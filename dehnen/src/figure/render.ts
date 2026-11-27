// Drawing: the solved body, seen by a camera, becomes a list of flat shapes (for a canvas or an SVG).
import { bodyBlobs, spotAt, type Part, type Sphere } from "./body.ts";
import type { Anim, Camera, Prop, SpotName, Target } from "./pose.ts";
import { DIM, mainFrame, mainTime, sample, supportAt, timeline, type Skeleton, type Timeline } from "./solve.ts";
import { add, cross, dot, madd, mul, norm, sub, type Vec } from "./vec.ts";

export type Rgb = readonly [number, number, number];

export interface Palette {
  skin: Rgb;
  top: Rgb;
  shorts: Rgb;
  hair: Rgb;
  mat: Rgb;
  matEdge: Rgb;
  shadow: Rgb;
  spot: Rgb;
  prop: Rgb;
  propDark: Rgb;
  blade: Rgb;
  wall: Rgb;
}

export const PALETTE: Palette = {
  skin: [232, 190, 160],
  top: [78, 196, 181],
  shorts: [38, 66, 92],
  hair: [52, 40, 38],
  mat: [22, 58, 66],
  matEdge: [44, 92, 100],
  shadow: [2, 10, 12],
  spot: [255, 200, 87],
  prop: [196, 205, 208],
  propDark: [70, 92, 104],
  blade: [255, 122, 89],
  wall: [160, 190, 196],
};

export interface View {
  az: number;
  el: number;
}

/** world → pixels: x = cx + u * scale, y = cy - v * scale, where (u, v) are the camera's right/up coordinates */
export interface Fit {
  scale: number;
  cx: number;
  cy: number;
}

export type Shape =
  | { k: "poly"; pts: number[]; fill: string; fill2?: string; g?: readonly [number, number, number, number]; stroke?: string; lw?: number; alpha?: number }
  | { k: "glow"; x: number; y: number; r: number; color: string; alpha: number };

interface Cam {
  right: Vec;
  up: Vec;
  toCam: Vec;
}

