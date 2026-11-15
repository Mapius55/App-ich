import type { CalendarEvent } from "./types";
import { addDays, daysBetween, isoWeek, weekStart } from "./plan";

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

/** minutes → "45 Min", "1 Std", "1.5 Std" */
export function minutesLabel(min: number): string {
  if (min < 60) return `${Math.max(0, Math.round(min))} Min`;
  const h = Math.round((min / 60) * 10) / 10;
  return `${String(h)} Std`;
}

// ---------- The space: titles and sublines for Tag, Woche, Jahr ----------

const WEEKDAYS_LONG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const MONTHS_LONG = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

const parts = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return { y, m, d };
};
const weekdayLong = (day: string) => WEEKDAYS_LONG[(dayDate(day).getDay() + 6) % 7];

/** "HEUTE" | "MORGEN" | "GESTERN" | "MITTWOCH" */
export function dayTitle(day: string, today: string): string {
  const n = daysBetween(today, day);
  if (n === 0) return "HEUTE";
  if (n === 1) return "MORGEN";
  if (n === -1) return "GESTERN";
  return weekdayLong(day).toUpperCase();
}

/** "Samstag, 14. November" (+ " 2027" when the day is in another year than today) */
export function daySubline(day: string, today: string): string {
  const { y, m, d } = parts(day);
  const s = `${weekdayLong(day)}, ${d}. ${MONTHS_LONG[m - 1]}`;
  return y === parts(today).y ? s : `${s} ${y}`;
}

/** "16.–22. November" | "30. November – 6. Dezember" | "28. Dezember 2026 – 3. Januar 2027" (the week of the day) */
export function weekRange(day: string): string {
  const a = parts(weekStart(day));
  const b = parts(addDays(weekStart(day), 6));
  if (a.y !== b.y) return `${a.d}. ${MONTHS_LONG[a.m - 1]} ${a.y} – ${b.d}. ${MONTHS_LONG[b.m - 1]} ${b.y}`;
  if (a.m !== b.m) return `${a.d}. ${MONTHS_LONG[a.m - 1]} – ${b.d}. ${MONTHS_LONG[b.m - 1]}`;
  return `${a.d}.–${b.d}. ${MONTHS_LONG[a.m - 1]}`;
}

/** "DIESE WOCHE" | "NÄCHSTE WOCHE" | "LETZTE WOCHE" | "KW 48" */
export function weekTitle(day: string, today: string): string {
  const n = Math.round(daysBetween(weekStart(today), weekStart(day)) / 7);
  if (n === 0) return "DIESE WOCHE";
  if (n === 1) return "NÄCHSTE WOCHE";
  if (n === -1) return "LETZTE WOCHE";
  return `KW ${isoWeek(day)}`;
}

const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "'");

/** minutes → "7 Std 45" | "2 Std" | "45 Min" (whole minutes) */
export function hoursMinutes(min: number): string {
  const total = Math.max(0, Math.round(min));
  if (total < 60) return `${total} Min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${thousands(h)} Std ${m}` : `${thousands(h)} Std`;
}

/** minutes for screen readers → "45 Minuten" | "1 Minute" | "1 Stunde" | "1 Stunde 45" | "7 Stunden 45" */
export function spokenMinutes(min: number): string {
  const total = Math.max(0, Math.round(min));
  if (total < 60) return total === 1 ? "1 Minute" : `${total} Minuten`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  const hours = h === 1 ? "1 Stunde" : `${thousands(h)} Stunden`;
  return m ? `${hours} ${m}` : hours;
}
