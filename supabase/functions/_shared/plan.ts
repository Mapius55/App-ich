// Small, pure helpers for goals, habits and the calendar views.
// Days are local calendar days written as "YYYY-MM-DD"; weeks start on Monday.
// Shared by the app and the coach (Edge Function), so no imports here.

interface Milestone {
  id: string;
  title: string;
  due_date: string | null;
  done_at: string | null;
  position: number;
}
interface Habit {
  per_week: number;
  done_days: string[];
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toUtc(day: string): number {
  const m = DAY_RE.exec(day);
  if (!m) throw new Error(`invalid day ${day}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function fromUtc(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" of a moment in the local time zone. */
export function dayOf(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(day: string, n: number): string {
  return fromUtc(toUtc(day) + n * 86400000);
}

/** whole days from `from` to `to` (negative if `to` lies before) */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86400000);
}

/** 0 = Monday … 6 = Sunday */
export function weekdayIndex(day: string): number {
  return (new Date(toUtc(day)).getUTCDay() + 6) % 7;
}

/** Monday of the week the day is in */
export function weekStart(day: string): string {
  return addDays(day, -weekdayIndex(day));
}

/** the seven days (Monday … Sunday) of the week the day is in */
export function weekDays(day: string): string[] {
  const start = weekStart(day);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** first day of the month the day is in */
export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/** the month moved by n months (keeps it on the 1st) */
export function addMonths(day: string, n: number): string {
  const [y, m] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return fromUtc(t.getTime());
}

/**
 * The days shown in a month view: whole weeks (Monday … Sunday) from the
 * week of the 1st to the week of the last day, 4 to 6 rows of 7 days.
 */
export function monthGrid(day: string): { day: string; inMonth: boolean }[] {
  const first = monthStart(day);
  const next = addMonths(first, 1);
  const last = addDays(next, -1);
  const start = weekStart(first);
  const end = addDays(weekStart(last), 6);
  const out: { day: string; inMonth: boolean }[] = [];
  for (let d = start; daysBetween(d, end) >= 0; d = addDays(d, 1)) out.push({ day: d, inMonth: d.slice(0, 7) === first.slice(0, 7) });
  return out;
}

// ---------- goals ----------

export interface GoalProgress {
  done: number;
  total: number;
  /** 0..1, 0 when there are no milestones */
  ratio: number;
  /** days until the target date (negative = past), null without date */
  daysLeft: number | null;
  /** the first open milestone (by position) */
  next: Milestone | null;
}

export function goalProgress<M extends Milestone>(goal: { target_date: string | null; milestones: M[] }, today: string = dayOf()): GoalProgress & { next: M | null } {
  const ms = [...goal.milestones].sort((a, b) => a.position - b.position);
  const done = ms.filter((m) => m.done_at).length;
  return {
    done,
    total: ms.length,
    ratio: ms.length ? done / ms.length : 0,
    daysLeft: goal.target_date ? daysBetween(today, goal.target_date) : null,
    next: ms.find((m) => !m.done_at) ?? null,
  };
}

/** "noch 23 Tage", "morgen", "heute", "vor 3 Tagen" */
export function daysLeftLabel(n: number | null): string | null {
  if (n === null) return null;
  if (n === 0) return "heute";
  if (n === 1) return "morgen";
  if (n > 1) return `noch ${n} Tage`;
  if (n === -1) return "gestern";
  return `vor ${-n} Tagen`;
}

// ---------- habits ----------

export interface HabitWeek {
  /** Monday … Sunday of the current week */
  days: { day: string; done: boolean; future: boolean }[];
  doneThisWeek: number;
  target: number;
}

export function habitWeek(habit: Pick<Habit, "done_days" | "per_week">, today: string = dayOf()): HabitWeek {
  const set = new Set(habit.done_days);
  const days = weekDays(today).map((d) => ({ day: d, done: set.has(d), future: daysBetween(today, d) > 0 }));
  return { days, doneThisWeek: days.filter((d) => d.done).length, target: habit.per_week };
}

export interface HabitStreak {
  count: number;
  unit: "Tag" | "Woche";
}

/**
 * The current streak.
 * Daily habits (7 per week): days in a row, up to today (today still open does not break it).
 * Others: weeks in a row that reached the target; the current week counts once reached,
 * and while it's still running it doesn't break the streak.
 */
export function habitStreak(habit: Pick<Habit, "done_days" | "per_week">, today: string = dayOf()): HabitStreak {
  const set = new Set(habit.done_days);
  if (habit.per_week >= 7) {
    let d = set.has(today) ? today : addDays(today, -1);
    let count = 0;
    while (set.has(d)) {
      count++;
      d = addDays(d, -1);
    }
    return { count, unit: "Tag" };
  }
  const countWeek = (monday: string) => weekDays(monday).filter((d) => set.has(d) && daysBetween(d, today) >= 0).length;
  let monday = weekStart(today);
  let count = 0;
  if (countWeek(monday) >= habit.per_week) count++;
  monday = addDays(monday, -7);
  while (countWeek(monday) >= habit.per_week) {
    count++;
    monday = addDays(monday, -7);
  }
  return { count, unit: "Woche" };
}

/** "3 Tage in Folge", "2 Wochen in Folge", or null when there's no streak */
export function streakLabel(s: HabitStreak): string | null {
  if (s.count === 0) return null;
  const unit = s.unit === "Tag" ? (s.count === 1 ? "Tag" : "Tage") : s.count === 1 ? "Woche" : "Wochen";
  return `${s.count} ${unit} in Folge`;
}

/** "jeden Tag", "1× pro Woche", "3× pro Woche" */
export function perWeekLabel(n: number): string {
  return n >= 7 ? "jeden Tag" : `${n}× pro Woche`;
}

// ---------- effort: how big a goal is and whether the time is enough ----------

export interface GoalEffortInput {
  effort_hours: number | null;
  weekly_hours: number | null;
  prior_hours: number;
  target_date: string | null;
  /** from the view goal_minutes: logged (and answered), past blocks nobody answered that still count, and of those
   *  the provisional ones (ended within PROVISIONAL_DAYS; missing = none) */
  time: { logged_minutes: number; block_minutes: number; provisional_minutes?: number };
}

export type Feasibility = "erreicht" | "machbar" | "knapp" | "kaum machbar";

export interface GoalEffort {
  /** estimated total hours, null = not estimated */
  effort: number | null;
  /** hours done: before the app + logged + past blocks that still count (provisional ones included) */
  done: number;
  /** of `done`: hours of blocks nobody answered yet that count only provisionally (0 = none); never said as done */
  provisional: number;
  /** hours left, null without an estimate */
  remaining: number | null;
  /** weeks to work on it: today up to the day before the target date (at least one day), null without a date or when it has passed */
  weeksLeft: number | null;
  /** hours per week needed to make it by the target date */
  neededPerWeek: number | null;
  /** hours per day needed, only when less than three weeks are left (else null) */
  neededPerDay: number | null;
  /** hours per week she can invest */
  available: number | null;
  /** with her weekly time and no target date (or a passed one): weeks until done */
  weeksToFinish: number | null;
  /** needed vs available: up to 85 % "machbar" (a buffer for bad weeks), up to 110 % "knapp", beyond "kaum machbar" */
  feasibility: Feasibility | null;
  /** the same verdict from confirmed time only (without `provisional`); equal to `feasibility` when nothing is provisional */
  confirmedFeasibility: Feasibility | null;
}

/** needed / available up to this share is "machbar"; up to TIGHT_MAX "knapp"; beyond "kaum machbar" */
export const FEASIBLE_MAX = 0.85;
export const TIGHT_MAX = 1.1;

const round1 = (n: number) => Math.round(n * 10) / 10;

export function goalEffort(g: GoalEffortInput, today: string = dayOf()): GoalEffort {
  const doneRaw = (g.prior_hours || 0) + (g.time.logged_minutes + g.time.block_minutes) / 60;
  // provisional time is part of the blocks that count by themselves
  const provisionalMin = Math.max(0, Math.min(g.time.block_minutes, g.time.provisional_minutes ?? 0));
  const done = round1(doneRaw);
  const effort = g.effort_hours && g.effort_hours > 0 ? g.effort_hours : null;
  const remaining = effort === null ? null : round1(Math.max(0, effort - done));
  const days = g.target_date ? daysBetween(today, g.target_date) : null;
  // the work happens from today up to the day before the target date (race or exam day itself doesn't count);
  // on the target day itself, today is the last day left
  const weeksLeft = days !== null && days >= 0 ? Math.max(1 / 7, days / 7) : null;
  const neededPerWeek = remaining !== null && weeksLeft !== null ? round1(remaining / weeksLeft) : null;
  const neededPerDay = remaining !== null && weeksLeft !== null && weeksLeft < 3 ? round1(remaining / (weeksLeft * 7)) : null;
  const available = g.weekly_hours && g.weekly_hours > 0 ? g.weekly_hours : null;
  const weeksToFinish = remaining !== null && available !== null && weeksLeft === null ? Math.ceil(remaining / available) : null;
  const verdict = (doneHours: number): Feasibility | null => {
    const left = effort === null ? null : round1(Math.max(0, effort - doneHours));
    if (left === 0) return "erreicht";
    if (left === null || weeksLeft === null || available === null) return null;
    // unrounded, so the buffers don't move with the display rounding
    const ratio = left / weeksLeft / available;
    return ratio <= FEASIBLE_MAX ? "machbar" : ratio <= TIGHT_MAX ? "knapp" : "kaum machbar";
  };
  const feasibility = verdict(done);
  return {
    effort,
    done,
    provisional: round1(provisionalMin / 60),
    remaining,
    weeksLeft: weeksLeft === null ? null : round1(weeksLeft),
    neededPerWeek,
    neededPerDay,
    available,
    weeksToFinish,
    feasibility,
    confirmedFeasibility: provisionalMin > 0 ? verdict(round1(doneRaw - provisionalMin / 60)) : feasibility,
  };
}

/** 1234.5 → "1'235", 12.3 → "12.3", 4 → "4" (Swiss thousands separator) */
export function hoursLabel(h: number): string {
  const v = h >= 100 ? Math.round(h) : round1(h);
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}

/** weeks → "3 Wochen", "8 Monate", "12 Jahre" (rounded, for long goals) */
export function durationLabel(weeks: number): string {
  if (weeks < 9) return `${Math.max(1, Math.round(weeks))} ${Math.round(weeks) === 1 ? "Woche" : "Wochen"}`;
  const months = weeks / 4.345;
  if (months < 24) return `${Math.round(months)} Monate`;
  return `${Math.round(months / 12)} Jahre`;
}

// ---------- honest counting: a past block nobody answered ----------

/** A past goal block nobody answered counts provisionally for this many days after it ended, then no more. */
export const PROVISIONAL_DAYS = 7;
const PROVISIONAL_MS = PROVISIONAL_DAYS * 86400000;

/** How a past block nobody answered counts: as it always did, provisionally, or (null) not at all. */
export type BlockCredit = "kept" | "provisional" | null;

/**
 * How a past goal block nobody answered counts, as the view goal_minutes counts it:
 * - "kept": it ended and was entered before honest counting began (`from`, public.honest_count_from()), so it
 *   counts as it always did (no sudden drop in anyone's numbers); also while `from` is unknown (null);
 * - "provisional": it ended within the last PROVISIONAL_DAYS: it counts, shown lighter, and is never said as done;
 * - null: it has not ended yet, or after those days it quietly stops counting (never a miss, never «verpasst»).
 * Without `created_at` (older rows) only the end decides.
 */
export function unansweredCredit(b: { ends_at: string | null; created_at?: string | null }, now: number, from: string | null | undefined): BlockCredit {
  const end = b.ends_at ? Date.parse(b.ends_at) : NaN;
  if (!Number.isFinite(end) || end > now) return null;
  const f = from ? Date.parse(from) : NaN;
  if (!Number.isFinite(f)) return "kept";
  const created = b.created_at ? Date.parse(b.created_at) : NaN;
  if (end < f && !(created >= f)) return "kept";
  return end > now - PROVISIONAL_MS ? "provisional" : null;
}

// ---------- the year at a glance: minutes for goals per day ----------

type DayBlock = { id: string; starts_at: string; ends_at: string | null; all_day: boolean; kind: string; goal_id: string | null; source?: string | null; created_at?: string | null };

export interface GoalDayMinutes {
  /** local day → minutes that count: logged and answered time, plus past blocks nobody answered that still count */
  total: Record<string, number>;
  /** local day → of those, the minutes that count only provisionally (shown lighter) */
  provisional: Record<string, number>;
}

/**
 * Minutes that went into goals per local day: logged time, plus past planned blocks for a goal that nobody
 * answered yet (an answered block is already in the log) while they still count (unansweredCredit, `from`:
 * when honest counting began; undefined or null: every such block counts, as before).
 * A planned Nolio training (source "nolio") never counts by itself: the completed training
 * arrives as logged time from Nolio, so counting the plan too would count it twice.
 * `dayOfIso` turns an ISO start time into the person's local day.
 */
export function goalDayMinutes(
  log: { day: string; minutes: number }[],
  blocks: DayBlock[],
  answered: Set<string>,
  now: Date,
  dayOfIso: (iso: string) => string,
  from?: string | null,
): GoalDayMinutes {
  const total: Record<string, number> = {};
  const provisional: Record<string, number> = {};
  for (const t of log) if (t.minutes > 0) total[t.day] = (total[t.day] ?? 0) + t.minutes;
  for (const b of blocks) {
    if (b.kind !== "block" || !b.goal_id || b.all_day || !b.ends_at || answered.has(b.id) || b.source === "nolio") continue;
    const credit = unansweredCredit(b, now.getTime(), from);
    if (!credit) continue;
    const min = Math.min(1440, Math.max(0, Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000)));
    if (!min) continue;
    const d = dayOfIso(b.starts_at);
    total[d] = (total[d] ?? 0) + min;
    if (credit === "provisional") provisional[d] = (provisional[d] ?? 0) + min;
  }
  return { total, provisional };
}

/** goalDayMinutes, only the minutes that count per day */
export function dayMinutes(log: { day: string; minutes: number }[], blocks: DayBlock[], answered: Set<string>, now: Date, dayOfIso: (iso: string) => string, from?: string | null): Record<string, number> {
  return goalDayMinutes(log, blocks, answered, now, dayOfIso, from).total;
}

/** The days whose time is mostly provisional (more than half of it): drawn lighter in the year's heat. */
export function provisionalDays(m: GoalDayMinutes): Set<string> {
  return new Set(Object.keys(m.provisional).filter((d) => m.provisional[d] * 2 > (m.total[d] ?? 0)));
}

/**
 * Four steps from "a little" to "a lot", fitted to the person's own days, so a few
 * minutes and three hours of training both get their range: the upper limits of
 * steps 1–3 are the quartiles of the active days, never below 15/45/90 minutes.
 */
export function heatThresholds(values: number[]): [number, number, number] {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  const q = (p: number) => (v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : 0);
  const t1 = Math.max(15, q(0.25));
  const t2 = Math.max(45, t1 + 1, q(0.5));
  const t3 = Math.max(90, t2 + 1, q(0.75));
  return [t1, t2, t3];
}

/** 0 = nothing, 1..4 = stronger */
export function heatLevel(minutes: number, t: [number, number, number]): 0 | 1 | 2 | 3 | 4 {
  if (!minutes || minutes <= 0) return 0;
  if (minutes <= t[0]) return 1;
  if (minutes <= t[1]) return 2;
  if (minutes <= t[2]) return 3;
  return 4;
}

/** The days of the year view: whole weeks (Monday first) ending with the week of `today`, `weeks` long. */
export function yearWeeks(today: string, weeks = 53): string[][] {
  const lastMonday = weekStart(today);
  const first = addDays(lastMonday, -7 * (weeks - 1));
  return Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)));
}

// ---------- calendar year (the space's Jahr level) ----------

/** ISO 8601 week number (weeks start on Monday; week 1 holds the year's first Thursday). */
export function isoWeek(day: string): number {
  const thursday = toUtc(day) + (3 - weekdayIndex(day)) * 86400000;
  const yearStart = Date.UTC(new Date(thursday).getUTCFullYear(), 0, 1);
  return 1 + Math.floor((thursday - yearStart) / (7 * 86400000));
}

/**
 * The twelve months of a calendar year, each as a Monday-first grid of
 * always 6 weeks (42 cells), so all month blocks have the same height.
 * The first rows equal monthGrid(); trailing out-of-month days pad to 42.
 */
export function yearMonths(year: number): { month: string; cells: { day: string; inMonth: boolean }[] }[] {
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${String(year).padStart(4, "0")}-${String(i + 1).padStart(2, "0")}`;
    const cells = monthGrid(`${month}-01`);
    while (cells.length < 42) cells.push({ day: addDays(cells[cells.length - 1].day, 1), inMonth: false });
    return { month, cells };
  });
}

