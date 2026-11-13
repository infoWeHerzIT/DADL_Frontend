import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// DEV-Variante von dynamics-survey-get: liest aus der Dynamics-DEV-Umgebung.
// Nutzt die bereits vorhandenen DYNAMICS_*-Secrets (DEV-Zugangsdaten) —
// getrennt von den DYNAMICS_PROD_*-Secrets der PROD-Function
// "dynamics-survey-get". Read-only — keine Schreibzugriffe.
const TENANT_ID     = Deno.env.get("DYNAMICS_TENANT_ID")!;
const CLIENT_ID     = Deno.env.get("DYNAMICS_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("DYNAMICS_CLIENT_SECRET")!;
const RESOURCE      = Deno.env.get("DYNAMICS_RESOURCE")!; // https://<org>.crm4.dynamics.com

// DEV: Der Origin variiert beim lokalen Testen — deshalb hier bewusst NICHT
// wie bei PROD auf das feste ALLOWED_ORIGIN-Secret eingeschränkt.
const ALLOWED_ORIGIN = "*";

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
// Konfiguration, direkt vom Nutzer angegeben:
// 959230000=Multiple Choice, 959230001=Single Choice, 959230002=Text,
// 959230003=Email, 959230004=Phone, 959230005=Number.
function typeLabel(n: unknown): string {
  const num = typeof n === "number" ? n : Number(n);
  if (num === 959230000) return "mehrfachauswahl";
  if (num === 959230001) return "einmalauswahl";
  if (num === 959230002) return "text";
  if (num === 959230003) return "email";
  if (num === 959230004) return "telefon";
  if (num === 959230005) return "nummer";
  return "text"; // unbekannter Wert: sicherer Fallback
}

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// wht_survey-Felder, die für beide Lookup-Wege (per "id" oder per "slug")
// gebraucht werden. "_wht_eventid_value" ist die Schatten-FK-Property des
// Lookups wht_eventid — liefert die rohe Event-GUID ohne $expand.
const SURVEY_SELECT = "wht_surveyid,wht_title,wht_intro,wht_description,wht_slug,_wht_eventid_value,statecode";

// wht_description2 = zweite Beschreibungsseite (Rich-Text wie wht_description).
// Das Feld ist neuer als die übrigen — existiert es in dieser Dynamics-
// Umgebung (noch) nicht, antwortet Dataverse auf das $select mit 400. Dann
// wird ohne das Feld noch einmal gelesen, damit die Umfrage trotzdem lädt.
async function fetchSurvey(buildUrl: (select: string) => string, headers: HeadersInit): Promise<Response> {
  const res = await fetch(buildUrl(SURVEY_SELECT + ",wht_description2"), { headers });
  if (res.status !== 400) return res;
  return await fetch(buildUrl(SURVEY_SELECT), { headers });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const url = new URL(req.url);
    const slug = (url.searchParams.get("slug") || "").trim();
    const idParam = (url.searchParams.get("id") || "").trim();
    if (!slug && !idParam) return jsonResponse({ error: "Parameter 'slug' oder 'id' fehlt" }, 400);
    if (idParam && !GUID_RE.test(idParam)) return jsonResponse({ error: "Ungültige 'id'" }, 400);

    const token = await getAccessToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
    };

    // Entity-Set-Name laut Dataverse-Metadaten ist "wht_surveies" (nicht
    // "wht_surveys" — Dataverse pluralisiert "survey" eigenwillig, wie
    // schon bei wht_paymentlinks -> wht_paymentlinkses).
    let survey: Record<string, unknown> | undefined;
    if (idParam) {
      const surveyRes = await fetchSurvey((select) => `${RESOURCE}/api/data/v9.2/wht_surveies(${idParam})?$select=${select}`, headers);
      if (surveyRes.status === 404) return jsonResponse(null, 404);
      if (!surveyRes.ok) {
        console.error("Dataverse error (survey by id):", surveyRes.status, await surveyRes.text());
        return jsonResponse({ error: "CRM-Anfrage fehlgeschlagen" }, 502);
      }
      const surveyRow = await surveyRes.json();
      // Deaktivierte Umfragen sollen genauso "nicht verfügbar" sein wie per
      // Slug — direkter Key-Zugriff kennt kein $filter, daher hier geprüft.
      survey = Number(surveyRow.statecode) === 0 ? surveyRow : undefined;
    } else {
      const slugEscaped = slug.replace(/'/g, "''");
      const surveyRes = await fetchSurvey((select) => `${RESOURCE}/api/data/v9.2/wht_surveies?$select=${select}&$filter=wht_slug eq '${slugEscaped}' and statecode eq 0`, headers);
      if (!surveyRes.ok) {
        console.error("Dataverse error (survey by slug):", surveyRes.status, await surveyRes.text());
        return jsonResponse({ error: "CRM-Anfrage fehlgeschlagen" }, 502);
      }
      const surveyData = await surveyRes.json();
      survey = (surveyData.value || [])[0];
    }
    if (!survey) return jsonResponse(null, 404);

    const surveyId = survey.wht_surveyid as string;

    // Fragen dieser Umfrage — Filter direkt auf die Schatten-FK-Property
    // (_wht_surveyid_value), kein $select (analog zum etablierten Muster
    // bei wht_paymentlinks/wht_event).
    const questionsUrl = `${RESOURCE}/api/data/v9.2/wht_surveyquestions?$filter=_wht_surveyid_value eq ${surveyId} and statecode eq 0&$orderby=wht_order asc`;
    const questionsRes = await fetch(questionsUrl, { headers });
    if (!questionsRes.ok) {
      console.error("Dataverse error (questions):", questionsRes.status, await questionsRes.text());
      return jsonResponse({ error: "CRM-Anfrage fehlgeschlagen" }, 502);
    }
    const questionsData = await questionsRes.json();
    const questionRows = (questionsData.value || []) as Record<string, unknown>[];
    const questionIds = questionRows.map((q) => String(q.wht_surveyquestionid));

    // Optionen NUR für die Fragen dieser Umfrage laden (OR-verketteter
    // Filter über die Frage-GUIDs) — Optionen sammeln sich über ALLE je
    // erstellten Umfragen an, ein ungefilterter Fetch würde mit der Zeit
    // immer langsamer werden.
    let optionsByQuestion: Record<string, Record<string, unknown>[]> = {};
    if (questionIds.length > 0) {
      const orFilter = questionIds.map((id) => `_wht_surveyquestionid_value eq ${id}`).join(" or ");
      const optionsUrl = `${RESOURCE}/api/data/v9.2/wht_surveyquestionoptions?$filter=(${orFilter}) and statecode eq 0&$orderby=wht_order asc`;
      const optionsRes = await fetch(optionsUrl, { headers });
      if (!optionsRes.ok) {
        // Optionen sind nicht kritisch fürs Anzeigen der Fragen — bei Fehlern
        // einfach ohne Optionen weitermachen (Fragen selbst bleiben nutzbar).
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

    const questions = questionRows
      .sort((a, b) => (Number(a.wht_order) || 0) - (Number(b.wht_order) || 0))
      .map((q) => {
        const qId = String(q.wht_surveyquestionid);
        const opts = (optionsByQuestion[qId] || [])
          .sort((a, b) => (Number(a.wht_order) || 0) - (Number(b.wht_order) || 0))
          .map((o) => ({
            id: o.wht_surveyquestionoptionid,
            label: o.wht_labeltext ?? "",
            order: o.wht_order ?? 0,
            requiresName: !!o.wht_makenamerequired,
            requiresSurname: !!o.wht_makesurnamerequired,
            requiresEmail: !!o.wht_makeemailrequired,
            requiresPhone: !!o.wht_makephonerequired,
            // wht_addmoreinformation: bei dieser Option zeigt das Formular
            // zusätzlich ein Freitextfeld unter dem Options-Label an (z. B.
            // "Sonstiges, und zwar: ___"), siehe DynamicSurveyRenderer.
            allowsAdditionalInfo: !!o.wht_addmoreinformation,
          }));
        return {
          id: qId,
          order: q.wht_order ?? 0,
          // wht_surveyquestion1 (Primary-Name-Feld) trägt die eigentliche
          // Frage, wht_label ist ein optionaler Hinweistext daneben (z. B.
          // "Erzähl es mir mit deinen eigenen Worten.") — nur gefüllt, wenn
          // beim Anlegen der Frage ein solcher Hinweis vergeben wurde.
          label: q.wht_surveyquestion1 ?? "",
          hint: q.wht_label ?? "",
          type: typeLabel(q.wht_type),
          required: !!q.wht_isrequired,
          options: opts,
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
          eventId: survey["_wht_eventid_value"] || null,
        },
        questions,
      },
      200
    );
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Interner Fehler" }, 500);
  }
});
