import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  Backend,
  CalendarEvent,
  ChatMessage,
  CoachContext,
  CoachEvent,
  CoachRequest,
  DayState,
  EventInput,
  EventScope,
  Goal,
  GoalInput,
  GoalTime,
  Habit,
  HabitInput,
  Memory,
  Milestone,
  NolioStatus,
  NolioSyncResult,
  Profile,
  PushSubscriptionRow,
  WhoopConfirmResult,
  WhoopStatus,
  WhoopSyncResult,
} from "./types";
import { normaliseUsername, USERNAME_RE } from "./types";
import { addDays, dayOf, habitTimeKey, habitTimeRow, seriesDayFollows, seriesPatchFromDay, weekStart } from "./plan";
import { blockTimeEntry } from "./demoBackend";
import { deviceAttribution } from "../../supabase/functions/_shared/nolio.ts";

// Supabase Auth works with e-mail addresses. People here log in with a plain
// username, so each username maps to an internal address on a reserved,
// non-routable domain (RFC 2606). No mail is ever sent there.
const USERNAME_DOMAIN = import.meta.env.VITE_USERNAME_EMAIL_DOMAIN || "nutzer.app-ich.example";

const toEmail = (username: string) => `${normaliseUsername(username)}@${USERNAME_DOMAIN}`;

// A goal row as PostgREST returns it, with its embedded milestones. Postgres numeric
// can come back as a string, so the hours are converted. kind, done_at, memory and reminded_at
// come with the Bucket List migration (missing before it: then it is a goal).
type Numeric = number | string | null;
type GoalRow = Omit<Goal, "milestones" | "time" | "effort_hours" | "weekly_hours" | "prior_hours" | "kind" | "done_at" | "memory"> & {
  milestones?: Milestone[] | null;
  effort_hours: Numeric;
  weekly_hours: Numeric;
  prior_hours: Numeric;
  kind?: Goal["kind"] | null;
  done_at?: string | null;
  memory?: string | null;
};
type GoalMinutes = Goal["time"];
const NO_TIME: GoalMinutes = { logged_minutes: 0, block_minutes: 0, provisional_minutes: 0 };
const toNumber = (v: Numeric | undefined): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const toGoal = (row: GoalRow, time: GoalMinutes = NO_TIME): Goal => ({
  ...row,
  kind: row.kind === "dream" ? "dream" : "goal",
  done_at: row.done_at ?? null,
  memory: row.memory ?? null,
  reminded_at: row.reminded_at ?? null,
  obstacle: row.obstacle ?? null,
  plan_b: row.plan_b ?? null,
  plan_b_asked_at: row.plan_b_asked_at ?? null,
  effort_hours: toNumber(row.effort_hours),
  weekly_hours: toNumber(row.weekly_hours),
  prior_hours: toNumber(row.prior_hours) ?? 0,
  milestones: [...(row.milestones ?? [])].sort((a, b) => a.position - b.position),
  time: { ...time },
});
/**
 * prior_hours is "not null default 0": an emptied field means 0. An emptied memory means none.
 * done_at needs no care here: the trigger goals_done_at sets it when the status becomes done and
 * clears it otherwise.
 */
const goalRow = <T extends Partial<GoalInput>>(g: T): T => {
  let out = g;
  if ((g.prior_hours as number | null | undefined) === null) out = { ...out, prior_hours: 0 };
  if (typeof g.memory === "string" && !g.memory.trim()) out = { ...out, memory: null };
  // an emptied Plan B (or obstacle) means none; the trigger goals_plan_b_asked notes the question for a new one
  if (typeof g.plan_b === "string" && !g.plan_b.trim()) out = { ...out, plan_b: null };
  if (typeof g.obstacle === "string" && !g.obstacle.trim()) out = { ...out, obstacle: null };
  return out;
};