// ---------- Bucket List: the year so far, life in weeks, the coach's reminders ----------

/** a real calendar day "YYYY-MM-DD" (so "2026-02-30" is not one) */
function isDay(day: string): boolean {
  return DAY_RE.test(day) && fromUtc(toUtc(day)) === day;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

/** 0 = 1 January … 364 = 31 December (365 in a leap year) */
export function dayOfYear(day: string): number {
  return daysBetween(`${day.slice(0, 4)}-01-01`, day);
}

export interface YearProgress {
  /** days of the year that have passed, today included */
  passedDays: number;
  totalDays: number;
  /** days after today («Noch 46 Tage in 2026» on 15 November) */
  leftDays: number;
  /** passedDays / totalDays: 1 for a past year, 0 for a future one */
  fraction: number;
}

/** How much of a calendar year has passed. Today counts as passed; on 31 December nothing is left. */
export function yearProgress(year: number, today: string = dayOf()): YearProgress {
  const totalDays = daysInYear(year);
  const now = Number(today.slice(0, 4));
  const passedDays = year < now ? totalDays : year > now || !isDay(today) ? 0 : dayOfYear(today) + 1;
  return { passedDays, totalDays, leftDays: totalDays - passedDays, fraction: passedDays / totalDays };
}

/** «Leben»: 90 years (rows) of 52 weeks (columns). */
export const LIFE_YEARS = 90;
export const LIFE_WEEKS_PER_YEAR = 52;

/**
 * The column of a day in its year's row: week 0 starts on 1 January, every seven days the next one;
 * the last day or two of the year (week «52», in a leap year also a 366th day) fold into column 51.
 */
export function lifeColumn(day: string): number {
  return Math.min(LIFE_WEEKS_PER_YEAR - 1, Math.floor(dayOfYear(day) / 7));
}

/**
 * The cell of a date in the life grid, or null when it lies outside the 90 years (or is no date).
 * Rows are the calendar years from the birth year on (row k = birthYear + k). `date` may be a day
 * "YYYY-MM-DD" or an ISO timestamp (its first ten characters are taken, e.g. a goal's done_at).
 */
export function weekCell(date: string | null | undefined, birthYear: number): { row: number; col: number } | null {
  if (typeof date !== "string" || !Number.isInteger(birthYear)) return null;
  const day = date.slice(0, 10);
  if (!isDay(day)) return null;
  const row = Number(day.slice(0, 4)) - birthYear;
  if (row < 0 || row >= LIFE_YEARS) return null;
  return { row, col: lifeColumn(day) };
}

export interface LifeWeeks {
  /** 90 × 52 = 4680 */
  total: number;
  /** the weeks before the current one */
  lived: number;
  /** today's cell; -1 / -1 when today lies outside the grid (birth year in the future, or more than 89 years ago) */
  currentRow: number;
  currentCol: number;
}

/**
 * Life in weeks. Before the birth year nothing is lived; after birthYear + 89 everything is
 * (and there is no current cell). The current week itself is not counted as lived: it is «Woche lived + 1».
 */
export function lifeWeeks(birthYear: number, today: string = dayOf()): LifeWeeks {
  const total = LIFE_YEARS * LIFE_WEEKS_PER_YEAR;
  const cell = weekCell(today, birthYear);
  if (cell) return { total, lived: cell.row * LIFE_WEEKS_PER_YEAR + cell.col, currentRow: cell.row, currentCol: cell.col };
  const after = Number.isInteger(birthYear) && isDay(today) && Number(today.slice(0, 4)) >= birthYear + LIFE_YEARS;
  return { total, lived: after ? total : 0, currentRow: -1, currentCol: -1 };
}

/** "4’680": the Swiss thousands separator for numbers people read (the right single quotation mark). */
export function thousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "’");
}

