// What the person sees, in one line for the coach (CoachContext.view).
import { daySubline, timeHM, weekRange } from "../lib/dates";
import { addDays, dayOf, isoWeek, weekStart } from "../lib/plan";
import type { SpaceState } from "./state";

const year = (day: string) => day.slice(0, 4);
/** "Montag, 16. November 2026" (always with the year) */
const fullDay = (day: string) => daySubline(day, "0000-01-01");

/** ref = the anchor: "Samstag, 14. November", with the year only when it differs from the anchor's */
function openDetail(d: NonNullable<SpaceState["detail"]>, ref: string): string {
  if (d.kind === "event") {
    if (!d.event) return `neuer Eintrag am ${daySubline(d.day, ref)}${d.time ? `, ${d.time}` : ""}`;
    const e = d.event;
    const local = dayOf(new Date(e.starts_at));
    return `Eintrag „${e.title}“ [${e.id}] am ${daySubline(local, ref)}, ${e.all_day ? "ganztags" : timeHM(e.starts_at)}`;
  }
  if (d.kind === "goal") return d.goal ? `Ziel „${d.goal.title}“ [${d.goal.id}]` : "neues Ziel";
  return d.habit ? `Gewohnheit „${d.habit.title}“ [${d.habit.id}]` : "neue Gewohnheit";
}

/**
 * "Jetzt (Startseite mit dem Kreis)" · "Tag: Montag, 16. November 2026" ·
 * "Woche: 16.–22. November 2026 (KW 47)" · "Jahr 2026, nur Ziel „Halbmarathon Zürich“" ·
 * "Ziele" · "Du (was ich über dich weiss, Verbindungen, Einstellungen)",
 * plus " · offen: …" while a detail is open.
 */
export function describeView(s: Pick<SpaceState, "place" | "level" | "anchor" | "yearGoal" | "detail">, goalTitle: (id: string) => string | null): string {
  let view: string;
  if (s.place === "ziele") view = "Ziele";
  else if (s.place === "du") view = "Du (was ich über dich weiss, Verbindungen, Einstellungen)";
  else if (s.level === 1) view = `Tag: ${fullDay(s.anchor)}`;
  else if (s.level === 2) {
    const range = weekRange(s.anchor);
    const withYear = /\d{4}/.test(range) ? range : `${range} ${year(addDays(weekStart(s.anchor), 6))}`;
    view = `Woche: ${withYear} (KW ${isoWeek(s.anchor)})`;
  } else if (s.level === 3) {
    const title = s.yearGoal ? goalTitle(s.yearGoal) : null;
    view = `Jahr ${year(s.anchor)}${title ? `, nur Ziel „${title}“` : ""}`;
  } else view = "Jetzt (Startseite mit dem Kreis)";
  return s.detail ? `${view} · offen: ${openDetail(s.detail, s.anchor)}` : view;
}
