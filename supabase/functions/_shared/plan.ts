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