export type DreamNudge = "lange" | "zeitpunkt" | "neu";

/** «guter Zeitpunkt»: the target date lies at most this many days ahead (8 weeks) … */
export const NUDGE_SOON_DAYS = 56;
/** … and the coach has not brought it up in the last 14 days */
export const NUDGE_SOON_QUIET_DAYS = 14;
/** «liegt lange»: no update, no logged time and no block for at least 60 days … */
export const NUDGE_LONG_DAYS = 60;
/** … and not brought up in the last 30 days */
export const NUDGE_LONG_QUIET_DAYS = 30;
/** «neu»: one joyful invitation in her second week with the app (7 up to 20 days after she started), for a dream she
 *  named in her first week (NUDGE_NEW_FIRST_WEEK_DAYS), never brought up and not planned */
export const NUDGE_NEW_FROM_DAYS = 7;
export const NUDGE_NEW_UNTIL_DAYS = 20;
export const NUDGE_NEW_FIRST_WEEK_DAYS = 7;
/** After her «nicht jetzt» a dream rests this long (goals.nudge_after) */
export const NUDGE_NOT_NOW_DAYS = 90;

export interface NudgeGoal {
  kind?: string | null;
  status: string;
  target_date: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  reminded_at?: string | null;
  /** after her «nicht jetzt»: no reminder before this day */
  nudge_after?: string | null;
}

export interface NudgeActivity {
  /** the newest day time was logged for the dream, null = never */
  lastTimeDay?: string | null;
  /** the newest day of a calendar block for it, a planned one in the future too, null = none */
  lastBlockDay?: string | null;
  /** the newest day one of its milestones was added, changed or done, null = none */
  lastStepDay?: string | null;
  /** an ISO timestamp → the person's local day; default its date as written (UTC from the database) */
  dayOfIso?: (iso: string) => string;
  /** the day she started with the app (profiles.created_at, local): only then can a dream be «neu» */
  startDay?: string | null;
}

/** The day a dream rests until after her «nicht jetzt» (goals.nudge_after), while it still rests; else null. */
export function restingUntil(nudgeAfter: string | null | undefined, today: string): string | null {
  if (typeof nudgeAfter !== "string") return null;
  const d = nudgeAfter.slice(0, 10);
  return isDay(d) && today < d ? d : null;
}

/**
 * The coach's reminder candidates (they go into its context, it mentions at most one per conversation):
 * "zeitpunkt" for an active dream with a target date in the next 8 weeks, not brought up in the last
 * 14 days; "neu" in her second week with the app (7 to 20 days after `ctx.startDay`) for a dream she named in
 * her first week, never brought up, without a date and without anything planned (one invitation about the
 * joy, never about steps; a dream added later never gets it, nor without a start day); "lange" for an
 * active dream with no update, logged time or block for 60 days or more, not brought up in the last
 * 30 days; otherwise null (goals, paused, fulfilled or dropped dreams too, and a dream resting after her
 * «nicht jetzt» until `nudge_after`).
 * "In the last n days" means fewer than n days ago: reminded exactly 14 days ago may be mentioned again.
 */
