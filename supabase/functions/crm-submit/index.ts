import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// PROD-Variante: schreibt gegen die Dynamics-PROD-Umgebung. Eigene, klar
// benannte Secrets — getrennt von den DYNAMICS_*-Secrets der DEV-Function
// "crm-submit-dev", damit lokale Tests nie echte Kontakte in Dynamics PROD
// anlegen und Produktions-Traffic nie versehentlich in Dynamics DEV landet.
//
// Legt IMMER einen neuen Lead an (Entität "wht_lead"), keinen Contact.
//
// wht_leadtype (Picklist, laut Dynamics-Metadaten): 959230000=Account, 959230001=Contact.
// wht_leadconnection ist ein Self-Lookup auf wht_lead selbst (Navigation-Property
// "wht_LeadConnection") — damit lässt sich z. B. ein Empfänger-Lead (Verschenken-Fall)
// mit dem ursprünglichen Besteller-Lead verknüpfen.
//
// Adressfelder: Adresse → wht_street1, Hausnr. → wht_street2, PLZ → wht_zippostalcode,
// Stadt → wht_city, Land → wht_countryregion, USt-IdNr. → wht_ustidnr, Nachricht für
// den Empfänger → wht_nachrichtfurdenempfanger. Firmenname (bei Unternehmen) →
// wht_accountname.
//
// ACHTUNG (Stand 2026-08-21 laut Dataverse-Metadaten-Check): wht_leadconnection, die
// sieben Adress-/Firmenfelder (inkl. wht_accountname/wht_city) UND
// wht_optinrightofwithdrawaldatetime existieren bisher NUR in Dynamics DEV, noch NICHT in
// PROD (wht_vorname/wht_leadtype existieren dagegen bereits in beiden Umgebungen).
// Dieser Code geht davon aus, dass die Felder inzwischen auch in PROD angelegt +
// publiziert wurden — falls nicht, schlägt jede Lead-Anlage mit 400 fehl. Vor dem
// Deploy also erst in Dynamics PROD prüfen/nachziehen.
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const payload = await req.json();

    // Whitelist: nur diese Felder werden angenommen, alles andere im Body wird ignoriert
    const firstname           = String(payload.firstname ?? "").trim();
    const lastname            = String(payload.lastname ?? "").trim();
    const email                = String(payload.email ?? "").trim();
    const mobilephone          = String(payload.mobilephone ?? "").trim();
    const eventId               = String(payload.eventId ?? "").trim();
    const quelleRaw             = payload.quelle;
    const interesseAnCoachingOptIn           = !!payload.interesseAnCoachingOptIn;
    const einwilligungDatenverarbeitungOptIn = !!payload.einwilligungDatenverarbeitungOptIn;
    const newsletterOptIn                    = !!payload.newsletterOptIn;
    const testimonialOptIn                   = !!payload.testimonialOptIn;
    const widerrufsverzichtOptIn             = !!payload.widerrufsverzichtOptIn;
    const emailOptIn                         = !!payload.emailOptIn;
    const leadTypeRaw           = String(payload.leadType ?? "").trim().toLowerCase();
    const leadConnectionId      = String(payload.leadConnectionId ?? "").trim();
    const firmenname            = String(payload.firmenname ?? "").trim();
    const extra                 = (payload.extra && typeof payload.extra === "object") ? payload.extra as Record<string, unknown> : null;

    // Vor- und Nachname sind NICHT zwingend — manche Formulare (z. B. die
    // Tools) fragen den Vornamen nur freiwillig ab. Pflicht ist nur eine
    // gültige E-Mail; fehlt jeder Name, dient die E-Mail als Lead-Name
    // (wie in crm-survey-response-submit).
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: "Pflichtfelder fehlen oder ungültig" }, 400);
    }

    const token = await getAccessToken();
    const nowIso = new Date().toISOString();

    // Dataverse Web API verlangt Attribut-Logical-Names IMMER in Kleinschreibung,
    // unabhängig davon, wie der Schema-Name im Studio angezeigt wird
    // (wht_Vorname → wht_vorname usw.).
    const leadFields: Record<string, unknown> = {
      wht_vorname:  firstname,
      wht_name:     lastname || (firstname ? "" : email),
      wht_leadname: (firstname + " " + lastname).trim() || email,
      wht_email1:   email,
    };
    if (firmenname) leadFields.wht_accountname = firmenname;
    if (mobilephone) leadFields.wht_phone1 = mobilephone;
    // wht_eventid ist ein Lookup (Verknüpfung zu wht_event), kein Textfeld —
    // Dataverse verlangt dafür die @odata.bind-Syntax. Der Navigation-Property-
    // Name ist NICHT der Attribut-Logical-Name (wht_eventid), sondern
    // "wht_EventId" (per ManyToOneRelationships-Metadaten ermittelt:
    // ReferencingAttribute=wht_eventid, ReferencingEntityNavigationPropertyName=wht_EventId).
    if (eventId) leadFields["wht_EventId@odata.bind"] = `/wht_events(${eventId})`;
    if (quelleRaw !== null && quelleRaw !== undefined && quelleRaw !== "") {
      const quelleNum = Number(quelleRaw);
      if (!Number.isNaN(quelleNum)) leadFields.wht_quelle = quelleNum;
    }
    // Zustimmungs-/Interessefelder speichern den Zeitpunkt der Anmeldung als
    // Datum, nicht true/false — nur gesetzt, wenn die Checkbox aktiv war.
    if (interesseAnCoachingOptIn)           leadFields.wht_optincoachingdatetime = nowIso;
    if (newsletterOptIn)                    leadFields.wht_optinnewsletterdatetime = nowIso;
    if (testimonialOptIn)                   leadFields.wht_optintestimonialsdatetime = nowIso;
    if (widerrufsverzichtOptIn)              leadFields.wht_optinrightofwithdrawaldatetime = nowIso;
    if (emailOptIn)                         leadFields.wht_optinemaildatetime = nowIso;

    if (leadTypeRaw === "account") leadFields.wht_leadtype = 959230000;
    else if (leadTypeRaw === "contact") leadFields.wht_leadtype = 959230001;

    if (leadConnectionId) leadFields["wht_LeadConnection@odata.bind"] = `/wht_leads(${leadConnectionId})`;

    // Adressfelder auf eigene Dataverse-Felder abbilden (siehe Kommentar oben).
    // Alle sonst unbekannten extra-Keys landen gebündelt in wht_jsoncontent.
    if (extra) {
      const FIELD_MAP: Record<string, string> = {
        strasse:   "wht_street1",
        hausnr:    "wht_street2",
        plz:       "wht_zippostalcode",
        stadt:     "wht_city",
        land:      "wht_countryregion",
        ustIdNr:   "wht_ustidnr",
        nachricht: "wht_nachrichtfurdenempfanger",
      };
      const remaining: Record<string, unknown> = {};
      Object.keys(extra).forEach((key) => {
        const val = extra[key];
        if (val === undefined || val === null || String(val).trim() === "") return;
        const strVal = String(val).trim();
        if (FIELD_MAP[key]) leadFields[FIELD_MAP[key]] = strVal;
        else remaining[key] = strVal;
      });
      if (Object.keys(remaining).length > 0) leadFields.wht_jsoncontent = JSON.stringify(remaining);
    }

    const leadRes = await fetch(`${RESOURCE}/api/data/v9.2/wht_leads`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
      },
      body: JSON.stringify(leadFields),
    });

    if (!leadRes.ok) {
      console.error("Dataverse error:", leadRes.status, await leadRes.text());
      return jsonResponse({ error: "CRM-Anfrage fehlgeschlagen" }, 502);
    }

    // Dataverse liefert die neue GUID im "OData-EntityId"-Header zurück
    // (Format ".../wht_leads(<guid>)"), nicht im Body (Standard-Response ist 204).
    // Wird gebraucht, um z. B. einen Empfänger-Lead per wht_leadconnection an
    // diesen Lead zu binden.
    const entityIdHeader = leadRes.headers.get("OData-EntityId") || "";
    const idMatch = entityIdHeader.match(/\(([0-9a-fA-F-]+)\)/);
    const id = idMatch ? idMatch[1] : null;

    return jsonResponse({ success: true, id }, 200);
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Interner Fehler" }, 500);
  }
});
