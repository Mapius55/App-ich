// Supabase Edge Function: notifications from the coach.
//   GET  ?action=key        → the public VAPID key (created on first use)
//   POST {action:"test"}    → test notification to the caller's devices (needs login)
//   POST {action:"dispatch"} + header x-cron-secret → morning/evening messages for everyone
//        whose time has come (called every 15 min by the GitHub workflow "push-cron").
// Deploy with --no-verify-jwt (the cron call has no user; "test" checks the login itself).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.119.0";
import { generateVapidKeys, sendPush, type VapidKeys } from "../_shared/webpush.ts";

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

interface Sub {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  app_url: string | null;
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

function localNow(tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: +p.hour * 60 + +p.minute };
}
const toMinutes = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);

async function dispatch(sb: SupabaseClient) {
  const vapid = await vapidKeys(sb);
  const { data: people } = await sb
    .from("profiles")
    .select("id, display_name, timezone, notify_morning, notify_evening, last_morning_push, last_evening_push")
    .or("notify_morning.not.is.null,notify_evening.not.is.null");
  let total = 0;
  for (const p of people ?? []) {
    const tz = p.timezone || "Europe/Zurich";
    const now = localNow(tz);
    // a one-hour window: scheduled runs can be a little late
    const due = (t: string | null, last: string | null) => t && last !== now.date && now.minutes >= toMinutes(t) && now.minutes < toMinutes(t) + 60;
    const morning = due(p.notify_morning, p.last_morning_push);
    const evening = !morning && due(p.notify_evening, p.last_evening_push);
    if (!morning && !evening) continue;

    const { data: subs } = await sb.from("push_subscriptions").select("id, endpoint, p256dh, auth, app_url").eq("user_id", p.id);
    if (!subs?.length) continue;
    const name = p.display_name ? `, ${p.display_name}` : "";
    let message: { title: string; body: string };

    if (morning) {
      // today's appointments make the morning message personal
      const start = new Date(Date.now() - 12 * 3600e3).toISOString();
      const end = new Date(Date.now() + 24 * 3600e3).toISOString();
      const { data: ev } = await sb.from("events").select("title, starts_at, all_day").eq("user_id", p.id).gte("starts_at", start).lte("starts_at", end).order("starts_at");
      const today = (ev ?? []).filter((e) => localNow(tz).date === new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(e.starts_at)));
      const first = today[0];
      const when = first && !first.all_day
        ? new Intl.DateTimeFormat("de-CH", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(first.starts_at)) + " "
        : "";
      message = {
        title: `Guten Morgen${name}`,
        body: first ? `Wie geht es dir heute? Heute steht an: ${when}${first.title}.` : "Wie geht es dir heute?",
      };
      await sb.from("profiles").update({ last_morning_push: now.date }).eq("id", p.id);
    } else {
      const { data: day } = await sb.from("days").select("focus").eq("user_id", p.id).eq("day", now.date).maybeSingle();
      message = {
        title: `Guten Abend${name}`,
        body: day?.focus ? `Wie lief es heute mit „${day.focus}“?` : "Wie war dein Tag? Erzähl mir kurz davon.",
      };
      await sb.from("profiles").update({ last_evening_push: now.date }).eq("id", p.id);
    }
    total += await deliver(sb, subs, message, vapid);
  }
  return total;
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
    return json({ sent: await dispatch(sb) });
  }

  if (body.action === "test") {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data.user) return json({ error: "unauthorized" }, 401);
    const { data: subs } = await sb.from("push_subscriptions").select("id, endpoint, p256dh, auth, app_url").eq("user_id", data.user.id);
    const sent = await deliver(sb, subs ?? [], { title: "I am", body: "So sehen meine Nachrichten aus. Bis bald!" }, await vapidKeys(sb));
    return json({ sent });
  }

  return json({ error: "unknown action" }, 400);
});