export function dreamNudge(goal: NudgeGoal, today: string = dayOf(), ctx: NudgeActivity = {}): DreamNudge | null {
  if (goal.kind !== "dream" || goal.status !== "active" || !isDay(today)) return null;
  if (restingUntil(goal.nudge_after, today)) return null;
  const local = (iso: string | null | undefined): string | null => {
    if (typeof iso !== "string" || !iso) return null;
    let d: string;
    try {
      d = iso.length > 10 && ctx.dayOfIso ? ctx.dayOfIso(iso) : iso.slice(0, 10);
    } catch {
      d = iso.slice(0, 10);
    }
    return isDay(d) ? d : null;
  };
  const reminded = local(goal.reminded_at);
  const quiet = (days: number) => reminded === null || daysBetween(reminded, today) >= days;
  if (goal.target_date && isDay(goal.target_date)) {
    const ahead = daysBetween(today, goal.target_date);
    if (ahead >= 0 && ahead <= NUDGE_SOON_DAYS && quiet(NUDGE_SOON_QUIET_DAYS)) return "zeitpunkt";
  }
  const created = local(goal.created_at);
  const start = typeof ctx.startDay === "string" && isDay(ctx.startDay) ? ctx.startDay : null;
  if (start && created && reminded === null && !goal.target_date && !ctx.lastTimeDay && !ctx.lastBlockDay && !ctx.lastStepDay) {
    const withApp = daysBetween(start, today);
    if (daysBetween(start, created) < NUDGE_NEW_FIRST_WEEK_DAYS && withApp >= NUDGE_NEW_FROM_DAYS && withApp <= NUDGE_NEW_UNTIL_DAYS) return "neu";
  }
  const seen = [goal.updated_at, goal.created_at, ctx.lastTimeDay, ctx.lastBlockDay, ctx.lastStepDay].map(local).filter((d): d is string => d !== null);
  if (!seen.length) return null;
  const last = seen.reduce((a, b) => (b > a ? b : a));
  if (daysBetween(last, today) >= NUDGE_LONG_DAYS && quiet(NUDGE_LONG_QUIET_DAYS)) return "lange";
  return null;
}

// ---------- the daily conversation: the opener, a pause, the Wochenblick ----------

/** Days since the last conversation from which it counts as a pause: the coach never mentions it, it offers a small restart. */
export const PAUSE_DAYS = 5;
/** The first open from this local time on looks back on the day (17:00). */
export const EVENING_FROM = 17 * 60;
/** «Wie hast du geschlafen?» only before this local time (11:00). */
export const MORNING_UNTIL = 11 * 60;
/** A mood this heavy (valence) or heavier makes the coach quiet: no wins, no Wochenblick, no goals first. */
export const HEAVY_VALENCE = -0.3;
/** At most this many evening questions in seven days, never two evenings in a row. */
export const EVENING_QUESTIONS_PER_WEEK = 3;

/** Whole days since the last conversation (yesterday = 1); null without an earlier one. */
export function daysSinceLast(lastDay: string | null | undefined, today: string): number | null {
  if (typeof lastDay !== "string" || !isDay(lastDay) || !isDay(today)) return null;
  const d = daysBetween(lastDay, today);
  return d > 0 ? d : null;
}

/** After a pause (PAUSE_DAYS or more without a conversation). */
export function isPause(lastDay: string | null | undefined, today: string): boolean {
  const d = daysSinceLast(lastDay, today);
  return d !== null && d >= PAUSE_DAYS;
}

