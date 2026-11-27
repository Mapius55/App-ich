// Small 3D vector helpers. World axes: +Y up, +Z where a standing figure looks, +X the figure's left.

export type Vec = readonly [number, number, number];

export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: Vec): number => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: Vec, b: Vec): number => len(sub(a, b));
export const lerp = (a: Vec, b: Vec, t: number): Vec => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** a + b*s */
export const madd = (a: Vec, b: Vec, s: number): Vec => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

export function norm(a: Vec, fallback: Vec = [0, 1, 0]): Vec {
  const l = len(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : fallback;
}

/** the part of `a` at right angles to the unit vector `n`, normalised (or `fallback` if nothing is left) */
export function perp(a: Vec, n: Vec, fallback: Vec): Vec {
  const p = madd(a, n, -dot(a, n));
  return len(p) > 1e-6 ? norm(p) : fallback;
}

/** any unit vector at right angles to `n` */
export function anyPerp(n: Vec): Vec {
  const a: Vec = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return norm(cross(n, a));
}

/** turn `a` around the unit axis by `deg` degrees (right-hand rule) */
export function rot(a: Vec, axis: Vec, deg: number): Vec {
  const k = norm(axis);
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const kxa = cross(k, a);
  const kd = dot(k, a) * (1 - c);
  return [a[0] * c + kxa[0] * s + k[0] * kd, a[1] * c + kxa[1] * s + k[1] * kd, a[2] * c + kxa[2] * s + k[2] * kd];
}

/** from direction a to direction b along the great circle (both get normalised) */
export function slerp(a: Vec, b: Vec, t: number): Vec {
  const ua = norm(a);
  const ub = norm(b);
  const d = Math.max(-1, Math.min(1, dot(ua, ub)));
  if (d > 0.9995) return norm(lerp(ua, ub, t));
  if (d < -0.9995) {
    // opposite: turn around any axis at right angles
    return rot(ua, anyPerp(ua), 180 * t);
  }
  const th = Math.acos(d);
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return norm([ua[0] * wa + ub[0] * wb, ua[1] * wa + ub[1] * wb, ua[2] * wa + ub[2] * wb]);
}

/** angle between two directions in degrees */
export function angle(a: Vec, b: Vec): number {
  return (Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))) * 180) / Math.PI;
}

export const mirrorX = (a: Vec): Vec => [-a[0], a[1], a[2]];

/** An orientation: left, up, fwd are unit vectors at right angles (left = up × fwd). */
export interface Basis {
  left: Vec;
  up: Vec;
  fwd: Vec;
}

export function basis(up: Vec, fwd: Vec): Basis {
  const u = norm(up);
  const f = perp(fwd, u, anyPerp(u));
  return { left: cross(u, f), up: u, fwd: f };
}

export function slerpBasis(a: Basis, b: Basis, t: number): Basis {
  return basis(slerp(a.up, b.up, t), slerp(a.fwd, b.fwd, t));
}

/** body coordinates [left, up, fwd] → world */
export function fromBody(b: Basis, v: Vec): Vec {
  return [b.left[0] * v[0] + b.up[0] * v[1] + b.fwd[0] * v[2], b.left[1] * v[0] + b.up[1] * v[1] + b.fwd[1] * v[2], b.left[2] * v[0] + b.up[2] * v[1] + b.fwd[2] * v[2]];
}

/** world → body coordinates [left, up, fwd] */
export function toBody(b: Basis, v: Vec): Vec {
  return [dot(v, b.left), dot(v, b.up), dot(v, b.fwd)];
}
