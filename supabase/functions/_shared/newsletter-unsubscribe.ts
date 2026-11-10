type UnsubscribeOptions = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  resource: string;
  allowedOrigin: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createNewsletterUnsubscribeHandler(options: UnsubscribeOptions) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": options.allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  function jsonResponse(body: unknown, status: number) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  async function getAccessToken(): Promise<string> {
    const url = `https://login.microsoftonline.com/${options.tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      grant_type: "client_credentials",
      scope: `${options.resource}/.default`,
    });
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) throw new Error(`Token-Anfrage fehlgeschlagen: ${response.status}`);
    const data = await response.json();
    return data.access_token as string;
  }

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

    try {
      const payload = await req.json();
      const email = typeof payload?.email === "string" ? payload.email.trim() : "";
      if (email.length > 254 || !EMAIL_RE.test(email)) {
        return jsonResponse({ error: "Bitte gib eine gültige E-Mail-Adresse ein." }, 400);
      }

      const accessToken = await getAccessToken();
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
      };
      const escapedEmail = email.replace(/'/g, "''");
      const query = new URLSearchParams({
        "$select": "contactid",
        "$filter": `emailaddress1 eq '${escapedEmail}'`,
        "$top": "100",
      });

      let nextUrl: string | null = `${options.resource}/api/data/v9.2/contacts?${query.toString()}`;
      const contactIds: string[] = [];
      while (nextUrl) {
        const response: Response = await fetch(nextUrl, { headers });
        if (!response.ok) {
          console.error("Dataverse error (find contacts):", response.status, await response.text());
          return jsonResponse({ error: "Der Kontakt konnte im CRM nicht gesucht werden." }, 502);
        }
        const result = await response.json();
        contactIds.push(...(result.value || []).map((contact: { contactid?: string }) => contact.contactid).filter(Boolean));
        nextUrl = result["@odata.nextLink"] || null;
      }

      if (contactIds.length === 0) {
        return jsonResponse({ error: "Zu dieser E-Mail-Adresse wurde kein Kontakt gefunden." }, 404);
      }

      for (const contactId of contactIds) {
        const response = await fetch(`${options.resource}/api/data/v9.2/contacts(${contactId})`, {
          method: "PATCH",
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ wht_optinnewsletter: null }),
        });
        if (!response.ok) {
          console.error("Dataverse error (unsubscribe contact):", response.status, await response.text());
          return jsonResponse({ error: "Die Abmeldung konnte im CRM nicht gespeichert werden." }, 502);
        }
      }

      return jsonResponse({ success: true, updatedCount: contactIds.length }, 200);
    } catch (error) {
      console.error("Newsletter unsubscribe error:", error);
      return jsonResponse({ error: "Die Abmeldung konnte gerade nicht abgeschlossen werden. Bitte versuche es später erneut." }, 500);
    }
  };
}
