import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// PROD-Variante: liest Leads (wht_lead) eines Events aus der
// Dynamics-PROD-Umgebung. Eigene, klar benannte Secrets — getrennt von den
// DYNAMICS_*-Secrets der DEV-Function "dynamics-leads-by-event-dev".
// Read-only — keine Schreibzugriffe.
//
// Dient admin/admin-feedback.html: Teilnehmerliste eines Events anzeigen und
// als Grundlage für den Massenversand des Feedback-Links (nur an "aktive",
// d. h. per Double-Opt-In bestätigte Leads — wht_doubleoptinam gesetzt, siehe
// crm-lead-confirm).
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

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const LEAD_SELECT = "wht_leadid,wht_vorname,wht_name,wht_leadname,wht_email1,wht_phone1,wht_doubleoptinam,createdon";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const url = new URL(req.url);
    const eventId = (url.searchParams.get("eventId") || "").trim();
    if (!eventId || !GUID_RE.test(eventId)) return jsonResponse({ error: "Ungültige oder fehlende 'eventId'" }, 400);

    const token = await getAccessToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
    };

    const leadsUrl = `${RESOURCE}/api/data/v9.2/wht_leads?$select=${LEAD_SELECT}&$filter=_wht_eventid_value eq ${eventId} and statecode eq 0&$orderby=createdon desc`;
    const leadsRes = await fetch(leadsUrl, { headers });
    if (!leadsRes.ok) {
      console.error("Dataverse error (leads by event):", leadsRes.status, await leadsRes.text());
      return jsonResponse({ error: "CRM-Anfrage fehlgeschlagen" }, 502);
    }
    const leadsData = await leadsRes.json();

    const leads = ((leadsData.value || []) as Record<string, unknown>[]).map((l) => ({
      id: l.wht_leadid,
      firstname: l.wht_vorname ?? "",
      lastname: l.wht_name ?? "",
      name: l.wht_leadname ?? "",
      email: l.wht_email1 ?? "",
      phone: l.wht_phone1 ?? "",
      // wht_doubleoptinam gesetzt = per Double-Opt-In bestätigt/aktiv (siehe crm-lead-confirm),
      // leer = noch nicht bestätigt.
      active: !!l.wht_doubleoptinam,
      confirmedAt: l.wht_doubleoptinam ?? null,
      createdOn: l.createdon ?? null,
    }));

    return jsonResponse(leads, 200);
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Interner Fehler" }, 500);
  }
});