/** The person's clock at a moment: the local day, minutes since midnight and the weekday (0 = Monday). */
export function localClock(now: Date, tz: string): { day: string; minutes: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const day = `${get("year")}-${get("month")}-${get("day")}`;
  return { day, minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")), weekday: weekdayIndex(day) };
}

type Mood = { valence?: number } | null | undefined;
const heavy = (m: Mood) => typeof m?.valence === "number" && m.valence <= HEAVY_VALENCE;

/**
 * Heavy lately: today's mood is heavy, or two of the moods recorded on the three days before today are.
 * After a pause (`lastSeen`: the last day with a conversation) those are the three days up to the last one she
 * was there: what weighed on her then is all there is to go on at the first greeting after it.
 * Read before she has said anything today, so it can only come from what was stored.
 */
export function heavyLately(todayMood: Mood, recent: { day: string; mood: Mood }[], today: string, lastSeen?: string | null): boolean {
  if (heavy(todayMood)) return true;
  const anchor = lastSeen && isPause(lastSeen, today) ? addDays(lastSeen, 1) : today;
  const last3 = recent.filter((d) => isDay(d.day) && daysBetween(d.day, anchor) >= 1 && daysBetween(d.day, anchor) <= 3 && typeof d.mood?.valence === "number");
  return last3.filter((d) => heavy(d.mood)).length >= 2;
}

export type OpenerKind = "termin" | "gestern" | "ziel" | "schlaf" | "jahreszeit" | "neustart" | "wochenblick" | "abend" | "abend_frage" | "zurueck";
/** The kinds that take turns from day to day, in the order that wins a tie. */
export const ROTATING_OPENERS: readonly OpenerKind[] = ["termin", "gestern", "ziel", "schlaf", "jahreszeit"];
const OPENER_KINDS: readonly string[] = [...ROTATING_OPENERS, "neustart", "wochenblick", "abend", "abend_frage", "zurueck"];
/** «Wie hast du geschlafen?» not again within this many days (at most twice in seven). */
export const SLEEP_OPENER_GAP_DAYS = 3;
export const isOpenerKind = (v: unknown): v is OpenerKind => typeof v === "string" && OPENER_KINDS.includes(v);

export interface OpenerSituation {
  /** local minutes since midnight */
  minutes: number;
  /** after a pause: one small restart */
  pause: boolean;
  /** a Wochenblick is due (wochenblickDue) */
  wochenblick: boolean;
  /** the rotating kinds that have something to say today */
  available: readonly OpenerKind[];
  /** heavy lately (heavyLately): only the gentle kinds, sleep or the season */
  quiet?: boolean;
  /** she said yes to «soll ich morgen darauf zurückkommen?» and it was not brought up yet (days.come_back) */
  comeBack?: boolean;
}

/**
 * How today's first greeting opens, chosen in code so it really changes from day to day.
 * A situation comes first: after a pause a small restart, then what she asked the coach to come back to (in the
 * morning or at midday; in the evening it waits for the next morning), then a due Wochenblick, then the first open in
 * the evening (a look back; with a question at most three evenings in seven and never two in a row).
 * Otherwise the rotating kinds take turns: of those with something to say today, the one used longest ago
 * (never yesterday's while another fits), ties in the order of ROTATING_OPENERS; sleep only in the morning and not
 * within SLEEP_OPENER_GAP_DAYS of the last time; in a heavy time only sleep or the season. Without any: the season.
 * `recent`: the openers of the days before today.
 */
export function chooseOpener(s: OpenerSituation, recent: { day: string; kind: string | null }[], today: string): OpenerKind {
  if (s.pause) return "neustart";
  if (s.comeBack && s.minutes < EVENING_FROM) return "zurueck";
  if (s.wochenblick) return "wochenblick";
  const ago = (kinds: string[]) =>
    recent
      .filter((r) => r.kind && kinds.includes(r.kind) && isDay(r.day))
      .map((r) => daysBetween(r.day, today))
      .filter((d) => d >= 1);
  if (s.minutes >= EVENING_FROM) {
    const asked = ago(["abend_frage"]);
    const yesterday = asked.includes(1);
    return !yesterday && asked.filter((d) => d <= 6).length < EVENING_QUESTIONS_PER_WEEK ? "abend_frage" : "abend";
  }
  const sleptLately = ago(["schlaf"]).some((d) => d <= SLEEP_OPENER_GAP_DAYS);
  const kinds = ROTATING_OPENERS.filter(
    (k) => s.available.includes(k) && (k !== "schlaf" || (s.minutes < MORNING_UNTIL && !sleptLately)) && (!s.quiet || k === "schlaf" || k === "jahreszeit"),
  );
  if (!kinds.length) return "jahreszeit";
  const since = (k: OpenerKind) => {
    const d = ago([k]);
    return d.length ? Math.min(...d) : Infinity;
  };
  const fresh = kinds.filter((k) => since(k) !== 1);
  const pool = fresh.length ? fresh : kinds;
  return pool.reduce((best, k) => (since(k) > since(best) ? k : best), pool[0]);
}

/** The Wochenblick: Sunday from 16:00 (weekday 6), or the first conversation of the new week up to Wednesday. */
export const REVIEW_FROM = 16 * 60;
export const REVIEW_LAST_WEEKDAY = 2;

/** The week a Wochenblick looks ahead to (its Monday): from Sunday 16:00 the coming one, else the current one. */
export function reviewWeek(day: string, minutes: number): string {
  return weekdayIndex(day) === 6 && minutes >= REVIEW_FROM ? addDays(day, 1) : weekStart(day);
}

export interface ReviewState {
  /** the Monday of the last week whose Wochenblick she did or declined */
  week: string | null;
  /** declines in a row */
  declines: number;
  /** null = never asked whether she wants it; false = she doesn't (never offered again); true = she does */
  wanted: boolean | null;
}

/** "anbieten": offer it in this conversation; "fragen": after two declines, ask once whether she wants it at all. */
export type ReviewDue = "anbieten" | "fragen";

/**
 * Whether the Wochenblick is due in this conversation: in its window (Sunday from 16:00 up to Wednesday),
 * not yet done or declined for this week (only the recorded offer, `state.week` from the tool «wochenblick», ends
 * it: a conversation in which it was not offered leaves it due), at least one goal with weekly hours or blocks,
 * not after a pause (that is a restart) and not in a heavy time. Never when she said she doesn't want it, and never
 * before she ever talked on an earlier day (`lastTalk`: her own last message before today, talkClock; null: there
 * is no week of hers to look back on yet; the Kennenlernen has its own thread and doesn't count).
 */
export function wochenblickDue(o: {
  day: string;
  minutes: number;
  lastTalk: { day: string; minutes: number } | null;
  state: ReviewState;
  hasPlanGoal: boolean;
  heavy: boolean;
  pause: boolean;
}): ReviewDue | null {
  if (!isDay(o.day) || !o.lastTalk || !o.hasPlanGoal || o.heavy || o.pause || o.state.wanted === false) return null;
  const wd = weekdayIndex(o.day);
  const inWindow = (wd === 6 && o.minutes >= REVIEW_FROM) || wd <= REVIEW_LAST_WEEKDAY;
  if (!inWindow) return null;
  const week = reviewWeek(o.day, o.minutes);
  if (o.state.week && isDay(o.state.week) && o.state.week >= week) return null;
  return o.state.declines >= 2 && o.state.wanted !== true ? "fragen" : "anbieten";
}

/**
 * When she last talked, on the clock of that conversation: the day of its thread, and the local time of her message,
 * or the end of that day when the message came after midnight (a conversation of Sunday evening that ran past
 * midnight is still Sunday evening). Null when the thread is no day (the Kennenlernen) or the time is unreadable.
 */
export function talkClock(thread: string, createdAt: string, tz: string): { day: string; minutes: number } | null {
  if (!isDay(thread) || !Number.isFinite(Date.parse(createdAt))) return null;
  const c = localClock(new Date(createdAt), tz);
  return { day: thread, minutes: c.day === thread ? c.minutes : c.day > thread ? 24 * 60 - 1 : 0 };
}

export interface DailySituation {
  /** her local minutes now (midday when her clock and the thread disagree around midnight) */
  minutes: number;
  /** after a pause: a small restart, nothing about what was missed */
  pause: boolean;
  /** heavy lately (heavyLately) */
  heavy: boolean;
  /** the Wochenblick, when it is due */
  review: ReviewDue | null;
}

/**
 * What the daily conversation knows before she says anything, from what was stored: her clock, a pause (by the
 * last day with any conversation), a heavy time, and whether the Wochenblick is due (by her own last message:
 * talkClock). `review` null: its state is unknown (the columns before their migration), so it is never offered.
 */
export function dailySituation(o: {
  /** her today (the thread) */
  day: string;
  now: Date;
  tz: string;
  /** the last day before today with any message, null = none */
  lastSeenDay: string | null;
  /** her own last message before today (its thread and created_at), null = none */
  lastSpoke: { thread: string; created_at: string } | null;
  todayMood: Mood;
  recentDays: { day: string; mood: Mood }[];
  review: ReviewState | null;
  hasPlanGoal: boolean;
}): DailySituation {
  const clock = localClock(o.now, o.tz);
  const minutes = clock.day === o.day ? clock.minutes : 12 * 60;
  const pause = isPause(o.lastSeenDay, o.day);
  const heavy = heavyLately(o.todayMood, o.recentDays, o.day, o.lastSeenDay);
  const review = o.review
    ? wochenblickDue({
        day: o.day,
        minutes,
        lastTalk: o.lastSpoke ? talkClock(o.lastSpoke.thread, o.lastSpoke.created_at, o.tz) : null,
        state: o.review,
        hasPlanGoal: o.hasPlanGoal,
        heavy,
        pause,
      })
    : null;
  return { minutes, pause, heavy, review };
}

/** A goal that has a plan to look at: active, not a dream, with weekly hours or with a block in the calendar. */
export function hasPlanGoal(goals: { id: string; kind?: string | null; status: string; weekly_hours?: number | null }[], blockGoalIds: Iterable<string>): boolean {
  const blocks = new Set(blockGoalIds);
  return goals.some((g) => g.kind !== "dream" && g.status === "active" && ((g.weekly_hours ?? 0) > 0 || blocks.has(g.id)));
}

/**
 * The one goal to plan for (Wochenblick) or to restart with (after a pause): active and not a dream; the
 * nearest target date still ahead first, then one with weekly hours, then the first. Null without any.
 */
export function focusGoal<G extends { id: string; kind?: string | null; status: string; target_date: string | null; weekly_hours?: number | null }>(goals: G[], today: string): G | null {
  const active = goals.filter((g) => g.kind !== "dream" && g.status === "active");
  const dated = active.filter((g) => g.target_date && isDay(g.target_date) && g.target_date >= today).sort((a, b) => (a.target_date! < b.target_date! ? -1 : 1));
  return dated[0] ?? active.find((g) => (g.weekly_hours ?? 0) > 0) ?? active[0] ?? null;
}

/**
 * The length of a small restart: half of her usual block for the goal (the median), or of a third of her weekly
 * hours, else of 40 minutes; in steps of 5, from 15 up to 45 minutes.
 */
export function smallStepMinutes(blockMinutes: number[], weeklyHours: number | null | undefined): number {
  const v = blockMinutes.filter((m) => m > 0).sort((a, b) => a - b);
  const usual = v.length ? v[Math.floor((v.length - 1) / 2)] : weeklyHours && weeklyHours > 0 ? (weeklyHours * 60) / 3 : 40;
  return Math.min(45, Math.max(15, Math.round(usual / 2 / 5) * 5));
}

type WeekBlock = { goal_id: string | null; starts_at: string; ends_at: string | null; all_day: boolean; kind?: string; source?: string | null; created_at?: string | null; answered: boolean };

/** One of her own past blocks nobody answered yet: timed, ended by `now`, not the trainer's plan. */
function openBlock(b: WeekBlock, now: Date): boolean {
  return (!b.kind || b.kind === "block") && !b.all_day && !!b.ends_at && !b.answered && b.source !== "nolio" && Date.parse(b.ends_at) <= now.getTime();
}

export interface WeekGoalSummary {
  goal_id: string;
  /** minutes of blocks planned for it that week (the trainer's plan too) */
  planned_minutes: number;
  blocks: number;
  /** minutes recorded for it that week: logged, answered blocks, completed trainings */
  done_minutes: number;
  /** minutes of its own past blocks that week nobody answered (never a miss) */
  open_minutes: number;
  /** what counts for it that week, as the goal's bar counts it: done_minutes plus the open blocks that still
   *  count (provisionally, or from before honest counting; unansweredCredit) */
  counted_minutes: number;
}

/**
 * Planned against done per goal for the week from `monday` (the Wochenblick, and the per-goal line on Woche).
 * done_minutes is confirmed time only; a block nobody answered is «open», never a miss. `from`: when honest
 * counting began (for counted_minutes). Goals with nothing planned and nothing done are left out.
 */
export function weekGoalSummary(
  goalIds: string[],
  blocks: (WeekBlock & { id: string })[],
  log: { goal_id: string; day: string; minutes: number }[],
  monday: string,
  now: Date,
  dayOfIso: (iso: string) => string,
  from?: string | null,
): WeekGoalSummary[] {
  const sunday = addDays(monday, 6);
  const inWeek = (d: string) => d >= monday && d <= sunday;
  const out = new Map(goalIds.map((id) => [id, { goal_id: id, planned_minutes: 0, blocks: 0, done_minutes: 0, open_minutes: 0, counted_minutes: 0 }]));
  for (const b of blocks) {
    const s = b.goal_id ? out.get(b.goal_id) : undefined;
    if (!s || (b.kind && b.kind !== "block") || b.all_day || !b.ends_at || !inWeek(dayOfIso(b.starts_at))) continue;
    const min = Math.min(1440, Math.max(0, Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000)));
    if (!min) continue;
    s.planned_minutes += min;
    s.blocks++;
    if (!openBlock(b, now)) continue;
    s.open_minutes += min;
    if (unansweredCredit(b, now.getTime(), from)) s.counted_minutes += min;
  }
  for (const t of log) {
    const s = out.get(t.goal_id);
    if (s && t.minutes > 0 && inWeek(t.day)) {
      s.done_minutes += t.minutes;
      s.counted_minutes += t.minutes;
    }
  }
  return [...out.values()].filter((s) => s.planned_minutes > 0 || s.done_minutes > 0);
}

