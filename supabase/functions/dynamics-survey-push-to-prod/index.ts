import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// Kopiert/synchronisiert eine Umfrage (wht_survey + wht_surveyquestion +
// wht_surveyquestionoption) von Dynamics DEV nach Dynamics PROD. Anders als
// alle übrigen dynamics-*-Functions spricht diese Function BEIDE Umgebungen
// an (DEV zum Lesen, PROD zum Schreiben) — deshalb kein "-dev"-Gegenstück,
// die Richtung ist immer DEV → PROD.
//
// Verhalten: UPSERT anhand von wht_slug. Existiert in PROD noch keine
// Umfrage mit diesem Slug, wird sie komplett neu angelegt (inkl. Fragen/
// Optionen). Existiert sie bereits, werden Titel/Intro/Beschreibung sowie
// Fragen/Optionen PER POSITION (wht_order) synchronisiert (PATCH), fehlende
// Fragen/Optionen werden ergänzt (POST). Überzählige PROD-Fragen/-Optionen
// (die es in DEV nicht mehr gibt) werden NIE gelöscht — an ihnen können
// bereits Antworten (wht_surveyanswer) hängen; sie werden nur als Warnung
// gemeldet, damit man sie bei Bedarf manuell aufräumt.
//
// Der Event-Link (wht_eventid) wird NUR beim Erstanlegen gesetzt (per
// Namensabgleich zwischen DEV- und PROD-Events) — bei einem bereits
// existierenden PROD-Survey wird eine dort ggf. manuell gesetzte
// Event-Verknüpfung nie überschrieben.
const DEV_TENANT_ID     = Deno.env.get("DYNAMICS_TENANT_ID")!;
const DEV_CLIENT_ID     = Deno.env.get("DYNAMICS_CLIENT_ID")!;
const DEV_CLIENT_SECRET = Deno.env.get("DYNAMICS_CLIENT_SECRET")!;
const DEV_RESOURCE      = Deno.env.get("DYNAMICS_RESOURCE")!;

const PROD_TENANT_ID     = Deno.env.get("DYNAMICS_PROD_TENANT_ID")!;
const PROD_CLIENT_ID     = Deno.env.get("DYNAMICS_PROD_CLIENT_ID")!;
const PROD_CLIENT_SECRET = Deno.env.get("DYNAMICS_PROD_CLIENT_SECRET")!;
const PROD_RESOURCE      = Deno.env.get("DYNAMICS_PROD_RESOURCE")!;

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

async function getToken(tenantId: string, clientId: string, clientSecret: string, resource: string): Promise<string> {
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: `${resource}/.default`,
  });
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!res.ok) throw new Error(`Token-Anfrage fehlgeschlagen: ${res.status}`);
  const data = await res.json();
  return data.access_token as string;
}

const dataverseHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  Accept: "application/json",
  "OData-MaxVersion": "4.0",
  "OData-Version": "4.0",
});

