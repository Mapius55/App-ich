// Supabase Edge Function: the "Bucket List" calendar as an iCalendar feed.
// The iPhone subscribes to  webcal://<project>.supabase.co/functions/v1/calendar?token=…
// Calendar apps can't log in, so a private random token in the link
// identifies the person (renewable in the app). Deploy with --no-verify-jwt.

import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { buildIcs } from "../_shared/ics.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!UUID_RE.test(token)) return new Response("Not found", { status: 404 });

  // Service role: reads exactly one person's events, found by their private token.
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data: profile } = await sb.from("profiles").select("id").eq("calendar_token", token).maybeSingle();
  if (!profile) return new Response("Not found", { status: 404 });

  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const { data: events, error } = await sb
    .from("events")
    .select("id, title, starts_at, ends_at, all_day, location, notes, reminder_minutes, sequence, updated_at")
    .eq("user_id", profile.id)
    .gte("starts_at", since)
    .order("starts_at")
    .limit(1000);
  if (error) return new Response("Error", { status: 500 });

  // "subscribed": the coach's context and the app can tell that the iPhone calendar reads the feed.
  // At most every 6 hours, a conditional update (no write per fetch); a missing column (migration
  // 20261118000000 not applied yet) must not break the feed.
  const stale = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const touched = await sb
    .from("profiles")
    .update({ calendar_fetched_at: new Date().toISOString() })
    .eq("id", profile.id)
    .or(`calendar_fetched_at.is.null,calendar_fetched_at.lt."${stale}"`);
  if (touched.error) console.error("calendar_fetched_at:", touched.error.code ?? "error");

  const tz = new URL(req.url).searchParams.get("tz") ?? "Europe/Zurich";
  return new Response(buildIcs(events ?? [], { name: "Bucket List", timezone: tz }), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="bucket-list.ics"',
      "Cache-Control": "no-cache",
    },
  });
});
