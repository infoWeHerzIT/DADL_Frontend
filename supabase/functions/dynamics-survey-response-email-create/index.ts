import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TENANT_ID = Deno.env.get("DYNAMICS_PROD_TENANT_ID")!;
const CLIENT_ID = Deno.env.get("DYNAMICS_PROD_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("DYNAMICS_PROD_CLIENT_SECRET")!;
const RESOURCE = Deno.env.get("DYNAMICS_PROD_RESOURCE")!;
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";
const FROM_EMAIL = "sorin.ratiu@weherzit.de";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

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

function extractIdFromEntityIdHeader(res: Response): string | null {
  const header = res.headers.get("OData-EntityId") || res.headers.get("odata-entityid");
  const match = header && header.match(/\(([0-9a-fA-F-]{36})\)/);
  return match ? match[1] : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const payload = await req.json();
    const surveyId = String(payload.surveyId ?? "").trim();
    const responseId = String(payload.responseId ?? "").trim();
    const bodyHtml = String(payload.bodyHtml ?? "");

    if (!GUID_RE.test(surveyId) || !GUID_RE.test(responseId)) {
      return jsonResponse({ error: "Ungültige Umfrage- oder Response-ID" }, 400);
    }
    if (!bodyHtml.trim() || bodyHtml.length > 1_000_000) {
      return jsonResponse({ error: "Ungültiger oder zu großer E-Mail-Body" }, 400);
    }

    const token = await getAccessToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
    };

    const responseUrl =
      `${RESOURCE}/api/data/v9.2/wht_surveyresponses?$select=wht_surveyresponseid,createdon` +
      `&$filter=wht_surveyresponseid eq ${responseId} and _wht_surveyid_value eq ${surveyId}` +
      `&$expand=wht_Lead($select=wht_leadid,wht_email1)`;
    const responseRes = await fetch(responseUrl, { headers });
    if (!responseRes.ok) {
      console.error("Dataverse error (survey response):", responseRes.status, await responseRes.text());
      return jsonResponse({ error: "CRM-Anfrage fehlgeschlagen" }, 502);
    }
    const responseData = await responseRes.json();
    const surveyResponse = (responseData.value || [])[0] as Record<string, unknown> | undefined;
    const lead = surveyResponse?.wht_Lead as Record<string, unknown> | null;
    const leadId = String(lead?.wht_leadid ?? "");
    const recipient = String(lead?.wht_email1 ?? "").trim();
    if (!surveyResponse || !lead || !GUID_RE.test(leadId) || !EMAIL_RE.test(recipient)) {
      return jsonResponse({ error: "Für diese Umfrageantwort ist kein gültiger CRM-Empfänger hinterlegt" }, 400);
    }

    const contactRes = await fetch(
      `${RESOURCE}/api/data/v9.2/contacts?$select=contactid,_wht_lead_value&$top=10&$filter=` +
        encodeURIComponent(`emailaddress1 eq '${recipient.replace(/'/g, "''")}'`),
      { headers },
    );
    if (!contactRes.ok) {
      console.error("Dataverse error (contact lookup):", contactRes.status, await contactRes.text());
      return jsonResponse({ error: "CRM-Anfrage fehlgeschlagen" }, 502);
    }
    // Bei mehreren Kontakten mit gleicher E-Mail den mit dem Lead verknüpften bevorzugen.
    const contacts = ((await contactRes.json()).value || []) as Record<string, unknown>[];
    const contact = contacts.find((c) => String(c._wht_lead_value ?? "").toLowerCase() === leadId.toLowerCase()) ?? contacts[0];
    const contactId = String(contact?.contactid ?? "");
    if (!GUID_RE.test(contactId)) {
      return jsonResponse({ error: `Kein Kontakt mit der E-Mail-Adresse ${recipient} im CRM gefunden` }, 400);
    }

    // Absender: aktiver Systembenutzer mit der Absenderadresse; sonst nur als Adresse setzen.
    const userRes = await fetch(
      `${RESOURCE}/api/data/v9.2/systemusers?$select=systemuserid&$top=1&$filter=` +
        encodeURIComponent(`internalemailaddress eq '${FROM_EMAIL}' and isdisabled eq false`),
      { headers },
    );
    const senderId = userRes.ok ? String(((await userRes.json()).value || [])[0]?.systemuserid ?? "") : "";
    const fromParty: Record<string, unknown> = { participationtypemask: 1, addressused: FROM_EMAIL };
    if (GUID_RE.test(senderId)) fromParty["partyid_systemuser@odata.bind"] = `/systemusers(${senderId})`;

    const surveyRes = await fetch(
      `${RESOURCE}/api/data/v9.2/wht_surveies(${surveyId})?$select=wht_title`,
      { headers },
    );
    if (!surveyRes.ok) {
      console.error("Dataverse error (survey):", surveyRes.status, await surveyRes.text());
      return jsonResponse({ error: "CRM-Anfrage fehlgeschlagen" }, 502);
    }
    const survey = await surveyRes.json();
    const date = new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "Europe/Berlin",
    }).format(new Date(String(surveyResponse.createdon)));
    const subject = `Ergebnisse deiner Umfrage von ${date} - ${String(survey.wht_title ?? "Umfrage")}`;

    const emailRes = await fetch(`${RESOURCE}/api/data/v9.2/emails`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        subject,
        description: bodyHtml,
        directioncode: true,
        statecode: 0,
        statuscode: 1,
        "regardingobjectid_contact_email@odata.bind": `/contacts(${contactId})`,
        email_activity_parties: [
          fromParty,
          {
            participationtypemask: 2,
            addressused: recipient,
            "partyid_contact@odata.bind": `/contacts(${contactId})`,
          },
        ],
      }),
    });
    if (!emailRes.ok) {
      console.error("Dataverse error (create email):", emailRes.status, await emailRes.text());
      return jsonResponse({ error: "CRM-E-Mail konnte nicht erstellt werden" }, 502);
    }

    return jsonResponse({ success: true, id: extractIdFromEntityIdHeader(emailRes) }, 200);
  } catch (err) {
    console.error("Create survey response email error:", err);
    return jsonResponse({ error: "Interner Fehler" }, 500);
  }
});
