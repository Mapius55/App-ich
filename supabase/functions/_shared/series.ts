// Fester Wochenrhythmus: fixed weekly blocks or termine (a row in public.series, kind 'block' | 'termin') whose days are
// entered as normal calendar entries up to 8 weeks ahead (supabase/migrations/20261124000000_series.sql,
// 20261126000500_termin_series.sql). Pure helpers shared by the coach, the app and the demo backend (which mirrors
// the database's fill and sync with seriesDays). No Deno-only imports.

import { zonedToUtc } from "./ics.ts";
import { addDays, blockAnswerState, daysBetween, localClock, weekdayIndex } from "./plan.ts";

/** How far ahead a rhythm's days stand in the calendar (8 weeks, like series_fill). */
export const SERIES_HORIZON_DAYS = 56;
/** The coach's context lists a rhythm's coming days for this many days (the rest stands in the rhythm's line). */
export const SERIES_CONTEXT_DAYS = 21;
/** A rhythm is offered only for a goal whose target date lies more than this many days ahead. */
export const RHYTHM_AHEAD_DAYS = 21;
/** It fills at most this share of her hours per week (a buffer for the unexpected). */
export const RHYTHM_SHARE = 0.7;
/** No offer while she has this many active rhythms. */
export const RHYTHM_MAX = 2;
/** The coach creates at most this many active rhythms of blocks … */
export const SERIES_MAX_ACTIVE = 3;
/** … and of her fixed times (termine: a training, the shop, a lecture). */
export const TERMIN_SERIES_MAX = 8;
/** After this many days of a rhythm that mostly didn't happen, the coach offers once to change or pause it. */
export const LAPSE_DAYS = 21;

/** The weekday codes the coach uses, Monday first (ISO 1 … 7). */
export const WEEKDAY_CODES = ["mo", "di", "mi", "do", "fr", "sa", "so"] as const;
const WEEKDAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const WEEKDAY_WORDS = ["montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonntag"];

/**
 * What a rhythm's days are: blocks planned with the coach (they rest with their goal and end before its target date),
 * or her fixed times (termine: «immer», «jeden Donnerstag», «jede Woche»; never ending with a goal, no reminder unless
 * she asked). Missing (before its migration): blocks.
 */
export type SeriesKind = "block" | "termin";
export const SERIES_KINDS: readonly SeriesKind[] = ["block", "termin"];
export const seriesKind = (s: { kind?: string | null }): SeriesKind => (s.kind === "termin" ? "termin" : "block");

/**
 * Whether a rhythm rests and ends with its goal: one of blocks. Her fixed times (termin) stay in the calendar when the
 * goal rests, is reached, dropped or deleted; they only let go of it (goals_series, goals_series_unlink).
 */
export const restsWithGoal = (s: { kind?: string | null }): boolean => seriesKind(s) === "block";

/**
 * The same rhythm twice: for the same goal (or both without one), at the same start, on a shared weekday, of either
 * kind (a training as blocks and again as her fixed time would stand twice in the calendar and count twice).
 */
export function sameRhythm(
  a: { goal_id: string | null; start_time: string; weekdays: readonly number[] },
  b: { goal_id: string | null; start_time: string; weekdays: readonly number[] },
): boolean {
  return (
    (a.goal_id ?? null) === (b.goal_id ?? null) &&
    String(a.start_time).slice(0, 5) === String(b.start_time).slice(0, 5) &&
    a.weekdays.some((w) => b.weekdays.includes(w))
  );
}

/** A weekly rhythm as stored (public.series). Times are local in `time_zone`. */
export interface SeriesRule {
  id: string;
  goal_id: string | null;
  /** blocks (the default) or her fixed times */
  kind?: SeriesKind;
  title: string;
  /** ISO weekdays, 1 = Monday … 7 = Sunday */
  weekdays: number[];
  /** "HH:MM" or "HH:MM:SS" */
  start_time: string;
  duration_minutes: number;
  location: string | null;
  reminder_minutes: number | null;
  time_zone: string;
  start_date: string;
  /** last day (inclusive); null: until the day before its goal's target date */
  until_date: string | null;
  active: boolean;
  /** coming days she let fall away */
  skip_days: string[];
  lapse_asked_at?: string | null;
  created_at?: string;
}

