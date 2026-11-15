// Pure layout maths for the time levels (Tag, Woche, Jahr). No React, no backend.
// Minutes are wall-clock minutes since local midnight of a given day.
import type { CalendarEvent } from "../lib/types";
import { hoursMinutes } from "../lib/dates";
import { addDays, dayOf, daysBetween, weekStart } from "../lib/plan";

export type EventLike = Pick<CalendarEvent, "id" | "starts_at" | "ends_at" | "all_day" | "kind" | "goal_id">;

export const DAY_MIN = 1440;
/** a timed entry without an end counts this long (UpNext: until 30 min after start) */
export const NO_END_MIN = 30;

/** wall-clock minutes of an ISO time relative to local midnight of `day` (negative before, > 1440 after) */
export function minutesIn(day: string, iso: string): number {
  const t = new Date(iso);
  return daysBetween(day, dayOf(t)) * DAY_MIN + t.getHours() * 60 + t.getMinutes();
}

/** end minute of a timed entry on its own start day (an entry without end lasts NO_END_MIN) */
function endIn(day: string, e: EventLike): number {
  return e.ends_at ? minutesIn(day, e.ends_at) : minutesIn(day, e.starts_at) + NO_END_MIN;
}

const byStart = (a: EventLike, b: EventLike) => a.starts_at.localeCompare(b.starts_at) || (a.ends_at ?? "").localeCompare(b.ends_at ?? "");

// ---------- Tag ----------

export type DayRow<E extends EventLike> = { type: "event"; e: E; past: boolean } | { type: "now" };

/**
 * The rows of a day: all-day entries first, then past timed entries, the JETZT line
 * (today only), then upcoming ones. A timed entry is past once it has ended
 * (without an end: 30 min after its start). On past days everything is past.
 */
export function dayRows<E extends EventLike>(events: E[], day: string, today: string, now: Date): DayRow<E>[] {
  const rel = daysBetween(today, day);
  const allDay = events.filter((e) => e.all_day).sort(byStart);
  const timed = events.filter((e) => !e.all_day).sort(byStart);
  const nowMs = now.getTime();
  const isPast = (e: E) => rel < 0 || (rel === 0 && (e.ends_at ? Date.parse(e.ends_at) : Date.parse(e.starts_at) + NO_END_MIN * 60000) <= nowMs);
  const rows: DayRow<E>[] = allDay.map((e) => ({ type: "event", e, past: rel < 0 }));
  const past = timed.filter(isPast);
  const upcoming = timed.filter((e) => !isPast(e));
  rows.push(...past.map((e) => ({ type: "event" as const, e, past: true })));
  if (rel === 0 && events.length) rows.push({ type: "now" });
  rows.push(...upcoming.map((e) => ({ type: "event" as const, e, past: false })));
  return rows;
}

export const GAP_FROM = 7 * 60;
export const GAP_TO = 22 * 60;
export const GAP_MIN = 120;
export const GAP_MAX_ENTRIES = 4;

/**
 * The largest free future gap of at least 2 h inside 07:00–22:00, on today or a
 * future day with at most 4 timed entries (else null). Today it starts no earlier
 * than now, rounded up to the next quarter hour. Ties go to the earliest gap.
 */
export function largestGap(events: EventLike[], day: string, today: string, now: Date): { start: number; end: number } | null {
  const rel = daysBetween(today, day);
  if (rel < 0) return null;
  const timed = events.filter((e) => !e.all_day);
  if (timed.length > GAP_MAX_ENTRIES) return null;
  let from = GAP_FROM;
  if (rel === 0) from = Math.max(from, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15);
  const busy = timed
    .map((e) => ({ start: minutesIn(day, e.starts_at), end: e.ends_at ? minutesIn(day, e.ends_at) : minutesIn(day, e.starts_at) + 60 }))
    .filter((s) => s.end > from && s.start < GAP_TO)
    .sort((a, b) => a.start - b.start);
  let best: { start: number; end: number } | null = null;
  let cursor = from;
  const consider = (end: number) => {
    if (end - cursor >= GAP_MIN && (!best || end - cursor > best.end - best.start)) best = { start: cursor, end };
  };
  for (const s of busy) {
    if (s.start > cursor) consider(Math.min(s.start, GAP_TO));
    cursor = Math.max(cursor, s.end);
    if (cursor >= GAP_TO) break;
  }
  if (cursor < GAP_TO) consider(GAP_TO);
  return best;
}

