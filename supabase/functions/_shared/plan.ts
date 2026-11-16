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
  time: { logged_minutes: number; block_minutes: number };
}

export type Feasibility = "erreicht" | "machbar" | "knapp" | "kaum machbar";

export interface GoalEffort {
  /** estimated total hours, null = not estimated */
  effort: number | null;
  /** hours done: before the app + logged + past blocks */
  done: number;
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
}

/** needed / available up to this share is "machbar"; up to TIGHT_MAX "knapp"; beyond "kaum machbar" */
export const FEASIBLE_MAX = 0.85;
export const TIGHT_MAX = 1.1;

const round1 = (n: number) => Math.round(n * 10) / 10;

export function goalEffort(g: GoalEffortInput, today: string = dayOf()): GoalEffort {
  const done = round1((g.prior_hours || 0) + (g.time.logged_minutes + g.time.block_minutes) / 60);
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
  let feasibility: Feasibility | null = null;
  if (remaining === 0) feasibility = "erreicht";
  else if (remaining !== null && weeksLeft !== null && available !== null) {
    // unrounded, so the buffers don't move with the display rounding
    const ratio = remaining / weeksLeft / available;
    feasibility = ratio <= FEASIBLE_MAX ? "machbar" : ratio <= TIGHT_MAX ? "knapp" : "kaum machbar";
  }
  return {
    effort,
    done,
    remaining,
    weeksLeft: weeksLeft === null ? null : round1(weeksLeft),
    neededPerWeek,
    neededPerDay,
    available,
    weeksToFinish,
    feasibility,
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

// ---------- the year at a glance: minutes for goals per day ----------

/**
 * Minutes that went into goals per local day: logged time, plus past planned blocks
 * for a goal that nobody answered yet (an answered block is already in the log).
 * A planned Nolio training (source "nolio") never counts by itself: the completed training
 * arrives as logged time from Nolio, so counting the plan too would count it twice.
 * `dayOfIso` turns an ISO start time into the person's local day.
 */
export function dayMinutes(
  log: { day: string; minutes: number }[],
  blocks: { id: string; starts_at: string; ends_at: string | null; all_day: boolean; kind: string; goal_id: string | null; source?: string | null }[],
  answered: Set<string>,
  now: Date,
  dayOfIso: (iso: string) => string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of log) if (t.minutes > 0) out[t.day] = (out[t.day] ?? 0) + t.minutes;
  for (const b of blocks) {
    if (b.kind !== "block" || !b.goal_id || b.all_day || !b.ends_at || answered.has(b.id) || b.source === "nolio") continue;
    const end = new Date(b.ends_at).getTime();
    if (end > now.getTime()) continue;
    const min = Math.min(1440, Math.max(0, Math.round((end - new Date(b.starts_at).getTime()) / 60000)));
    if (!min) continue;
    const d = dayOfIso(b.starts_at);
    out[d] = (out[d] ?? 0) + min;
  }
  return out;
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

export type DreamNudge = "lange" | "zeitpunkt";

/** «guter Zeitpunkt»: the target date lies at most this many days ahead (8 weeks) … */
export const NUDGE_SOON_DAYS = 56;
/** … and the coach has not brought it up in the last 14 days */
export const NUDGE_SOON_QUIET_DAYS = 14;
/** «liegt lange»: no update, no logged time and no block for at least 60 days … */
export const NUDGE_LONG_DAYS = 60;
/** … and not brought up in the last 30 days */
export const NUDGE_LONG_QUIET_DAYS = 30;

export interface NudgeGoal {
  kind?: string | null;
  status: string;
  target_date: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  reminded_at?: string | null;
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
}

/**
 * The coach's reminder candidates (they go into its context, it mentions at most one per conversation):
 * "zeitpunkt" for an active dream with a target date in the next 8 weeks, not brought up in the last
 * 14 days; "lange" for an active dream with no update, logged time or block for 60 days or more, not
 * brought up in the last 30 days; otherwise null (goals, paused, fulfilled or dropped dreams too).
 * "In the last n days" means fewer than n days ago: reminded exactly 14 days ago may be mentioned again.
 */
export function dreamNudge(goal: NudgeGoal, today: string = dayOf(), ctx: NudgeActivity = {}): DreamNudge | null {
  if (goal.kind !== "dream" || goal.status !== "active" || !isDay(today)) return null;
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
  const seen = [goal.updated_at, goal.created_at, ctx.lastTimeDay, ctx.lastBlockDay, ctx.lastStepDay].map(local).filter((d): d is string => d !== null);
  if (!seen.length) return null;
  const last = seen.reduce((a, b) => (b > a ? b : a));
  if (daysBetween(last, today) >= NUDGE_LONG_DAYS && quiet(NUDGE_LONG_QUIET_DAYS)) return "lange";
  return null;
}
