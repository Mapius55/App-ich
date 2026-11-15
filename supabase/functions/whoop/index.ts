// Supabase Edge Function "whoop": the app's side of the WHOOP connection (status, connect, "Jetzt holen",
// disconnect) and the reconciliation called by pg_cron. Routes and rules: ../_shared/whoop_server.ts.
// Deploy with --no-verify-jwt: the login (or the cron secret) is checked there.

import { handleApp } from "../_shared/whoop_server.ts";

Deno.serve(handleApp);