/** Splits ids for .in() filters, so the request URL stays short. */
function chunks<T>(items: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** PostgREST returns at most max_rows (1000 on Supabase) per request; the export pages through. */
const EXPORT_PAGE = 1000;
// every table of the export with a stable order for paging (its primary key)
const EXPORT_TABLES: [string, string[]][] = [
  ["memories", ["id"]],
  ["events", ["id"]],
  ["goals", ["id"]],
  ["milestones", ["id"]],
  ["goal_time", ["id"]],
  ["habits", ["id"]],
  ["habit_logs", ["habit_id", "day"]],
  ["days", ["user_id", "day"]],
  ["messages", ["id"]],
  ["push_subscriptions", ["id"]],
];
// readable by the person (RLS), present once the WHOOP / Nolio / push log migrations ran
const EXPORT_CONNECTION_TABLES: [string, string[]][] = [
  ["connections", ["provider"]],
  ["whoop_days", ["day"]],
  ["nolio_trainings", ["id"]],
  ["nolio_sync", ["user_id"]],
  // which notifications went out or stayed out (template ids and reasons, never a text)
  ["push_log", ["id"]],
  // the weekly rhythms (their days are in events)
  ["series", ["id"]],
];

// A habit row with its embedded logs (only the days).
type HabitRow = Omit<Habit, "done_days"> & { habit_logs: { day: string }[] | null };
const toHabit = ({ habit_logs, ...row }: HabitRow): Habit => ({ ...row, done_days: (habit_logs ?? []).map((l) => l.day).sort() });

/** First day of the habit history the app shows: the current week and the 15 before it. */
const habitsSince = () => addDays(weekStart(dayOf()), -15 * 7);

/** The status JSON of the whoop function, checked field by field; null when it isn't one. */
function whoopStatusFrom(j: unknown): WhoopStatus | null {
  const o = j as Partial<WhoopStatus> | null;
  if (!o || typeof o !== "object" || typeof o.available !== "boolean") return null;
  const st = o.status;
  return {
    available: o.available,
    connected: o.connected === true,
    status: st === "connected" || st === "pending" || st === "needs_reconnect" ? st : null,
    consent_ai: o.consent_ai === true,
    connected_at: typeof o.connected_at === "string" ? o.connected_at : null,
    last_sync_at: typeof o.last_sync_at === "string" ? o.last_sync_at : null,
    last_error: typeof o.last_error === "string" ? o.last_error : null,
    attribution: typeof o.attribution === "string" && o.attribution.trim() ? o.attribution : "Daten von WHOOP",
    days: Array.isArray(o.days) ? o.days.filter((d) => d && typeof d === "object" && typeof d.day === "string") : [],
  };
}

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "Benutzername oder Passwort stimmt nicht.";
  if (m.includes("already registered") || m.includes("already exists")) return "Diesen Benutzernamen gibt es schon.";
  if (m.includes("password") && m.includes("characters")) return "Das Passwort braucht mindestens 8 Zeichen.";
  if (m.includes("rate limit")) return "Zu viele Versuche. Bitte warte kurz.";
  if (m.includes("email not confirmed"))
    return "In Supabase ist die E-Mail-Bestätigung noch eingeschaltet (siehe Anleitung im README).";
  return message;
}

export class SupabaseBackend implements Backend {
  readonly kind = "supabase" as const;
  private sb: SupabaseClient;
  private url: string;
  private anonKey: string;

