// Supabase Edge Function: notifications from the coach.
//   GET  ?action=key        → the public VAPID key (created on first use)
//   POST {action:"test"}    → test notification to the caller's devices (needs login)
//   POST {action:"dispatch"} + header x-cron-secret → morning/evening messages for everyone
//        whose time has come, and the reminders whose moment falls in the next 15 minutes (called
//        every 15 min by pg_cron 'i-am-push' and the GitHub workflow "push-cron"; the push log makes
//        sure only one of them sends).
// Deploy with --no-verify-jwt (the cron call has no user; "test" checks the login itself).
//
// What a message says and when it stays out is decided in _shared/push_text.ts (pure, tested): only
// with something of her own (else nothing), none once she was there or while one of her entries runs,
// the morning later on the weekend at the default time and after a late night, one line after a few
// days away and then silence, reminders for her blocks and what she asked for (only without the
// calendar subscription, at most 3 a day, never Nolio), never a dream (except a reminder she asked
// for), nothing sensitive on the lock screen. The push log (public.push_log) keeps per day and slot (and
// per entry for a reminder) what was decided, with the template id and fingerprints (never the text).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.119.0";
import { generateVapidKeys, sendPush, type VapidKeys } from "../_shared/webpush.ts";
import { dispatch, type Sub } from "./dispatch.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const admin = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

async function vapidKeys(sb: SupabaseClient): Promise<VapidKeys> {
  const read = async () => {
    const { data } = await sb.from("app_keys").select("name, value").in("name", ["vapid_public", "vapid_private_jwk"]);
    const m = Object.fromEntries((data ?? []).map((r) => [r.name, r.value]));
    return m.vapid_public && m.vapid_private_jwk ? { publicKey: m.vapid_public, privateJwk: JSON.parse(m.vapid_private_jwk) } : null;
  };
  const existing = await read();
  if (existing) return existing;
  const k = await generateVapidKeys();
  // ignoreDuplicates: if two requests race, the first one wins and both read it back
  await sb.from("app_keys").upsert(
    [
      { name: "vapid_public", value: k.publicKey },
      { name: "vapid_private_jwk", value: JSON.stringify(k.privateJwk) },
    ],
    { onConflict: "name", ignoreDuplicates: true },
  );
  return (await read())!;
}

async function deliver(sb: SupabaseClient, subs: Sub[], message: { title: string; body: string }, vapid: VapidKeys) {
  let sent = 0;
  for (const s of subs) {
    const url = s.app_url ?? undefined;
    const subject = url && /^https:\/\//.test(url) ? new URL(url).origin : "https://github.com";
    try {
      const status = await sendPush(s, { ...message, url }, vapid, subject);
      if (status === 404 || status === 410) await sb.from("push_subscriptions").delete().eq("id", s.id);
      else if (status < 300) sent++;
      else console.warn("push status", status);
    } catch (e) {
      console.error("push failed", e);
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const sb = admin();

  if (req.method === "GET") {
    if (new URL(req.url).searchParams.get("action") !== "key") return json({ error: "unknown action" }, 400);
    const k = await vapidKeys(sb);
    return json({ publicKey: k.publicKey });
  }
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad request" }, 400);
  }

  if (body.action === "dispatch") {
    const secret = Deno.env.get("PUSH_CRON_SECRET");
    if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "unauthorized" }, 401);
    const vapid = await vapidKeys(sb);
    return json({ sent: await dispatch(sb, (subs, message) => deliver(sb, subs, message, vapid)) });
  }

  if (body.action === "test") {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data.user) return json({ error: "unauthorized" }, 401);
    const { data: subs } = await sb.from("push_subscriptions").select("id, endpoint, p256dh, auth, app_url").eq("user_id", data.user.id);
    const sent = await deliver(sb, subs ?? [], { title: "Bucket List", body: "So sehen meine Nachrichten aus. Bis bald!" }, await vapidKeys(sb));
    return json({ sent });
  }

  return json({ error: "unknown action" }, 400);
});
