// The dispatch of the Edge Function "push": for everyone whose morning or evening time has come, decide
// once (push log), then send a body from her data or leave it out. The decisions themselves are pure
// (_shared/push_text.ts); this file reads the data, keeps the log and calls `send`. Without Deno APIs,
// so the tests can run it against a fake client.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.119.0";
import {
  addDays,
  chooseBody,
  dueSlot,
  eveningCandidates,
  fingerprint,
  localParts,
  morningCandidates,
  NO_REPEAT_DAYS,
  pushTitle,
  skipReason,
  slotMinutes,
  zoneOr,
  type Activity,
  type Candidate,
  type EveningFacts,
  type MorningFacts,
  type PushEvent,
  type PushGoal,
  type PushProfile,
  type SentBefore,
  type SkipReason,
} from "../_shared/push_text.ts";

/** how long push log rows are kept */
export const LOG_KEEP_DAYS = 90;

/** one device that allowed notifications (public.push_subscriptions) */
export interface Sub {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  app_url: string | null;
}

/** delivers one message to her devices; how many it reached */
export type Send = (subs: Sub[], message: { title: string; body: string }) => Promise<number>;

type Db = { data: unknown; error: { code?: string; message?: string } | null };

/** the rows, or null when the query failed (logged; the caller decides what that means) */
async function rows<T>(q: PromiseLike<Db>, what: string): Promise<T[] | null> {
  const { data, error } = await q;
  if (error) {
    console.warn("push:", what, error.message ?? error);
    return null;
  }
  return (data ?? []) as T[];
}

// no such table yet (the push_log migration has not run): work as before, without the log
const missingTable = (e: { code?: string } | null) => e?.code === "42P01" || e?.code === "PGRST205";

interface Person extends PushProfile {
  id: string;
  display_name: string | null;
  timezone: string | null;
  created_at: string | null;
}

/** when she last opened the app (any message row) and last said something herself */
async function activityOf(sb: SupabaseClient, userId: string): Promise<Activity | null> {
  const [open, talk] = await Promise.all([
    rows<{ created_at: string }>(sb.from("messages").select("created_at").eq("user_id", userId).order("id", { ascending: false }).limit(1), "last open"),
    rows<{ created_at: string }>(
      sb.from("messages").select("created_at").eq("user_id", userId).eq("role", "user").eq("hidden", false).order("id", { ascending: false }).limit(1),
      "last talk",
    ),
  ]);
  if (!open || !talk) return null;
  return { lastOpen: open[0]?.created_at ?? null, lastTalk: talk[0]?.created_at ?? null };
}

async function morningFacts(sb: SupabaseClient, userId: string, at: Date, today: string): Promise<MorningFacts> {
  const [events, goals, day] = await Promise.all([
    // a few days back too, so an all-day entry over several days is still seen
    rows<PushEvent>(
      sb
        .from("events")
        .select("title, starts_at, ends_at, all_day, kind, goal_id")
        .eq("user_id", userId)
        .gte("starts_at", new Date(at.getTime() - 3 * 86400e3).toISOString())
        .lte("starts_at", new Date(at.getTime() + 36 * 3600e3).toISOString())
        .order("starts_at")
        .limit(80),
      "events",
    ),
    rows<PushGoal>(sb.from("goals").select("id, title, kind, status, done_at").eq("user_id", userId).limit(500), "goals"),
    rows<{ focus: string | null }>(sb.from("days").select("focus").eq("user_id", userId).eq("day", today).limit(1), "focus"),
  ]);
  return { events: events ?? [], goals, focus: day?.[0]?.focus ?? null };
}

async function eveningFacts(sb: SupabaseClient, userId: string, at: Date, today: string): Promise<EveningFacts> {
  const [goals, goalTime, milestones, logs] = await Promise.all([
    rows<PushGoal>(sb.from("goals").select("id, title, kind, status, done_at").eq("user_id", userId).limit(500), "goals"),
    rows<EveningFacts["goalTime"][number]>(sb.from("goal_time").select("goal_id, minutes, source").eq("user_id", userId).eq("day", today).limit(200), "goal_time"),
    rows<EveningFacts["milestones"][number]>(
      sb
        .from("milestones")
        .select("title, goal_id, done_at")
        .eq("user_id", userId)
        .gte("done_at", new Date(at.getTime() - 36 * 3600e3).toISOString())
        .limit(100),
      "milestones",
    ),
    rows<{ habit_id: string }>(sb.from("habit_logs").select("habit_id").eq("user_id", userId).eq("day", today).limit(100), "habit_logs"),
  ]);
  const ids = (logs ?? []).map((l) => l.habit_id);
  const habits = ids.length
    ? ((await rows<{ title: string; goal_id: string | null; active: boolean }>(sb.from("habits").select("title, goal_id, active").in("id", ids), "habits")) ?? [])
    : [];
  return { goals, goalTime: goalTime ?? [], milestones: milestones ?? [], habits: habits.filter((h) => h.active !== false) };
}

