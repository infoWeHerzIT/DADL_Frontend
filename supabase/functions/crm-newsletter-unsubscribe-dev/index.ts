import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createNewsletterUnsubscribeHandler } from "../_shared/newsletter-unsubscribe.ts";

serve(createNewsletterUnsubscribeHandler({
  tenantId: Deno.env.get("DYNAMICS_TENANT_ID")!,
  clientId: Deno.env.get("DYNAMICS_CLIENT_ID")!,
  clientSecret: Deno.env.get("DYNAMICS_CLIENT_SECRET")!,
  resource: Deno.env.get("DYNAMICS_RESOURCE")!,
  allowedOrigin: "*",
}));
