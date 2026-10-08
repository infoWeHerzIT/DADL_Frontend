import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// PROD-Variante: liefert die EINZELNEN Responses einer Umfrage (nicht
// aggregiert wie dynamics-survey-results) — je Response die zugehörige
// Lead-Info (falls vorhanden) und die Antworten je Frage in Fragen-
// Reihenfolge. Read-only — keine Schreibzugriffe.
const TENANT_ID     = Deno.env.get("DYNAMICS_PROD_TENANT_ID")!;
const CLIENT_ID     = Deno.env.get("DYNAMICS_PROD_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("DYNAMICS_PROD_CLIENT_SECRET")!;
const RESOURCE      = Deno.env.get("DYNAMICS_PROD_RESOURCE")!;

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

    // ── Fragen dieser Umfrage (für Reihenfolge/Beschriftung je Antwort) ──
    const questionsUrl = `${RESOURCE}/api/data/v9.2/wht_surveyquestions?$select=wht_surveyquestionid,wht_surveyquestion1,wht_order,wht_type&$filter=_wht_surveyid_value eq ${surveyId} and statecode eq 0&$orderby=wht_order asc`;
    const questionsRes = await fetch(questionsUrl, { headers });
    if (!questionsRes.ok) {
      console.error("Dataverse error (questions):", questionsRes.status, await questionsRes.text());
      return jsonResponse({ error: "CRM-Anfrage fehlgeschlagen" }, 502);
    }
    const questionsData = await questionsRes.json();
    const questionRows = (questionsData.value || []) as Record<string, unknown>[];
    const questionIds = questionRows.map((q) => String(q.wht_surveyquestionid));
    // Fragen vom Typ E-Mail (959230003) / Phone (959230004) enthalten personenbezogene
    // Kontaktdaten und werden nicht ausgeliefert.
    const sensitiveQuestionIds = new Set<string>();
    const questionsById: Record<string, { order: number; label: string }> = {};
    for (const q of questionRows) {
      const qType = Number(q.wht_type);
      if (qType === 959230003 || qType === 959230004) { sensitiveQuestionIds.add(String(q.wht_surveyquestionid)); continue; }
      questionsById[String(q.wht_surveyquestionid)] = {
        order: Number(q.wht_order) || 0,
        label: String(q.wht_surveyquestion1 ?? ""),
      };
    }

    // ── Alle Responses dieser Umfrage, mit Lead-Daten (falls verknüpft) ──
    const responsesUrl =
      `${RESOURCE}/api/data/v9.2/wht_surveyresponses?$select=wht_surveyresponseid,wht_responsename,createdon` +
      `&$filter=_wht_surveyid_value eq ${surveyId}&$orderby=createdon desc` +
      `&$expand=wht_Lead($select=wht_leadname,wht_vorname,wht_name)`;
    const responsesRes = await fetch(responsesUrl, { headers });
    if (!responsesRes.ok) {
      console.error("Dataverse error (responses):", responsesRes.status, await responsesRes.text());
      return jsonResponse({ error: "CRM-Anfrage fehlgeschlagen" }, 502);
    }
    const responsesData = await responsesRes.json();
    const responseRows = (responsesData.value || []) as Record<string, unknown>[];

    // ── Alle Antworten zu den Fragen dieser Umfrage laden, nach Response
    // gruppieren (wht_value ist bereits der anzeigbare Text — bei
    // Auswahl-Fragen das Options-Label, siehe crm-survey-response-submit) ──
    // Bewusst KEIN $select (analog zum Muster in dynamics-survey-results):
    // ein $select auf ein (noch) nicht existierendes/veröffentlichtes Feld
    // wie wht_moreinformation lässt Dataverse die GESAMTE Anfrage mit
    // 400 ablehnen, statt das Feld nur wegzulassen — dann blieben ALLE
    // Antworten leer, nicht nur die neuen Freitexte.
    let answersByResponse: Record<string, Record<string, unknown>[]> = {};
    if (questionIds.length > 0) {
      const orFilter = questionIds.map((id) => `_wht_surveyquestionid_value eq ${id}`).join(" or ");
      const answersUrl = `${RESOURCE}/api/data/v9.2/wht_surveyanswers?$filter=(${orFilter})`;
      const answersRes = await fetch(answersUrl, { headers });
      if (!answersRes.ok) {
        console.error("Dataverse error (answers):", answersRes.status, await answersRes.text());
      } else {
        const answersData = await answersRes.json();
        for (const a of (answersData.value || []) as Record<string, unknown>[]) {
          const respId = String(a["_wht_surveyresponseid_value"]);
          if (!answersByResponse[respId]) answersByResponse[respId] = [];
          answersByResponse[respId].push(a);
        }
      }
    }

    const responses = responseRows.map((r) => {
      const respId = String(r.wht_surveyresponseid);
      const lead = r["wht_Lead"] as Record<string, unknown> | null;

      // Antworten dieser Response nach Frage gruppieren — bei Mehrfach-
      // auswahl gibt es mehrere Zeilen je Frage, deren Labels zusammen-
      // gefasst werden. Freitexte aus wht_moreinformation (befüllt,
      // wenn die gewählte Option wht_addmoreinformation=ja hat) werden
      // separat gesammelt, statt in den Wert eingemischt — die aufrufende
      // Seite zeigt sie als eigene Zeile unter der Antwort an.
      const valuesByQuestion: Record<string, string[]> = {};
      const infoByQuestion: Record<string, string[]> = {};
      for (const a of answersByResponse[respId] || []) {
        const qId = String(a["_wht_surveyquestionid_value"]);
        if (sensitiveQuestionIds.has(qId)) continue;
        const val = String(a.wht_value ?? "").trim();
        if (!val) continue;
        if (!valuesByQuestion[qId]) valuesByQuestion[qId] = [];
        valuesByQuestion[qId].push(val);

        const additionalInfo = String(a.wht_moreinformation ?? "").trim();
        if (additionalInfo) {
          if (!infoByQuestion[qId]) infoByQuestion[qId] = [];
          infoByQuestion[qId].push(additionalInfo);
        }
      }

      const answers = Object.keys(valuesByQuestion)
        .map((qId) => ({
          questionId: qId,
          order: questionsById[qId]?.order ?? 0,
          questionLabel: questionsById[qId]?.label ?? "",
          value: valuesByQuestion[qId].join(", "),
          additionalInfo: infoByQuestion[qId] || [],
        }))
        .sort((a, b) => a.order - b.order);

      return {
        id: respId,
        createdOn: r.createdon ?? null,
        lead: lead
          ? {
              name: lead.wht_leadname ?? [lead.wht_vorname, lead.wht_name].filter(Boolean).join(" "),
            }
          : null,
        answers,
      };
    });

    return jsonResponse({ responses }, 200);
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Interner Fehler" }, 500);
  }
});
