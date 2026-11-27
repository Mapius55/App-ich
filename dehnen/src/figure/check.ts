// A plain-text check of an animation: what touches the floor, joint angles, limbs that sink into each other.
// Used by the pose authors (scripts/dehnen/sheet.ts) and by the tests.
import { bodyBlobs } from "./body.ts";
import type { Anim, JointName, Lr, Prop } from "./pose.ts";
import { sample, supportAt, timeline, type Skeleton } from "./solve.ts";
import { angle, dot, sub, toBody, type Vec } from "./vec.ts";

export interface Finding {
  level: "warn" | "info";
  text: string;
}

const cm = (m: number) => Math.round(m * 100);
const deg = (d: number) => Math.round(d);

/** distance between two segments */
function segDist(p1: Vec, q1: Vec, p2: Vec, q2: Vec): number {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s: number;
  let t: number;
  if (a <= 1e-9 && e <= 1e-9) return Math.hypot(r[0], r[1], r[2]);
  if (a <= 1e-9) {
    s = 0;
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = dot(d1, r);
    if (e <= 1e-9) {
      t = 0;
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = dot(d1, d2);
      const den = a * e - b * b;
      s = den > 1e-9 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }
  const x = [p1[0] + d1[0] * s - (p2[0] + d2[0] * t), p1[1] + d1[1] * s - (p2[1] + d2[1] * t), p1[2] + d1[2] * s - (p2[2] + d2[2] * t)];
  return Math.hypot(x[0], x[1], x[2]);
}

interface Seg {
  name: string;
  a: Vec;
  b: Vec;
  r: number;
  group: string;
}

function segments(sk: Skeleton): Seg[] {
  const P = sk.p;
  const out: Seg[] = [
    { name: "pelvis", a: P.hipL, b: P.hipR, r: 0.085, group: "torso" },
    { name: "belly", a: P.pelvis, b: P.chest, r: 0.1, group: "torso" },
    { name: "ribs", a: P.chest, b: P.neck, r: 0.095, group: "torso" },
    { name: "head", a: P.head, b: P.head, r: 0.095, group: "head" },
  ];
  for (const s of ["L", "R"] as Lr[]) {
    out.push({ name: `thigh${s}`, a: P[`hip${s}`], b: P[`knee${s}`], r: 0.065, group: `leg${s}` });
    out.push({ name: `shank${s}`, a: P[`knee${s}`], b: P[`ankle${s}`], r: 0.045, group: `leg${s}` });
    out.push({ name: `foot${s}`, a: P[`heel${s}`], b: P[`toe${s}`], r: 0.03, group: `leg${s}` });
    out.push({ name: `upperArm${s}`, a: P[`shoulder${s}`], b: P[`elbow${s}`], r: 0.042, group: `arm${s}` });
    out.push({ name: `forearm${s}`, a: P[`elbow${s}`], b: P[`wrist${s}`], r: 0.033, group: `arm${s}` });
  }
  return out;
}

const ADJACENT = new Set(["torso|legL", "torso|legR", "torso|armL", "torso|armR", "torso|head"]);

/** Parts that sink into each other by more than `limit` metres. */
function overlaps(sk: Skeleton, limit = 0.045): string[] {
  const segs = segments(sk);
  const out: string[] = [];
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const A = segs[i];
      const B = segs[j];
      if (A.group === B.group) continue;
      const pair = `${A.group}|${B.group}`;
      // thighs start inside the pelvis, upper arms at the ribs, the head on the neck: only test the far parts
      if (ADJACENT.has(pair) || ADJACENT.has(`${B.group}|${A.group}`)) {
        const limb = A.group === "torso" ? B : A;
        if (/^(thigh|upperArm|head)/.test(limb.name)) continue;
      }
      const depth = A.r + B.r - segDist(A.a, A.b, B.a, B.b);
      if (depth > limit) out.push(`${A.name} and ${B.name} overlap by ${cm(depth)} cm`);
    }
  return out;
}

const TOUCH: JointName[] = ["heelL", "toeL", "heelR", "toeR", "kneeL", "kneeR", "handL", "handR", "elbowL", "elbowR", "hipL", "hipR", "shoulderL", "shoulderR", "head"];
const RADIUS: Partial<Record<JointName, number>> = { kneeL: 0.056, kneeR: 0.056, heelL: 0.04, heelR: 0.04, toeL: 0.023, toeR: 0.023, handL: 0.038, handR: 0.038, elbowL: 0.04, elbowR: 0.04, hipL: 0.09, hipR: 0.09, shoulderL: 0.058, shoulderR: 0.058, head: 0.1 };

/** Height of each listed joint's surface above what is under it (floor, box, roller), in cm. */
export function clearances(sk: Skeleton, props: readonly Prop[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const j of TOUCH) {
    const p = sk.p[j];
    out[j] = cm(p[1] - (RADIUS[j] ?? 0.04) - supportAt(p[0], p[2], props));
  }
  return out;
}

/** Joint angles of a solved body, in degrees. */
export function angles(sk: Skeleton): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of ["L", "R"] as Lr[]) {
    const leg = sk.leg[s];
    const arm = sk.arm[s];
    const sgn = s === "L" ? 1 : -1;
    out[`knee${s}`] = deg(angle(leg.thigh, leg.shank));
    const t = toBody(sk.pelvisB, leg.thigh);
    // flexion: thigh forward of straight down; abduction: thigh out to its own side
    out[`hipFlex${s}`] = deg((Math.atan2(t[2], -t[1]) * 180) / Math.PI);
    out[`hipAbd${s}`] = deg((Math.asin(Math.max(-1, Math.min(1, t[0] * sgn))) * 180) / Math.PI);
    out[`ankle${s}`] = deg(angle(leg.foot, leg.shank) - 90) * -1;
    out[`elbow${s}`] = deg(angle(arm.upper, arm.fore));
  }
  out.spineBend = deg(angle(sk.pelvisB.up, sk.chestB.up));
  out.spineTwist = deg(angle(sk.pelvisB.left, sk.chestB.left));
  out.neckBend = deg(angle(sk.chestB.up, sk.headB.up));
  out.neckTurn = deg(angle(sk.chestB.fwd, sk.headB.fwd));
  return out;
}

