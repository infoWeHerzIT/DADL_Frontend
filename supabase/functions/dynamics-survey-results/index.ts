import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// PROD-Variante: liest und aggregiert die Ergebnisse einer Umfrage aus der
// Dynamics-PROD-Umgebung. Eigene, klar benannte Secrets — getrennt von den
// DYNAMICS_*-Secrets der DEV-Function "dynamics-survey-results-dev".
// Read-only — keine Schreibzugriffe.
//
// Anders als dynamics-survey-get (das nur die Fragen/Optionen für die
// Anzeige des Formulars liefert) holt diese Function zusätzlich ALLE
// wht_surveyanswer-Zeilen zu den Fragen der Umfrage und aggregiert sie
// serverseitig: bei Auswahl-Fragen zu Häufigkeiten pro Option, bei
// Text/E-Mail/Telefon/Nummer-Fragen zu einer Liste der Einzelantworten.
const TENANT_ID     = Deno.env.get("DYNAMICS_PROD_TENANT_ID")!;
const CLIENT_ID     = Deno.env.get("DYNAMICS_PROD_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("DYNAMICS_PROD_CLIENT_SECRET")!;
const RESOURCE      = Deno.env.get("DYNAMICS_PROD_RESOURCE")!; // https://<org>.crm4.dynamics.com

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getAccessToken(): Promise<string> {
  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "client_credentials",
    scope: `${RESOURCE}/.default`,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Token-Anfrage fehlgeschlagen: ${res.status}`);
  const data = await res.json();
  return data.access_token as string;
}

// wht_type (Picklist auf wht_surveyquestion) — Options-Werte laut Dynamics-
// Konfiguration: 959230000=Multiple Choice, 959230001=Single Choice,
// 959230002=Text, 959230003=Email, 959230004=Phone, 959230005=Number.
function typeLabel(n: unknown): string {
  const num = typeof n === "number" ? n : Number(n);
  if (num === 959230000) return "mehrfachauswahl";
  if (num === 959230001) return "einmalauswahl";
  if (num === 959230002) return "text";
  if (num === 959230003) return "email";
  if (num === 959230004) return "telefon";
  if (num === 959230005) return "nummer";
  return "text";
}

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const url = new URL(req.url);
    const surveyId = (url.searchParams.get("id") || "").trim();
    if (!surveyId) return jsonResponse({ error: "Parameter 'id' fehlt" }, 400);
    if (!GUID_RE.test(surveyId)) return jsonResponse({ error: "Ungültige 'id'" }, 400);

    const token = await getAccessToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
    };

    // ── Survey selbst (Titel/Intro) — Auswertung soll auch für
    // deaktivierte Umfragen möglich sein, deshalb kein statecode-Filter. ──
    const surveySelect = "wht_surveyid,wht_title,wht_intro,wht_description,wht_slug,_wht_eventid_value";
    // wht_description2 (zweite Beschreibungsseite) ist ein neueres Feld — fehlt
    // es in dieser Umgebung noch, antwortet Dataverse mit 400; dann ohne lesen.
    let surveyRes = await fetch(`${RESOURCE}/api/data/v9.2/wht_surveies(${surveyId})?$select=${surveySelect},wht_description2`, { headers });
    if (surveyRes.status === 400) surveyRes = await fetch(`${RESOURCE}/api/data/v9.2/wht_surveies(${surveyId})?$select=${surveySelect}`, { headers });
    if (surveyRes.status === 404) return jsonResponse(null, 404);
    if (!surveyRes.ok) {
      console.error("Dataverse error (survey):", surveyRes.status, await surveyRes.text());
      return jsonResponse({ error: "CRM-Anfrage fehlgeschlagen" }, 502);
    }
    const survey = await surveyRes.json();

    // ── Fragen dieser Umfrage ──────────────────────────────────────
    const questionsUrl = `${RESOURCE}/api/data/v9.2/wht_surveyquestions?$filter=_wht_surveyid_value eq ${surveyId} and statecode eq 0&$orderby=wht_order asc`;
    const questionsRes = await fetch(questionsUrl, { headers });
    if (!questionsRes.ok) {
      console.error("Dataverse error (questions):", questionsRes.status, await questionsRes.text());
      return jsonResponse({ error: "CRM-Anfrage fehlgeschlagen" }, 502);
    }
    const questionsData = await questionsRes.json();
    const questionRows = (questionsData.value || []) as Record<string, unknown>[];
    const questionIds = questionRows.map((q) => String(q.wht_surveyquestionid));

    // ── Optionen aller Fragen (kein $select — analog zum etablierten
    // Muster in dynamics-survey-get) ──
    let optionsByQuestion: Record<string, Record<string, unknown>[]> = {};
    if (questionIds.length > 0) {
      const orFilter = questionIds.map((id) => `_wht_surveyquestionid_value eq ${id}`).join(" or ");
      const optionsUrl = `${RESOURCE}/api/data/v9.2/wht_surveyquestionoptions?$filter=(${orFilter}) and statecode eq 0&$orderby=wht_order asc`;
      const optionsRes = await fetch(optionsUrl, { headers });
      if (!optionsRes.ok) {
        console.error("Dataverse error (options):", optionsRes.status, await optionsRes.text());
      } else {
        const optionsData = await optionsRes.json();
        for (const opt of (optionsData.value || []) as Record<string, unknown>[]) {
          const qId = String(opt["_wht_surveyquestionid_value"]);
          if (!optionsByQuestion[qId]) optionsByQuestion[qId] = [];
          optionsByQuestion[qId].push(opt);
        }
      }
    }

    // ── Antwortenzahl (für "X Teilnehmer:innen") ────────────────────
    const responsesUrl = `${RESOURCE}/api/data/v9.2/wht_surveyresponses?$filter=_wht_surveyid_value eq ${surveyId}&$select=wht_surveyresponseid`;
    const responsesRes = await fetch(responsesUrl, { headers });
    let responseCount = 0;
    if (responsesRes.ok) {
      const responsesData = await responsesRes.json();
      responseCount = (responsesData.value || []).length;
    } else {
      console.error("Dataverse error (responses count):", responsesRes.status, await responsesRes.text());
    }

    // ── ALLE Antworten zu den Fragen dieser Umfrage laden (kein $select,
    // analog zum Options-Muster) — direkt über die Fragen-GUIDs gefiltert,
    // kein Umweg über Response-IDs nötig, da jede Frage genau einer
    // Umfrage gehört. ──
    let answersByQuestion: Record<string, Record<string, unknown>[]> = {};
    if (questionIds.length > 0) {
      const orFilter = questionIds.map((id) => `_wht_surveyquestionid_value eq ${id}`).join(" or ");
      const answersUrl = `${RESOURCE}/api/data/v9.2/wht_surveyanswers?$filter=(${orFilter})`;
      const answersRes = await fetch(answersUrl, { headers });
      if (!answersRes.ok) {
        console.error("Dataverse error (answers):", answersRes.status, await answersRes.text());
      } else {
        const answersData = await answersRes.json();
        for (const a of (answersData.value || []) as Record<string, unknown>[]) {
          const qId = String(a["_wht_surveyquestionid_value"]);
          if (!answersByQuestion[qId]) answersByQuestion[qId] = [];
          answersByQuestion[qId].push(a);
        }
      }
    }

    // ── Aggregation pro Frage ────────────────────────────────────────
    const questions = questionRows
      .sort((a, b) => (Number(a.wht_order) || 0) - (Number(b.wht_order) || 0))
      .map((q) => {
        const qId = String(q.wht_surveyquestionid);
        const type = typeLabel(q.wht_type);
        const isChoice = type === "mehrfachauswahl" || type === "einmalauswahl";
        const opts = (optionsByQuestion[qId] || [])
          .sort((a, b) => (Number(a.wht_order) || 0) - (Number(b.wht_order) || 0))
          .map((o) => ({
            id: o.wht_surveyquestionoptionid,
            label: o.wht_labeltext ?? "",
            order: o.wht_order ?? 0,
            allowsAdditionalInfo: !!o.wht_addmoreinformation,
          }));
        const qAnswers = answersByQuestion[qId] || [];

        if (isChoice) {
          const countByOption: Record<string, number> = {};
          const additionalInfoByOption: Record<string, string[]> = {};
          const respondentIds = new Set<string>();
          for (const a of qAnswers) {
            const optId = a["_wht_surveyquestionoptionid_value"];
            if (optId) {
              countByOption[String(optId)] = (countByOption[String(optId)] || 0) + 1;
              const info = String(a.wht_moreinformation ?? "").trim();
              if (info) (additionalInfoByOption[String(optId)] ||= []).push(info);
            }
            const respId = a["_wht_surveyresponseid_value"];
            if (respId) respondentIds.add(String(respId));
          }
          const optionsWithCounts = opts.map((o) => ({
            id: o.id,
            label: o.label,
            order: o.order,
            count: countByOption[String(o.id)] || 0,
            allowsAdditionalInfo: o.allowsAdditionalInfo,
            // Freitexte, die Teilnehmer:innen bei dieser Option zusätzlich
            // eingetragen haben (nur relevant, wenn o.allowsAdditionalInfo).
            additionalInfo: additionalInfoByOption[String(o.id)] || [],
          }));
          return {
            id: qId,
            order: q.wht_order ?? 0,
            label: q.wht_surveyquestion1 ?? "",
            hint: q.wht_label ?? "",
            type,
            required: !!q.wht_isrequired,
            totalAnswered: respondentIds.size,
            options: optionsWithCounts,
            textAnswers: [] as string[],
          };
        }

        const textAnswers = qAnswers
          .map((a) => String(a.wht_value ?? "").trim())
          .filter((v) => v.length > 0);
        return {
          id: qId,
          order: q.wht_order ?? 0,
          label: q.wht_surveyquestion1 ?? "",
          hint: q.wht_label ?? "",
          type,
          required: !!q.wht_isrequired,
          totalAnswered: textAnswers.length,
          options: [] as unknown[],
          textAnswers,
        };
      });

    return jsonResponse(
      {
        survey: {
          id: surveyId,
          title: survey.wht_title ?? "",
          intro: survey.wht_intro ?? "",
          description: survey.wht_description ?? "",
          description2: survey.wht_description2 ?? "",
          slug: survey.wht_slug ?? "",
          eventId: survey._wht_eventid_value ?? null,
        },
        responseCount,
        questions,
      },
      200
    );
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Interner Fehler" }, 500);
  }
});