/**
 * The blocks of the week from `monday` that weekGoalSummary counts as «ohne Rückmeldung», one by one and in order,
 * for the Wochenblick: with their id she can still say how one went, or that it didn't happen (log_time, 0 minutes).
 */
export function openWeekBlocks<B extends WeekBlock>(blocks: B[], goalIds: string[], monday: string, now: Date, dayOfIso: (iso: string) => string): B[] {
  const goals = new Set(goalIds);
  const sunday = addDays(monday, 6);
  return blocks
    .filter((b) => {
      const d = dayOfIso(b.starts_at);
      return !!b.goal_id && goals.has(b.goal_id) && d >= monday && d <= sunday && openBlock(b, now) && Date.parse(b.ends_at!) > Date.parse(b.starts_at);
    })
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
}

// ---------- a block's answer: Ja · Teilweise · Nein, and the pattern of a goal's blocks ----------

/** What she answered for a past block: null = nothing yet, "ja" (as planned or more), "teilweise" (some), "nein" (0). */
export type BlockAnswerState = "ja" | "teilweise" | "nein" | null;

export function blockAnswerState(minutes: number | null | undefined, planned: number): BlockAnswerState {
  if (minutes === null || minutes === undefined) return null;
  if (minutes <= 0) return "nein";
  return minutes < planned ? "teilweise" : "ja";
}

/** «Teilweise» without a number: half of the planned length in steps of 5 minutes, at least 5, less than planned. */
export function partialMinutes(planned: number): number {
  const half = Math.max(5, Math.round(planned / 2 / 5) * 5);
  return Math.max(1, Math.min(half, Math.round(planned) - 1));
}

/** The pattern of a goal's blocks looks back this many days. */
export const PATTERN_DAYS = 28;
/** The coach offers to adapt a goal's blocks from their pattern at most once in this many days. */
export const PATTERN_EVERY_DAYS = 7;

export interface BlockPattern {
  /** her own past blocks for the goal in the window */
  planned: number;
  /** answered with time (Ja or Teilweise) */
  confirmed: number;
  /** of those, with less than planned (Teilweise) */
  partial: number;
  /** answered «Nein» (0 minutes): kept as data */
  missed: number;
  /** nobody answered */
  open: number;
  /** a start hour (local) or else a weekday that at least two «Nein» share, where more didn't work than worked */
  slot: { hour: number; count: number } | { weekday: number; count: number } | null;
  /** worth offering once to adapt them: a slot that doesn't work, or most of them didn't happen (at least three) */
  adapt: boolean;
}

/**
 * The pattern of one goal's blocks over the last PATTERN_DAYS: planned, confirmed, «Nein» (where they cluster)
 * and open. Only her own timed blocks that have ended (not the trainer's plan). `minutes`: the answer (null = none).
 * `clockOf`: the local minutes since midnight and weekday (0 = Monday) of an ISO time. Null without any block.
 */
export function blockPattern(
  blocks: { starts_at: string; ends_at: string | null; all_day?: boolean; kind?: string; source?: string | null; minutes: number | null }[],
  now: number,
  clockOf: (iso: string) => { minutes: number; weekday: number },
): BlockPattern | null {
  const since = now - PATTERN_DAYS * 86400000;
  const past = blocks.filter(
    (b) => (!b.kind || b.kind === "block") && !b.all_day && b.source !== "nolio" && !!b.ends_at && Date.parse(b.ends_at) <= now && Date.parse(b.starts_at) >= since,
  );
  if (!past.length) return null;
  const p: BlockPattern = { planned: past.length, confirmed: 0, partial: 0, missed: 0, open: 0, slot: null, adapt: false };
  const byHour = new Map<number, { missed: number; worked: number }>();
  const byDay = new Map<number, { missed: number; worked: number }>();
  const tally = (m: Map<number, { missed: number; worked: number }>, k: number) => m.get(k) ?? m.set(k, { missed: 0, worked: 0 }).get(k)!;
  for (const b of past) {
    const planned = Math.round((Date.parse(b.ends_at!) - Date.parse(b.starts_at)) / 60000);
    const state = blockAnswerState(b.minutes, planned);
    if (state === null) {
      p.open++;
      continue;
    }
    const c = clockOf(b.starts_at);
    const key = state === "nein" ? "missed" : "worked";
    tally(byHour, Math.floor(c.minutes / 60))[key]++;
    tally(byDay, c.weekday)[key]++;
    if (state === "nein") p.missed++;
    else {
      p.confirmed++;
      if (state === "teilweise") p.partial++;
    }
  }
  // the slot with the most «Nein» (the earlier one on a tie), if at least two and more than worked there
  const worst = (m: Map<number, { missed: number; worked: number }>) =>
    [...m.entries()].filter(([, v]) => v.missed >= 2 && v.missed > v.worked).sort((a, b) => b[1].missed - a[1].missed || a[0] - b[0])[0];
  const hour = worst(byHour);
  const day = hour ? undefined : worst(byDay);
  p.slot = hour ? { hour: hour[0], count: hour[1].missed } : day ? { weekday: day[0], count: day[1].missed } : null;
  p.adapt = p.slot !== null || (p.missed >= 3 && p.missed > p.confirmed);
  return p;
}

/**
 * May the coach offer to adapt the goal's blocks now (at most once in PATTERN_EVERY_DAYS)? `askedAt`: when it
 * last did (goals.pattern_asked_at); null = never; undefined = unknown (then never: nothing could be noted).
 */
