// The dispatch of the Edge Function "push": for everyone whose morning or evening time has come, decide
// once (push log), then send a body from her own data or leave it out; and the reminders whose moment falls
// in the next 15 minutes. The decisions themselves are pure (_shared/push_text.ts); this file reads the data,
// keeps the log and calls `send`. Without Deno APIs, so the tests can run it against a fake client.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.119.0";
import {
  addDays,
  busyDecision,
  calendarSubscribed,
  chooseBody,
  DAILY_LOOKBACK_DAYS,
  dueReminders,
  dueSlot,
  endedLate,
  eveningCandidates,
  fingerprint,
  laterAskedToday,
  localParts,
  morningCandidates,
  namedCounts,
  NO_REPEAT_DAYS,
  PAUSE_AFTER_DAYS,
  PAUSE_LOOKAHEAD_DAYS,
  pauseCandidates,
  pauseLineSent,
  pauseState,
  pushTitle,
  REMINDER_MAX_LEAD_MIN,
  REMINDER_WINDOW_MIN,
  REMINDERS_PER_DAY,
  reminderDay,
  reminderInRun,
  reminderMessage,
  remindedSoon,
  REMINDER_SOON_MIN,
  skipReason,
  slotDueAt,
  zoneOr,
  type Activity,
  type Candidate,
  type EveningFacts,
  type MorningFacts,
  type PauseFacts,
  type PushEvent,
  type PushGoal,
  type PushProfile,
  type ReminderEvent,
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
// no such column yet (this round's migration has not run): the older columns still work
const missingColumn = (e: { code?: string } | null) => e?.code === "42703" || e?.code === "PGRST204";

interface Person extends PushProfile {
  id: string;
  display_name: string | null;
  timezone: string | null;
  created_at: string | null;
  /** Du › Benachrichtigungen › «Erinnerungen an Einträge» (undefined: column not there yet, then none) */
  notify_reminders?: boolean | null;
  /** the last time her iPhone calendar fetched the feed (subscribed: no reminder as a notification) */
  calendar_fetched_at?: string | null;
}

const PEOPLE_COLS = "id, display_name, timezone, notify_morning, notify_evening, last_morning_push, last_evening_push, created_at";

/** ids per query in an `in` filter (the request line stays short) */
const IN_CHUNK = 100;
const chunks = <T>(xs: T[]): T[][] => Array.from({ length: Math.ceil(xs.length / IN_CHUNK) }, (_, i) => xs.slice(i * IN_CHUNK, (i + 1) * IN_CHUNK));

/**
 * Everyone with a time, and those with a reminder in this run (`reminderUsers`) whose switch is on: the switch is on
 * for everyone by default, so asking for it alone would read every profile each run. Before this round's migration
 * only those with a time.
 */
async function people(sb: SupabaseClient, reminderUsers: string[]): Promise<Person[]> {
  const cols = `${PEOPLE_COLS}, notify_reminders, calendar_fetched_at`;
  const res = await sb.from("profiles").select(cols).or("notify_morning.not.is.null,notify_evening.not.is.null");
  if (res.error) {
    if (!missingColumn(res.error)) console.warn("push: people", res.error.message ?? res.error);
    const { data } = await sb.from("profiles").select(PEOPLE_COLS).or("notify_morning.not.is.null,notify_evening.not.is.null");
    return (data ?? []) as Person[];
  }
  const out = (res.data ?? []) as Person[];
  const known = new Set(out.map((p) => p.id));
  for (const ids of chunks(reminderUsers.filter((id) => !known.has(id)))) {
    const more = await rows<Person>(sb.from("profiles").select(cols).in("id", ids).eq("notify_reminders", true), "reminder people");
    out.push(...(more ?? []));
  }
  return out;
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

const EVENT_COLS = "id, title, starts_at, ends_at, all_day, kind, goal_id, source, location";

/**
 * Her entries around now: a week back (an entry of every day, DAILY_LOOKBACK_DAYS; an all-day entry over a few days,
 * the late entry of last night) to a day and a half ahead, and all-day entries that began before and still run. Null
 * when they could not be read: then nothing about her day, no wait for a running entry and no later morning.
 */
async function nearEvents(sb: SupabaseClient, userId: string, at: Date): Promise<PushEvent[] | null> {
  const from = new Date(at.getTime() - (DAILY_LOOKBACK_DAYS + 1) * 86400e3).toISOString();
  const [near, longer] = await Promise.all([
    rows<PushEvent>(
      sb
        .from("events")
        .select(EVENT_COLS)
        .eq("user_id", userId)
        .gte("starts_at", from)
        .lte("starts_at", new Date(at.getTime() + 36 * 3600e3).toISOString())
        .order("starts_at")
        .limit(300),
      "events",
    ),
    // all-day entries that began before that and still run (two weeks of holidays): ends_at is the local
    // midnight of the last day, so a day and a half back is early enough (the pure function checks the day)
    rows<PushEvent>(
      sb
        .from("events")
        .select(EVENT_COLS)
        .eq("user_id", userId)
        .eq("all_day", true)
        .lt("starts_at", from)
        .gte("ends_at", new Date(at.getTime() - 36 * 3600e3).toISOString())
        .order("starts_at")
        .limit(20),
      "long events",
    ),
  ]);
  return near ? [...near, ...(longer ?? [])] : null;
}

const goalsOf = (sb: SupabaseClient, userId: string) =>
  rows<PushGoal>(sb.from("goals").select("id, title, kind, status, done_at").eq("user_id", userId).limit(500), "goals");

async function morningFacts(sb: SupabaseClient, userId: string, today: string, events: PushEvent[] | null): Promise<MorningFacts> {
  const [goals, steps] = await Promise.all([
    goalsOf(sb, userId),
    // the open steps due today: known before she opens the app (unlike the day's focus, set in conversation)
    rows<MorningFacts["dueSteps"][number]>(
      sb.from("milestones").select("title, goal_id").eq("user_id", userId).eq("due_date", today).is("done_at", null).limit(20),
      "due steps",
    ),
  ]);
  // an entry list that could not be read is treated as empty: the morning then says nothing about the day
  return { events: events ?? [], dueSteps: steps ?? [], goals };
}

async function eveningFacts(sb: SupabaseClient, userId: string, at: Date, today: string, events: PushEvent[] | null): Promise<EveningFacts> {
  const [goals, goalTime, milestones, logs] = await Promise.all([
    goalsOf(sb, userId),
    rows<EveningFacts["goalTime"][number]>(sb.from("goal_time").select("goal_id, minutes, source, event_id").eq("user_id", userId).eq("day", today).limit(200), "goal_time"),
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
  // without her answers (the query failed) no entry of the day either: a block she said no to must not be named
  return {
    goals,
    goalTime: goalTime ?? [],
    milestones: milestones ?? [],
    habits: habits.filter((h) => h.active !== false),
    events: goalTime ? (events ?? []) : [],
  };
}

/** for the pause line: her next entries (a week ahead) and open steps with a day */
async function pauseFacts(sb: SupabaseClient, userId: string, at: Date, today: string): Promise<PauseFacts> {
  const [events, steps, goals] = await Promise.all([
    rows<PushEvent>(
      sb
        .from("events")
        .select(EVENT_COLS)
        .eq("user_id", userId)
        .eq("all_day", false)
        .gte("starts_at", at.toISOString())
        .lte("starts_at", new Date(at.getTime() + (PAUSE_LOOKAHEAD_DAYS + 1) * 86400e3).toISOString())
        .order("starts_at")
        .limit(40),
      "next events",
    ),
    rows<PauseFacts["steps"][number]>(
      sb
        .from("milestones")
        .select("title, goal_id, due_date")
        .eq("user_id", userId)
        .gte("due_date", today)
        .lte("due_date", addDays(today, PAUSE_LOOKAHEAD_DAYS))
        .is("done_at", null)
        .order("due_date")
        .limit(20),
      "next steps",
    ),
    goalsOf(sb, userId),
  ]);
  return { events: events ?? [], steps: steps ?? [], goals };
}

/**
 * What went out lately (rotation, the pause line, how often an entry was named); before this round without `named`.
 * `log`: the push log is there (without it no reminder goes out, claim()).
 */
async function historyOf(sb: SupabaseClient, userId: string, today: string): Promise<{ sent: SentBefore[]; log: boolean }> {
  const q = (cols: string) =>
    sb
      .from("push_log")
      .select(cols)
      .eq("user_id", userId)
      .in("slot", ["morning", "evening"])
      .gte("day", addDays(today, -PAUSE_AFTER_DAYS));
  const res = await q("day, slot, status, template, fingerprint, named, created_at");
  if (!res.error) return { sent: (res.data ?? []) as unknown as SentBefore[], log: true };
  if (!missingColumn(res.error)) {
    if (!missingTable(res.error)) console.warn("push: history", res.error.message ?? res.error);
    return { sent: [], log: !missingTable(res.error) };
  }
  return { sent: (await rows<SentBefore>(q("day, slot, status, template, fingerprint, created_at"), "history")) ?? [], log: true };
}

/**
 * Claims the slot for today in the push log (one row per person, day, slot and entry), so that of two runs at the
 * same time (pg_cron and the GitHub workflow both call "dispatch") only one decides and sends. False when another
 * run was first. Without the log table (migration not run) or on another error: true for the morning and the
 * evening, so notifications keep working as before (profiles.last_*_push still guards the day); false for a
 * reminder (without the log it could come twice).
 */
async function claim(sb: SupabaseClient, row: Record<string, unknown>, onError: boolean): Promise<boolean> {
  const { data, error } = await sb.from("push_log").upsert(row, { onConflict: "user_id,day,slot,event_id", ignoreDuplicates: true }).select("id");
  if (error) {
    if (!missingTable(error)) console.warn("push: log", error.message ?? error);
    return onError;
  }
  return (data ?? []).length > 0;
}

/** fingerprints of the labels a body named (the log keeps no text), null for none */
const namedPrints = (c: Candidate | null) => (c?.named?.length ? [...new Set(c.named.map(fingerprint))].slice(0, 4) : null);

interface PersonRun {
  sb: SupabaseClient;
  p: Person;
  at: Date;
  tz: string;
  send: Send;
  subs(): Promise<Sub[]>;
  activity(): Promise<Activity | null>;
}

/** the slot that is due for this person, decided once: sent with a body from her own data, or left out */
async function slotFor(r: PersonRun): Promise<number> {
  const { sb, p, at, tz } = r;
  const now = localParts(at, tz);
  // due at its usual time, or two hours later after a late entry: which one, her entries tell
  if (!dueSlot(p, now) && !dueSlot(p, now, true)) return 0;
  const subs = await r.subs();
  if (!subs.length) return 0;
  const events = await nearEvents(sb, p.id, at);
  const late = events ? endedLate(events, at, tz) : false;
  const slot = dueSlot(p, now, late);
  if (!slot) return 0; // the usual morning time after a late night: it comes later
  const time = (slot === "morning" ? p.notify_morning : p.notify_evening)!;
  const due = slotDueAt(slot, time, now.weekday, late);

  const activity = await r.activity();
  const { sent: history, log } = await historyOf(sb, p.id, now.date);
  const a = activity ? { ...activity, since: p.created_at } : null;
  const lineSent = a ? pauseLineSent(history, a) : false;
  // unknown activity (the query failed): no pause and no skip, as before
  let reason: SkipReason | null = a ? skipReason(slot, at, tz, due.minutes, a, lineSent) : null;
  const pauseLine = !reason && !!a && pauseState(at, a, lineSent) === "line";
  if (!reason && due.skip) reason = "late_night";
  if (!reason && events) {
    // none while one of her entries runs: a later run in the slot's hour decides, or it stays out
    const busy = busyDecision(events, at, now, due.minutes);
    if (busy === "wait") return 0;
    if (busy === "skip") reason = "busy";
  }
  let choice: Candidate | null = null;
  if (!reason) {
    const recent = history.filter((h) => h.day >= addDays(now.date, -NO_REPEAT_DAYS));
    const named = namedCounts(recent, now.date);
    // what her own reminders say within the hour, the morning and the pause line leave out (none without the log)
    const remindSoon = log && (pauseLine || slot === "morning") ? await soonReminded(sb, p, at, a) : undefined;
    const groups = pauseLine
      ? pauseCandidates({ ...(await pauseFacts(sb, p.id, at, now.date)), remindSoon }, at, tz)
      : slot === "morning"
        ? morningCandidates({ ...(await morningFacts(sb, p.id, now.date, events)), named, remindSoon }, at, tz)
        : eveningCandidates({ ...(await eveningFacts(sb, p.id, at, now.date, events)), named }, at, tz);
    choice = chooseBody(groups, recent, now.date, slot);
    // nothing of her own to say: no message (round 3, no filler)
    if (!choice) reason = groups.length ? "repeat" : pauseLine ? "paused" : "empty";
  }

  const named = namedPrints(choice);
  const claimed = await claim(
    sb,
    {
      user_id: p.id,
      day: now.date,
      slot,
      event_id: null,
      status: reason ? "skipped" : "sent",
      reason,
      template: choice?.template ?? null,
      fingerprint: choice ? fingerprint(choice.body) : null,
      ...(named ? { named } : {}),
      // the run's clock (the pause line counts as sent only after her last open)
      created_at: at.toISOString(),
    },
    true,
  );
  if (!claimed) return 0;
  // decided for today, sent or not: later runs in the window leave it alone
  await sb
    .from("profiles")
    .update(slot === "morning" ? { last_morning_push: now.date } : { last_evening_push: now.date })
    .eq("id", p.id);
  if (reason || !choice) return 0;

  const sent = await r.send(subs, { title: pushTitle(slot, p.display_name), body: choice.body });
  const { error } = await sb.from("push_log").update({ devices: Math.min(sent, 100) }).eq("user_id", p.id).eq("day", now.date).eq("slot", slot).is("event_id", null);
  if (error && !missingTable(error)) console.warn("push: log devices", error.message ?? error);
  return sent;
}

/**
 * Her reminders of this run (owner decision 2): only with the switch on, a device, and her iPhone calendar not
 * subscribed (its own alarm reminds her); a dream's block only when she asked for it; at most three a day; each entry
 * once (the push log, keyed by the day of its moment).
 */
async function remindersFor(r: PersonRun, candidates: ReminderEvent[], answered: Set<string>): Promise<number> {
  const { sb, p, at, tz } = r;
  if (!candidates.length || p.notify_reminders !== true || calendarSubscribed(p.calendar_fetched_at, at)) return 0;
  const subs = await r.subs();
  if (!subs.length) return 0;
  const today = localParts(at, tz).date;
  const sentToday = await rows<{ id: number }>(
    sb.from("push_log").select("id").eq("user_id", p.id).eq("day", today).eq("slot", "reminder").eq("status", "sent"),
    "reminders today",
  );
  if (!sentToday) return 0; // unknown how many went out: none rather than a fourth
  const activity = await r.activity();
  // a dream's block only when she asked for the reminder (goals unknown: only those she asked for)
  const goals = await goalsOf(sb, p.id);
  // a block's reminder leaves room for those she asked for later today (unknown: no block reminder rather than hers lost)
  const later = candidates.some((e) => e.reminder_asked !== true) ? await askedLater(sb, p.id, at, tz) : 0;
  const due = dueReminders(
    { events: candidates, answered, sentToday: sentToday.length, activity: activity ? { ...activity, since: p.created_at } : null, goals, laterAsked: later },
    at,
  );
  let total = 0;
  for (const e of due) {
    const m = reminderMessage(e, goals, at, tz);
    // the day of its moment, not of this run: the run before midnight and the one after it share the key
    const day = reminderDay(e, tz) ?? today;
    const claimed = await claim(
      sb,
      { user_id: p.id, day, slot: "reminder", event_id: e.id, status: "sent", reason: null, template: m.template, fingerprint: fingerprint(m.body), created_at: at.toISOString() },
      false,
    );
    if (!claimed) continue;
    const sent = await r.send(subs, { title: m.title, body: m.body });
    const { error } = await sb.from("push_log").update({ devices: Math.min(sent, 100) }).eq("user_id", p.id).eq("day", day).eq("slot", "reminder").eq("event_id", e.id);
    if (error) console.warn("push: log devices", error.message ?? error);
    total += sent;
  }
  return total;
}

const REMINDER_COLS = "id, user_id, title, starts_at, ends_at, all_day, kind, goal_id, source, reminder_minutes, reminder_asked";

/** the ids of entries with an answer already (done early, a habit's tick); null when that could not be read */
async function answeredOf(sb: SupabaseClient, ids: string[]): Promise<Set<string> | null> {
  const out = new Set<string>();
  for (const part of chunks(ids)) {
    const done = await rows<{ event_id: string }>(sb.from("goal_time").select("event_id").in("event_id", part), "answered entries");
    if (!done) return null;
    for (const d of done) out.add(d.event_id);
  }
  return out;
}

/**
 * Her entries whose reminder comes as a notification within the hour (remindedSoon), for the morning and the pause
 * line to leave out: only when her reminders come as notifications (the switch on, her iPhone calendar not
 * subscribed). Empty when that is not so or could not be read (then a message may name it as before).
 */
async function soonReminded(sb: SupabaseClient, p: Person, at: Date, activity: Activity | null): Promise<Set<string>> {
  if (p.notify_reminders !== true || calendarSubscribed(p.calendar_fetched_at, at)) return new Set();
  const until = new Date(at.getTime() + (REMINDER_SOON_MIN + REMINDER_MAX_LEAD_MIN) * 60000).toISOString();
  const [timed, allDay] = await Promise.all([
    rows<ReminderEvent>(
      sb
        .from("events")
        .select(REMINDER_COLS)
        .eq("user_id", p.id)
        .eq("all_day", false)
        .not("reminder_minutes", "is", null)
        .neq("source", "nolio")
        .gte("starts_at", at.toISOString())
        .lte("starts_at", until)
        .or("kind.eq.block,reminder_asked.is.true")
        .order("starts_at")
        .limit(50),
      "reminders soon",
    ),
    // an all-day entry she asked a reminder for: from a day back (its day began at midnight; remindedSoon checks it)
    rows<ReminderEvent>(
      sb
        .from("events")
        .select(REMINDER_COLS)
        .eq("user_id", p.id)
        .eq("all_day", true)
        .eq("reminder_asked", true)
        .not("reminder_minutes", "is", null)
        .neq("source", "nolio")
        .gte("starts_at", new Date(at.getTime() - 24 * 3600e3).toISOString())
        .lte("starts_at", until)
        .limit(20),
      "all-day reminders soon",
    ),
  ]);
  const list = timed ? [...timed, ...(allDay ?? [])] : null;
  if (!list?.length) return new Set();
  const [answered, goals] = await Promise.all([answeredOf(sb, list.filter((e) => e.goal_id).map((e) => e.id)), goalsOf(sb, p.id)]);
  // unknown answers: an entry done early would still be named, never a reminder that does not come left out
  return remindedSoon({ events: list, answered: answered ?? new Set(list.map((e) => e.id)), activity, goals }, at);
}

/** how many reminders she asked for ring later today (laterAskedToday); on a failed query the whole day's three */
async function askedLater(sb: SupabaseClient, userId: string, at: Date, tz: string): Promise<number> {
  const list = await rows<ReminderEvent>(
    sb
      .from("events")
      .select(REMINDER_COLS)
      .eq("user_id", userId)
      .eq("reminder_asked", true)
      .not("reminder_minutes", "is", null)
      .neq("source", "nolio")
      // from a day back: an all-day entry's reminder may fall within its day
      .gte("starts_at", new Date(at.getTime() - 24 * 3600e3).toISOString())
      .lte("starts_at", new Date(at.getTime() + (REMINDER_MAX_LEAD_MIN + 24 * 60) * 60000).toISOString())
      .limit(50),
    "asked reminders later",
  );
  return list ? laterAskedToday(list, at, tz) : REMINDERS_PER_DAY;
}

/**
 * The entries whose reminder falls in this run (for everyone, one query), per person, and the blocks among them that
 * have an answer already. Empty before this round's migration (no reminder_asked yet) or when the query fails.
 */
async function reminderCandidates(sb: SupabaseClient, at: Date): Promise<{ byUser: Map<string, ReminderEvent[]>; answered: Set<string> }> {
  const byUser = new Map<string, ReminderEvent[]>();
  const answered = new Set<string>();
  const [list, allDay] = await Promise.all([
    rows<ReminderEvent & { user_id: string }>(
      sb
        .from("events")
        .select(REMINDER_COLS)
        .eq("all_day", false)
        .not("reminder_minutes", "is", null)
        .neq("source", "nolio")
        .gte("starts_at", at.toISOString())
        .lte("starts_at", new Date(at.getTime() + (REMINDER_MAX_LEAD_MIN + REMINDER_WINDOW_MIN) * 60000).toISOString())
        .or("kind.eq.block,reminder_asked.is.true")
        .order("starts_at")
        .limit(2000),
      "reminder entries",
    ),
    // all-day entries she asked a reminder for (counted from the midnight their day begins: also within that day)
    rows<ReminderEvent & { user_id: string }>(
      sb
        .from("events")
        .select(REMINDER_COLS)
        .eq("all_day", true)
        .eq("reminder_asked", true)
        .not("reminder_minutes", "is", null)
        .neq("source", "nolio")
        .gte("starts_at", new Date(at.getTime() - 24 * 3600e3).toISOString())
        .lte("starts_at", new Date(at.getTime() + (REMINDER_MAX_LEAD_MIN + REMINDER_WINDOW_MIN) * 60000).toISOString())
        .order("starts_at")
        .limit(500),
      "all-day reminder entries",
    ),
  ]);
  // only what falls in this run's span (the pure check again per person, with her own facts)
  const near = [...(list ?? []), ...(allDay ?? [])].filter((e) => reminderInRun(e, at.getTime()));
  for (const e of near) {
    if (!byUser.has(e.user_id)) byUser.set(e.user_id, []);
    byUser.get(e.user_id)!.push(e);
  }
  // those with a goal can have an answer: a block, and a termin with a goal (a training, answered early by a tick)
  for (const part of chunks(near.filter((e) => e.goal_id).map((e) => e.id))) {
    const done = await answeredOf(sb, part);
    // unknown answers: no reminder for these (one for something she did already would be worse than none)
    for (const id of done ?? part) answered.add(id);
  }
  return { byUser, answered };
}

/**
 * Morning and evening messages for everyone whose time has come, and the reminders of this run. `send`
 * delivers one message to a person's devices and says how many it reached. Returns the number of devices reached.
 */
export async function dispatch(sb: SupabaseClient, send: Send, at: Date = new Date()): Promise<number> {
  const reminders = await reminderCandidates(sb, at);
  const persons = await people(sb, [...reminders.byUser.keys()]);
  let total = 0;
  for (const p of persons) {
    let subs: Promise<Sub[]> | null = null;
    let activity: Promise<Activity | null> | null = null;
    const run: PersonRun = {
      sb,
      p,
      at,
      tz: zoneOr(p.timezone),
      send,
      subs: () =>
        (subs ??= Promise.resolve(sb.from("push_subscriptions").select("id, endpoint, p256dh, auth, app_url").eq("user_id", p.id)).then(
          ({ data }) => (data ?? []) as Sub[],
        )),
      activity: () => (activity ??= activityOf(sb, p.id)),
    };
    try {
      total += await slotFor(run);
    } catch (e) {
      // one person's trouble never stops the others' messages
      console.error("push: person", p.id, e);
    }
    try {
      total += await remindersFor(run, reminders.byUser.get(p.id) ?? [], reminders.answered);
    } catch (e) {
      console.error("push: reminders", p.id, e);
    }
  }
  // the log is only needed for a while (rotation, «already decided today»): older rows go
  const { error } = await sb.from("push_log").delete().lt("day", addDays(at.toISOString().slice(0, 10), -LOG_KEEP_DAYS));
  if (error && !missingTable(error)) console.warn("push: log cleanup", error.message ?? error);
  return total;
}
