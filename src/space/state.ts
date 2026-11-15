// The shared contract of the space (phase 0, frozen): types, the context hook,
// hash routing and the pure "is the coach's change visible here?" check.
import { createContext, useContext } from "react";
import type { CalendarEvent, CoachEvent, Goal, Habit } from "../lib/types";
import { addDays, daysBetween, weekStart } from "../lib/plan";

export type Place = "du" | "jetzt" | "ziele";
export type Level = 0 | 1 | 2 | 3; // 0 Jetzt, 1 Tag, 2 Woche, 3 Jahr
export type TourStep = 1 | 2 | 3 | 4;
export type DuSection = "memories" | "body" | "connections" | "notifications" | "settings";
export type AddKey = "tag" | "woche" | "ziele" | "du";
export type CloseVia = "done" | "escape" | "backdrop" | "pull" | "nav";

export type Detail =
  | { kind: "event"; event: CalendarEvent | null; day: string; time?: string } // time "HH:MM" preset for a new entry
  | { kind: "goal"; goal: Goal | null; focusEffort?: boolean }
  | { kind: "habit"; habit: Habit | null };

export type Target =
  | { kind: "event"; id: string; day: string }
  | { kind: "goal"; id: string }
  | { kind: "habit"; id: string };

export interface SpaceState {
  place: Place; // settled
  level: Level; // settled level of the time column (kept while on a side)
  anchor: string; // YYYY-MM-DD: Tag shows it, Woche its week, Jahr its year
  today: string;
  yearGoal: string | null; // Jahr filtered to one goal
  detail: Detail | null;
  detailOrigin: HTMLElement | null;
  /** the Du row asked for by go("du", { duSection }) or a deep link; Du opens it on every request */
  duSection: DuSection | null;
  /** counts those requests: the same row asked for again (e.g. a second "Verbindungen ansehen") opens it again */
  duRequest: number;
  tour: TourStep | null;
  highlight: string | null; // id that glows once; cleared after 1.6 s
  typing: boolean;
  reduced: boolean; // prefers-reduced-motion
}

/**
 * The object useSpace() returns. The state fields change with every update; the
 * functions keep their identity for the lifetime of <Space>, so effects can depend
 * on them (e.g. `const { registerAdd } = useSpace()`), never on the whole object.
 */
export interface SpaceApi extends SpaceState {
  /** resolve after settle; while a detail is open they first call close("nav") and abort on false */
  go(place: Place, o?: { highlight?: string; duSection?: DuSection }): Promise<void>;
  goLevel(level: Level, o?: { day?: string; highlight?: string; yearGoal?: string | null }): Promise<void>;
  setAnchor(day: string): void;
  setYearGoal(id: string | null): void;
  open(d: Detail, origin?: HTMLElement | null): void;
  /** asks the registered closer; on true Space sets detail = null. Without a closer it just closes. */
  close(via?: CloseVia): Promise<boolean>;
  /** Unfold registers itself; its closer resolves true once saved and collapsed, false to stay open */
  registerCloser(fn: ((via: CloseVia) => Promise<boolean>) | null): void;
  flash(id: string): void;
  /** dock "+" shows only when the current key has a handler */
  registerAdd(key: AddKey, fn: (() => void) | null): void;
  /** unlockAudio() + coachBus.ask() */
  ask(text: string): void;
  startTour(): void;
  /** null ends the tour (Space then also calls markTourSeen()) */
  setTour(step: TourStep | null): void;
  /** Du reports the row that is open (by hand, the dock "+", a deep link): the hash follows ("#du/verbindungen") */
  setDuOpen(section: DuSection | null): void;
}

export const SpaceContext = createContext<SpaceApi | null>(null);
export function useSpace(): SpaceApi {
  const s = useContext(SpaceContext);
  if (!s) throw new Error("useSpace() outside <Space>");
  return s;
}

// ---------- hash routing (replaceState only) ----------

