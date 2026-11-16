// Supabase Edge Function "whoop-webhook": WHOOP (webhooks v2) reports changed or deleted sleep, recovery
// and workouts here. Checks the signature (X-WHOOP-Signature, HMAC with the client secret), answers at
// once and recomputes the affected day in the background.
// Deploy with --no-verify-jwt (WHOOP has no Supabase login). See ../_shared/whoop_server.ts.

import { handleWebhook } from "../_shared/whoop_server.ts";

Deno.serve(handleWebhook);
