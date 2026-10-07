import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// DEV-Variante von crm-survey-response-submit: schreibt gegen die
// Dynamics-DEV-Umgebung. Nutzt die bereits vorhandenen DYNAMICS_*-Secrets
// (DEV-Zugangsdaten) — getrennt von den DYNAMICS_PROD_*-Secrets der
// PROD-Function "crm-survey-response-submit".
//
// Legt IMMER einen neuen Lead an (wie crm-survey-submit, aber ohne
// wht_jsoncontent — die Antworten werden hier normalisiert als eigene
// wht_surveyanswer-Zeilen abgelegt statt als JSON-Blob), dann eine
// wht_surveyresponse (Klammer der Einreichung) und pro beantworteter
// Frage eine oder mehrere wht_surveyanswer-Zeilen.
//
// Schreibt in 3 Stufen (Lead -> Response -> N Answers) über einzelne
// @odata.bind-POSTs (kein Deep-Insert/$batch — beides unerprobte Mechanik
// in diesem Projekt). Die erzeugte GUID wird jeweils über den
// "OData-EntityId"-Response-Header gelesen (kein Prefer: return=representation
// nötig, da wir nur die ID brauchen).
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

const dataverseHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  Accept: "application/json",
  "OData-MaxVersion": "4.0",
  "OData-Version": "4.0",
});

// Liest die GUID des neu erzeugten Datensatzes aus dem "OData-EntityId"-
// Response-Header (Format: ".../wht_xyz(<guid>)"), statt per
// "Prefer: return=representation" den ganzen Datensatz zurückzuholen.
function extractIdFromEntityIdHeader(res: Response): string | null {
  const header = res.headers.get("OData-EntityId") || res.headers.get("odata-entityid");
  if (!header) return null;
  const m = header.match(/\(([0-9a-fA-F-]{36})\)/);
  return m ? m[1] : null;
}

