import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// DEV-Variante von dynamics-surveys-list: listet alle aktiven Umfragen aus
// der Dynamics-DEV-Umgebung (wht_survey, read-only). Nutzt die bereits
// vorhandenen DYNAMICS_*-Secrets (DEV-Zugangsdaten) — getrennt von den
// DYNAMICS_PROD_*-Secrets der PROD-Function "dynamics-surveys-list".
//
// Dient der Umfrage-Auswahl auf admin/admin-umfrage.html (wenn keine
// oder eine ungültige "?id=" übergeben wurde) — analog zu
// dynamics-events-list für die Event-Auswahl an anderer Stelle.
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const token = await getAccessToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
    };

    const surveysUrl = `${RESOURCE}/api/data/v9.2/wht_surveies?$select=wht_surveyid,wht_title,wht_slug&$filter=statecode eq 0&$orderby=createdon desc`;
    const surveysRes = await fetch(surveysUrl, { headers });
    if (!surveysRes.ok) {
      console.error("Dataverse error (surveys list):", surveysRes.status, await surveysRes.text());
      return jsonResponse({ error: "CRM-Anfrage fehlgeschlagen" }, 502);
    }
    const surveysData = await surveysRes.json();
    const surveys = ((surveysData.value || []) as Record<string, unknown>[]).map((s) => ({
      id: s.wht_surveyid,
      title: s.wht_title ?? "",
      slug: s.wht_slug ?? "",
    }));

    return jsonResponse(surveys, 200);
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Interner Fehler" }, 500);
  }
});
