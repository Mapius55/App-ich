// Kehrwasser: what the history adds up to. Pure: "today" is always passed in.
// Days are local calendar days as strings (YYYY-MM-DD); the arithmetic on them runs in UTC,
// so a change of summer or winter time never shifts a day.
import { REGIONS } from "../types.ts";
import type { HistoryEntry, Region } from "../types.ts";

/** a local day as "YYYY-MM-DD", or a Date that is turned into one with dayKey() */
export type DayInput = string | Date;

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));
const pad4 = (n: number): string => String(n).padStart(4, "0");

/** Local calendar day of a Date: YYYY-MM-DD. */
export function dayKey(date: Date): string {
  return `${pad4(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function toDay(d: DayInput): string {
  return typeof d === "string" ? d.slice(0, 10) : dayKey(d);
}

function toUtc(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

/** The day n days after (or before, n < 0) the given day. */
export function addDays(day: string, n: number): string {
  const t = new Date(toUtc(day) + Math.round(n) * 86_400_000);
  return `${pad4(t.getUTCFullYear())}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** Whole days from a to b (b later = positive). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayIndex(day: string): number {
  return (new Date(toUtc(day)).getUTCDay() + 6) % 7;
}

/** The Monday of the week the day lies in. */
export function weekStart(day: string): string {
  return addDays(day, -weekdayIndex(day));
}

interface DaySum {
  seconds: number;
  sessions: number;
}

function byDay(history: HistoryEntry[]): Map<string, DaySum> {
  const map = new Map<string, DaySum>();
  for (const h of history) {
    const seconds = Number.isFinite(h.seconds) ? Math.max(0, h.seconds) : 0;
    if (seconds <= 0 || typeof h.day !== "string") continue;
    const sum = map.get(h.day) ?? { seconds: 0, sessions: 0 };
    sum.seconds += seconds;
    sum.sessions += 1;
    map.set(h.day, sum);
  }
  return map;
}

export interface WeekDay {
  /** YYYY-MM-DD */
  day: string;
  seconds: number;
  sessions: number;
  isToday: boolean;
  /** after today: nothing can have happened yet */
  isFuture: boolean;
}

export interface WeekSummary {
  /** Monday */
  start: string;
  /** Sunday */
  end: string;
  /** seven days, Monday first */
  days: WeekDay[];
  seconds: number;
  sessions: number;
  /** days of this week with at least one session */
  activeDays: number;
}

/** Monday to Sunday of today's week. */
export function weekSummary(history: HistoryEntry[], today: DayInput): WeekSummary {
  const now = toDay(today);
  const start = weekStart(now);
  const sums = byDay(history);
  const days: WeekDay[] = [];
  let seconds = 0;
  let sessions = 0;
  let activeDays = 0;
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    const sum = sums.get(day);
    days.push({ day, seconds: sum?.seconds ?? 0, sessions: sum?.sessions ?? 0, isToday: day === now, isFuture: day > now });
    if (sum) {
      seconds += sum.seconds;
      sessions += sum.sessions;
      activeDays += 1;
    }
  }
  return { start, end: addDays(start, 6), days, seconds, sessions, activeDays };
}

/** Consecutive days with a session up to today, or up to yesterday while today has nothing yet. */
export function streak(history: HistoryEntry[], today: DayInput): number {
  const now = toDay(today);
  const sums = byDay(history);
  let day = sums.has(now) ? now : addDays(now, -1);
  let n = 0;
  while (sums.has(day)) {
    n += 1;
    day = addDays(day, -1);
  }
  return n;
}

export interface HeatDay {
  day: string;
  seconds: number;
}

/** Columns = weeks (oldest first, the last one is today's week), each Monday to Sunday. */
export function heat(history: HistoryEntry[], today: DayInput, weeks: number): HeatDay[][] {
  const count = Math.max(0, Math.floor(weeks));
  const start = weekStart(toDay(today));
  const sums = byDay(history);
  const columns: HeatDay[][] = [];
  for (let w = count - 1; w >= 0; w--) {
    const monday = addDays(start, -7 * w);
    const column: HeatDay[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(monday, i);
      column.push({ day, seconds: sums.get(day)?.seconds ?? 0 });
    }
    columns.push(column);
  }
  return columns;
}

export interface RegionSeconds {
  region: Region;
  seconds: number;
}

/** Seconds per region over the last `days` days (today included), for all regions, also those with 0. */
export function regionBalance(history: HistoryEntry[], today: DayInput, days: number): RegionSeconds[] {
  const now = toDay(today);
  const from = addDays(now, -(Math.max(1, Math.floor(days)) - 1));
  const sum = new Map<Region, number>();
  for (const h of history) {
    if (typeof h.day !== "string" || h.day < from || h.day > now || !h.regions) continue;
    for (const region of REGIONS) {
      const s = h.regions[region];
      if (typeof s === "number" && Number.isFinite(s) && s > 0) sum.set(region, (sum.get(region) ?? 0) + s);
    }
  }
  return REGIONS.map((region) => ({ region, seconds: sum.get(region) ?? 0 }));
}

export interface Totals {
  /** sessions with at least a second of exercise */
  sessions: number;
  /** sessions that went through to the end */
  completed: number;
  seconds: number;
  /** different days with a session */
  days: number;
  /** different exercises done at least once */
  exercises: number;
  /** the longest run of consecutive days ever */
  longestStreak: number;
}

export function totals(history: HistoryEntry[]): Totals {
  const sums = byDay(history);
  let sessions = 0;
  let completed = 0;
  let seconds = 0;
  const ids = new Set<string>();
  for (const h of history) {
    const s = Number.isFinite(h.seconds) ? Math.max(0, h.seconds) : 0;
    if (s <= 0) continue;
    sessions += 1;
    seconds += s;
    if (h.completed) completed += 1;
    for (const x of h.exercises ?? []) if (x.seconds > 0) ids.add(x.id);
  }
  let longestStreak = 0;
  let run = 0;
  let last: string | null = null;
  for (const day of [...sums.keys()].sort()) {
    run = last !== null && addDays(last, 1) === day ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
    last = day;
  }
  return { sessions, completed, seconds, days: sums.size, exercises: ids.size, longestStreak };
}