function extractId(res: Response): string | null {
  const header = res.headers.get("OData-EntityId") || res.headers.get("odata-entityid");
  if (!header) return null;
  const m = header.match(/\(([0-9a-fA-F-]{36})\)/);
  return m ? m[1] : null;
}

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Schreibt die Umfrage-Kopffelder nach PROD. wht_description2 (zweite
// Beschreibungsseite) wird mitgeschickt, wenn DEV das Feld geliefert hat;
// kennt PROD das Feld noch nicht (400), noch einmal ohne — mit Warnung.
async function writeProdSurvey(url: string, method: string, fields: Record<string, unknown>, description2: unknown, headers: HeadersInit, warnings: string[]): Promise<Response> {
  if (description2 !== undefined) {
    const res = await fetch(url, { method, headers, body: JSON.stringify({ ...fields, wht_description2: description2 ?? "" }) });
    if (res.status !== 400) return res;
    warnings.push("Feld wht_description2 existiert in PROD noch nicht — die zweite Beschreibung wurde nicht übertragen.");
  }
  return await fetch(url, { method, headers, body: JSON.stringify(fields) });
}

type DevOption = {
  wht_surveyquestionoptionid: string;
  wht_labeltext: string;
  wht_order: number;
  wht_makenamerequired: boolean;
  wht_makesurnamerequired: boolean;
  wht_makeemailrequired: boolean;
  wht_makephonerequired: boolean;
  wht_addmoreinformation: boolean;
};
type DevQuestion = {
  wht_surveyquestionid: string;
  wht_surveyquestion1: string;
  wht_label: string | null;
  wht_type: number;
  wht_order: number;
  wht_isrequired: boolean;
  options: DevOption[];
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const payload = await req.json().catch(() => ({}));
    const surveyId = String(payload.id ?? "").trim();
    if (!surveyId || !GUID_RE.test(surveyId)) return jsonResponse({ error: "Ungültige oder fehlende 'id' (DEV-Umfrage-GUID)" }, 400);

    const devToken = await getToken(DEV_TENANT_ID, DEV_CLIENT_ID, DEV_CLIENT_SECRET, DEV_RESOURCE);
    const devHeaders = dataverseHeaders(devToken);

    // ── 1. Umfrage + Fragen + Optionen aus DEV lesen ──────────────────
    const warnings: string[] = [];
    const surveySelect = "wht_surveyid,wht_title,wht_intro,wht_description,wht_slug,_wht_eventid_value,statecode";
    // wht_description2 (zweite Beschreibungsseite) ist ein neueres Feld — fehlt
    // es in DEV noch, antwortet Dataverse mit 400; dann ohne das Feld lesen.
    let surveyRes = await fetch(`${DEV_RESOURCE}/api/data/v9.2/wht_surveies(${surveyId})?$select=${surveySelect},wht_description2`, { headers: devHeaders });
    if (surveyRes.status === 400) surveyRes = await fetch(`${DEV_RESOURCE}/api/data/v9.2/wht_surveies(${surveyId})?$select=${surveySelect}`, { headers: devHeaders });
    if (surveyRes.status === 404) return jsonResponse({ error: "Umfrage in DEV nicht gefunden" }, 404);
    if (!surveyRes.ok) return jsonResponse({ step: "dev-survey", status: surveyRes.status, error: await surveyRes.text() }, 502);
    const devSurvey = await surveyRes.json();
    const slug = String(devSurvey.wht_slug ?? "").trim();
    if (!slug) return jsonResponse({ error: "Umfrage in DEV hat keinen Slug — Abbruch" }, 400);

    const questionsRes = await fetch(
      `${DEV_RESOURCE}/api/data/v9.2/wht_surveyquestions?$filter=_wht_surveyid_value eq ${surveyId} and statecode eq 0&$orderby=wht_order asc`,
      { headers: devHeaders }
    );
    if (!questionsRes.ok) return jsonResponse({ step: "dev-questions", status: questionsRes.status, error: await questionsRes.text() }, 502);
    const questionRows = ((await questionsRes.json()).value || []) as Record<string, unknown>[];
    const questionIds = questionRows.map((q) => String(q.wht_surveyquestionid));

    let optionsByQuestion: Record<string, DevOption[]> = {};
    if (questionIds.length > 0) {
      const orFilter = questionIds.map((id) => `_wht_surveyquestionid_value eq ${id}`).join(" or ");
      const optionsRes = await fetch(
        `${DEV_RESOURCE}/api/data/v9.2/wht_surveyquestionoptions?$filter=(${orFilter}) and statecode eq 0&$orderby=wht_order asc`,
        { headers: devHeaders }
      );
      if (!optionsRes.ok) return jsonResponse({ step: "dev-options", status: optionsRes.status, error: await optionsRes.text() }, 502);
      for (const opt of ((await optionsRes.json()).value || []) as Record<string, unknown>[]) {
        const qId = String(opt["_wht_surveyquestionid_value"]);
        (optionsByQuestion[qId] ||= []).push({
          wht_surveyquestionoptionid: String(opt.wht_surveyquestionoptionid),
          wht_labeltext: String(opt.wht_labeltext ?? ""),
          wht_order: Number(opt.wht_order) || 0,
          wht_makenamerequired: !!opt.wht_makenamerequired,
          wht_makesurnamerequired: !!opt.wht_makesurnamerequired,
          wht_makeemailrequired: !!opt.wht_makeemailrequired,
          wht_makephonerequired: !!opt.wht_makephonerequired,
          wht_addmoreinformation: !!opt.wht_addmoreinformation,
        });
      }
    }

    const devQuestions: DevQuestion[] = questionRows
      .map((q) => ({
        wht_surveyquestionid: String(q.wht_surveyquestionid),
        wht_surveyquestion1: String(q.wht_surveyquestion1 ?? ""),
        wht_label: q.wht_label != null ? String(q.wht_label) : null,
        wht_type: Number(q.wht_type) || 0,
        wht_order: Number(q.wht_order) || 0,
        wht_isrequired: !!q.wht_isrequired,
        options: (optionsByQuestion[String(q.wht_surveyquestionid)] || []).sort((a, b) => a.wht_order - b.wht_order),
      }))
      .sort((a, b) => a.wht_order - b.wht_order);

    // ── 2. PROD-Zugang + bestehende Ziel-Umfrage (per Slug) suchen ────
    const prodToken = await getToken(PROD_TENANT_ID, PROD_CLIENT_ID, PROD_CLIENT_SECRET, PROD_RESOURCE);
    const prodHeaders = dataverseHeaders(prodToken);
    const slugEscaped = slug.replace(/'/g, "''");

    const existingRes = await fetch(
      `${PROD_RESOURCE}/api/data/v9.2/wht_surveies?$select=wht_surveyid&$filter=wht_slug eq '${slugEscaped}'`,
      { headers: prodHeaders }
    );
    if (!existingRes.ok) return jsonResponse({ step: "prod-lookup", status: existingRes.status, error: await existingRes.text() }, 502);
    const existingMatch = ((await existingRes.json()).value || [])[0] as Record<string, unknown> | undefined;

    let prodSurveyId: string;
    let surveyAction: "created" | "updated";

    if (existingMatch) {
      prodSurveyId = String(existingMatch.wht_surveyid);
      surveyAction = "updated";
      const patchRes = await writeProdSurvey(`${PROD_RESOURCE}/api/data/v9.2/wht_surveies(${prodSurveyId})`, "PATCH", {
        wht_title: devSurvey.wht_title ?? "",
        wht_intro: devSurvey.wht_intro ?? "",
        wht_description: devSurvey.wht_description ?? "",
      }, devSurvey.wht_description2, prodHeaders, warnings);
      if (!patchRes.ok) return jsonResponse({ step: "prod-survey-update", status: patchRes.status, error: await patchRes.text() }, 502);
    } else {
      surveyAction = "created";
      const createFields: Record<string, unknown> = {
        wht_title: devSurvey.wht_title ?? "",
        wht_intro: devSurvey.wht_intro ?? "",
        wht_description: devSurvey.wht_description ?? "",
        wht_slug: slug,
      };

      // Event-Verknüpfung nur beim Neuanlegen versuchen: DEV-Eventnamen lesen
      // und per exaktem Namensabgleich (case-insensitive) ein PROD-Event
      // suchen. DEV- und PROD-Events haben unterschiedliche GUIDs (getrennte
      // Umgebungen) — eine 1:1-ID-Übernahme ist nie möglich.
      const devEventId = devSurvey["_wht_eventid_value"] as string | null;
      if (devEventId) {
        const devEventRes = await fetch(`${DEV_RESOURCE}/api/data/v9.2/wht_events(${devEventId})?$select=wht_name`, { headers: devHeaders });
        if (devEventRes.ok) {
          const devEventName = String((await devEventRes.json()).wht_name ?? "").trim();
          if (devEventName) {
            const nameEscaped = devEventName.replace(/'/g, "''");
            const prodEventRes = await fetch(
              `${PROD_RESOURCE}/api/data/v9.2/wht_events?$select=wht_eventid&$filter=wht_name eq '${nameEscaped}'`,
              { headers: prodHeaders }
            );
            if (prodEventRes.ok) {
              const prodEventMatch = ((await prodEventRes.json()).value || [])[0] as Record<string, unknown> | undefined;
              if (prodEventMatch) createFields["wht_EventId@odata.bind"] = `/wht_events(${prodEventMatch.wht_eventid})`;
            }
          }
        }
      }

      const createRes = await writeProdSurvey(`${PROD_RESOURCE}/api/data/v9.2/wht_surveies`, "POST", createFields, devSurvey.wht_description2, prodHeaders, warnings);
      if (!createRes.ok) return jsonResponse({ step: "prod-survey-create", status: createRes.status, error: await createRes.text() }, 502);
      const newId = extractId(createRes);
      if (!newId) return jsonResponse({ step: "prod-survey-create", error: "Keine Survey-ID im OData-EntityId-Header" }, 502);
      prodSurveyId = newId;
    }

    // ── 3. Bestehende PROD-Fragen dieser Umfrage laden (für Positions-Abgleich) ──
    const prodQuestionsRes = await fetch(
      `${PROD_RESOURCE}/api/data/v9.2/wht_surveyquestions?$select=wht_surveyquestionid,wht_order&$filter=_wht_surveyid_value eq ${prodSurveyId} and statecode eq 0&$orderby=wht_order asc`,
      { headers: prodHeaders }
    );
    if (!prodQuestionsRes.ok) return jsonResponse({ step: "prod-questions-list", status: prodQuestionsRes.status, error: await prodQuestionsRes.text() }, 502);
    const prodQuestionRows = ((await prodQuestionsRes.json()).value || []) as Record<string, unknown>[];
    const prodQuestionByOrder: Record<number, string> = {};
    for (const q of prodQuestionRows) prodQuestionByOrder[Number(q.wht_order) || 0] = String(q.wht_surveyquestionid);

    let questionsCreated = 0;
    let questionsUpdated = 0;
    let optionsCreated = 0;
    let optionsUpdated = 0;

    // ── 4. Fragen + Optionen per Position (wht_order) synchronisieren ─
    for (const q of devQuestions) {
      let prodQuestionId = prodQuestionByOrder[q.wht_order];

      if (prodQuestionId) {
        questionsUpdated++;
        const patchRes = await fetch(`${PROD_RESOURCE}/api/data/v9.2/wht_surveyquestions(${prodQuestionId})`, {
          method: "PATCH",
          headers: prodHeaders,
          body: JSON.stringify({
            wht_surveyquestion1: q.wht_surveyquestion1,
            wht_label: q.wht_label,
            wht_type: q.wht_type,
            wht_isrequired: q.wht_isrequired,
            wht_order: q.wht_order,
          }),
        });
        if (!patchRes.ok) return jsonResponse({ step: "prod-question-update", order: q.wht_order, status: patchRes.status, error: await patchRes.text(), prodSurveyId }, 502);
      } else {
        questionsCreated++;
        const createRes = await fetch(`${PROD_RESOURCE}/api/data/v9.2/wht_surveyquestions`, {
          method: "POST",
          headers: prodHeaders,
          body: JSON.stringify({
            wht_surveyquestion1: q.wht_surveyquestion1,
            wht_label: q.wht_label,
            wht_type: q.wht_type,
            wht_order: q.wht_order,
            wht_isrequired: q.wht_isrequired,
            "wht_SurveyID@odata.bind": `/wht_surveies(${prodSurveyId})`,
          }),
        });
        if (!createRes.ok) return jsonResponse({ step: "prod-question-create", order: q.wht_order, status: createRes.status, error: await createRes.text(), prodSurveyId }, 502);
        const newQId = extractId(createRes);
        if (!newQId) return jsonResponse({ step: "prod-question-create", order: q.wht_order, error: "Keine Question-ID im Header", prodSurveyId }, 502);
        prodQuestionId = newQId;
      }

      const prodOptionsRes = await fetch(
        `${PROD_RESOURCE}/api/data/v9.2/wht_surveyquestionoptions?$select=wht_surveyquestionoptionid,wht_order&$filter=_wht_surveyquestionid_value eq ${prodQuestionId} and statecode eq 0&$orderby=wht_order asc`,
        { headers: prodHeaders }
      );
      if (!prodOptionsRes.ok) return jsonResponse({ step: "prod-options-list", order: q.wht_order, status: prodOptionsRes.status, error: await prodOptionsRes.text(), prodSurveyId }, 502);
      const prodOptionRows = ((await prodOptionsRes.json()).value || []) as Record<string, unknown>[];
      const prodOptionByOrder: Record<number, string> = {};
      for (const o of prodOptionRows) prodOptionByOrder[Number(o.wht_order) || 0] = String(o.wht_surveyquestionoptionid);

      for (const opt of q.options) {
        const prodOptionId = prodOptionByOrder[opt.wht_order];
        const optFields = {
          wht_labeltext: opt.wht_labeltext,
          wht_order: opt.wht_order,
          wht_makenamerequired: opt.wht_makenamerequired,
          wht_makesurnamerequired: opt.wht_makesurnamerequired,
          wht_makeemailrequired: opt.wht_makeemailrequired,
          wht_makephonerequired: opt.wht_makephonerequired,
          wht_addmoreinformation: opt.wht_addmoreinformation,
        };
        if (prodOptionId) {
          optionsUpdated++;
          const patchRes = await fetch(`${PROD_RESOURCE}/api/data/v9.2/wht_surveyquestionoptions(${prodOptionId})`, {
            method: "PATCH",
            headers: prodHeaders,
            body: JSON.stringify(optFields),
          });
          if (!patchRes.ok) return jsonResponse({ step: "prod-option-update", questionOrder: q.wht_order, optionOrder: opt.wht_order, status: patchRes.status, error: await patchRes.text(), prodSurveyId }, 502);
        } else {
          optionsCreated++;
          const createRes = await fetch(`${PROD_RESOURCE}/api/data/v9.2/wht_surveyquestionoptions`, {
            method: "POST",
            headers: prodHeaders,
            body: JSON.stringify({ ...optFields, "wht_SurveyQuestionID@odata.bind": `/wht_surveyquestions(${prodQuestionId})` }),
          });
          if (!createRes.ok) return jsonResponse({ step: "prod-option-create", questionOrder: q.wht_order, optionOrder: opt.wht_order, status: createRes.status, error: await createRes.text(), prodSurveyId }, 502);
        }
      }
    }

    const extraProdQuestionOrders = Object.keys(prodQuestionByOrder).map(Number).filter((o) => !devQuestions.some((q) => q.wht_order === o));

    return jsonResponse(
      {
        success: true,
        prodSurveyId,
        slug,
        surveyAction,
        questionsCreated,
        questionsUpdated,
        optionsCreated,
        optionsUpdated,
        warnings: warnings.concat(extraProdQuestionOrders.length > 0
          ? [`PROD hat ${extraProdQuestionOrders.length} zusätzliche Frage(n) (Position ${extraProdQuestionOrders.join(", ")}), die es in DEV nicht mehr gibt — wurden NICHT gelöscht.`]
          : []),
      },
      200
    );
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Interner Fehler", detail: String(err && (err as Error).message || err) }, 500);
  }
});
