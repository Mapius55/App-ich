// Formatting of dates and durations, German as written in Switzerland.

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"] as const;
const WEEKDAYS_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"] as const;

/** "Donnerstag, 26. November" */
export function longDate(date: Date = new Date()): string {
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()}. ${MONTHS[date.getMonth()]}`;
}

/** "26. November 2026" */
export function fullDate(date: Date): string {
  return `${date.getDate()}. ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "26.11." */
export function shortDate(date: Date): string {
  return `${date.getDate()}.${date.getMonth() + 1}.`;
}

/** "Do" for a Date or for a day key (YYYY-MM-DD). */
export function weekdayShort(day: Date | string): string {
  return WEEKDAYS_SHORT[toDate(day).getDay()] ?? "";
}

/** "Donnerstag" for a Date or for a day key (YYYY-MM-DD). */
export function weekdayLong(day: Date | string): string {
  return WEEKDAYS[toDate(day).getDay()] ?? "";
}

/** A local Date from a day key (YYYY-MM-DD), at noon so that no time zone can shift the day. */
export function toDate(day: Date | string): Date {
  if (day instanceof Date) return day;
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12);
}

// durations: one implementation for the whole app, from the session logic
//   formatMinutes(seconds)  "12 Min", under a minute "45 Sek"
//   formatDuration(seconds) "3 Std 20 Min" for totals
//   formatClock(seconds)    "1:05"
export { formatClock, formatDuration, formatMinutes } from "./logic/plan.ts";

/** Local day of a Date as YYYY-MM-DD (the format of HistoryEntry.day). */
export { dayKey } from "./logic/stats.ts";

/** The length of one hold: "45 Sek" below one minute, otherwise "1:30 Min" or "2 Min" */
export function holdLabel(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} Sek`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s ? `${m}:${String(s).padStart(2, "0")} Min` : `${m} Min`;
}

/** 1 Übung, 2 Übungen; 1 Tag, 2 Tage */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
