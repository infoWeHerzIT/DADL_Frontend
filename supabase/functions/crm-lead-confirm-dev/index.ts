import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// DEV-Variante von crm-lead-confirm: bestätigt die Double-Opt-In-E-Mail
// eines Leads gegen die Dynamics-DEV-Umgebung. Nutzt die bereits
// vorhandenen DYNAMICS_*-Secrets (DEV-Zugangsdaten) — getrennt von den
// DYNAMICS_PROD_*-Secrets der PROD-Function "crm-lead-confirm".
//
// Body: { email, token }, wobei "token" die Lead-GUID ist (kein separat
// generiertes Token). Bestätigt wird nur, wenn die im Lead hinterlegte
// E-Mail-Adresse exakt (case-insensitiv) mit der übergebenen übereinstimmt.
//
// POST statt GET, weil zustandsändernd (Konvention in diesem Projekt).
// Wird von Templates/verify-email.html automatisch beim Laden aufgerufen
// (sobald email+token in der URL stehen).
const TENANT_ID     = Deno.env.get("DYNAMICS_TENANT_ID")!;
const CLIENT_ID     = Deno.env.get("DYNAMICS_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("DYNAMICS_CLIENT_SECRET")!;
const RESOURCE      = Deno.env.get("DYNAMICS_RESOURCE")!; // https://<org>.crm4.dynamics.com

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

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const payload = await req.json();
    const email  = String(payload.email ?? "").trim();
    const leadId = String(payload.token ?? "").trim();

    if (!EMAIL_RE.test(email) || !GUID_RE.test(leadId)) {
      return jsonResponse({ error: "Ungültiger Bestätigungslink" }, 400);
    }

    const token = await getAccessToken();

    const getRes = await fetch(
      `${RESOURCE}/api/data/v9.2/wht_leads(${leadId})?$select=wht_email1,wht_doubleoptinaccepted`,
      { headers: dataverseHeaders(token) }
    );
    if (!getRes.ok) {
      if (getRes.status === 404) return jsonResponse({ error: "Ungültiger Bestätigungslink" }, 404);
      console.error("Dataverse error (get lead):", getRes.status, await getRes.text());
      return jsonResponse({ error: "CRM-Anfrage fehlgeschlagen" }, 502);
    }
    const lead = await getRes.json();

    // Der Link bestätigt nur, wenn die im Lead hinterlegte E-Mail-Adresse
    // zur übergebenen passt — verhindert, dass ein erratenes/fremdes Lead-ID
    // im Link einen falschen Lead bestätigt.
    const leadEmail = String(lead.wht_email1 ?? "").trim().toLowerCase();
    if (!leadEmail || leadEmail !== email.toLowerCase()) {
      return jsonResponse({ error: "Ungültiger Bestätigungslink" }, 400);
    }

    if (lead.wht_doubleoptinaccepted) {
      // Bereits bestätigt — kein erneutes Schreiben, wht_doubleoptinaccepted
      // bleibt der ursprüngliche Bestätigungszeitpunkt.
      return jsonResponse({ success: true, alreadyConfirmed: true }, 200);
    }

    const nowIso = new Date().toISOString();
    const patchRes = await fetch(`${RESOURCE}/api/data/v9.2/wht_leads(${leadId})`, {
      method: "PATCH",
      headers: dataverseHeaders(token),
      body: JSON.stringify({ wht_doubleoptinaccepted: nowIso }),
    });
    if (!patchRes.ok) {
      console.error("Dataverse error (patch lead):", patchRes.status, await patchRes.text());
      return jsonResponse({ error: "CRM-Anfrage fehlgeschlagen" }, 502);
    }

    return jsonResponse({ success: true, alreadyConfirmed: false }, 200);
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Interner Fehler" }, 500);
  }
});