type AnswerOption = { id?: string; label?: string; additionalInfo?: string };
type AnswerInput = { questionId?: string; value?: string; options?: AnswerOption[] };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const payload = await req.json();

    const firstname   = String(payload.firstname ?? "").trim();
    const lastnameRaw = String(payload.lastname ?? "").trim();
    const emailRaw    = String(payload.email ?? "").trim();
    const mobilephone = String(payload.mobilephone ?? "").trim();
    const eventId      = String(payload.eventId ?? "").trim();
    const surveyId      = String(payload.surveyId ?? "").trim();
    const newsletterOptIn = !!payload.newsletterOptIn;
    const emailOptIn = !!payload.emailOptIn;
    const answers: AnswerInput[] = Array.isArray(payload.answers) ? payload.answers : [];

    if (!surveyId) return jsonResponse({ error: "surveyId fehlt" }, 400);

    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw);
    const email = emailValid ? emailRaw : "";
    const lastname = lastnameRaw || firstname || email || mobilephone || "Umfrage-Teilnehmerin";
    const leadNameTrimmed = (firstname + " " + lastname).trim();

    const token = await getAccessToken();

    // ── Stufe 1: Lead anlegen — NUR wenn E-Mail oder Telefon vorliegt.
    // Ohne Kontaktweg ist ein Lead in Dynamics nutzlos; Response+Answers
    // werden trotzdem angelegt (siehe unten), nur ohne Lead-Verknüpfung.
    let leadId: string | null = null;
    if (email || mobilephone) {
      const leadFields: Record<string, unknown> = {
        wht_name:     lastname,
        wht_leadname: leadNameTrimmed,
      };
      if (firstname) leadFields.wht_vorname = firstname;
      if (email)     leadFields.wht_email1  = email;
      if (mobilephone) leadFields.wht_phone1 = mobilephone;
      if (eventId) leadFields["wht_EventId@odata.bind"] = `/wht_events(${eventId})`;
      // Wie bei crm-submit: Zustimmungsfelder speichern den Zeitpunkt der
      // Zustimmung als Datum, kein Bool — nur gesetzt, wenn die Checkbox
      // aktiv war.
      if (newsletterOptIn || emailOptIn) {
        const optInIso = new Date().toISOString();
        if (newsletterOptIn) leadFields.wht_optinnewsletterdatetime = optInIso;
        if (emailOptIn) leadFields.wht_optinemaildatetime = optInIso;
      }

      const leadRes = await fetch(`${RESOURCE}/api/data/v9.2/wht_leads`, {
        method: "POST",
        headers: dataverseHeaders(token),
        body: JSON.stringify(leadFields),
      });
      if (!leadRes.ok) {
        console.error("Dataverse error (lead):", leadRes.status, await leadRes.text());
        return jsonResponse({ error: "CRM-Anfrage fehlgeschlagen (Lead)" }, 502);
      }
      leadId = extractIdFromEntityIdHeader(leadRes);
    }

    // ── Stufe 2: Survey-Response anlegen ────────────────────────────
    // wht_responsename ist das Primary-Name-Feld von wht_surveyresponse
    // (laut Dataverse-Metadaten) — ohne das bleibt der Datensatz in jeder
    // Dynamics-Ansicht/-Lookup namenlos.
    const nowIso = new Date().toISOString();
    const responseFields: Record<string, unknown> = {
      "wht_SurveyID@odata.bind": `/wht_surveies(${surveyId})`,
      wht_responsename: leadNameTrimmed + " – " + nowIso,
    };
    if (leadId) responseFields["wht_Lead@odata.bind"] = `/wht_leads(${leadId})`;

    const responseRes = await fetch(`${RESOURCE}/api/data/v9.2/wht_surveyresponses`, {
      method: "POST",
      headers: dataverseHeaders(token),
      body: JSON.stringify(responseFields),
    });
    if (!responseRes.ok) {
      console.error("Dataverse error (survey response):", responseRes.status, await responseRes.text(), "leadId:", leadId);
      return jsonResponse({ error: "CRM-Anfrage fehlgeschlagen (Response)" }, 502);
    }
    const responseId = extractIdFromEntityIdHeader(responseRes);
    if (!responseId) {
      console.error("Konnte Response-GUID nicht aus OData-EntityId-Header lesen. leadId:", leadId);
      return jsonResponse({ error: "CRM-Anfrage fehlgeschlagen (Response-ID)" }, 502);
    }

    // ── Stufe 3: Antworten anlegen (1 Zeile je Frage, N Zeilen bei Mehrfachauswahl) ──
    // wht_value ist das Primary-Name-Feld von wht_surveyanswer — wird bei
    // Auswahl-Antworten zusätzlich zum Options-Lookup mit dem Options-Label
    // befüllt, sonst bliebe die Zeile in jeder Ansicht namenlos.
    const errors: string[] = [];
    for (const a of answers) {
      const questionId = String(a?.questionId ?? "").trim();
      if (!questionId) continue;

      const options = Array.isArray(a?.options) ? a.options.filter((o) => o && o.id) : [];
      const value = typeof a?.value === "string" ? a.value.trim() : "";

      if (options.length > 0) {
        for (const opt of options) {
          const answerFields: Record<string, unknown> = {
            "wht_SurveyResponseID@odata.bind": `/wht_surveyresponses(${responseId})`,
            "wht_SurveyQuestionID@odata.bind": `/wht_surveyquestions(${questionId})`,
            "wht_SurveyQuestionOptionID@odata.bind": `/wht_surveyquestionoptions(${opt.id})`,
            wht_value: opt.label || "",
          };
          // Freitext aus dem "wht_addmoreinformation"-Feld der Option (falls
          // vorhanden und vom User befüllt) — landet auf der Antwort-Zeile,
          // nicht auf der Option selbst (die ist geteilte Konfiguration).
          const additionalInfo = typeof opt.additionalInfo === "string" ? opt.additionalInfo.trim() : "";
          if (additionalInfo) answerFields.wht_moreinformation = additionalInfo;

          let res = await fetch(`${RESOURCE}/api/data/v9.2/wht_surveyanswers`, {
            method: "POST",
            headers: dataverseHeaders(token),
            body: JSON.stringify(answerFields),
          });
          // Fallback: existiert wht_moreinformation (noch) nicht in
          // Dataverse (nicht angelegt/veröffentlicht), lehnt Dataverse den
          // GESAMTEN POST ab — dann lieber die Kernantwort (Optionsauswahl)
          // ohne den Zusatztext speichern, statt die ganze Frage zu verlieren.
          if (!res.ok && additionalInfo) {
            console.error("Dataverse error (answer/option, mit additionalInfo) — retry ohne Zusatzfeld:", res.status, await res.text(), "questionId:", questionId, "optionId:", opt.id, "responseId:", responseId);
            delete answerFields.wht_moreinformation;
            res = await fetch(`${RESOURCE}/api/data/v9.2/wht_surveyanswers`, {
              method: "POST",
              headers: dataverseHeaders(token),
              body: JSON.stringify(answerFields),
            });
          }
          if (!res.ok) {
            console.error("Dataverse error (answer/option):", res.status, await res.text(), "questionId:", questionId, "optionId:", opt.id, "responseId:", responseId);
            errors.push(`q=${questionId} opt=${opt.id}`);
          }
        }
      } else if (value) {
        const answerFields: Record<string, unknown> = {
          "wht_SurveyResponseID@odata.bind": `/wht_surveyresponses(${responseId})`,
          "wht_SurveyQuestionID@odata.bind": `/wht_surveyquestions(${questionId})`,
          wht_value: value,
        };
        const res = await fetch(`${RESOURCE}/api/data/v9.2/wht_surveyanswers`, {
          method: "POST",
          headers: dataverseHeaders(token),
          body: JSON.stringify(answerFields),
        });
        if (!res.ok) {
          console.error("Dataverse error (answer/value):", res.status, await res.text(), "questionId:", questionId, "responseId:", responseId);
          errors.push(`q=${questionId}`);
        }
      }
    }

    if (errors.length > 0) {
      // Lead + Response wurden angelegt, ein Teil der Antworten aber nicht —
      // kein Rollback (siehe Kommentar oben), nur mit Kontext geloggt.
      console.error("Teilfehler beim Anlegen von Antworten. responseId:", responseId, "leadId:", leadId, "failed:", errors);
      return jsonResponse({ success: false, partial: true, leadId, responseId, failedAnswers: errors.length }, 207);
    }

    return jsonResponse({ success: true, leadId, responseId }, 200);
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Interner Fehler" }, 500);
  }
});
