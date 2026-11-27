// Kehrwasser: from a list of exercises to the steps of a session. Pure: no clock, no DOM.
// The rhythm lives here: with "gleichmässig" on, every hold lasts the same, left and right are
// always equal, and every change of position gets the same pause.
import type { ExerciseText, RoutineItem, SessionPlan, SessionStep, Settings, Side } from "../types.ts";

export type ExerciseLookup = (id: string) => ExerciseText | undefined;

export interface PlanInput {
  /** routine id, or "mix" for a generated session */
  source: string;
  title: string;
  items: RoutineItem[];
}

/** the first countdown ("get into position") is never shorter than this */
export const MIN_READY_SECONDS = 5;

function whole(n: number | undefined, min: number, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return Math.max(min, Math.round(fallback));
  return Math.max(min, Math.round(n));
}

/**
 * Seconds for ONE side of an exercise (or in total if it is not unilateral).
 * Gleichmässig on: statisch → holdSeconds, dynamisch/aktiv → moveSeconds.
 * Off: the routine's own seconds, else the exercise's suggestion.
 */
export function stepSeconds(e: ExerciseText, item: RoutineItem, settings: Settings): number {
  if (settings.uniform) {
    return whole(e.kind === "statisch" ? settings.holdSeconds : settings.moveSeconds, 1, 45);
  }
  const own = item.seconds;
  const usable = typeof own === "number" && Number.isFinite(own) && own >= 1;
  return whole(usable ? own : e.seconds, 1, 45);
}

/** seconds of the countdown before the first exercise */
export function readySeconds(settings: Settings): number {
  return Math.max(MIN_READY_SECONDS, whole(settings.transitionSeconds, 0, 8));
}

/** seconds to change position between two exercises */
export function gapSeconds(settings: Settings): number {
  return whole(settings.transitionSeconds, 0, 8);
}

/** seconds to switch sides within one exercise */
export function sideSwitchSeconds(settings: Settings): number {
  return whole(settings.switchSeconds, 0, 5);
}

/** Seconds one exercise takes as a whole: both sides and the switch between them if it is unilateral. */
export function exerciseSeconds(e: ExerciseText, item: RoutineItem, settings: Settings): number {
  const one = stepSeconds(e, item, settings);
  return e.unilateral ? one * 2 + sideSwitchSeconds(settings) : one;
}

/**
 * The steps of a session:
 *   ready, then per exercise either one step (side null) or first side, switch, other side,
 *   and between two exercises a transition "next".
 * index/of count exercises, not sides. Unknown ids are skipped. A pause of 0 seconds is left out.
 * Without any known exercise the plan is empty (no steps, 0 seconds).
 */
export function buildPlan(input: PlanInput, settings: Settings, lookup: ExerciseLookup): SessionPlan {
  const known: { item: RoutineItem; e: ExerciseText }[] = [];
  for (const item of input.items) {
    const e = lookup(item.exercise);
    if (e) known.push({ item, e });
  }
  const of = known.length;
  const first: Side = settings.firstSide === "R" ? "R" : "L";
  const second: Side = first === "L" ? "R" : "L";
  const ready = readySeconds(settings);
  const gap = gapSeconds(settings);
  const swap = sideSwitchSeconds(settings);

  const steps: SessionStep[] = [];
  known.forEach(({ item, e }, i) => {
    const seconds = stepSeconds(e, item, settings);
    const index = i + 1;
    const startSide: Side | null = e.unilateral ? first : null;
    if (i === 0) {
      steps.push({ type: "ready", seconds: ready, next: { exercise: e.id, side: startSide } });
    } else if (gap > 0) {
      steps.push({ type: "transition", reason: "next", seconds: gap, next: { exercise: e.id, side: startSide } });
    }
    if (e.unilateral) {
      steps.push({ type: "exercise", exercise: e.id, side: first, seconds, index, of });
      if (swap > 0) {
        steps.push({ type: "transition", reason: "switch", seconds: swap, next: { exercise: e.id, side: second } });
      }
      steps.push({ type: "exercise", exercise: e.id, side: second, seconds, index, of });
    } else {
      steps.push({ type: "exercise", exercise: e.id, side: null, seconds, index, of });
    }
  });

  let seconds = 0;
  for (const step of steps) seconds += step.seconds;
  return { source: input.source, title: input.title, steps, seconds };
}

/** The total of buildPlan(...).seconds without building the steps. */
export function planSeconds(items: RoutineItem[], settings: Settings, lookup: ExerciseLookup): number {
  let count = 0;
  let seconds = 0;
  for (const item of items) {
    const e = lookup(item.exercise);
    if (!e) continue;
    count += 1;
    seconds += exerciseSeconds(e, item, settings);
  }
  if (count === 0) return 0;
  return readySeconds(settings) + seconds + (count - 1) * gapSeconds(settings);
}

/** "12 Min", under a minute "45 Sek". */
export function formatMinutes(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  if (s < 60) return `${s} Sek`;
  return `${Math.round(s / 60)} Min`;
}

/** "3 Std 20 Min" for the big totals, "12 Min" and "45 Sek" below an hour. */
export function formatDuration(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  if (s < 3600) return formatMinutes(s);
  const minutes = Math.round(s / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} Std` : `${h} Std ${m} Min`;
}

/** "1:05" (minutes:seconds), for the time left in a session. */
export function formatClock(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : 0;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}:${rest < 10 ? "0" : ""}${rest}`;
}
