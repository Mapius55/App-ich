import type { CalendarEvent } from "./types";

export function eventWhen(e: Pick<CalendarEvent, "starts_at" | "all_day">): string {
  const d = new Date(e.starts_at);
  const day = new Intl.DateTimeFormat("de-CH", { weekday: "short", day: "numeric", month: "long" }).format(d);
  if (e.all_day) return `${day} · ganztägig`;
  const time = new Intl.DateTimeFormat("de-CH", { hour: "2-digit", minute: "2-digit" }).format(d);
  return `${day} · ${time}`;
}

export function dayHeading(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Heute";
  if (same(d, tomorrow)) return "Morgen";
  return new Intl.DateTimeFormat("de-CH", { weekday: "long", day: "numeric", month: "long" }).format(d);
}

// ---------- Plan: local days ("YYYY-MM-DD") and times ----------

const WEEKDAYS_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONTHS_SHORT = ["Jan", "Feb", "März", "Apr", "Mai", "Juni", "Juli", "Aug", "Sept", "Okt", "Nov", "Dez"];

/** A local day as a Date at noon (noon keeps it on the same day across DST changes). */
export function dayDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

/** "Mo" … "So" for a day */
export function weekdayShort(day: string): string {
  return WEEKDAYS_SHORT[(dayDate(day).getDay() + 6) % 7];
}

/** "So, 6. Dez" (Intl adds dots after every abbreviation, which reads busy in a meta line) */
export function shortDay(day: string): string {
  const d = dayDate(day);
  return `${weekdayShort(day)}, ${d.getDate()}. ${MONTHS_SHORT[d.getMonth()]}`;
}

/** "Samstag, 14. November" */
export function longDay(day: string): string {
  return new Intl.DateTimeFormat("de-CH", { weekday: "long", day: "numeric", month: "long" }).format(dayDate(day));
}

/** "November 2026" */
export function monthTitle(day: string): string {
  return new Intl.DateTimeFormat("de-CH", { month: "long", year: "numeric" }).format(dayDate(day));
}

/** "09:30" in local time */
export function timeHM(iso: string): string {
  return new Intl.DateTimeFormat("de-CH", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** ISO (UTC) of local midnight at the start of a day; all-day entries are stored like this. */
export function localMidnightIso(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toISOString();
}
