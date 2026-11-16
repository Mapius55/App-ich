// The colour-flow wash over a dream that just came true (§2). A dream fulfilled a
// moment ago (by the coach or by hand) washes once, the first time it is seen on the
// Bucket List; the goal detail marks the ones it already washed, so they don't twice.
import { useEffect, useRef, useState } from "react";
import type { Goal } from "../lib/types";

/** how long a fulfilled dream counts as "just now" */
export const WASH_RECENT = 2 * 60 * 1000;
/** the wash's length (CSS .bl-wash, keep in sync) */
export const WASH_MS = 1800;

const washed = new Set<string>();
/** fulfilled by the coach just now (goal_saved with fulfilled), whatever date it came true on */
const pending = new Set<string>();

/** done a moment ago (or just fulfilled by the coach) and not washed yet */
export function wantsWash(g: Pick<Goal, "id" | "kind" | "status" | "done_at">, now: number): boolean {
  if (g.kind !== "dream" || g.status !== "done" || washed.has(g.id)) return false;
  if (pending.has(g.id)) return true;
  if (!g.done_at) return false;
  const age = now - Date.parse(g.done_at);
  return age >= -WASH_RECENT && age < WASH_RECENT;
}

/** the coach fulfilled it in this conversation: it washes once when it is next seen (again, if it
 * was reopened and has come true once more) */
export function requestWash(id: string): void {
  washed.delete(id);
  pending.add(id);
}

export function markWashed(id: string): void {
  washed.add(id);
  pending.delete(id);
}

/** for tests only */
export function resetWashedForTests(): void {
  washed.clear();
  pending.clear();
}

/** true while the wash runs: once `visible`, a dream that wants it washes (never under reduced motion) */
export function useWash(g: Goal, visible: boolean, reduced: boolean): boolean {
  const [on, setOn] = useState(false);
  const timer = useRef(0);
  useEffect(() => {
    if (!visible || !wantsWash(g, Date.now())) return;
    markWashed(g.id);
    if (reduced) return;
    setOn(true);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOn(false), WASH_MS);
  }, [visible, reduced, g]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return on;
}