function limits(a: Record<string, number>): string[] {
  const w: string[] = [];
  for (const s of ["L", "R"]) {
    if (a[`knee${s}`] > 164) w.push(`knee${s} bent ${a[`knee${s}`]}° (more than a knee can: max about 160°)`);
    if (a[`elbow${s}`] > 155) w.push(`elbow${s} bent ${a[`elbow${s}`]}° (max about 150°)`);
    const f = a[`hipFlex${s}`];
    if (f < -35 && f > -150) w.push(`hip${s} extended ${-f}° behind the pelvis (max about 25°): tilt the pelvis or bring the thigh forward`);
    if (f > 150 || f <= -150) w.push(`hip${s} flexed about ${f > 0 ? f : 360 + f}° (max about 145°: tilt the pelvis with the thigh)`);
  }
  if (a.spineBend > 75) w.push(`spine bent ${a.spineBend}° between pelvis and chest (keep under about 70°)`);
  if (a.spineTwist > 70) w.push(`spine twisted about ${a.spineTwist}° (keep under about 60°)`);
  if (a.neckBend > 60) w.push(`neck bent ${a.neckBend}° (keep under about 55°)`);
  if (a.neckTurn > 85) w.push(`head turned ${a.neckTurn}° (keep under about 80°)`);
  return w;
}

/** Check one solved body. */
export function checkBody(sk: Skeleton, props: readonly Prop[]): Finding[] {
  const out: Finding[] = [];
  for (const i of sk.issues) out.push({ level: "warn", text: i });
  for (const k of Object.keys(sk.p) as JointName[]) if (sk.p[k].some((n) => !Number.isFinite(n))) out.push({ level: "warn", text: `${k} is not a number` });
  for (const t of limits(angles(sk))) out.push({ level: "warn", text: t });
  for (const t of overlaps(sk)) out.push({ level: "warn", text: t });
  // nothing may hang below the floor (only possible with an explicit y)
  let low = Infinity;
  for (const b of bodyBlobs(sk)) for (const s of b.s) low = Math.min(low, s.c[1] - s.r - supportAt(s.c[0], s.c[2], props));
  if (low < -0.02) out.push({ level: "warn", text: `the body is ${cm(-low)} cm inside the floor or a prop (y too low, or a reaching limb goes too deep)` });
  if (low > 0.03) out.push({ level: "warn", text: `the body floats ${cm(low)} cm above the floor (y too high)` });
  return out;
}

/** Check a whole animation: every keyframe and the in-betweens. Returns warnings per keyframe ("frame 1: …") and for the moves between. */
export function checkAnim(anim: Anim): string[] {
  const out: string[] = [];
  if (!anim.frames.length) return ["no frames"];
  const tl = timeline(anim);
  tl.keys.forEach((k, i) => {
    for (const f of checkBody(k.sk, tl.props)) out.push(`frame ${i}: ${f.text}`);
  });
  if (tl.keys.length > 1) {
    const seen = new Set<string>();
    const steps = tl.keys.length * 6;
    for (let i = 0; i < steps; i++) {
      const s = sample(tl, (i / steps) * tl.total);
      if (s.holding) continue;
      for (const f of checkBody(s.sk, tl.props)) {
        const msg = `moving into frame ${s.frame}: ${f.text.replace(/\d+/g, "N")}`;
        if (!seen.has(msg)) {
          seen.add(msg);
          out.push(`moving into frame ${s.frame}: ${f.text}`);
        }
      }
    }
  }
  if (!Number.isFinite(tl.total) || tl.total <= 0) out.push("the loop has no length");
  return out;
}

/** The full text report for one keyframe (for the authors). */
export function describe(sk: Skeleton, props: readonly Prop[]): string {
  const a = angles(sk);
  const c = clearances(sk, props);
  const on = Object.entries(c)
    .filter(([, v]) => v <= 2)
    .map(([k]) => k);
  const near = Object.entries(c)
    .filter(([, v]) => v > 2 && v <= 12)
    .map(([k, v]) => `${k} ${v}cm`);
  const pos = (j: JointName) => `${j}(${cm(sk.p[j][0])},${cm(sk.p[j][1])},${cm(sk.p[j][2])})`;
  const lines = [
    `  touching: ${on.join(", ") || "nothing listed"}${near.length ? `   | close above: ${near.join(", ")}` : ""}`,
    `  joints cm (x,y,z): ${(["pelvis", "chest", "head", "shoulderL", "shoulderR", "wristL", "wristR", "kneeL", "kneeR", "ankleL", "ankleR"] as JointName[]).map(pos).join(" ")}`,
    `  angles: knee L${a.kneeL} R${a.kneeR}, hip flexion L${a.hipFlexL} R${a.hipFlexR}, hip abduction L${a.hipAbdL} R${a.hipAbdR}, ankle point L${a.ankleL} R${a.ankleR}, elbow L${a.elbowL} R${a.elbowR}, spine bend ${a.spineBend} twist ${a.spineTwist}, neck bend ${a.neckBend} turn ${a.neckTurn}`,
  ];
  for (const f of checkBody(sk, props)) lines.push(`  WARNING: ${f.text}`);
  return lines.join("\n");
}
