// The Bucket List (§2): its order and its small texts. Pure (no React, no backend),
// tested in tests/bucket.test.ts. Dreams are goals with kind "dream"; a goal without
// a kind (older data) counts as a goal.
import { dayOf, goalEffort, goalProgress, hoursLabel } from "../lib/plan";
import type { Goal } from "../lib/types";

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

export const isDream = (g: Pick<Goal, "kind">): boolean => g.kind === "dream";

/** the local day (YYYY-MM-DD) of an ISO timestamp */
export const localDayOf = (iso: string): string => dayOf(new Date(iso));

/** when a fulfilled dream came true (local day); a done dream without done_at falls back to updated_at */
export function fulfilledDay(g: Pick<Goal, "done_at" | "updated_at">): string {
  return localDayOf(g.done_at ?? g.updated_at);
}

export interface BucketParts {
  /** dreams still to live: active first, then paused (each in the backend's order) */
  open: Goal[];
  /** fulfilled dreams, newest first: they stay at the top as a memory */
  fulfilled: Goal[];
  /** concrete goals, active first, then paused */
  goals: Goal[];
  /** the fold «Abgeschlossen»: reached and dropped goals, dropped dreams (never fulfilled ones) */
  finished: Goal[];
}

export function bucketParts(all: Goal[]): BucketParts {
  const dreams = all.filter(isDream);
  const plain = all.filter((g) => !isDream(g));
  const with_ = (list: Goal[], s: Goal["status"]) => list.filter((g) => g.status === s);
  const when = (g: Goal) => g.done_at ?? g.updated_at;
  return {
    open: [...with_(dreams, "active"), ...with_(dreams, "paused")],
    fulfilled: with_(dreams, "done").sort((a, b) => when(b).localeCompare(when(a))),
    goals: [...with_(plain, "active"), ...with_(plain, "paused")],
    finished: [...with_(plain, "done"), ...with_(plain, "dropped"), ...with_(dreams, "dropped")],
  };
}

/** "März 2026" */
export function monthYear(day: string): string {
  return `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(0, 4))}`;
}

/** "erfüllt im März 2026" (the Bucket List), capitalised for a line of its own */
export function fulfilledLabel(g: Pick<Goal, "done_at" | "updated_at">, capital = false): string {
  return `${capital ? "Erfüllt" : "erfüllt"} im ${monthYear(fulfilledDay(g))}`;
}

/** a dream's time: "Februar 2027"; the last day of a year means "some time that year": "2027" */
export function dreamWhen(targetDate: string | null): string | null {
  if (!targetDate) return null;
  if (targetDate.slice(5) === "12-31") return targetDate.slice(0, 4);
  return monthYear(targetDate);
}

/** the quiet progress line of a dream with a plan ("1 von 3 Etappen · als Nächstes: Flug buchen"), else null */
export function dreamPlanLine(g: Goal, today: string): string | null {
  const p = goalProgress(g, today);
  const e = goalEffort(g, today);
  const parts: string[] = [];
  if (p.total > 0) parts.push(`${p.done} von ${p.total} ${p.total === 1 ? "Etappe" : "Etappen"}`);
  if (e.effort !== null) parts.push(`${hoursLabel(e.done)} von ≈ ${hoursLabel(e.effort)} Std`);
  else if (e.done > 0) parts.push(`${hoursLabel(e.done)} Std investiert`);
  if (p.next) parts.push(`als Nächstes: ${p.next.title}`);
  return parts.length ? parts.join(" · ") : null;
}

/** what the coach hears when the person wants to tell how a fulfilled dream was */
export function tellText(title: string): string {
  return `Mein Traum „${title.trim()}“ ist wahr geworden. Ich erzähle dir, wie es war.`;
}

// ---------- Jahr (§3) ----------

/** «Noch offen in 2026»: active dreams and goals with a target date in that year, by date */
export function openInYear(all: Goal[], year: number): Goal[] {
  const prefix = `${String(year).padStart(4, "0")}-`;
  return all
    .filter((g) => g.status === "active" && !!g.target_date?.startsWith(prefix))
    .sort((a, b) => a.target_date!.localeCompare(b.target_date!) || a.title.localeCompare(b.title));
}

/** «Erfüllt in 2026»: dreams fulfilled in that year (local day), in the order they came true */
export function fulfilledInYear(all: Goal[], year: number): Goal[] {
  const prefix = `${String(year).padStart(4, "0")}-`;
  return all
    .filter((g) => isDream(g) && g.status === "done" && fulfilledDay(g).startsWith(prefix))
    .sort((a, b) => fulfilledDay(a).localeCompare(fulfilledDay(b)));
}

/** "Erfüllt in 2025: 2 Träume" (a past year with fulfilled dreams), else null */
export function fulfilledYearLine(count: number, year: number): string | null {
  if (count <= 0) return null;
  return `Erfüllt in ${year}: ${count} ${count === 1 ? "Traum" : "Träume"}`;
}

/** "Noch 46 Tage in 2026"; on the last day "Der letzte Tag in 2026" */
export function daysLeftLine(leftDays: number, year: number): string {
  if (leftDays <= 0) return `Der letzte Tag in ${year}`;
  return `Noch ${leftDays} ${leftDays === 1 ? "Tag" : "Tage"} in ${year}`;
}
