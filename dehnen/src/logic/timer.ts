// Kehrwasser: the player's clock as a pure state machine. It never reads the time itself:
// every function gets `now` (milliseconds, e.g. Date.now()). Because the state only keeps
// timestamps, it survives a sleeping screen or a tab in the background: tick() catches up.
import type { HistoryEntry, Region, SessionPlan, SessionStep } from "../types.ts";
import type { ExerciseLookup } from "./plan.ts";

export interface PlayerState {
  plan: SessionPlan;
  /** index into plan.steps */
  index: number;
  /** ms, when the current step started, adjusted for pauses */
  startedAt: number;
  /** ms, when the pause began; null while running */
  pausedAt: number | null;
  done: boolean;
  /** seconds actually spent per exercise step, keyed by the step's index in plan.steps (steps that were left; the running one is added by summary()) */
  spent: Record<number, number>;
}

export interface PlayerView {
  /** the current step; null once the session is done (or the plan is empty) */
  step: SessionStep | null;
  /** whole seconds left in the current step (rounded up) */
  remaining: number;
  /** 0..1 of the current step */
  fraction: number;
  /** seconds of the whole plan that lie behind the current moment (jumps when a step is skipped) */
  elapsed: number;
  /** seconds of the whole plan */
  total: number;
  paused: boolean;
  done: boolean;
  /** 1-based number of the exercise that is running or comes next; 0 for an empty plan */
  exerciseIndex: number;
  exerciseCount: number;
  /** the next exercise step after the current step; null at the end */
  upcoming: SessionStep | null;
}

/** "back" within the first seconds of an exercise goes to the one before; later it restarts the current one */
export const PREV_RESTART_AFTER_SECONDS = 3;

function stepElapsed(s: PlayerState, now: number): number {
  return Math.max(0, ((s.pausedAt ?? now) - s.startedAt) / 1000);
}

/** `spent` after leaving the current step at this moment. */
function leave(s: PlayerState, now: number): Record<number, number> {
  const step = s.plan.steps[s.index];
  if (!step || step.type !== "exercise") return s.spent;
  const seconds = Math.min(step.seconds, stepElapsed(s, now));
  if (seconds <= 0) return s.spent;
  return { ...s.spent, [s.index]: (s.spent[s.index] ?? 0) + seconds };
}

function exerciseAfter(plan: SessionPlan, index: number): number {
  for (let i = index + 1; i < plan.steps.length; i++) if (plan.steps[i].type === "exercise") return i;
  return -1;
}

function exerciseBefore(plan: SessionPlan, index: number): number {
  for (let i = Math.min(index, plan.steps.length) - 1; i >= 0; i--) if (plan.steps[i].type === "exercise") return i;
  return -1;
}

function exerciseCountOf(plan: SessionPlan): number {
  let count = 0;
  for (const step of plan.steps) if (step.type === "exercise" && step.index > count) count = step.index;
  return count;
}

export function start(plan: SessionPlan, now: number): PlayerState {
  return { plan, index: 0, startedAt: now, pausedAt: null, done: plan.steps.length === 0, spent: {} };
}

/**
 * Advance through every step that has run out, also several at once after a long sleep.
 * The overflow carries into the next step, so the rhythm stays exact. Sets done at the end.
 * Does nothing while paused. Returns the same object when nothing changed.
 */
export function tick(s: PlayerState, now: number): PlayerState {
  if (s.done || s.pausedAt !== null) return s;
  const steps = s.plan.steps;
  let index = s.index;
  let startedAt = s.startedAt;
  let spent = s.spent;
  while (index < steps.length) {
    const step = steps[index];
    const length = Math.max(0, step.seconds) * 1000;
    if (now - startedAt < length) break;
    if (step.type === "exercise" && step.seconds > 0) {
      spent = { ...spent, [index]: (spent[index] ?? 0) + step.seconds };
    }
    startedAt += length;
    index += 1;
  }
  if (index === s.index) return s;
  if (index >= steps.length) return { ...s, index: Math.max(0, steps.length - 1), startedAt, spent, done: true };
  return { ...s, index, startedAt, spent };
}

export function pause(s: PlayerState, now: number): PlayerState {
  const t = tick(s, now);
  if (t.done || t.pausedAt !== null) return t;
  return { ...t, pausedAt: now };
}

export function resume(s: PlayerState, now: number): PlayerState {
  if (s.done || s.pausedAt === null) return s;
  return { ...s, startedAt: s.startedAt + Math.max(0, now - s.pausedAt), pausedAt: null };
}

export function toggle(s: PlayerState, now: number): PlayerState {
  return s.pausedAt === null ? pause(s, now) : resume(s, now);
}