export function cam(view: View): Cam {
  const a = (view.az * Math.PI) / 180;
  const e = (view.el * Math.PI) / 180;
  const toCam: Vec = [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
  const right = norm(cross([0, 1, 0], toCam), [1, 0, 0]);
  return { right, up: cross(toCam, right), toCam };
}

export const viewOf = (c: Camera): View => ({ az: c.az, el: c.el ?? 12 });

const rgb = (c: Rgb, f = 1) => `rgb(${Math.round(Math.max(0, Math.min(255, c[0] * f)))},${Math.round(Math.max(0, Math.min(255, c[1] * f)))},${Math.round(Math.max(0, Math.min(255, c[2] * f)))})`;

/** convex hull of 2D points (flat array x0,y0,x1,y1,…), counter-clockwise */
function hull(pts: number[]): number[] {
  const n = pts.length / 2;
  if (n < 3) return pts;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => pts[a * 2] - pts[b * 2] || pts[a * 2 + 1] - pts[b * 2 + 1]);
  const crossZ = (o: number, a: number, b: number) => (pts[a * 2] - pts[o * 2]) * (pts[b * 2 + 1] - pts[o * 2 + 1]) - (pts[a * 2 + 1] - pts[o * 2 + 1]) * (pts[b * 2] - pts[o * 2]);
  const h: number[] = [];
  for (const i of idx) {
    while (h.length >= 2 && crossZ(h[h.length - 2], h[h.length - 1], i) <= 0) h.pop();
    h.push(i);
  }
  const lower = h.length + 1;
  for (let k = idx.length - 2; k >= 0; k--) {
    const i = idx[k];
    while (h.length >= lower && crossZ(h[h.length - 2], h[h.length - 1], i) <= 0) h.pop();
    h.push(i);
  }
  h.pop();
  const out: number[] = [];
  for (const i of h) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

const SEG = 22;
const COS = Array.from({ length: SEG }, (_, i) => Math.cos((i / SEG) * Math.PI * 2));
const SIN = Array.from({ length: SEG }, (_, i) => Math.sin((i / SEG) * Math.PI * 2));

function blobPoly(s: readonly Sphere[], c: Cam, fit: Fit): number[] {
  const pts: number[] = [];
  for (const q of s) {
    const x = fit.cx + dot(q.c, c.right) * fit.scale;
    const y = fit.cy - dot(q.c, c.up) * fit.scale;
    const r = q.r * fit.scale;
    for (let i = 0; i < SEG; i++) pts.push(x + COS[i] * r, y + SIN[i] * r);
  }
  return hull(pts);
}

const project = (p: Vec, c: Cam, fit: Fit): [number, number] => [fit.cx + dot(p, c.right) * fit.scale, fit.cy - dot(p, c.up) * fit.scale];

function bbox(pts: number[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    if (pts[i] < x0) x0 = pts[i];
    if (pts[i] > x1) x1 = pts[i];
    if (pts[i + 1] < y0) y0 = pts[i + 1];
    if (pts[i + 1] > y1) y1 = pts[i + 1];
  }
  return [x0, y0, x1, y1];
}

function resolvePoint(t: Target, sk: Skeleton, props: readonly Prop[]): Vec {
  if (Array.isArray(t)) return t as Vec;
  const o = t as Exclude<Target, Vec>;
  if ("floor" in o) return [o.floor[0], supportAt(o.floor[0], o.floor[1], props) + DIM.wristH, o.floor[1]];
  if ("under" in o) {
    const j = sk.p[o.under];
    const x = j[0] + (o.offset?.[0] ?? 0);
    const z = j[2] + (o.offset?.[1] ?? 0);
    return [x, supportAt(x, z, props) + DIM.wristH, z];
  }
  return add(sk.p[o.at], o.offset ?? [0, 0, 0]);
}

/** Spheres of the props that are drawn as round shapes (stick, paddle, band, roller), for fitting and drawing. */
function propBlobs(props: readonly Prop[], sk: Skeleton): { id: string; kind: "prop" | "propDark" | "blade"; s: Sphere[]; support?: boolean }[] {
  const out: { id: string; kind: "prop" | "propDark" | "blade"; s: Sphere[]; support?: boolean }[] = [];
  props.forEach((p, i) => {
    if (p.type === "stick") {
      const a = resolvePoint(p.a, sk, props);
      const b = resolvePoint(p.b, sk, props);
      const d = norm(sub(b, a), [1, 0, 0]);
      const e = p.extend ?? 0.25;
      const a2 = madd(a, d, -e);
      const b2 = madd(b, d, e);
      out.push({ id: `stick${i}`, kind: "prop", s: [{ c: a2, r: 0.015 }, { c: b2, r: 0.015 }] });
      if (p.paddle) {
        out.push({ id: `bladeA${i}`, kind: "blade", s: [{ c: madd(a2, d, -0.06), r: 0.05 }, { c: madd(a2, d, -0.36), r: 0.075 }] });
        out.push({ id: `bladeB${i}`, kind: "blade", s: [{ c: madd(b2, d, 0.06), r: 0.05 }, { c: madd(b2, d, 0.36), r: 0.075 }] });
      }
    } else if (p.type === "band") {
      out.push({ id: `band${i}`, kind: "blade", s: [{ c: resolvePoint(p.a, sk, props), r: 0.009 }, { c: resolvePoint(p.b, sk, props), r: 0.009 }] });
    } else if (p.type === "roller") {
      const r = p.radius ?? 0.075;
      const half = (p.length ?? 0.45) / 2 - r * 0.5;
      const dir: Vec = p.axis === "x" ? [1, 0, 0] : [0, 0, 1];
      const c: Vec = [p.at[0], r, p.at[1]];
      out.push({ id: `roller${i}`, kind: "propDark", s: [{ c: madd(c, dir, -half), r }, { c: madd(c, dir, half), r }], support: true });
    }
  });
  return out;
}

function boxCorners(p: Extract<Prop, { type: "box" }>): Vec[] {
  const yaw = ((p.yaw ?? 0) * Math.PI) / 180;
  const cx = Math.cos(yaw);
  const sx = Math.sin(yaw);
  const y0 = p.base ?? 0;
  const out: Vec[] = [];
  for (const sy of [0, 1])
    for (const [ax, az] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const lx = (ax * p.size[0]) / 2;
      const lz = (az * p.size[2]) / 2;
      out.push([p.at[0] + lx * cx + lz * sx, y0 + sy * p.size[1], p.at[1] - lx * sx + lz * cx]);
    }
  return out;
}

export interface Stage {
  anim: Anim;
  tl: Timeline;
  main: number;
  mainTime: number;
  /** all spheres over the loop (for framing) */
  cloud: Sphere[];
  mat: { x: number; z: number; across: boolean };
}

/** Everything about one animation that does not change from frame to frame. */
export function stage(anim: Anim): Stage {
  const tl = timeline(anim);
  const main = mainFrame(anim);
  const cloud: Sphere[] = [];
  const steps = tl.keys.length === 1 ? 1 : Math.max(8, tl.keys.length * 4);
  const collect = (sk: Skeleton) => {
    for (const b of bodyBlobs(sk)) cloud.push(...b.s);
    for (const b of propBlobs(tl.props, sk)) cloud.push(...b.s);
  };
  for (const k of tl.keys) collect(k.sk);
  for (let i = 0; i < steps; i++) collect(sample(tl, (i / steps) * tl.total).sk);
  for (const p of tl.props) if (p.type === "box") for (const c of boxCorners(p)) cloud.push({ c, r: 0 });
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const s of cloud) {
    if (s.c[1] - s.r > 0.5) continue; // the footprint: what is near the floor
    x0 = Math.min(x0, s.c[0] - s.r);
    x1 = Math.max(x1, s.c[0] + s.r);
    z0 = Math.min(z0, s.c[2] - s.r);
    z1 = Math.max(z1, s.c[2] + s.r);
  }
  if (!Number.isFinite(x0)) x0 = x1 = z0 = z1 = 0;
  const across = anim.matAcross ?? x1 - x0 > (z1 - z0) * 1.15;
  return { anim, tl, main, mainTime: mainTime(tl, main), cloud, mat: { x: (x0 + x1) / 2, z: (z0 + z1) / 2, across } };
}

