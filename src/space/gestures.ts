// Gesture constants and the one place that decides which horizontal handler is live (D1).
import type { Level, SpaceState } from "./state";

export const AXIS_SLOP = 10; // px before deciding the axis
export const AXIS_RATIO = 1.2; // horizontal if |dx| > 1.2·|dy| at decision time, then setPointerCapture
export const PAGER_ENABLE_SCROLLY = 8;
export const PAGER_COMMIT_RATIO = 0.28; // of viewport width (≈109 px on 390)
export const FLICK_V = 0.45; // px/ms release velocity…
export const FLICK_MIN_DX = 24; // …with at least this travel
export const SETTLE_MIN = 220,
  SETTLE_MAX = 460; // ms = clamp(remaining/|v|)
export const CANCEL_MS = 280; // spring back
export const RUBBER = 0.3; // beyond the ends
export const EDGE_GUARD = 20; // px, Safari tab mode only
export const DISCRETE_FOLLOW = 0.5,
  DISCRETE_CAP = 80; // time paging: content follows ×0.5, max 80 px
export const DISCRETE_COMMIT = 60,
  DISCRETE_V = 0.4; // px / px·ms⁻¹
export const PULL_CLOSE = 96,
  PULL_V = 0.6; // Unfold pull-down
export const SETTLE_IDLE = 140; // ms without scroll = settled (when scrollend is missing)
export const STILL_VALVE = 1500; // ms: busy with no touch and no scroll this long = still (motion.ts)
export const RESUME_KEEP_MS = 30 * 60 * 1000;
export const SIDEWAYS: "cross" | "everywhere" = "cross"; // D1 switch

type Gate = Pick<SpaceState, "place" | "level" | "detail" | "typing">;

/** the Du ↔ Jetzt ↔ Ziele pager. cross: on a side, or at Jetzt settled near the top; never with a detail or typing */
export function pagerEnabled(s: Gate, scrollY: number): boolean {
  if (s.detail || s.typing) return false;
  if ((SIDEWAYS as string) === "everywhere") return true;
  return s.place !== "jetzt" || (s.level === 0 && scrollY < PAGER_ENABLE_SCROLLY);
}

/** time paging (previous / next day, week, year) on the given level; only when that level is the settled one */
export function timeSwipeEnabled(s: Gate, level: Level): boolean {
  if ((SIDEWAYS as string) === "everywhere") return false;
  return s.place === "jetzt" && s.level === level && level > 0 && !s.detail && !s.typing;
}

/**
 * The column rests on a level: scrollY within 1 px of the nearest snap position (`tops`, else
 * k·sectionH). A section top past `maxScroll` (scrollHeight − innerHeight) snaps to maxScroll: in
 * a Safari tab with the toolbar collapsed the viewport is taller than the 100svh sections, so Leben's
 * top cannot be reached and mandatory snap rests at the end. Without scrollend an idle gap can come
 * in the middle of a fling (a slow frame); a settle by timer waits until the column is really on a
 * snap point.
 */
export function atSnapPoint(scrollY: number, sectionH: number, tops?: readonly number[], maxScroll = Infinity): boolean {
  if (!(sectionH > 0)) return true;
  const max = maxScroll >= 0 ? maxScroll : Infinity;
  const at = (top: number) => Math.abs(scrollY - Math.min(top, max)) <= 1;
  if (tops?.length) return tops.some(at);
  return at(Math.max(0, Math.round(scrollY / sectionH)) * sectionH);
}

type Pt = { x: number; y: number };

/**
 * A tap on the circle lets the coach speak: the pointer went up within AXIS_SLOP of where it went
 * down (a drag or a swipe across the circle never starts the voice), inside the circle (the largest
 * square of the orb slot, max 300, with a little slack), and not while the column moves. The old
 * screens pass the drawn circle itself (max Infinity).
 */
export function circleTap(down: Pt | null, up: Pt, slot: { left: number; top: number; width: number; height: number }, moving = false, max = 300): boolean {
  if (!down || moving || Math.hypot(up.x - down.x, up.y - down.y) >= AXIS_SLOP) return false;
  const r = Math.min(slot.width, slot.height, max) / 2;
  return r > 0 && Math.hypot(up.x - (slot.left + slot.width / 2), up.y - (slot.top + slot.height / 2)) <= r + 8;
}