const DU_SLUGS: Record<DuSection, string> = {
  memories: "wissen",
  body: "koerper",
  connections: "verbindungen",
  notifications: "benachrichtigungen",
  settings: "einstellungen",
};

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function validDay(s: string): boolean {
  const m = DAY_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** the same month and day in another year (29 February → 28 February) */
export function sameDayInYear(day: string, year: number): string {
  const md = day.slice(5);
  const y = String(year).padStart(4, "0");
  return validDay(`${y}-${md}`) ? `${y}-${md}` : `${y}-02-28`;
}

/** "#tag/2026-11-15", "#woche/2026-11-16" (Monday), "#jahr/2026", "#ziele", "#du", "#du/verbindungen", "" for Jetzt */
export function toHash(s: Pick<SpaceState, "place" | "level" | "anchor" | "duSection">): string {
  if (s.place === "ziele") return "#ziele";
  if (s.place === "du") return s.duSection ? `#du/${DU_SLUGS[s.duSection]}` : "#du";
  if (s.level === 1) return `#tag/${s.anchor}`;
  if (s.level === 2) return `#woche/${weekStart(s.anchor)}`;
  if (s.level === 3) return `#jahr/${s.anchor.slice(0, 4)}`;
  return "";
}

/**
 * The place a hash points to. "" and "#jetzt" → Jetzt. A week resolves to today
 * when today is in it (else its Monday); a year to today's date in that year.
 * A query after the place ("?…") is ignored. Anything unknown or invalid → null.
 */
export function fromHash(hash: string, today: string): Pick<SpaceState, "place" | "level" | "anchor" | "duSection"> | null {
  // a query after the place belongs to someone else (e.g. "#du/verbindungen?whoop=confirm&code=…")
  let h: string;
  try {
    h = decodeURIComponent(hash.replace(/^#/, "").split("?")[0]).trim().toLowerCase();
  } catch {
    return null; // a malformed escape
  }
  const at = (place: Place, level: Level, anchor = today, duSection: DuSection | null = null) => ({ place, level, anchor, duSection });
  if (h === "" || h === "jetzt") return at("jetzt", 0);
  if (h === "ziele") return at("ziele", 0);
  if (h === "du") return at("du", 0);
  const [head, arg, ...rest] = h.split("/");
  if (rest.length || arg === undefined) return null;
  if (head === "du") {
    const section = (Object.keys(DU_SLUGS) as DuSection[]).find((k) => DU_SLUGS[k] === arg);
    return section ? at("du", 0, today, section) : null;
  }
  if (head === "tag") return validDay(arg) ? at("jetzt", 1, arg) : null;
  if (head === "woche") {
    if (!validDay(arg)) return null;
    const monday = weekStart(arg);
    return at("jetzt", 2, weekStart(today) === monday ? today : monday);
  }
  if (head === "jahr") {
    if (!/^\d{4}$/.test(arg)) return null;
    const year = Number(arg);
    return at("jetzt", 3, year === Number(today.slice(0, 4)) ? today : sameDayInYear(today, year));
  }
  return null;
}

// ---------- coach changes: glow instead of toast ----------

function detailShows(t: Target, d: Detail | null): boolean {
  if (!d) return false;
  if (t.kind === "event") return d.kind === "event" && d.event?.id === t.id;
  if (t.kind === "goal") return d.kind === "goal" && d.goal?.id === t.id;
  return d.kind === "habit" && d.habit?.id === t.id;
}

/**
 * Is the coach's change already visible where the person is? (glow instead of toast)
 * With a detail open the world is dimmed: only the open item itself counts.
 */
export function showsTarget(t: Target, s: Pick<SpaceState, "place" | "level" | "anchor" | "detail">): boolean {
  if (s.detail) return detailShows(t, s.detail);
  if (t.kind === "event") {
    if (s.place !== "jetzt") return false;
    if (s.level === 1) return t.day === s.anchor;
    if (s.level === 2) return weekStart(t.day) === weekStart(s.anchor);
    return false;
  }
  return s.place === "ziele";
}

/** what a coach event points at (for the glow, the toast's "Ansehen"); null when there's nothing to show */
export function targetOf(e: CoachEvent, dayOfIso: (iso: string) => string): Target | null {
  switch (e.type) {
    case "event_created":
    case "event_updated":
      return { kind: "event", id: e.event.id, day: dayOfIso(e.event.starts_at) };
    case "goal_saved":
      return { kind: "goal", id: e.goal.id };
    case "time_logged":
      return { kind: "goal", id: e.goal_id };
    case "habit_saved":
      return { kind: "habit", id: e.habit.id };
    case "habit_logged":
      return { kind: "habit", id: e.habit_id };
    default:
      return null;
  }
}

// ---------- small shared helpers for the time levels ----------

/** the anchor moved by one period of a level: Tag ±1 day, Woche ±7 days, Jahr ±1 year (same date, clamped) */
export function stepAnchor(anchor: string, level: Level, dir: -1 | 1): string {
  if (level === 1) return addDays(anchor, dir);
  if (level === 2) return addDays(anchor, 7 * dir);
  if (level === 3) return sameDayInYear(anchor, Number(anchor.slice(0, 4)) + dir);
  return anchor;
}

/** is the anchor's period (day, week, year of the level) the one that holds today? */
export function anchorIsCurrent(anchor: string, today: string, level: Level): boolean {
  if (level === 2) return daysBetween(weekStart(today), weekStart(anchor)) === 0;
  if (level === 3) return anchor.slice(0, 4) === today.slice(0, 4);
  return anchor === today;
}