/** "14:00" for minutes since midnight */
export function hm(min: number): string {
  const m = Math.max(0, Math.min(DAY_MIN, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// ---------- Woche: the 06–22 day track ----------

export interface TrackRange {
  from: number;
  to: number;
}
export const TRACK_FROM = 6 * 60;
export const TRACK_TO = 22 * 60;

/** 06:00–22:00, widened to whole hours around the earliest start / latest end of the week's timed entries */
export function trackRange(events: EventLike[]): TrackRange {
  let from = TRACK_FROM;
  let to = TRACK_TO;
  for (const e of events) {
    if (e.all_day) continue;
    const day = dayOf(new Date(e.starts_at));
    from = Math.min(from, Math.floor(minutesIn(day, e.starts_at) / 60) * 60);
    to = Math.max(to, Math.ceil(Math.min(DAY_MIN, endIn(day, e)) / 60) * 60);
  }
  return { from: Math.max(0, from), to: Math.min(DAY_MIN, to) };
}

export interface Segment {
  id: string;
  /** 0..1 of the track */
  left: number;
  width: number;
  /** a block for a goal (accent); everything else is a plain entry */
  goal: boolean;
}

/** the timed entries of one day as segments of the track, clipped to the range */
export function weekTrack(events: EventLike[], day: string, range: TrackRange): Segment[] {
  const span = range.to - range.from;
  if (span <= 0) return [];
  const out: Segment[] = [];
  for (const e of [...events].sort(byStart)) {
    if (e.all_day) continue;
    const start = Math.max(range.from, minutesIn(day, e.starts_at));
    const end = Math.min(range.to, endIn(day, e));
    if (end <= start) continue;
    out.push({ id: e.id, left: (start - range.from) / span, width: (end - start) / span, goal: e.kind === "block" && !!e.goal_id });
  }
  return out;
}

/** where "now" sits on the track (0..1), or null outside the range */
export function nowTick(now: Date, range: TrackRange): number | null {
  const m = now.getHours() * 60 + now.getMinutes();
  if (m < range.from || m > range.to || range.to <= range.from) return null;
  return (m - range.from) / (range.to - range.from);
}

/** minutes of goal blocks on a day that have not ended yet (they are "geplant") */
export function plannedMinutes(events: EventLike[], now: Date): number {
  let sum = 0;
  for (const e of events) {
    if (e.kind !== "block" || !e.goal_id || e.all_day || !e.ends_at) continue;
    const end = Date.parse(e.ends_at);
    if (end <= now.getTime()) continue;
    sum += Math.min(DAY_MIN, Math.max(0, Math.round((end - Date.parse(e.starts_at)) / 60000)));
  }
  return sum;
}

export type WeekKind = "past" | "current" | "future";

export function weekKind(day: string, today: string): WeekKind {
  const n = daysBetween(weekStart(today), weekStart(day));
  return n < 0 ? "past" : n > 0 ? "future" : "current";
}

export const NO_GOAL_TIME = "Noch keine Zeit für Ziele geplant";

/**
 * The week's summary line: current "7 Std 45 für deine Ziele geplant, 5 Std davon geschafft",
 * past "5 Std für deine Ziele", future "3 Std für deine Ziele geplant", else "Noch keine Zeit für Ziele geplant".
 * done = time that went into goals (logged + past blocks), planned = goal blocks still ahead.
 */
export function weekSummary(kind: WeekKind, done: number, planned: number, fmt: (min: number) => string = hoursMinutes): string {
  if (kind === "past") return done > 0 ? `${fmt(done)} für deine Ziele` : NO_GOAL_TIME;
  if (kind === "future") return planned > 0 ? `${fmt(planned)} für deine Ziele geplant` : NO_GOAL_TIME;
  const total = done + planned;
  if (total <= 0) return NO_GOAL_TIME;
  return `${fmt(total)} für deine Ziele geplant${done > 0 ? `, ${fmt(done)} davon geschafft` : ""}`;
}

/** a week row's micro line: past "1 Std 45 für Ziele", future "2 Std 30 geplant", today both */
export function microLine(day: string, today: string, done: number, planned: number): { text: string; kind: "done" | "planned" }[] {
  const rel = daysBetween(today, day);
  const out: { text: string; kind: "done" | "planned" }[] = [];
  if (rel <= 0 && done > 0) out.push({ text: `${hoursMinutes(done)} für Ziele`, kind: "done" });
  if (rel >= 0 && planned > 0) out.push({ text: `${hoursMinutes(planned)} geplant`, kind: "planned" });
  return out;
}

// ---------- planning with the coach (texts match the demo coach's /(tag|woche)…planen/) ----------

const MONTHS_LONG = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WEEKDAYS_LONG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

/** "17. November" (+ " 2027" when not in today's year) */
function dateWords(day: string, today: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${d}. ${MONTHS_LONG[m - 1]}${String(y) === today.slice(0, 4) ? "" : ` ${y}`}`;
}

export function dayPlanText(day: string, today: string): string {
  const rel = daysBetween(today, day);
  if (rel === 0) return "Lass uns meinen Tag planen.";
  if (rel === 1) return "Lass uns den Tag morgen planen.";
  const wd = WEEKDAYS_LONG[(new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7];
  return `Lass uns den Tag am ${wd}, ${dateWords(day, today)} planen.`;
}

export function weekPlanText(day: string, today: string): string {
  if (weekKind(day, today) === "current") return "Lass uns meine Woche planen.";
  return `Lass uns die Woche vom ${dateWords(weekStart(day), today)} planen.`;
}

// ---------- Jahr ----------

export const MONTH_SHORT = ["JAN", "FEB", "MÄR", "APR", "MAI", "JUN", "JUL", "AUG", "SEP", "OKT", "NOV", "DEZ"];
export const MONTH_LONG = MONTHS_LONG;

/** minutes and active days of a set of days (e.g. a month "2026-11" or a year "2026" prefix) */
export function sumDays(perDay: Record<string, number>, prefix: string): { minutes: number; days: number } {
  let minutes = 0;
  let days = 0;
  for (const [d, m] of Object.entries(perDay)) {
    if (!d.startsWith(prefix) || !(m > 0)) continue;
    minutes += m;
    days++;
  }
  return { minutes, days };
}

/** short hours for labels: "45 Min", "7 Std", "212 Std" (whole hours from 1 h on) */
export function hoursShort(min: number): string {
  if (min <= 0) return "";
  if (min < 60) return `${Math.round(min)} Min`;
  return `${String(Math.round(min / 60)).replace(/\B(?=(\d{3})+(?!\d))/g, "'")} Std`;
}

/** "212 Std für deine Ziele an 143 Tagen", or the empty line */
export function yearSummary(minutes: number, days: number): string {
  if (days <= 0) return "Hier wächst dein Jahr: Jeder Tag mit Zeit für deine Ziele leuchtet.";
  return `${hoursShort(minutes)} für deine Ziele an ${days} ${days === 1 ? "Tag" : "Tagen"}`;
}

/** under an open month: "18 Tage · 24 Std für Ziele" */
export function monthSummary(minutes: number, days: number): string {
  if (days <= 0) return NO_GOAL_TIME;
  return `${days} ${days === 1 ? "Tag" : "Tage"} · ${hoursShort(minutes)} für Ziele`;
}

/** the days a range spans, from inclusive to exclusive (YYYY-MM-DD) */
export function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) out.push(d);
  return out;
}