/** Scale and offset so the whole loop fits a w × h picture from this view. */
export function fitStage(st: Stage, view: View, w: number, h: number, pad = 0.09): Fit {
  const c = cam(view);
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const s of st.cloud) {
    const u = dot(s.c, c.right);
    const v = dot(s.c, c.up);
    u0 = Math.min(u0, u - s.r);
    u1 = Math.max(u1, u + s.r);
    v0 = Math.min(v0, v - s.r);
    v1 = Math.max(v1, v + s.r);
  }
  const bw = Math.max(0.2, u1 - u0);
  const bh = Math.max(0.2, v1 - v0);
  const scale = Math.min((w * (1 - 2 * pad)) / bw, (h * (1 - 2 * pad)) / bh, Math.min(w, h) / 1.15);
  return { scale, cx: w / 2 - ((u0 + u1) / 2) * scale, cy: h / 2 + ((v0 + v1) / 2) * scale + h * 0.01 };
}

interface Item {
  depth: number;
  shapes: Shape[];
}

const PART: Record<Part, keyof Palette> = { skin: "skin", top: "top", shorts: "shorts", hair: "hair" };

/** One picture of the loop at `seconds`. */
export function frame(st: Stage, seconds: number, view: View, fit: Fit, opts: { spots?: boolean; palette?: Palette } = {}): Shape[] {
  const pal = opts.palette ?? PALETTE;
  const c = cam(view);
  const { sk, holding } = sample(st.tl, seconds);
  const breath = holding ? 0.5 + 0.5 * Math.sin((seconds / 4.6) * Math.PI * 2) : 0.5;
  const blobs = bodyBlobs(sk, breath);
  const props = st.tl.props;
  const out: Shape[] = [];
  const lw = Math.max(0.75, fit.scale * 0.0045);

  // the mat
  {
    const hw = st.mat.across ? 0.95 : 0.34;
    const hd = st.mat.across ? 0.34 : 0.95;
    const r = 0.05;
    const pts: number[] = [];
    const corner = (cx: number, cz: number, a0: number) => {
      for (let i = 0; i <= 4; i++) {
        const a = a0 + (i / 4) * (Math.PI / 2);
        const q = project([st.mat.x + cx + Math.cos(a) * r, 0, st.mat.z + cz + Math.sin(a) * r], c, fit);
        pts.push(q[0], q[1]);
      }
    };
    corner(hw - r, hd - r, 0);
    corner(-hw + r, hd - r, Math.PI / 2);
    corner(-hw + r, -hd + r, Math.PI);
    corner(hw - r, -hd + r, Math.PI * 1.5);
    out.push({ k: "poly", pts, fill: rgb(pal.mat), stroke: rgb(pal.matEdge), lw });
  }

  // walls behind everything (when the camera is in the room)
  const late: Shape[] = [];
  for (const p of props) {
    if (p.type !== "wall") continue;
    const n: Vec = p.axis === "z" ? [0, 0, p.faces] : [p.faces, 0, 0];
    const along: Vec = p.axis === "z" ? [1, 0, 0] : [0, 0, 1];
    const mid = p.axis === "z" ? sk.p.pelvis[0] : sk.p.pelvis[2];
    const base: Vec = p.axis === "z" ? [mid, 0, p.at] : [p.at, 0, mid];
    const pts: number[] = [];
    for (const [a, y] of [
      [-0.95, 0],
      [0.95, 0],
      [0.95, 2.0],
      [-0.95, 2.0],
    ]) {
      const q = project(add(madd(base, along, a), [0, y, 0]), c, fit);
      pts.push(q[0], q[1]);
    }
    const inRoom = dot(n, c.toCam) > 0;
    const shape: Shape = { k: "poly", pts, fill: rgb(pal.wall), stroke: rgb(pal.wall, 1.1), lw, alpha: inRoom ? 0.2 : 0.1 };
    if (inRoom) out.push(shape);
    else late.push(shape);
  }

  // one soft shadow on the floor for the whole body
  {
    for (const b of blobs) {
      const pts: number[] = [];
      for (const s of b.s) {
        const k = Math.max(0.3, Math.min(1, 1 - (s.c[1] - s.r) / 0.9)) * 0.95;
        for (let i = 0; i < SEG; i += 2) {
          const q = project([s.c[0] + COS[i] * s.r * k, 0, s.c[2] + SIN[i] * s.r * k], c, fit);
          pts.push(q[0], q[1]);
        }
      }
      out.push({ k: "poly", pts: hull(pts), fill: rgb(pal.shadow), alpha: 0.2 });
    }
  }

  const items: Item[] = [];
  let depthSum = 0;
  const depths = blobs.map((b) => {
    let d = 0;
    for (const s of b.s) d += dot(s.c, c.toCam);
    d /= b.s.length;
    depthSum += d;
    return d;
  });
  const ref = depthSum / blobs.length;
  const shade = (base: Rgb, depth: number, pts: number[]): Shape => {
    const f = 1 + 0.1 * Math.max(-1, Math.min(1, (depth - ref) / 0.45));
    const [x0, y0, x1, y1] = bbox(pts);
    return { k: "poly", pts, fill: rgb(base, f * 1.06), fill2: rgb(base, f * 0.88), g: [x0, y0, x1, y1], stroke: rgb(base, f * 0.5), lw };
  };
  blobs.forEach((b, i) => {
    items.push({ depth: depths[i], shapes: [shade(pal[PART[b.part]], depths[i], blobPoly(b.s, c, fit))] });
  });

  // things the body rests on must be drawn before the parts that lie on them
  const restingDepth = (inside: (x: number, z: number) => boolean, top: number): number => {
    let d = Infinity;
    blobs.forEach((b, i) => {
      for (const s of b.s) if (s.c[1] - s.r > top - 0.06 && inside(s.c[0], s.c[2])) d = Math.min(d, depths[i]);
    });
    return d;
  };

  for (const pb of propBlobs(props, sk)) {
    let d = 0;
    for (const s of pb.s) d += dot(s.c, c.toCam);
    d /= pb.s.length;
    if (pb.support) {
      const x0 = Math.min(...pb.s.map((s) => s.c[0] - s.r));
      const x1 = Math.max(...pb.s.map((s) => s.c[0] + s.r));
      const z0 = Math.min(...pb.s.map((s) => s.c[2] - s.r));
      const z1 = Math.max(...pb.s.map((s) => s.c[2] + s.r));
      d = Math.min(d, restingDepth((x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1, pb.s[0].r * 2) - 0.001);
    }
    const base = pal[pb.kind];
    const pts = blobPoly(pb.s, c, fit);
    const [x0, y0, x1, y1] = bbox(pts);
    items.push({ depth: d, shapes: [{ k: "poly", pts, fill: rgb(base, 1.05), fill2: rgb(base, 0.85), g: [x0, y0, x1, y1], stroke: rgb(base, 0.5), lw }] });
  }

  for (const p of props) {
    if (p.type !== "box") continue;
    const q = boxCorners(p);
    const faces: [number[], Vec][] = [
      [[4, 5, 6, 7], [0, 1, 0]],
      [[0, 1, 5, 4], sub(q[0], q[3])],
      [[1, 2, 6, 5], sub(q[1], q[0])],
      [[2, 3, 7, 6], sub(q[3], q[0])],
      [[3, 0, 4, 7], sub(q[0], q[1])],
    ];
    const shapes: Shape[] = [];
    for (const [ids, nrm] of faces) {
      const n = norm(nrm);
      if (dot(n, c.toCam) <= 0.001) continue;
      const pts: number[] = [];
      for (const id of ids) {
        const s = project(q[id], c, fit);
        pts.push(s[0], s[1]);
      }
      const light = 0.78 + 0.3 * Math.max(0, n[1]) + 0.12 * Math.max(0, dot(n, norm([-0.4, 0.5, 0.6])));
      shapes.push({ k: "poly", pts, fill: rgb(pal.propDark, light), stroke: rgb(pal.propDark, 0.55), lw });
    }
    const centre = mul(add(q[0], q[6]), 0.5);
    const yaw = ((p.yaw ?? 0) * Math.PI) / 180;
    const inside = (x: number, z: number) => {
      const dx = x - p.at[0];
      const dz = z - p.at[1];
      const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      return Math.abs(lx) <= p.size[0] / 2 + 0.04 && Math.abs(lz) <= p.size[2] / 2 + 0.04;
    };
    const d = Math.min(dot(centre, c.toCam), restingDepth(inside, (p.base ?? 0) + p.size[1]) - 0.001);
    items.push({ depth: d, shapes });
  }

  if (opts.spots !== false && st.anim.spots?.length) {
    const pulse = 0.78 + 0.22 * Math.sin((seconds / 2.6) * Math.PI * 2);
    for (const name of st.anim.spots as SpotName[]) {
      const s = spotAt(sk, name);
      const q = project(s.c, c, fit);
      items.push({ depth: dot(s.c, c.toCam) + 0.012, shapes: [{ k: "glow", x: q[0], y: q[1], r: s.r * fit.scale * 1.25, color: rgb(pal.spot), alpha: 0.9 * pulse }] });
    }
  }

  items.sort((a, b) => a.depth - b.depth);
  for (const it of items) out.push(...it.shapes);
  out.push(...late);
  return out;
}

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

/** The shapes as SVG markup (without the outer <svg> tag). `id` must be unique on the page (gradient ids). */
export function svgBody(shapes: readonly Shape[], id: string): string {
  const defs: string[] = [];
  const body: string[] = [];
  shapes.forEach((s, i) => {
    if (s.k === "glow") {
      defs.push(`<radialGradient id="${id}g${i}"><stop offset="0" stop-color="${s.color}" stop-opacity="${f1(s.alpha)}"/><stop offset="0.55" stop-color="${s.color}" stop-opacity="${f1(s.alpha * 0.45)}"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></radialGradient>`);
      body.push(`<circle cx="${f1(s.x)}" cy="${f1(s.y)}" r="${f1(s.r)}" fill="url(#${id}g${i})"/>`);
      return;
    }
    let d = "";
    for (let k = 0; k < s.pts.length; k += 2) d += `${k ? "L" : "M"}${f1(s.pts[k])} ${f1(s.pts[k + 1])}`;
    d += "Z";
    let fill = s.fill;
    if (s.fill2 && s.g) {
      defs.push(`<linearGradient id="${id}l${i}" gradientUnits="userSpaceOnUse" x1="${f1(s.g[0])}" y1="${f1(s.g[1])}" x2="${f1(s.g[2])}" y2="${f1(s.g[3])}"><stop offset="0" stop-color="${s.fill}"/><stop offset="1" stop-color="${s.fill2}"/></linearGradient>`);
      fill = `url(#${id}l${i})`;
    }
    body.push(`<path d="${d}" fill="${fill}"${s.stroke ? ` stroke="${s.stroke}" stroke-width="${f1(s.lw ?? 1)}" stroke-linejoin="round"` : ""}${s.alpha !== undefined ? ` opacity="${s.alpha}"` : ""}/>`);
  });
  return `<defs>${defs.join("")}</defs>${body.join("")}`;
}

export function svg(shapes: readonly Shape[], w: number, h: number, id: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${svgBody(shapes, id)}</svg>`;
}

/** Paint the shapes on a canvas (the context is expected to be scaled for the device already). */
export function paint(ctx: CanvasRenderingContext2D, shapes: readonly Shape[]): void {
  for (const s of shapes) {
    if (s.k === "glow") {
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
      g.addColorStop(0, s.color);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.save();
      ctx.globalAlpha = s.alpha;
      // fade to transparent in the same hue: draw with a radial alpha mask
      const rg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
      const col = s.color.replace("rgb(", "").replace(")", "");
      rg.addColorStop(0, `rgba(${col},1)`);
      rg.addColorStop(0.55, `rgba(${col},0.45)`);
      rg.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      continue;
    }
    ctx.beginPath();
    for (let k = 0; k < s.pts.length; k += 2) {
      if (k) ctx.lineTo(s.pts[k], s.pts[k + 1]);
      else ctx.moveTo(s.pts[k], s.pts[k + 1]);
    }
    ctx.closePath();
    if (s.alpha !== undefined) ctx.globalAlpha = s.alpha;
    if (s.fill2 && s.g) {
      const g = ctx.createLinearGradient(s.g[0], s.g[1], s.g[2], s.g[3]);
      g.addColorStop(0, s.fill);
      g.addColorStop(1, s.fill2);
      ctx.fillStyle = g;
    } else ctx.fillStyle = s.fill;
    ctx.fill();
    if (s.stroke) {
      ctx.strokeStyle = s.stroke;
      ctx.lineWidth = s.lw ?? 1;
      ctx.lineJoin = "round";
      ctx.stroke();
    }
    if (s.alpha !== undefined) ctx.globalAlpha = 1;
  }
}
