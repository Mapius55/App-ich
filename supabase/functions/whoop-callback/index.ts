// Supabase Edge Function "whoop-callback": WHOOP sends the browser here after the consent page
// (redirect URI https://<project>.supabase.co/functions/v1/whoop-callback). Checks the state, stores the
// tokens (encrypted), fetches the first 14 days and sends the browser back to the app.
// Deploy with --no-verify-jwt (the browser comes without a Supabase login). See ../_shared/whoop_server.ts.

import { handleCallback } from "../_shared/whoop_server.ts";

Deno.serve(handleCallback);