const CLOCK_RE = /^([01]?\d|2[0-3])(?::([0-5]\d))?(?::[0-5]\d)?$/;

/** "18", "7:30", "18:00:00" → "18:00", "07:30"; null when it is no time of day. */
export function parseClock(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = CLOCK_RE.exec(v.trim().replace(/\s*uhr$/i, "").replace(".", ":"));
  return m ? `${m[1].padStart(2, "0")}:${m[2] ?? "00"}` : null;
}

/** ["di", "do"], ["Dienstag"], [2, 4] → [2, 4] (ISO, sorted, once each); null when one is no weekday or none is given. */
export function parseWeekdays(v: unknown): number[] | null {
  if (!Array.isArray(v) || !v.length || v.length > 14) return null;
  const out = new Set<number>();
  for (const x of v) {
    let n = 0;
    if (typeof x === "number" && Number.isInteger(x) && x >= 1 && x <= 7) n = x;
    else if (typeof x === "string") {
      const t = x.trim().toLowerCase();
      const i = WEEKDAY_CODES.indexOf(t.slice(0, 2) as (typeof WEEKDAY_CODES)[number]);
      if (i >= 0 && (t.length === 2 || WEEKDAY_WORDS[i].startsWith(t.replace(/\.$/, "")))) n = i + 1;
    }
    if (!n) return null;
    out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

const hm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const clockMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** "Di, Do 18:00–19:00" */
export function seriesLabel(s: Pick<SeriesRule, "weekdays" | "start_time" | "duration_minutes">): string {
  const start = clockMinutes(s.start_time);
  return `${s.weekdays.map((w) => WEEKDAY_SHORT[w - 1]).join(", ")} ${hm(start)}–${hm(start + s.duration_minutes)}`;
}

/** The ISO weekday (1 = Monday) of a day "YYYY-MM-DD". */
export const isoWeekday = (day: string) => weekdayIndex(day) + 1;

/** The start of a rhythm's day: that day's local time in its time zone (DST-correct), and the end after its length. */
export function seriesTimes(s: Pick<SeriesRule, "start_time" | "duration_minutes" | "time_zone">, day: string): { starts_at: string; ends_at: string } {
  const starts_at = zonedToUtc(`${day}T${hm(clockMinutes(s.start_time))}`, s.time_zone);
  return { starts_at, ends_at: new Date(Date.parse(starts_at) + s.duration_minutes * 60000).toISOString() };
}

/**
 * The last day a rhythm may have: its own end, else (blocks) the day before its goal's target date; null = open.
 * Her fixed times (termin) end only by their own end.
 */
export function seriesEndDay(s: Pick<SeriesRule, "until_date" | "kind">, goalTarget: string | null | undefined): string | null {
  return s.until_date ?? (goalTarget && seriesKind(s) === "block" ? addDays(goalTarget, -1) : null);
}

/** Whether a rhythm runs: active, and for blocks its goal (if any) active too; her fixed times run whatever a goal does. */
const seriesLive = (s: SeriesRule, goal: { status: string } | null | undefined) =>
  s.active && (!s.goal_id || seriesKind(s) === "termin" || goal?.status === "active");

/**
 * The coming days of a rhythm up to `horizonDays` ahead, as series_fill enters them: on its weekdays from its start
 * (never before today in its time zone, never a time that has passed) to its end, without the days she let fall
 * away. Nothing while it rests, or (blocks) while its goal (`goal`, null when there is none) is not active.
 */
export function seriesDays(
  s: SeriesRule,
  o: { now: number; goal?: { status: string; target_date: string | null } | null; horizonDays?: number },
): { day: string; starts_at: string; ends_at: string }[] {
  if (!seriesLive(s, o.goal)) return [];
  const today = localClock(new Date(o.now), s.time_zone).day;
  const horizon = addDays(today, o.horizonDays ?? SERIES_HORIZON_DAYS);
  const end = seriesEndDay(s, s.goal_id ? o.goal?.target_date : null);
  const last = end && end < horizon ? end : horizon;
  const out: { day: string; starts_at: string; ends_at: string }[] = [];
  for (let d = s.start_date > today ? s.start_date : today; d <= last; d = addDays(d, 1)) {
    if (!s.weekdays.includes(isoWeekday(d)) || s.skip_days.includes(d)) continue;
    const t = seriesTimes(s, d);
    if (Date.parse(t.starts_at) > o.now) out.push({ day: d, ...t });
  }
  return out;
}

/** Whether a coming day still belongs to the rhythm (series_sync keeps it): `exception` = she changed that day on its own. */
export function seriesKeepsDay(
  s: SeriesRule,
  day: string,
  exception: boolean,
  goal: { status: string; target_date: string | null } | null | undefined,
): boolean {
  const end = seriesEndDay(s, s.goal_id ? goal?.target_date : null);
  if (!seriesLive(s, goal) || day < s.start_date || (end && day > end) || s.skip_days.includes(day)) return false;
  return exception || s.weekdays.includes(isoWeekday(day));
}

/** How big a rhythm should be for her hours per week: at most RHYTHM_SHARE of them, in one to three blocks a week. */
export function rhythmSuggestion(weeklyHours: number): { count: number; minutes: number } {
  const target = Math.max(0, weeklyHours) * 60 * RHYTHM_SHARE;
  const count = target < 60 ? 1 : target <= 180 ? 2 : 3;
  return { count, minutes: Math.min(120, Math.max(20, Math.round(target / count / 15) * 15)) };
}

// shift work, a rota, changing hours (not «Geschichte»)
const SHIFT_NOTE = /(?<!ge)schicht|nachtdienst|frühdienst|spätdienst|pikett|dienstplan|turnus|wechselnde\w* (?:arbeits)?zeit|unregelmässige\w* (?:arbeits)?zeit|unregelmässige\w* wochen/i;
const SHIFT_ENTRY = /(?<!ge)schicht|\b(?:früh|spät|nacht)dienst\b|\bdienst\b/i;

/** Her weeks look irregular (shift work, a rota): from what the coach noted, or two or more shifts in the calendar. */
export function irregularWeeks(memories: { content: string }[], entries: { title: string; kind?: string | null }[]): boolean {
  if (memories.some((m) => SHIFT_NOTE.test(m.content))) return true;
  return entries.filter((e) => e.kind !== "block" && SHIFT_ENTRY.test(e.title)).length >= 2;
}

/**
 * The Sunday ask for next week's shifts (owner decision 4, the Anstoss «dienste»): on a Sunday, for irregular weeks
 * (irregularWeeks), the first time once (`askedAt` null: never asked) and after her first yes every Sunday (`weekly`);
 * not when two or more shifts of the coming week (Monday to Sunday) already stand in the calendar (she named them).
 * Unknown state (`askedAt` undefined, before its migration): never, since nothing could be noted.
 */
export function shiftAskDue(o: {
  today: string;
  irregular: boolean;
  askedAt: string | null | undefined;
  weekly: boolean | null | undefined;
  entries: readonly { title: string; kind?: string | null; starts_at: string }[];
  dayOfIso: (iso: string) => string;
}): boolean {
  if (o.askedAt === undefined || !o.irregular || isoWeekday(o.today) !== 7) return false;
  if (o.askedAt !== null && o.weekly !== true) return false;
  const from = addDays(o.today, 1);
  const to = addDays(o.today, 7);
  const named = o.entries.filter((e) => {
    const d = o.dayOfIso(e.starts_at);
    return e.kind !== "block" && SHIFT_ENTRY.test(e.title) && d >= from && d <= to;
  });
  return named.length < 2;
}

/**
 * The rhythms that still run on `today`: active and not ended (its last day not behind). A rhythm split «ab Januar»
 * (split_series: the old part ends the day before the new one starts, same goal and kind) counts once, as its later part.
 */
export function liveRhythms<T extends Pick<SeriesRule, "goal_id" | "active" | "start_date" | "until_date"> & { kind?: string | null }>(
  series: readonly T[],
  today: string,
): T[] {
  const live = series.filter((s) => s.active && !(s.until_date && s.until_date < today));
  return live.filter(
    (s) =>
      !(s.until_date && live.some((o) => o !== s && o.goal_id === s.goal_id && seriesKind(o) === seriesKind(s) && o.start_date === addDays(s.until_date!, 1))),
  );
}

/**
 * Offer a rhythm for this goal now (once per goal)? An active goal with hours per week, without a target date or more
 * than RHYTHM_AHEAD_DAYS before it, without a rhythm, never offered (`rhythm_asked_at` null; undefined = unknown:
 * never), not for irregular weeks, not while she already has RHYTHM_MAX rhythms that run (liveRhythms), and not for a
 * goal her trainer plans in Nolio (`trainer`: his plan is her week; fixed blocks next to it would plan the same time
 * twice, and while the completed trainings count by themselves, the rhythm's days would stay unanswered and read as
 * «klappt selten»).
 */
export function rhythmOfferDue(
  g: { kind?: string | null; status: string; target_date: string | null; weekly_hours?: number | null; rhythm_asked_at?: string | null },
  o: { hasRhythm: boolean; activeRhythms: number; irregular: boolean; today: string; trainer?: boolean },
): boolean {
  if (g.rhythm_asked_at !== null || o.hasRhythm || o.irregular || o.trainer || o.activeRhythms >= RHYTHM_MAX) return false;
  if (g.kind === "dream" || g.status !== "active" || !((g.weekly_hours ?? 0) > 0)) return false;
  return !g.target_date || daysBetween(o.today, g.target_date) > RHYTHM_AHEAD_DAYS;
}

/** A rhythm's past days with their answer (goal_time minutes, null = none). */
type RhythmDay = { starts_at: string; ends_at: string | null; minutes: number | null };

/** «4 von 6 bestätigt»: of its days that ended, how many she confirmed (Ja or Teilweise). */
export function rhythmTally(days: RhythmDay[], now: number): { ended: number; confirmed: number } {
  const ended = days.filter((d) => d.ends_at && Date.parse(d.ends_at) <= now);
  const confirmed = ended.filter((d) => {
    const planned = Math.round((Date.parse(d.ends_at!) - Date.parse(d.starts_at)) / 60000);
    const state = blockAnswerState(d.minutes, planned);
    return state === "ja" || state === "teilweise";
  }).length;
  return { ended: ended.length, confirmed };
}

/**
 * Three weeks of mostly «Nein» or no answer: offer once to change or pause the rhythm. It must have run LAPSE_DAYS;
 * of its days that ended in the last LAPSE_DAYS (and after the last offer, `lapse_asked_at`) at least three, and more
 * than half of them «Nein» or unanswered. After an offer it comes again only after another LAPSE_DAYS like that.
 */
export function seriesLapse(days: RhythmDay[], s: Pick<SeriesRule, "active" | "start_date" | "lapse_asked_at">, now: number, today: string): boolean {
  if (!s.active || daysBetween(s.start_date, today) < LAPSE_DAYS) return false;
  const asked = s.lapse_asked_at ? Date.parse(s.lapse_asked_at) : NaN;
  if (Number.isFinite(asked) && now - asked < LAPSE_DAYS * 86400000) return false;
  const since = Math.max(now - LAPSE_DAYS * 86400000, Number.isFinite(asked) ? asked : -Infinity);
  const window = days.filter((d) => d.ends_at && Date.parse(d.ends_at) <= now && Date.parse(d.starts_at) > since);
  if (window.length < 3) return false;
  const { confirmed } = rhythmTally(window, now);
  return (window.length - confirmed) * 2 > window.length;
}

// ---------- one day of a rhythm in the app: «Nur diesen Termin» or «Alle kommenden» ----------

type DayEntry = { series_id?: string | null; starts_at: string; ends_at: string | null; all_day: boolean; title: string; location: string | null; reminder_minutes: number | null };
type DayInput = { starts_at: string; ends_at: string | null; all_day: boolean; title: string; location: string | null; reminder_minutes: number | null };

/**
 * Ask «Nur diesen Termin» or «Alle kommenden»? Only for a coming day of a rhythm whose change could hold for every
 * week: the time, length, title, place or reminder changed on the same day. Moving it to another day, making it
 * all-day, or changing only notes or the goal is always just this day (no question).
 */
export function seriesScopeNeeded(e: DayEntry, next: DayInput, now: number, dayOfIso: (iso: string) => string): boolean {
  if (!e.series_id || e.all_day || next.all_day || Date.parse(e.starts_at) <= now) return false;
  if (dayOfIso(next.starts_at) !== dayOfIso(e.starts_at)) return false;
  const at = (iso: string | null) => (iso ? Date.parse(iso) : null);
  return (
    at(next.starts_at) !== at(e.starts_at) ||
    at(next.ends_at) !== at(e.ends_at) ||
    next.title !== e.title ||
    (next.location ?? null) !== (e.location ?? null) ||
    (next.reminder_minutes ?? null) !== (e.reminder_minutes ?? null)
  );
}

type RhythmPatch = Partial<Pick<SeriesRule, "title" | "start_time" | "duration_minutes" | "location" | "reminder_minutes" | "goal_id">>;

/**
 * The rhythm's new values when a change of one day holds for «Alle kommenden»: only what she changed on that day
 * (`prev` → `next`; a start in the rhythm's local time). What the day had on its own before (her exception, e.g. moved
 * to 19:00 this once) never becomes the rhythm's unless she changed it now.
 */
export function seriesPatchFromDay(prev: DayInput & { goal_id?: string | null }, next: DayInput & { goal_id?: string | null }, tz: string): RhythmPatch {
  const length = (d: DayInput) => (d.ends_at ? Math.round((Date.parse(d.ends_at) - Date.parse(d.starts_at)) / 60000) : 60);
  const out: RhythmPatch = {};
  if (Date.parse(next.starts_at) !== Date.parse(prev.starts_at)) out.start_time = hm(localClock(new Date(next.starts_at), tz).minutes);
  if (length(next) !== length(prev)) out.duration_minutes = Math.min(720, Math.max(5, length(next)));
  if (next.title !== prev.title) out.title = next.title;
  if ((next.location ?? null) !== (prev.location ?? null)) out.location = next.location ?? null;
  if ((next.reminder_minutes ?? null) !== (prev.reminder_minutes ?? null)) out.reminder_minutes = next.reminder_minutes ?? null;
  if (next.goal_id !== undefined && (next.goal_id ?? null) !== (prev.goal_id ?? null)) out.goal_id = next.goal_id ?? null;
  return out;
}

/**
 * «Alle kommenden»: does the day follow the rhythm again afterwards (its exception mark cleared, the rhythm's change
 * moves it like every other coming day)? Yes unless it was her exception and she left its start as it was: then it
 * keeps its own time and takes the change directly.
 */
export const seriesDayFollows = (exception: boolean | undefined, patch: RhythmPatch) => !exception || patch.start_time !== undefined;
