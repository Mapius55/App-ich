// Pure maths for the horizontal swipes (pager and discrete time paging).
// No DOM here, so every decision is unit-tested (tests/swipe.test.ts).
import {
  AXIS_RATIO,
  AXIS_SLOP,
  DISCRETE_CAP,
  DISCRETE_COMMIT,
  DISCRETE_FOLLOW,
  DISCRETE_V,
  FLICK_MIN_DX,
  FLICK_V,
  PAGER_COMMIT_RATIO,
  RUBBER,
  SETTLE_MAX,
  SETTLE_MIN,
} from "./gestures";

export type Axis = "x" | "y";
export type Dir = -1 | 1;
export type SwipeMode = "pager" | "discrete";

/** null until the finger travelled AXIS_SLOP; then "x" when |dx| > AXIS_RATIO·|dy|, else "y" */
export function decideAxis(dx: number, dy: number): Axis | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < AXIS_SLOP) return null;
  return ax > AXIS_RATIO * ay ? "x" : "y";
}

/** the direction a horizontal travel points to: 1 = next (finger moved left), -1 = previous */
export function dirOf(dx: number): Dir {
  return dx < 0 ? 1 : -1;
}

/**
 * Commit or cancel on release. dx = finger travel (px), v = signed release velocity
 * (px/ms, same axis as dx), width = viewport width. Returns the direction or 0.
 * A fast flick against the drag always cancels.
 */
export function decideCommit(mode: SwipeMode, dx: number, v: number, width: number): Dir | 0 {
  if (dx === 0) return 0;
  const ax = Math.abs(dx);
  const along = Math.sign(v) === Math.sign(dx);
  const flickV = mode === "pager" ? FLICK_V : DISCRETE_V;
  if (!along && Math.abs(v) > flickV) return 0;
  if (along && Math.abs(v) > flickV && ax > FLICK_MIN_DX) return dirOf(dx);
  const far = mode === "pager" ? ax > PAGER_COMMIT_RATIO * width : ax >= DISCRETE_COMMIT;
  return far ? dirOf(dx) : 0;
}

/** settle duration for the rest of the way: clamp(remaining / |v|, SETTLE_MIN, SETTLE_MAX) */
export function settleMs(remaining: number, v: number): number {
  const sv = Math.abs(v);
  if (sv < 0.01) return SETTLE_MAX;
  return Math.round(Math.min(SETTLE_MAX, Math.max(SETTLE_MIN, Math.abs(remaining) / sv)));
}

/** beyond an end the content follows only ×RUBBER */
export function rubber(dx: number): number {
  return dx * RUBBER;
}

/**
 * Pager: how far the layers follow the finger. 1:1 towards an allowed neighbour,
 * rubber-banded past it (beyond one page) and everywhere when that way is closed.
 */
export function pagerFollow(dx: number, width: number, canGo: boolean): number {
  if (!canGo) return rubber(dx);
  const ax = Math.abs(dx);
  if (ax <= width) return dx;
  return Math.sign(dx) * (width + rubber(ax - width));
}

/** discrete time paging: the content follows ×DISCRETE_FOLLOW, at most DISCRETE_CAP px (×RUBBER when closed) */
export function discreteFollow(dx: number, canGo = true): number {
  const off = Math.sign(dx) * Math.min(Math.abs(dx) * DISCRETE_FOLLOW, DISCRETE_CAP);
  return canGo ? off : rubber(off);
}

export interface Sample {
  t: number; // ms
  x: number; // px
}

/** release velocity (px/ms) over the last `windowMs`; 0 when the finger rested longer than `restMs` before release */
export function velocity(samples: Sample[], now: number, windowMs = 100, restMs = 80): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  if (now - last.t > restMs) return 0;
  let first = last;
  for (let i = samples.length - 2; i >= 0; i--) {
    if (last.t - samples[i].t > windowMs) break;
    first = samples[i];
  }
  const dt = last.t - first.t;
  return dt > 0 ? (last.x - first.x) / dt : 0;
}

/** CSS cubic-bezier(x1, y1, x2, y2) as a function of progress 0..1 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  const dsx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 8; i++) {
      const err = sx(u) - t;
      if (Math.abs(err) < 1e-5) break;
      const d = dsx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    if (u < 0 || u > 1 || Math.abs(sx(u) - t) > 1e-3) {
      // bisection fallback
      let lo = 0, hi = 1;
      u = t;
      for (let i = 0; i < 30; i++) {
        if (sx(u) < t) lo = u;
        else hi = u;
        u = (lo + hi) / 2;
      }
    }
    return sy(u);
  };
}

/** --ease-out: cubic-bezier(.2,.75,.2,1) */
export const easeOut = cubicBezier(0.2, 0.75, 0.2, 1);

/** the circle's docking curve: e = 1 − (1 − d)², d clamped to 0..1 */
export function dockEase(d: number): number {
  const c = Math.min(1, Math.max(0, d));
  return 1 - (1 - c) * (1 - c);
}