export function patternOfferDue(askedAt: string | null | undefined, today: string, dayOfIso: (iso: string) => string): boolean {
  if (askedAt === undefined) return false;
  if (askedAt === null) return true;
  const last = dayOfIso(askedAt);
  return !isDay(last) || daysBetween(last, today) >= PATTERN_EVERY_DAYS;
}

type PatternBlock = Parameters<typeof blockPattern>[0][number];

/**
 * The offer to adapt a goal's blocks, for the pattern line: "anbieten" (worth it, `p.adapt`, and not offered in the
 * last PATTERN_EVERY_DAYS), "angeboten" (offered within them) or null. After an offer only the blocks since then
 * count for the next one: the same old «Nein» never bring it back week after week (she may have moved the blocks,
 * or said she keeps them). `askedAt`: goals.pattern_asked_at (null = never; undefined = unknown: never offered).
 */
export function patternOffer(
  p: BlockPattern,
  blocks: PatternBlock[],
  askedAt: string | null | undefined,
  now: number,
  today: string,
  clockOf: (iso: string) => { minutes: number; weekday: number },
  dayOfIso: (iso: string) => string,
): "anbieten" | "angeboten" | null {
  if (!p.adapt || askedAt === undefined) return null;
  if (!patternOfferDue(askedAt, today, dayOfIso)) return "angeboten";
  if (askedAt === null) return "anbieten";
  const since = Date.parse(askedAt);
  const fresh = Number.isFinite(since) ? blockPattern(blocks.filter((b) => Date.parse(b.starts_at) > since), now, clockOf) : p;
  return fresh?.adapt ? "anbieten" : null;
}

export type TodayWin = { kind: "zeit"; title: string; minutes: number } | { kind: "etappe"; title: string; goal: string } | { kind: "gewohnheit"; title: string };

/**
 * What really happened today, for the evening look back: time recorded for a goal (logged, an answered block,
 * a completed training), a step done today, a habit ticked today. Nothing that only was planned.
 */
export function todayWins(
  goals: { id: string; title: string; milestones: { title: string; done_at: string | null }[] }[],
  habits: { title: string; done_days: string[] }[],
  log: { goal_id: string; minutes: number }[],
  today: string,
  dayOfIso: (iso: string) => string,
): TodayWin[] {
  const wins: TodayWin[] = [];
  const minutes = new Map<string, number>();
  for (const t of log) if (t.minutes > 0) minutes.set(t.goal_id, (minutes.get(t.goal_id) ?? 0) + t.minutes);
  for (const g of goals) {
    const m = minutes.get(g.id);
    if (m) wins.push({ kind: "zeit", title: g.title, minutes: m });
  }
  for (const g of goals) for (const m of g.milestones) if (m.done_at && dayOfIso(m.done_at) === today) wins.push({ kind: "etappe", title: m.title, goal: g.title });
  for (const h of habits) if (h.done_days.includes(today)) wins.push({ kind: "gewohnheit", title: h.title });
  return wins;
}

/** 45 → «45 Min», 60 → «1 Std», 75 → «1 Std 15 Min» (written as it is said) */
export function minutesText(m: number): string {
  const t = Math.round(m);
  const h = Math.floor(t / 60);
  const rest = t % 60;
  return h ? `${h} Std${rest ? ` ${rest} Min` : ""}` : `${rest} Min`;
}

/**
 * The quiet line on Jetzt: what she did today, only what is confirmed (todayWins: logged time, answered blocks,
 * completed trainings, steps done, habits ticked), e.g. «Heute: 40 Min für Halbmarathon Zürich · Dehnen».
 * Null when there is nothing: never «0», never what is missing, never what was only planned.
 */
export function todayWinsLine(wins: TodayWin[]): string | null {
  if (!wins.length) return null;
  return `Heute: ${wins.map((w) => (w.kind === "zeit" ? `${minutesText(w.minutes)} für ${w.title}` : w.title)).join(" · ")}`;
}

// ---------- Plan B: one if-then plan per serious goal ----------

/** goals.plan_b, her if-then sentence («Wenn es regnet, laufe ich auf dem Laufband.»): at most this many characters. */
export const PLAN_B_MAX = 200;
/** goals.obstacle, what could get in the way («Regen»), for the coach: at most this many characters. */
export const OBSTACLE_MAX = 160;

type PlanBGoal = { kind?: string | null; status: string; target_date: string | null; weekly_hours?: number | null };

/**
 * Serious: she works toward a date with real time for it. An active goal (not a dream) whose target date still
 * lies ahead, with hours per week or planned blocks (`hasBlocks`: blocks for it in the calendar, past or coming).
 */
export function seriousGoal(g: PlanBGoal, hasBlocks: boolean, today: string): boolean {
  if (g.kind === "dream" || g.status !== "active" || !g.target_date || !isDay(g.target_date) || g.target_date <= today) return false;
  return (g.weekly_hours ?? 0) > 0 || hasBlocks;
}

/**
 * Ask once now what could get in the way (Plan B)? A serious goal with neither a Plan B nor an obstacle, never
 * asked (plan_b_asked_at null). Unknown (undefined, e.g. before the column) means never: nothing could be noted.
 */
export function planBDue(
  g: PlanBGoal & { plan_b?: string | null; obstacle?: string | null; plan_b_asked_at?: string | null },
  hasBlocks: boolean,
  today: string,
): boolean {
  if (g.plan_b_asked_at !== null) return false;
  if (g.plan_b?.trim() || g.obstacle?.trim()) return false;
  return seriousGoal(g, hasBlocks, today);
}

/** «Viel» in one day: at least this many of her own messages. */
export const TALK_MANY = 12;

/**
 * She leans on the coach: over the 14 days before today, at least 10 days with many of her own messages,
 * and most of the moods recorded then (at least 6, 60 %) heavy. The coach then once points warmly to people
 * in her life or a professional, and never lengthens a conversation.
 */
export function leansOnCoach(talk: Record<string, number>, moods: { day: string; mood: Mood }[], today: string): boolean {
  const within = (d: string) => isDay(d) && daysBetween(d, today) >= 1 && daysBetween(d, today) <= 14;
  const busy = Object.entries(talk).filter(([d, n]) => within(d) && n >= TALK_MANY).length;
  const recorded = moods.filter((m) => within(m.day) && typeof m.mood?.valence === "number");
  const low = recorded.filter((m) => heavy(m.mood)).length;
  return busy >= 10 && low >= 6 && low >= 0.6 * recorded.length;
}