/** Skip to the next step: from an exercise into the pause that follows it, from a pause (or "ready") straight into its exercise. A paused player stays paused. */
export function next(s: PlayerState, now: number): PlayerState {
  const t = tick(s, now);
  if (t.done) return t;
  const spent = leave(t, now);
  const index = t.index + 1;
  if (index >= t.plan.steps.length) return { ...t, spent, pausedAt: null, done: true };
  return { ...t, index, startedAt: now, pausedAt: t.pausedAt === null ? null : now, spent };
}

/**
 * Back: restart the current exercise step, or, if it has run for less than 3 seconds (or the
 * current step is a pause), go to the exercise step before it. Without one, the current step restarts.
 * The time already spent stays counted. A paused player stays paused.
 */
export function prev(s: PlayerState, now: number): PlayerState {
  const t = tick(s, now);
  if (t.done) return t;
  const step = t.plan.steps[t.index];
  let index = t.index;
  if (step.type !== "exercise" || stepElapsed(t, now) < PREV_RESTART_AFTER_SECONDS) {
    const before = exerciseBefore(t.plan, t.index);
    if (before !== -1) index = before;
  }
  return { ...t, index, startedAt: now, pausedAt: t.pausedAt === null ? null : now, spent: leave(t, now) };
}

/**
 * Extend the current step by some seconds. Negative shortens it, but never below what has
 * already passed (the step then ends at the next tick, and the following one starts fresh).
 */
export function addTime(s: PlayerState, seconds: number, now: number): PlayerState {
  const t = tick(s, now);
  if (t.done || !Number.isFinite(seconds) || seconds === 0) return t;
  const step = t.plan.steps[t.index];
  const length = Math.max(1, Math.ceil(stepElapsed(t, now) - 1e-9), Math.round(step.seconds + seconds));
  if (length === step.seconds) return t;
  const steps = t.plan.steps.slice();
  steps[t.index] = { ...step, seconds: length };
  return { ...t, plan: { ...t.plan, steps, seconds: t.plan.seconds + (length - step.seconds) } };
}

/** What the player shows at this moment. Never changes the state: call tick() first. */
export function view(s: PlayerState, now: number): PlayerView {
  const { plan } = s;
  const exerciseCount = exerciseCountOf(plan);
  if (s.done || plan.steps.length === 0) {
    return { step: null, remaining: 0, fraction: 1, elapsed: plan.seconds, total: plan.seconds, paused: false, done: true, exerciseIndex: exerciseCount, exerciseCount, upcoming: null };
  }
  const step = plan.steps[s.index];
  const inStep = Math.min(step.seconds, stepElapsed(s, now));
  let before = 0;
  for (let i = 0; i < s.index; i++) before += plan.steps[i].seconds;
  const nextExercise = exerciseAfter(plan, s.index);
  const upcoming = nextExercise === -1 ? null : plan.steps[nextExercise];
  let exerciseIndex = 0;
  if (step.type === "exercise") exerciseIndex = step.index;
  else if (upcoming && upcoming.type === "exercise") exerciseIndex = upcoming.index;
  else exerciseIndex = exerciseCount;
  return {
    step,
    remaining: Math.max(0, Math.ceil(step.seconds - inStep - 1e-9)),
    fraction: step.seconds > 0 ? Math.min(1, Math.max(0, inStep / step.seconds)) : 1,
    elapsed: before + inStep,
    total: plan.seconds,
    paused: s.pausedAt !== null,
    done: false,
    exerciseIndex,
    exerciseCount,
    upcoming,
  };
}

/**
 * The history entry of this session (without id, at and day): the seconds really spent per exercise
 * (both sides together, pauses and skipped parts left out) and per main region.
 * completed = went through to the end.
 */
export function summary(s: PlayerState, now: number, lookup: ExerciseLookup): Omit<HistoryEntry, "id" | "at" | "day"> {
  const spent = s.done ? s.spent : leave(s, now);
  const perExercise = new Map<string, number>();
  s.plan.steps.forEach((step, i) => {
    if (step.type !== "exercise") return;
    const seconds = spent[i] ?? 0;
    if (seconds <= 0) return;
    perExercise.set(step.exercise, (perExercise.get(step.exercise) ?? 0) + seconds);
  });
  const exercises: { id: string; seconds: number }[] = [];
  const regions: Partial<Record<Region, number>> = {};
  let total = 0;
  for (const [id, raw] of perExercise) {
    const seconds = Math.round(raw);
    if (seconds <= 0) continue;
    exercises.push({ id, seconds });
    total += seconds;
    const region = lookup(id)?.regions[0];
    if (region) regions[region] = (regions[region] ?? 0) + seconds;
  }
  return { source: s.plan.source, title: s.plan.title, seconds: total, completed: s.done, exercises, regions };
}