  constructor(url: string, anonKey: string) {
    this.url = url;
    this.anonKey = anonKey;
    // persistSession keeps people logged in, so the app opens straight to the orb.
    this.sb = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "ich.auth" },
    });
  }

  async currentUserId() {
    const { data } = await this.sb.auth.getSession();
    return data.session?.user.id ?? null;
  }

  onAuthChange(cb: (userId: string | null) => void) {
    const { data } = this.sb.auth.onAuthStateChange((_e, session) => cb(session?.user.id ?? null));
    return () => data.subscription.unsubscribe();
  }

  async signUp(username: string, password: string) {
    const u = normaliseUsername(username);
    if (!USERNAME_RE.test(u)) throw new Error("Benutzername: 3–30 Zeichen, nur a–z, 0–9, Punkt, Strich, Unterstrich.");
    if (password.length < 8) throw new Error("Das Passwort braucht mindestens 8 Zeichen.");
    const { data, error } = await this.sb.auth.signUp({
      email: toEmail(u),
      password,
      options: { data: { username: u } },
    });
    if (error) throw new Error(friendlyAuthError(error.message));
    if (!data.session) {
      // Sign-up worked but no session: e-mail confirmation is still on in Supabase.
      throw new Error(friendlyAuthError("email not confirmed"));
    }
  }

  async signIn(username: string, password: string) {
    const { error } = await this.sb.auth.signInWithPassword({ email: toEmail(username), password });
    if (error) throw new Error(friendlyAuthError(error.message));
  }

  async signOut() {
    await this.sb.auth.signOut();
  }

  private async uid(): Promise<string> {
    const id = await this.currentUserId();
    if (!id) throw new Error("Nicht eingeloggt.");
    return id;
  }

  async getProfile(): Promise<Profile> {
    const id = await this.uid();
    const { data, error } = await this.sb.from("profiles").select("*").eq("id", id).single();
    if (error) throw error;
    return data as Profile;
  }

  async updateProfile(patch: Partial<Omit<Profile, "id" | "username">>) {
    const id = await this.uid();
    const { error } = await this.sb.from("profiles").update(patch).eq("id", id);
    if (error) throw error;
  }

  async listMemories(): Promise<Memory[]> {
    const { data, error } = await this.sb.from("memories").select("*").order("created_at", { ascending: true });
    if (error) throw error;
    return data as Memory[];
  }

  async addMemory(m: Pick<Memory, "content" | "category" | "event_date">): Promise<Memory> {
    const { data, error } = await this.sb.from("memories").insert(m).select().single();
    if (error) throw error;
    return data as Memory;
  }

  async updateMemory(id: string, patch: Partial<Pick<Memory, "content" | "category" | "event_date" | "source">>) {
    const { error } = await this.sb.from("memories").update(patch).eq("id", id);
    if (error) throw error;
  }

  async deleteMemory(id: string) {
    const { error } = await this.sb.from("memories").delete().eq("id", id);
    if (error) throw error;
  }

  async listEvents(from?: string, to?: string): Promise<CalendarEvent[]> {
    const since = from ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    let q = this.sb.from("events").select("*").gte("starts_at", since);
    if (to) q = q.lt("starts_at", to);
    const { data, error } = await q.order("starts_at").limit(1000);
    if (error) throw error;
    return data as CalendarEvent[];
  }

  async addEvent(e: EventInput): Promise<CalendarEvent> {
    const row = { ...e, kind: e.kind ?? "termin", goal_id: e.goal_id ?? null, source: "person" };
    const { data, error } = await this.sb.from("events").insert(row).select().single();
    if (error) throw error;
    return data as CalendarEvent;
  }

  async updateEvent(id: string, patch: Partial<EventInput>, scope: EventScope = "this"): Promise<CalendarEvent> {
    // «Alle kommenden»: the rhythm takes the change, its trigger (series_sync) moves every coming day nobody answered
    if (scope === "following") {
      const day = await this.rhythmDay(id);
      if (day) {
        // only what she changed now goes to the rhythm (never what the day had on its own before)
        const rule = seriesPatchFromDay(day.entry, { ...day.entry, ...patch }, day.time_zone);
        // the day follows the rhythm again (its change moves it like every coming day); her exception that keeps its
        // own start takes the change directly and stays hers
        const follows = seriesDayFollows(day.entry.series_exception, rule);
        if (follows && day.entry.series_exception) {
          const back = await this.sb.from("events").update({ series_exception: false }).eq("id", id);
          if (back.error) throw back.error;
        }
        if (Object.keys(rule).length) {
          const res = await this.sb.from("series").update(rule).eq("id", day.series_id);
          if (res.error) throw res.error;
        }
        // notes stay with the day
        const own: Partial<EventInput> = follows ? (patch.notes !== undefined && patch.notes !== day.entry.notes ? { notes: patch.notes } : {}) : patch;
        if (Object.keys(own).length) {
          const n = await this.sb.from("events").update(own).eq("id", id);
          if (n.error) throw n.error;
        }
        const { data, error } = await this.sb.from("events").select("*").eq("id", id).single();
        if (error) throw error;
        return data as CalendarEvent;
      }
    }
    // The events_bump trigger raises sequence and updated_at, so subscribed calendars pick it up. A day of a weekly
    // rhythm changed here is her exception (trigger events_series_exception).
    const { data, error } = await this.sb.from("events").update(patch).eq("id", id).select().single();
    if (error) throw error;
    return data as CalendarEvent;
  }

  async deleteEvent(id: string, scope: EventScope = "this") {
    // «Alle kommenden»: the rhythm ends the day before (or goes, when nothing of it is left); its trigger removes
    // the coming days, past and answered ones stay. «Nur diesen Termin»: the day falls away (a skip marker).
    if (scope === "following") {
      const day = await this.rhythmDay(id);
      if (day?.entry.series_day) {
        const last = addDays(day.entry.series_day, -1);
        const res =
          last >= day.start_date
            ? await this.sb.from("series").update({ until_date: last }).eq("id", day.series_id)
            : await this.sb.from("series").delete().eq("id", day.series_id);
        if (res.error) throw res.error;
        return;
      }
    }
    const { error } = await this.sb.from("events").delete().eq("id", id);
    if (error) throw error;
  }

  /** A day of a weekly rhythm with its rhythm's time zone and first day; null for any other entry. */
  private async rhythmDay(id: string): Promise<{ entry: CalendarEvent; series_id: string; time_zone: string; start_date: string } | null> {
    const { data, error } = await this.sb.from("events").select("*, series(time_zone, start_date)").eq("id", id).maybeSingle();
    if (error) throw error;
    const row = data as (CalendarEvent & { series: { time_zone: string; start_date: string } | null }) | null;
    if (!row?.series_id || !row.series) return null;
    const { series, ...entry } = row;
    return { entry, series_id: row.series_id, time_zone: series.time_zone, start_date: series.start_date };
  }

  /** Minutes per goal from the view goal_minutes (logged time, past blocks not yet answered that still count, of those
   *  the provisional ones; before the honest-counting migration there is no provisional_minutes: 0). */
  private async goalMinutes(ids: string[]): Promise<Map<string, GoalMinutes>> {
    const out = new Map<string, GoalMinutes>();
    for (const part of chunks(ids)) {
      const { data, error } = await this.sb.from("goal_minutes").select("*").in("goal_id", part);
      if (error) throw error;
      for (const r of data as { goal_id: string; logged_minutes: Numeric; block_minutes: Numeric; provisional_minutes?: Numeric }[])
        out.set(r.goal_id, {
          logged_minutes: toNumber(r.logged_minutes) ?? 0,
          block_minutes: toNumber(r.block_minutes) ?? 0,
          provisional_minutes: toNumber(r.provisional_minutes) ?? 0,
        });
    }
    return out;
  }

  private countFrom: Promise<string | null> | null = null;
  /** public.honest_count_from(), asked once per session; a failure (e.g. before its migration) is asked again next time. */
  countingFrom(): Promise<string | null> {
    this.countFrom ??= Promise.resolve(this.sb.rpc("honest_count_from")).then(
      ({ data, error }) => {
        if (error || typeof data !== "string" || !Number.isFinite(Date.parse(data))) {
          this.countFrom = null;
          return null;
        }
        return data;
      },
      () => {
        this.countFrom = null;
        return null;
      },
    );
    return this.countFrom;
  }

  private async withTime(rows: GoalRow[]): Promise<Goal[]> {
    const time = rows.length ? await this.goalMinutes(rows.map((r) => r.id)) : new Map<string, GoalMinutes>();
    return rows.map((r) => toGoal(r, time.get(r.id)));
  }

  async listGoals(all = false): Promise<Goal[]> {
    let q = this.sb.from("goals").select("*, milestones(*)");
    if (!all) q = q.in("status", ["active", "paused"]);
    const { data, error } = await q.order("target_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true });
    if (error) throw error;
    return this.withTime(data as GoalRow[]);
  }

  async addGoal(g: GoalInput, milestones: Pick<Milestone, "title" | "due_date">[] = []): Promise<Goal> {
    const { data, error } = await this.sb.from("goals").insert({ ...goalRow(g), source: "person" }).select().single();
    if (error) throw error;
    // a new goal has no time and no blocks yet
    const goal = data as GoalRow;
    if (!milestones.length) return toGoal(goal);
    const rows = milestones.map((m, i) => ({ goal_id: goal.id, title: m.title, due_date: m.due_date, position: i }));
    const res = await this.sb.from("milestones").insert(rows).select();
    if (res.error) {
      // No transactions over PostgREST: undo the goal so it isn't left half-saved.
      await this.sb.from("goals").delete().eq("id", goal.id);
      throw res.error;
    }
    return toGoal({ ...goal, milestones: res.data as Milestone[] });
  }

  async updateGoal(id: string, patch: Partial<GoalInput>): Promise<Goal> {
    const { data, error } = await this.sb.from("goals").update(goalRow(patch)).eq("id", id).select("*, milestones(*)").single();
    if (error) throw error;
    const [goal] = await this.withTime([data as GoalRow]);
    return goal;
  }

  async deleteGoal(id: string) {
    // milestones go with it (cascade); habits and calendar entries keep existing without the link
    const { error } = await this.sb.from("goals").delete().eq("id", id);
    if (error) throw error;
  }

  async addMilestone(goalId: string, m: Pick<Milestone, "title" | "due_date">): Promise<Milestone> {
    const last = await this.sb.from("milestones").select("position").eq("goal_id", goalId).order("position", { ascending: false }).limit(1).maybeSingle();
    if (last.error) throw last.error;
    const position = last.data ? (last.data.position as number) + 1 : 0;
    const { data, error } = await this.sb.from("milestones").insert({ goal_id: goalId, title: m.title, due_date: m.due_date, position }).select().single();
    if (error) throw error;
    return data as Milestone;
  }

  async updateMilestone(id: string, patch: Partial<Pick<Milestone, "title" | "due_date" | "position">> & { done?: boolean }): Promise<Milestone> {
    const { done, ...rest } = patch;
    const row: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    if (done === false) row.done_at = null;
    let out: Milestone | null = null;
    if (done !== true || Object.keys(row).length) {
      const { data, error } = await this.sb.from("milestones").update(row).eq("id", id).select().single();
      if (error) throw error;
      out = data as Milestone;
    }
    if (done !== true) return out!;
    // Done keeps the moment it was first done (a second tap, another device).
    const set = await this.sb.from("milestones").update({ done_at: new Date().toISOString() }).eq("id", id).is("done_at", null).select();
    if (set.error) throw set.error;
    if (set.data.length) return set.data[0] as Milestone;
    if (out) return out;
    const { data, error } = await this.sb.from("milestones").select().eq("id", id).single();
    if (error) throw error;
    return data as Milestone;
  }

  async deleteMilestone(id: string) {
    const { error } = await this.sb.from("milestones").delete().eq("id", id);
    if (error) throw error;
  }

  async setBlockDone(eventId: string, done: boolean | null, minutes?: number) {
    if (done === null) {
      // no answer any more: the block counts by itself again (provisionally for a week after it ended, as the view counts)
      const { error } = await this.sb.from("goal_time").delete().eq("event_id", eventId);
      if (error) throw error;
      return;
    }
    const ev = await this.sb.from("events").select("kind, goal_id, starts_at, ends_at, all_day").eq("id", eventId).maybeSingle();
    if (ev.error) throw ev.error;
    const fields = { ...blockTimeEntry(ev.data as Pick<CalendarEvent, "kind" | "goal_id" | "starts_at" | "ends_at" | "all_day"> | null, done, minutes), source: "block" as GoalTime["source"] };
    // Update, else insert: the unique index on event_id is partial, which PostgREST's upsert can't target.
    const update = () => this.sb.from("goal_time").update(fields).eq("event_id", eventId).select("id");
    const upd = await update();
    if (upd.error) throw upd.error;
    if (upd.data.length) return;
    const ins = await this.sb.from("goal_time").insert({ ...fields, event_id: eventId });
    if (!ins.error) return;
    if (ins.error.code !== "23505") throw ins.error;
    // answered on another device at the same moment: this answer wins
    const again = await update();
    if (again.error) throw again.error;
  }

  async blockAnswers(eventIds: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const part of chunks([...new Set(eventIds)])) {
      const { data, error } = await this.sb.from("goal_time").select("event_id, minutes").in("event_id", part);
      if (error) throw error;
      for (const r of data as Pick<GoalTime, "event_id" | "minutes">[]) if (r.event_id) out[r.event_id] = r.minutes;
    }
    return out;
  }

  async listGoalTime(from: string, to: string): Promise<GoalTime[]> {
    const out: GoalTime[] = [];
    for (let start = 0; ; start += 1000) {
      const { data, error } = await this.sb
        .from("goal_time")
        .select("id, goal_id, day, minutes, source, event_id, external_id, note")
        .gte("day", from)
        .lte("day", to)
        .order("day")
        .order("id")
        .range(start, start + 999);
      if (error) throw error;
      out.push(...(data as GoalTime[]));
      if (data.length < 1000) return out;
    }
  }

  async listHabits(): Promise<Habit[]> {
    // The filter on habit_logs.day limits the embedded logs, not the habits.
    const { data, error } = await this.sb
      .from("habits")
      .select("*, habit_logs(day)")
      .eq("active", true)
      .gte("habit_logs.day", habitsSince())
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data as HabitRow[]).map(toHabit);
  }

  async addHabit(h: HabitInput): Promise<Habit> {
    const { data, error } = await this.sb.from("habits").insert({ ...h, source: "person" }).select().single();
    if (error) throw error;
    return { ...(data as Omit<Habit, "done_days">), done_days: [] };
  }

  async updateHabit(id: string, patch: Partial<HabitInput>): Promise<Habit> {
    const { data, error } = await this.sb.from("habits").update(patch).eq("id", id).select().single();
    if (error) throw error;
    // read the logs on their own: filters on embedded rows are only sure to work on plain reads
    const logs = await this.sb.from("habit_logs").select("day").eq("habit_id", id).gte("day", habitsSince());
    if (logs.error) throw logs.error;
    return toHabit({ ...(data as Omit<Habit, "done_days">), habit_logs: logs.data as { day: string }[] });
  }

  async deleteHabit(id: string) {
    const { error } = await this.sb.from("habits").delete().eq("id", id);
    if (error) throw error;
  }

  async setHabitDone(habitId: string, day: string, done: boolean) {
    const { error } = done
      ? // ticking twice (two devices, a double tap) must not fail
        await this.sb.from("habit_logs").upsert({ habit_id: habitId, day }, { onConflict: "habit_id,day", ignoreDuplicates: true })
      : await this.sb.from("habit_logs").delete().eq("habit_id", habitId).eq("day", day);
    if (error) throw error;
    await this.habitTime(habitId, day, done);
  }

  /**
   * D2, as the coach's log_habit: a tick of a habit with a goal and a length counts that length for the goal (one
   * goal_time row, source «habit», external_id «<habit id>:<day>»; once with a block of that day that is the same thing,
   * habitTimeRow); an untick removes it. The tick is saved already: a failure here only leaves the minutes uncounted.
   */
  private async habitTime(habitId: string, day: string, done: boolean): Promise<void> {
    try {
      if (!done) {
        const del = await this.sb.from("goal_time").delete().eq("source", "habit").eq("external_id", habitTimeKey(habitId, day));
        if (del.error) console.warn("habit time off:", del.error.message);
        return;
      }
      // "*": minutes only after its migration
      const h = await this.sb.from("habits").select("*").eq("id", habitId).maybeSingle();
      const habit = h.data as (Habit & { minutes?: number | null }) | null;
      if (h.error || !habit?.goal_id || !habit.minutes) return;
      const start = Date.parse(`${day}T00:00:00Z`);
      const [blocks, times] = await Promise.all([
        this.sb
          .from("events")
          // its blocks and termine (a termin with a goal counts like a block)
          .select("id, title, goal_id, starts_at, all_day, kind, source, goal_time(id)")
          .eq("goal_id", habit.goal_id)
          .eq("all_day", false)
          .neq("source", "nolio")
          .gte("starts_at", new Date(start - 86400e3).toISOString())
          .lt("starts_at", new Date(start + 2 * 86400e3).toISOString())
          .limit(20),
        this.sb.from("goal_time").select("goal_id, day, minutes, source, external_id").eq("goal_id", habit.goal_id).eq("day", day).limit(100),
      ]);
      if (blocks.error || times.error) return;
      type BlockRow = { id: string; title: string; goal_id: string | null; starts_at: string; all_day: boolean; kind: string; source: string; goal_time: unknown };
      const row = habitTimeRow(habit, day, {
        blocks: ((blocks.data ?? []) as BlockRow[]).map((b) => ({ ...b, answered: Array.isArray(b.goal_time) ? b.goal_time.length > 0 : !!b.goal_time })),
        times: (times.data ?? []) as { goal_id: string; day: string; minutes: number; source: string; external_id: string | null }[],
        dayOfIso: (iso) => dayOf(new Date(iso)),
      });
      if (!row) return;
      const ins = await this.sb
        .from("goal_time")
        .upsert({ ...row, user_id: await this.uid(), note: null }, { onConflict: "user_id,source,external_id", ignoreDuplicates: true });
      if (ins.error) console.warn("habit time:", ins.error.message);
    } catch (e) {
      console.warn("habit time:", e);
    }
  }

  async calendarLink(): Promise<string | null> {
    const id = await this.uid();
    const { data, error } = await this.sb.from("profiles").select("calendar_token").eq("id", id).single();
    if (error) throw error;
    const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
    return `${this.url.replace(/^https?:/, "webcal:")}/functions/v1/calendar?token=${data.calendar_token}&tz=${tz}`;
  }

  async renewCalendarLink() {
    const id = await this.uid();
    const { error } = await this.sb.from("profiles").update({ calendar_token: crypto.randomUUID() }).eq("id", id);
    if (error) throw error;
  }

  private async fn(name: string, init: RequestInit = {}): Promise<Response> {
    const { data } = await this.sb.auth.getSession();
    const headers = new Headers(init.headers);
    headers.set("apikey", this.anonKey);
    if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
    if (init.body) headers.set("Content-Type", "application/json");
    return fetch(`${this.url}/functions/v1/${name}`, { ...init, headers });
  }

  /**
   * A call to a connection function. Null when the function isn't deployed or can't be reached
   * (network error, CORS-less gateway answer, 404, 502–504): the app then shows "Bald verfügbar".
   * Null without a call when nobody is logged in: signing out clears the connection states while Du
   * is still on screen, and their reload would only get a 401.
   */
  private async connFn(name: string, init: RequestInit = {}): Promise<Response | null> {
    if (!(await this.currentUserId())) return null;
    let res: Response;
    try {
      res = await this.fn(name, init);
    } catch {
      return null;
    }
    if (res.status === 404 || res.status === 502 || res.status === 503 || res.status === 504) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    return res;
  }

  private async connJson<T>(name: string, init: RequestInit, what: string): Promise<T> {
    const res = await this.connFn(name, init);
    if (!res) throw new Error(`${what} ist gerade nicht erreichbar.`);
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`${what} ist gerade nicht erreichbar. Versuch es später nochmal.`);
    }
    return (await res.json()) as T;
  }

  async whoopStatus(): Promise<WhoopStatus | null> {
    const res = await this.connFn("whoop?action=status");
    if (!res) return null;
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error("WHOOP ist gerade nicht erreichbar.");
    }
    try {
      return whoopStatusFrom(await res.json());
    } catch {
      return null;
    }
  }

  async whoopStart(): Promise<{ url: string }> {
    // the app's own address (…/App-ich/ or …/bucket-list/): the server sends the browser back there if it is
    // exactly on its allowlist (supabase/functions/_shared/app_url.ts)
    const return_to = typeof location === "undefined" ? undefined : new URL(import.meta.env.BASE_URL, location.origin).href;
    const j = await this.connJson<{ url?: unknown; reason?: unknown }>("whoop", { method: "POST", body: JSON.stringify({ action: "start", return_to }) }, "WHOOP");
    if (typeof j.url !== "string" || !/^https:\/\//.test(j.url)) throw new Error("WHOOP ist noch nicht eingerichtet.");
    return { url: j.url };
  }

  async whoopConfirm(code: string): Promise<WhoopConfirmResult> {
    const res = await this.connFn("whoop", { method: "POST", body: JSON.stringify({ action: "confirm", code }) });
    if (!res) return { ok: false, reason: "error" };
    // {ok:false, reason:"mismatch" | "expired"} may come with a 4xx status too
    const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!j || j.ok === false || !res.ok) return { ok: false, reason: typeof j?.reason === "string" ? j.reason : "error" };
    const status = whoopStatusFrom(j);
    return status ? { ...status, ok: true } : { ok: false, reason: "error" };
  }

  async whoopSync(): Promise<WhoopSyncResult> {
    return this.connJson<WhoopSyncResult>("whoop", { method: "POST", body: JSON.stringify({ action: "sync" }) }, "WHOOP");
  }

  async whoopDisconnect(): Promise<void> {
    const j = await this.connJson<{ ok?: boolean }>("whoop", { method: "POST", body: JSON.stringify({ action: "disconnect" }) }, "WHOOP");
    if (j.ok === false) throw new Error("Die Verbindung zu WHOOP liess sich nicht trennen. Versuch es später nochmal.");
  }

  async setWhoopConsent(on: boolean): Promise<boolean> {
    const { data, error } = await this.sb.rpc("set_whoop_consent", { p_consent: on });
    if (error) throw error;
    return data === true;
  }

  async nolioStatus(): Promise<NolioStatus | null> {
    const res = await this.connFn("nolio?action=status");
    if (!res) return null;
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error("Nolio ist gerade nicht erreichbar.");
    }
    const j = (await res.json().catch(() => null)) as NolioStatus | null;
    if (!j || typeof j !== "object") return null;
    const status: NolioStatus = {
      available: j.available === true,
      connected: j.connected === true,
      last_sync_at: typeof j.last_sync_at === "string" ? j.last_sync_at : null,
      last_error: typeof j.last_error === "string" ? j.last_error : null,
      running: j.running === true,
      counts: j.counts && typeof j.counts === "object" ? j.counts : null,
      garmin: typeof j.garmin === "string" ? j.garmin : null,
    };
    // Garmin's attribution: where the latest trainings came from a Garmin device (own rows, RLS)
    if (status.available && !status.garmin) {
      const { data } = await this.sb.from("nolio_trainings").select("source, device_name").eq("restricted", false).order("day", { ascending: false }).limit(10);
      for (const r of (data ?? []) as { source: string | null; device_name: string | null }[]) {
        const a = deviceAttribution(r.source, r.device_name);
        if (a) {
          status.garmin = a;
          break;
        }
      }
    }
    return status;
  }

  async nolioSync(): Promise<NolioSyncResult> {
    return this.connJson<NolioSyncResult>("nolio", { method: "POST", body: JSON.stringify({ action: "sync" }) }, "Nolio");
  }

  async pushPublicKey(): Promise<string | null> {
    const res = await this.fn("push?action=key");
    if (!res.ok) throw new Error("Der Benachrichtigungs-Dienst ist noch nicht eingerichtet.");
    return (await res.json()).publicKey as string;
  }

  async savePushSubscription(s: PushSubscriptionRow) {
    const { error } = await this.sb.from("push_subscriptions").upsert(s, { onConflict: "endpoint" });
    if (error) throw error;
  }

  async deletePushSubscription(endpoint: string) {
    const { error } = await this.sb.from("push_subscriptions").delete().eq("endpoint", endpoint);
    if (error) throw error;
  }

  async ownsPushSubscription(endpoint: string) {
    // RLS shows only her own rows: a row means this subscription is hers
    const { data, error } = await this.sb.from("push_subscriptions").select("endpoint").eq("endpoint", endpoint).maybeSingle();
    if (error) throw error;
    return !!data;
  }

  async sendTestPush(): Promise<number> {
    const res = await this.fn("push", { method: "POST", body: JSON.stringify({ action: "test" }) });
    if (!res.ok) throw new Error("Test-Nachricht konnte nicht gesendet werden.");
    return (await res.json()).sent as number;
  }

  async voiceReady(): Promise<boolean> {
    const res = await this.fn("voice?action=status");
    return res.ok && !!(await res.json()).ready;
  }

  async speak(text: string): Promise<ArrayBuffer> {
    const res = await this.fn("voice", { method: "POST", body: JSON.stringify({ action: "speak", text }) });
    if (!res.ok) throw new Error(`Stimme ${res.status}`);
    return res.arrayBuffer();
  }

  async transcribe(audio: Blob): Promise<string> {
    const form = new FormData();
    const ext = audio.type.includes("mp4") || audio.type.includes("aac") ? "m4a" : "webm";
    form.append("audio", audio, `sprache.${ext}`);
    const { data } = await this.sb.auth.getSession();
    const res = await fetch(`${this.url}/functions/v1/voice`, {
      method: "POST",
      headers: { apikey: this.anonKey, ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}) },
      body: form,
    });
    if (!res.ok) throw new Error("Ich konnte dich gerade nicht verstehen. Versuch es nochmal.");
    return ((await res.json()).text as string) ?? "";
  }

  /** All rows of a table, page by page in a stable order. */
  private async readAll(table: string, order: string[]): Promise<unknown[]> {
    const rows: unknown[] = [];
    let total: number | null = null;
    for (;;) {
      let q = this.sb.from(table).select("*", rows.length ? undefined : { count: "exact" });
      for (const col of order) q = q.order(col, { ascending: true });
      const { data, error, count } = await q.range(rows.length, rows.length + EXPORT_PAGE - 1);
      if (error) throw error;
      if (!rows.length) total = count ?? null;
      rows.push(...(data ?? []));
      // a server with a smaller max_rows sends shorter pages; the count says when it's complete
      const complete = total === null ? (data?.length ?? 0) < EXPORT_PAGE : rows.length >= total;
      if (!data?.length || complete) return rows;
    }
  }

  async exportData() {
    // never the calendar link's token: whoever holds the file could read the calendar with it
    const { calendar_token: _token, ...profile } = await this.getProfile();
    const out: Record<string, unknown> = { exported_at: new Date().toISOString(), profile };
    for (const [table, order] of EXPORT_TABLES) out[table] = await this.readAll(table, order);
    // the connections' own rows (WHOOP, Nolio), where the server has them; never the tokens
    for (const [table, order] of EXPORT_CONNECTION_TABLES) {
      try {
        out[table] = await this.readAll(table, order);
      } catch {
        // not set up on this server (the table doesn't exist): nothing to export
      }
    }
    return out;
  }

  async deleteAccount() {
    const res = await this.fn("account", { method: "POST", body: JSON.stringify({ action: "delete" }) });
    if (!res.ok) throw new Error("Das Konto konnte nicht gelöscht werden. Bitte später nochmal versuchen.");
    await this.sb.auth.signOut();
  }

  async getMessages(thread: string): Promise<ChatMessage[]> {
    const { data, error } = await this.sb
      .from("messages")
      .select("id, role, content, hidden, created_at")
      .eq("thread", thread)
      .order("id", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((m) => ({ ...m, id: String(m.id) })) as ChatMessage[];
  }

  async getDay(day: string): Promise<DayState | null> {
    const { data, error } = await this.sb.from("days").select("day, mood, focus").eq("day", day).maybeSingle();
    if (error) throw error;
    return (data as DayState) ?? null;
  }

  async tidy(context: CoachContext) {
    await this.coach({ mode: "tidy", thread: context.day, context }, () => {});
  }

  async coach(req: CoachRequest, onEvent: (e: CoachEvent) => void, signal?: AbortSignal) {
    const { data } = await this.sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Nicht eingeloggt.");

    const res = await fetch(`${this.url}/functions/v1/coach`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: this.anonKey,
      },
      body: JSON.stringify(req),
      signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(`Der Coach ist gerade nicht erreichbar (${res.status}). ${text.slice(0, 200)}`);
    }

    // Server-Sent Events: "data: {json}\n\n"
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            onEvent(JSON.parse(line.slice(5).trim()) as CoachEvent);
          } catch {
            /* ignore malformed line */
          }
        }
      }
    }
  }
}