/**
 * Claims the slot for today in the push log (one row per person, day and slot), so that of two runs at
 * the same time (pg_cron and the GitHub workflow both call "dispatch") only one decides and sends.
 * False when another run was first. Without the log table (migration not run) or on another error: true,
 * so notifications keep working as before (profiles.last_*_push still guards the day).
 */
async function claim(sb: SupabaseClient, row: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await sb.from("push_log").upsert(row, { onConflict: "user_id,day,slot", ignoreDuplicates: true }).select("id");
  if (error) {
    if (!missingTable(error)) console.warn("push: log", error.message ?? error);
    return true;
  }
  return (data ?? []).length > 0;
}

/** the slot that is due for this person, decided once: sent with a body from her data, or left out */
async function forPerson(sb: SupabaseClient, p: Person, at: Date, send: Send): Promise<number> {
  const tz = zoneOr(p.timezone);
  const now = localParts(at, tz);
  const slot = dueSlot(p, now);
  if (!slot) return 0;
  const { data: subs } = await sb.from("push_subscriptions").select("id, endpoint, p256dh, auth, app_url").eq("user_id", p.id);
  if (!subs?.length) return 0;

  const time = (slot === "morning" ? p.notify_morning : p.notify_evening)!;
  const activity = await activityOf(sb, p.id);
  // unknown activity (the query failed): no pause and no skip, as before
  let reason: SkipReason | null = activity ? skipReason(slot, at, tz, slotMinutes(slot, time, now.weekday), { ...activity, since: p.created_at }) : null;
  let choice: Candidate | null = null;
  if (!reason) {
    const history =
      (await rows<SentBefore>(
        sb.from("push_log").select("day, slot, status, template, fingerprint").eq("user_id", p.id).gte("day", addDays(now.date, -NO_REPEAT_DAYS)),
        "history",
      )) ?? [];
    const groups =
      slot === "morning" ? morningCandidates(await morningFacts(sb, p.id, at, now.date), at, tz) : eveningCandidates(await eveningFacts(sb, p.id, at, now.date), at, tz);
    choice = chooseBody(groups, history, now.date, slot);
    if (!choice) reason = "repeat";
  }

  const claimed = await claim(sb, {
    user_id: p.id,
    day: now.date,
    slot,
    status: reason ? "skipped" : "sent",
    reason,
    template: choice?.template ?? null,
    fingerprint: choice ? fingerprint(choice.body) : null,
  });
  if (!claimed) return 0;
  // decided for today, sent or not: later runs in the window leave it alone
  await sb
    .from("profiles")
    .update(slot === "morning" ? { last_morning_push: now.date } : { last_evening_push: now.date })
    .eq("id", p.id);
  if (reason || !choice) return 0;

  const sent = await send(subs as Sub[], { title: pushTitle(slot, p.display_name), body: choice.body });
  const { error } = await sb.from("push_log").update({ devices: Math.min(sent, 100) }).eq("user_id", p.id).eq("day", now.date).eq("slot", slot);
  if (error && !missingTable(error)) console.warn("push: log devices", error.message ?? error);
  return sent;
}

/**
 * Morning and evening messages for everyone whose time has come. `send` delivers one message to a
 * person's devices and says how many it reached. Returns the number of devices reached.
 */
export async function dispatch(sb: SupabaseClient, send: Send, at: Date = new Date()): Promise<number> {
  const { data: people } = await sb
    .from("profiles")
    .select("id, display_name, timezone, notify_morning, notify_evening, last_morning_push, last_evening_push, created_at")
    .or("notify_morning.not.is.null,notify_evening.not.is.null");
  let total = 0;
  for (const p of (people ?? []) as Person[]) {
    try {
      total += await forPerson(sb, p, at, send);
    } catch (e) {
      // one person's trouble never stops the others' messages
      console.error("push: person", p.id, e);
    }
  }
  // the log is only needed for a while (rotation, «already decided today»): older rows go
  const { error } = await sb.from("push_log").delete().lt("day", addDays(at.toISOString().slice(0, 10), -LOG_KEEP_DAYS));
  if (error && !missingTable(error)) console.warn("push: log cleanup", error.message ?? error);
  return total;
}