// Word parts for sensitiveTopic. Anchored where a short part sits inside harmless words: «Bankett» and
// «Bankdrücken» are no bank, «Klagenfurt» no lawsuit, «belohnt» and «lohnt sich» no wage, «festgehalten» no salary,
// «Velo mieten» no rent, the «Trainingspartner» no partner.
const SENSITIVE = new RegExp(
  [
    // health
    "arzt", "ärzt", "doktor", "\\bdr\\.", "zahn", "therap", "psych", "notfall", "notaufnahme", "unfall", "operation", "\\bop\\b", "diagnos",
    "krank", "physio", "\\breha", "untersuch", "blutt", "blutdruck", "impf", "gyn", "schwanger", "hebamm", "mammo", "ultraschall", "röntgen",
    "\\bmrt\\b", "\\bmri\\b", "\\bct\\b", "chemo", "onkolog", "kardiolog", "orthopäd", "chirurg",
    // relationships
    "beziehung", "trennung", "scheidung", "\\bpartner", "\\bdate\\b", "\\bex\\b", "liebeskummer", "schluss gemacht",
    // money
    "kredit", "schulden", "steuer", "betreibung", "(?<!be)lohn(?!t)", "gehalt(?!en)", "gehält", "geld", "miete\\b", "\\bmieter",
    "mietzins", "budget", "finanz", "hypothek", "arbeitslos", "\\brav\\b",
    // legal matters
    "klage\\b", "\\bklagt\\b", "\\bbusse\\b", "vormund", "kesb",
  ].join("|"),
  "i",
);
// Places that are sensitive as an appointment but are also employers: «beim Notar», «im Spital», «bei der Bank»
// are a private matter, a «Vorstellungsgespräch bei der Bank» or a «Probetag im Spital» is not.
const SENSITIVE_PLACE = /\bbank(?!ett|drück)|versicherung|spital|klinik|gericht|polizei|notar|anwalt|anwält/i;
const PLACE = "bank(?!ett|drück)|versicherung|spital|klinik|gericht|polizei|notar|anwalt|anwält"; // also in a compound: «Kantonsspital»
// A job, an application or a training.
const JOB = [
  "vorstellungsgespr", "(?<!wett)bew[ei]rb", "beworben", "probetag", "probearbeit", "schnupper", "interview", "job",
  "\\bstelle\\b", "\\bstellen(?:antritt|angebot|wechsel|suche|inserat)", "lehrstelle", "praktik", "ausbildung",
  "assessment", "eignungstest", "aufnahmetest", "arbeitstag", "(?<!ge)schicht",
].join("|");
const W = "[a-zäöüéèàç]";
// Only where the place is the job's own: «Vorstellungsgespräch (am Dienstag) bei der Bank», «Probetag im Spital»,
// «Praktikum in einer Anwaltskanzlei», «Bankjob», «Spital: Probetag». A job word elsewhere in the note changes
// nothing: «nach der Schicht ins Spital zur Kontrolle», «Termin beim Anwalt wegen dem Job», «nach dem Job beim
// Notar», «Bewerbung, danach ins Spital» stay private (going there, «ins», «zum», «zur», «vor», is a visit).
const JOB_PLACE = new RegExp(
  [
    `(?<!\\b(?:nach|vor|seit)\\s+(?:${W}+\\s+)?${W}*)(?:${JOB})${W}*` +
      `(?:\\s+(?!(?:und|dann|danach|nachher|anschliessend|noch|oder|aber)\\b)[\\wäöü]+){0,3}?` +
      `\\s+(?:bei|beim|im|in|am|an|ans|auf|für)\\s+(?:(?:der|die|das|dem|den|des|ein|eine|einer|einem|einen)\\s+)?(?:${W}+\\s+)?${W}*?(?:${PLACE})${W}*`,
    `(?:${PLACE})${W}*(?:[ \\t]*[:–-][ \\t]*|[ \\t]+)?${W}*?(?:${JOB})${W}*`,
  ].join("|"),
  "gi",
);

/**
 * A dated note she might be asked about that the coach never raises on its own: health, relationships,
 * money, legal matters. A coarse word check; the prompt says the same. A bank, an insurance, a hospital, a court,
 * the police, a notary or a lawyer named as the place of a job, an application or a training is no such matter
 * (JOB_PLACE), anywhere else in the same note it still is.
 */
export function sensitiveTopic(text: string): boolean {
  return SENSITIVE.test(text) || SENSITIVE_PLACE.test(text.replace(JOB_PLACE, " "));
}

// A note that waits for someone else's answer: a mail, a request, a message to someone, an application, an offer.
// «Mailand» is no mail, a «Bewerbungsgespräch» is her own appointment (asked about the next day).
const AWAITS_REPLY = /\b(?:e-?)?mails?\b|gemailt|anfrage|angefragt|nachricht an|beworben|bewerbung(?!sgespr)|offerte|\bantwort|rückmeldung|rückruf|zurückrufen|\bwartet auf/i;
/** Whether someone else has answered is asked at the earliest this many days after the note's day. */
export const FOLLOW_UP_REPLY_DAYS = 7;

/** A note that waits for someone else's answer («Mail an die Stationsleitung», «Ferienanfrage», «beworben»). */
export function awaitsReply(text: string): boolean {
  return AWAITS_REPLY.test(text);
}

/**
 * A dated memory to ask about once: its day lies one to three days back (one that waits for someone else's answer:
 * seven to nine, earlier it feels like control), not asked yet, and nothing sensitive.
 */
export function followUpDue(m: { event_date: string | null; content: string; followed_up_at?: string | null }, today: string): boolean {
  if (!m.event_date || !isDay(m.event_date) || m.followed_up_at) return false;
  const d = daysBetween(m.event_date, today);
  const from = awaitsReply(m.content) ? FOLLOW_UP_REPLY_DAYS : 1;
  return d >= from && d <= from + 2 && !sensitiveTopic(m.content);
}

// Work and shifts: the evening never takes them up («Spätdienst», «Frühschicht», «Arbeit», «Teammeeting», «im Laden»).
// «Geschichte» is no shift, «Dienstag» no duty, «Gartenarbeit» no work.
const WORK = /\barbeit|(?<!ge)schicht|dienst(?!ag)|büro|office|meeting|sitzung|besprechung|\bcall\b|kunde|\bjob|\bladen\b|pikett|rapport/i;

/** An entry about her work or a shift (a coarse word check on its title). */
export function workEntry(text: string): boolean {
  return WORK.test(text);
}

export interface DayEntry {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location?: string | null;
  kind?: string;
  source?: string | null;
}

/**
 * Her own entries of today that are over, for the evening look back (NEXT #4): a Termin or a block, with a time,
 * ended by `now` (one without an end an hour after it began), not from her trainer (Nolio), nothing sensitive
 * (sensitiveTopic, also its place), no work or shift (workEntry), no block she said no to (`declined`: its id).
 * Termine first (her own life), then blocks, each in the order of the day; at most `max`.
 */
export function eveningEntries<E extends DayEntry>(
  events: E[],
  o: { now: number; today: string; dayOfIso: (iso: string) => string; declined?: Set<string> },
  max = 2,
): E[] {
  const over = (e: E) => (e.ends_at ? Date.parse(e.ends_at) : Date.parse(e.starts_at) + 3600_000) <= o.now;
  return events
    .filter(
      (e) =>
        !e.all_day &&
        e.source !== "nolio" &&
        (!e.kind || e.kind === "termin" || e.kind === "block") &&
        o.dayOfIso(e.starts_at) === o.today &&
        over(e) &&
        !o.declined?.has(e.id) &&
        !sensitiveTopic(`${e.title} ${e.location ?? ""}`) &&
        !workEntry(e.title),
    )
    .sort((a, b) => (a.kind === "block" ? 1 : 0) - (b.kind === "block" ? 1 : 0) || Date.parse(a.starts_at) - Date.parse(b.starts_at))
    .slice(0, max);
}

/**
 * Time without a block (log_time without event_id) that already stands for this goal on this day with the same
 * minutes, from any source (her coach, a block she answered, a training, a habit): the same report said again, so no
 * second row unless she really did it twice (D1).
 */
export function sameTimeLogged(rows: { goal_id: string; day: string; minutes: number | string | null }[], goalId: string, day: string, minutes: number): boolean {
  return minutes > 0 && rows.some((r) => String(r.goal_id).toLowerCase() === goalId.toLowerCase() && r.day === day && Number(r.minutes) === minutes);
}

/** People without goals or dreams get one small experiment at most every this many days. */
export const EXPERIMENT_EVERY_DAYS = 7;

/**
 * One small experiment may be offered (people without any open goal or dream): nothing active or paused,
 * and the last offer (experiment_at) at least a week ago.
 */
export function experimentDue(goals: { status: string }[], lastAt: string | null | undefined, today: string, dayOfIso: (iso: string) => string): boolean {
  if (goals.some((g) => g.status === "active" || g.status === "paused")) return false;
  if (!lastAt) return true;
  const last = dayOfIso(lastAt);
  return !isDay(last) || daysBetween(last, today) >= EXPERIMENT_EVERY_DAYS;
}

/** The hint to point to people in her life comes back at most after this many days. */
export const SUPPORT_EVERY_DAYS = 90;
