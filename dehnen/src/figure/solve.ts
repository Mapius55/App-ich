// From a pose (directions) to a skeleton (points in space), set down on the floor.
import { bodyBlobs, type Limb } from "./body.ts";
import { isArmReach, isLegReach, type Anim, type Arm, type Frame, type JointName, type Leg, type Lr, type Pose, type Prop, type Target } from "./pose.ts";
import { add, anyPerp, basis, cross, dist, dot, fromBody, lerp, madd, mirrorX, mul, norm, perp, rot, slerp, slerpBasis, sub, type Basis, type Vec } from "./vec.ts";

/** Body measures in metres (a figure of about 1.72 m). */
export const DIM = {
  hipW: 0.095,
  thigh: 0.44,
  shank: 0.42,
  ankleH: 0.08,
  waist: 0.13,
  spine: 0.21,
  shoulderUp: 0.13,
  shoulderW: 0.185,
  neckUp: 0.19,
  upper: 0.29,
  fore: 0.26,
  wristH: 0.035,
} as const;

export interface LegSolved {
  thigh: Vec;
  shank: Vec;
  /** heel → toes */
  foot: Vec;
  /** out of the top of the foot */
  footUp: Vec;
  shinFront: Vec;
  thighFront: Vec;
}

export interface ArmSolved {
  upper: Vec;
  fore: Vec;
  hand: Vec;
}

export interface Skeleton {
  pelvisB: Basis;
  chestB: Basis;
  headB: Basis;
  p: Record<JointName, Vec>;
  leg: Record<Lr, LegSolved>;
  arm: Record<Lr, ArmSolved>;
  /** things that could not be done as asked (a hand that does not reach, …) */
  issues: string[];
}

const UP: Vec = [0, 1, 0];
const SIDES: Lr[] = ["L", "R"];
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** carry `v` along with the smallest turn that takes direction `from` to direction `to` */
function transport(v: Vec, from: Vec, to: Vec): Vec {
  const axis = cross(from, to);
  const s = Math.hypot(axis[0], axis[1], axis[2]);
  const c = dot(from, to);
  if (s < 1e-6) return c > 0 ? v : rot(v, anyPerp(from), 180);
  return rot(v, mul(axis, 1 / s), (Math.atan2(s, c) * 180) / Math.PI);
}

/** The front of a leg segment: clear when the knee is bent, taken from the pelvis when the leg is straight. */
function fronts(thigh: Vec, shank: Vec, pelvis: Basis): { shinFront: Vec; thighFront: Vec } {
  const carried = transport(pelvis.fwd, mul(pelvis.up, -1), thigh);
  const fbShin = perp(carried, shank, anyPerp(shank));
  const fbThigh = perp(carried, thigh, anyPerp(thigh));
  const ps = madd(thigh, shank, -dot(thigh, shank));
  const pt = madd(shank, thigh, -dot(shank, thigh));
  const w = clamp(Math.hypot(ps[0], ps[1], ps[2]) / 0.35, 0, 1);
  const shinFront = perp(lerp(fbShin, norm(ps, fbShin), w), shank, fbShin);
  const thighFront = perp(lerp(fbThigh, mul(norm(pt, mul(fbThigh, -1)), -1), w), thigh, fbThigh);
  return { shinFront, thighFront };
}

function legFromDirs(thighIn: Vec, shankIn: Vec, pelvis: Basis, foot: Vec | undefined, point: number | undefined, flat = false): LegSolved {
  const thigh = norm(thighIn, mul(pelvis.up, -1));
  const shank = norm(shankIn, thigh);
  const { shinFront, thighFront } = fronts(thigh, shank, pelvis);
  if (foot) {
    const f = norm(foot);
    return { thigh, shank, foot: f, footUp: perp(mul(shank, -1), f, shinFront), shinFront, thighFront };
  }
  if (flat && point === undefined) {
    const f = perp(shinFront, UP, perp(pelvis.fwd, UP, [0, 0, 1]));
    return { thigh, shank, foot: f, footUp: UP, shinFront, thighFront };
  }
  const a = ((point ?? 0) * Math.PI) / 180;
  const f = norm(add(mul(shinFront, Math.cos(a)), mul(shank, Math.sin(a))));
  const fu = norm(add(mul(shank, -Math.cos(a)), mul(shinFront, Math.sin(a))));
  return { thigh, shank, foot: f, footUp: fu, shinFront, thighFront };
}

/** Elbow or knee of a two-part limb that reaches from `root` to `target`. */
function twoBone(root: Vec, target: Vec, a: number, b: number, pole: Vec): { mid: Vec; end: Vec; short: number } {
  const raw = dist(root, target);
  const dir = norm(sub(target, root), [0, -1, 0]);
  const short = Math.max(0, raw - (a + b));
  const d = clamp(raw, Math.abs(a - b) + 1e-4, a + b - 1e-4);
  const x = (a * a + d * d - b * b) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  const side = perp(pole, dir, anyPerp(dir));
  return { mid: add(madd(root, dir, x), mul(side, h)), end: madd(root, dir, d), short };
}

/** Height of the surface the body can rest on at (x, z): the floor, a box, a roller. */
export function supportAt(x: number, z: number, props: readonly Prop[]): number {
  let h = 0;
  for (const p of props) {
    if (p.type === "box") {
      const yaw = ((p.yaw ?? 0) * Math.PI) / 180;
      const dx = x - p.at[0];
      const dz = z - p.at[1];
      const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      if (Math.abs(lx) <= p.size[0] / 2 && Math.abs(lz) <= p.size[2] / 2) h = Math.max(h, (p.base ?? 0) + p.size[1]);
    } else if (p.type === "roller") {
      const r = p.radius ?? 0.075;
      const half = (p.length ?? 0.45) / 2;
      const along = p.axis === "x" ? x - p.at[0] : z - p.at[1];
      const across = p.axis === "x" ? z - p.at[1] : x - p.at[0];
      if (Math.abs(along) <= half && Math.abs(across) < r) h = Math.max(h, r + Math.sqrt(r * r - across * across));
    }
  }
  return h;
}

interface LegPlan {
  dirs?: LegSolved;
  reach?: { target: (sk: Skeleton) => Vec; bend: (sk: Skeleton) => Vec; finish: (thigh: Vec, shank: Vec, sk: Skeleton) => LegSolved };
}
interface ArmPlan {
  dirs?: ArmSolved;
  reach?: { target: (sk: Skeleton) => Vec; bend: (sk: Skeleton) => Vec; hand: (fore: Vec, sk: Skeleton) => Vec };
}
interface Placement {
  anchor: JointName;
  at: readonly [number, number];
  y: number | undefined;
  w: number;
}
interface Plan {
  pelvis: Basis;
  chest: Basis;
  head: Basis;
  leg: Record<Lr, LegPlan>;
  arm: Record<Lr, ArmPlan>;
  place: Placement[];
}

const frameBasis = (f: Frame): Basis => basis(f.up, f.fwd);

function resolveTarget(t: Target, sk: Skeleton, props: readonly Prop[], lift: number): Vec {
  if (Array.isArray(t)) return t as Vec;
  const o = t as Exclude<Target, Vec>;
  if ("floor" in o) return [o.floor[0], supportAt(o.floor[0], o.floor[1], props) + lift, o.floor[1]];
  if ("under" in o) {
    const j = sk.p[o.under];
    const x = j[0] + (o.offset?.[0] ?? 0);
    const z = j[2] + (o.offset?.[1] ?? 0);
    return [x, supportAt(x, z, props) + lift, z];
  }
  return add(sk.p[o.at], o.offset ?? [0, 0, 0]);
}

const onGround = (t: Target): boolean => !Array.isArray(t) && ("floor" in (t as object) || "under" in (t as object));

function defaultArmBend(sk: Skeleton, side: Lr): Vec {
  const c = sk.chestB;
  return norm(add(add(mul(c.up, -0.5), mul(c.fwd, -0.6)), mul(c.left, side === "L" ? 0.35 : -0.35)));
}
function defaultLegBend(sk: Skeleton, side: Lr): Vec {
  const p = sk.pelvisB;
  return norm(add(add(p.fwd, mul(p.up, 0.2)), mul(p.left, side === "L" ? 0.25 : -0.25)));
}
function flatHand(sk: Skeleton): Vec {
  const c = sk.chestB;
  return perp(add(c.up, c.fwd), UP, perp(sk.pelvisB.fwd, UP, [0, 0, 1]));
}

function legPlan(l: Leg, pelvis: Basis, side: Lr, props: readonly Prop[]): LegPlan {
  if (isLegReach(l)) {
    return {
      reach: {
        target: (sk) => resolveTarget(l.ankle, sk, props, DIM.ankleH),
        bend: (sk) => (l.bend ? norm(l.bend) : defaultLegBend(sk, side)),
        finish: (thigh, shank, sk) => legFromDirs(thigh, shank, sk.pelvisB, l.foot, l.point, onGround(l.ankle)),
      },
    };
  }
  const w = (v: Vec) => (l.space === "body" ? fromBody(pelvis, v) : v);
  return { dirs: legFromDirs(w(l.thigh), w(l.shank), pelvis, l.foot ? w(l.foot) : undefined, l.point) };
}

function armPlan(a: Arm, chest: Basis, side: Lr, props: readonly Prop[]): ArmPlan {
  if (isArmReach(a)) {
    return {
      reach: {
        target: (sk) => resolveTarget(a.wrist, sk, props, DIM.wristH),
        bend: (sk) => (a.bend ? norm(a.bend) : defaultArmBend(sk, side)),
        hand: (fore, sk) => (a.hand ? norm(a.hand) : onGround(a.wrist) ? flatHand(sk) : fore),
      },
    };
  }
  const w = (v: Vec) => (a.space === "body" ? fromBody(chest, v) : v);
  const upper = norm(w(a.upper), [0, -1, 0]);
  const fore = norm(w(a.fore), upper);
  return { dirs: { upper, fore, hand: a.hand ? norm(w(a.hand)) : fore } };
}

function planOf(pose: Pose, props: readonly Prop[]): Plan {
  const pelvis = frameBasis(pose.pelvis);
  const chest = frameBasis(pose.chest ?? pose.pelvis);
  const head = frameBasis(pose.head ?? pose.chest ?? pose.pelvis);
  return {
    pelvis,
    chest,
    head,
    leg: { L: legPlan(pose.legL, pelvis, "L", props), R: legPlan(pose.legR, pelvis, "R", props) },
    arm: { L: armPlan(pose.armL, chest, "L", props), R: armPlan(pose.armR, chest, "R", props) },
    place: [{ anchor: pose.anchor ?? "pelvis", at: pose.at ?? [0, 0], y: pose.y, w: 1 }],
  };
}

const limbOf = (j: JointName): Limb | null => {
  const side = j.endsWith("L") ? "L" : j.endsWith("R") ? "R" : null;
  if (!side) return null;
  if (/^(knee|ankle|toe|heel)/.test(j)) return `leg${side}`;
  if (/^(elbow|wrist|hand)/.test(j)) return `arm${side}`;
  return null;
};

function assemble(plan: Plan, props: readonly Prop[]): Skeleton {
  const { pelvis, chest, head } = plan;
  const p = {} as Record<JointName, Vec>;
  const issues: string[] = [];
  p.pelvis = [0, 0, 0];
  p.waist = mul(pelvis.up, DIM.waist);
  const mid = norm(add(pelvis.up, chest.up), pelvis.up);
  p.chest = madd(p.waist, mid, DIM.spine);
  p.neck = madd(p.chest, chest.up, DIM.neckUp);
  p.head = add(madd(p.neck, norm(add(chest.up, head.up), head.up), 0.065), mul(head.up, 0.075));
  const S = madd(p.chest, chest.up, DIM.shoulderUp);
  for (const side of SIDES) {
    const sgn = side === "L" ? 1 : -1;
    p[`hip${side}`] = mul(pelvis.left, DIM.hipW * sgn);
    p[`shoulder${side}`] = madd(S, chest.left, DIM.shoulderW * sgn);
  }
  const sk: Skeleton = { pelvisB: pelvis, chestB: chest, headB: head, p, leg: {} as Record<Lr, LegSolved>, arm: {} as Record<Lr, ArmSolved>, issues };
  const skip: Partial<Record<Limb, boolean>> = {};

  const setLeg = (side: Lr, leg: LegSolved, knee: Vec, ankle: Vec) => {
    sk.leg[side] = leg;
    p[`knee${side}`] = knee;
    p[`ankle${side}`] = ankle;
    p[`toe${side}`] = add(madd(ankle, leg.foot, 0.168), mul(leg.footUp, -0.057));
    p[`heel${side}`] = add(madd(ankle, leg.foot, -0.03), mul(leg.footUp, -0.04));
  };
  const setArm = (side: Lr, arm: ArmSolved, elbow: Vec, wrist: Vec) => {
    sk.arm[side] = arm;
    p[`elbow${side}`] = elbow;
    p[`wrist${side}`] = wrist;
    p[`hand${side}`] = madd(wrist, arm.hand, 0.09);
  };

  for (const side of SIDES) {
    const lp = plan.leg[side];
    if (lp.dirs) {
      const knee = madd(p[`hip${side}`], lp.dirs.thigh, DIM.thigh);
      setLeg(side, lp.dirs, knee, madd(knee, lp.dirs.shank, DIM.shank));
    } else skip[`leg${side}`] = true;
    const ap = plan.arm[side];
    if (ap.dirs) {
      const elbow = madd(p[`shoulder${side}`], ap.dirs.upper, DIM.upper);
      setArm(side, ap.dirs, elbow, madd(elbow, ap.dirs.fore, DIM.fore));
    } else skip[`arm${side}`] = true;
  }

  // set the body down: where the anchor stands, and how high the pelvis is
  const spheres = bodyBlobs(sk, 0, skip).flatMap((b) => b.s);
  let tx = 0;
  let ty = 0;
  let tz = 0;
  for (const pl of plan.place) {
    let anchor = pl.anchor;
    const limb = limbOf(anchor);
    if (limb && skip[limb]) {
      issues.push(`anchor ${anchor} belongs to a reaching limb; using the pelvis instead`);
      anchor = "pelvis";
    }
    const a = p[anchor];
    const dx = pl.at[0] - a[0];
    const dz = pl.at[1] - a[2];
    let dy: number;
    if (pl.y !== undefined) dy = pl.y;
    else {
      dy = -Infinity;
      for (const s of spheres) dy = Math.max(dy, supportAt(s.c[0] + dx, s.c[2] + dz, props) - (s.c[1] - s.r));
    }
    tx += dx * pl.w;
    ty += dy * pl.w;
    tz += dz * pl.w;
  }
  const T: Vec = [tx, ty, tz];
  for (const k of Object.keys(p) as JointName[]) p[k] = add(p[k], T);

  // limbs that reach for a point
  for (const side of SIDES) {
    const lp = plan.leg[side];
    if (lp.reach) {
      const hip = p[`hip${side}`];
      const target = lp.reach.target(sk);
      const r = twoBone(hip, target, DIM.thigh, DIM.shank, lp.reach.bend(sk));
      if (r.short > 0.01) issues.push(`leg${side}: ankle target is ${(r.short * 100).toFixed(0)} cm out of reach`);
      setLeg(side, lp.reach.finish(norm(sub(r.mid, hip)), norm(sub(r.end, r.mid)), sk), r.mid, r.end);
    }
  }
  for (const side of SIDES) {
    const ap = plan.arm[side];
    if (ap.reach) {
      const sh = p[`shoulder${side}`];
      // a target on the other arm that is not solved yet: fall back to its shoulder
      const other = side === "L" ? "R" : "L";
      if (!sk.arm[other]) {
        p[`elbow${other}`] ??= p[`shoulder${other}`];
        p[`wrist${other}`] ??= p[`shoulder${other}`];
        p[`hand${other}`] ??= p[`shoulder${other}`];
      }
      const target = ap.reach.target(sk);
      const r = twoBone(sh, target, DIM.upper, DIM.fore, ap.reach.bend(sk));
      if (r.short > 0.01) issues.push(`arm${side}: wrist target is ${(r.short * 100).toFixed(0)} cm out of reach`);
      const upper = norm(sub(r.mid, sh));
      const fore = norm(sub(r.end, r.mid));
      setArm(side, { upper, fore, hand: ap.reach.hand(fore, sk) }, r.mid, r.end);
    }
  }
  return sk;
}

/** One pose, solved. */
export function solvePose(pose: Pose, props: readonly Prop[] = []): Skeleton {
  return assemble(planOf(pose, props), props);
}

/** A keyframe with its solved skeleton (kept, so in-betweens are cheap). */
export interface Key {
  pose: Pose;
  sk: Skeleton;
}

export function key(pose: Pose, props: readonly Prop[] = []): Key {
  return { pose, sk: solvePose(pose, props) };
}

/** The body between two keyframes (t from 0 to 1). Limbs that reach in both keep reaching (a planted hand stays planted). */
export function solveBetween(a: Key, b: Key, t: number, props: readonly Prop[] = []): Skeleton {
  if (t <= 0) return a.sk;
  if (t >= 1) return b.sk;
  const pelvis = slerpBasis(a.sk.pelvisB, b.sk.pelvisB, t);
  const chest = slerpBasis(a.sk.chestB, b.sk.chestB, t);
  const head = slerpBasis(a.sk.headB, b.sk.headB, t);
  const plan: Plan = {
    pelvis,
    chest,
    head,
    leg: {} as Record<Lr, LegPlan>,
    arm: {} as Record<Lr, ArmPlan>,
    place: [
      { anchor: a.pose.anchor ?? "pelvis", at: a.pose.at ?? [0, 0], y: a.pose.y, w: 1 - t },
      { anchor: b.pose.anchor ?? "pelvis", at: b.pose.at ?? [0, 0], y: b.pose.y, w: t },
    ],
  };
  for (const side of SIDES) {
    const la = a.pose[`leg${side}`];
    const lb = b.pose[`leg${side}`];
    const sa = a.sk.leg[side];
    const sb = b.sk.leg[side];
    const mixLeg = (thigh: Vec, shank: Vec): LegSolved => {
      const f = fronts(thigh, shank, pelvis);
      const foot = slerp(sa.foot, sb.foot, t);
      return { thigh, shank, foot, footUp: perp(slerp(sa.footUp, sb.footUp, t), foot, f.shinFront), shinFront: f.shinFront, thighFront: f.thighFront };
    };
    if (isLegReach(la) && isLegReach(lb)) {
      plan.leg[side] = {
        reach: {
          target: (sk) => lerp(resolveTarget(la.ankle, sk, props, DIM.ankleH), resolveTarget(lb.ankle, sk, props, DIM.ankleH), t),
          bend: (sk) => slerp(la.bend ?? defaultLegBend(sk, side), lb.bend ?? defaultLegBend(sk, side), t),
          finish: (thigh, shank) => mixLeg(thigh, shank),
        },
      };
    } else plan.leg[side] = { dirs: mixLeg(slerp(sa.thigh, sb.thigh, t), slerp(sa.shank, sb.shank, t)) };

    const aa = a.pose[`arm${side}`];
    const ab = b.pose[`arm${side}`];
    const ra = a.sk.arm[side];
    const rb = b.sk.arm[side];
    if (isArmReach(aa) && isArmReach(ab)) {
      plan.arm[side] = {
        reach: {
          target: (sk) => lerp(resolveTarget(aa.wrist, sk, props, DIM.wristH), resolveTarget(ab.wrist, sk, props, DIM.wristH), t),
          bend: (sk) => slerp(aa.bend ?? defaultArmBend(sk, side), ab.bend ?? defaultArmBend(sk, side), t),
          hand: () => slerp(ra.hand, rb.hand, t),
        },
      };
    } else plan.arm[side] = { dirs: { upper: slerp(ra.upper, rb.upper, t), fore: slerp(ra.fore, rb.fore, t), hand: slerp(ra.hand, rb.hand, t) } };
  }
  return assemble(plan, props);
}

// ---------- mirroring: the same exercise for the other side ----------

const swapName = <T extends string>(j: T): T => (j.endsWith("L") ? (`${j.slice(0, -1)}R` as T) : j.endsWith("R") ? (`${j.slice(0, -1)}L` as T) : j);
const mv = (v: Vec | undefined): Vec | undefined => (v ? mirrorX(v) : undefined);

function mirrorTarget(t: Target): Target {
  if (Array.isArray(t)) return mirrorX(t as Vec);
  const o = t as Exclude<Target, Vec>;
  if ("floor" in o) return { floor: [-o.floor[0], o.floor[1]] };
  if ("under" in o) return { under: swapName(o.under), offset: o.offset ? [-o.offset[0], o.offset[1]] : undefined };
  return { at: swapName(o.at), offset: mv(o.offset) };
}
const mirrorFrame = (f: Frame): Frame => ({ up: mirrorX(f.up), fwd: mirrorX(f.fwd) });
function mirrorLeg(l: Leg): Leg {
  if (isLegReach(l)) return { ankle: mirrorTarget(l.ankle), bend: mv(l.bend), foot: mv(l.foot), point: l.point };
  return { thigh: mirrorX(l.thigh), shank: mirrorX(l.shank), foot: mv(l.foot), point: l.point, space: l.space };
}
function mirrorArm(a: Arm): Arm {
  if (isArmReach(a)) return { wrist: mirrorTarget(a.wrist), bend: mv(a.bend), hand: mv(a.hand) };
  return { upper: mirrorX(a.upper), fore: mirrorX(a.fore), hand: mv(a.hand), space: a.space };
}

export function mirrorPose(p: Pose): Pose {
  return {
    pelvis: mirrorFrame(p.pelvis),
    chest: p.chest ? mirrorFrame(p.chest) : undefined,
    head: p.head ? mirrorFrame(p.head) : undefined,
    legL: mirrorLeg(p.legR),
    legR: mirrorLeg(p.legL),
    armL: mirrorArm(p.armR),
    armR: mirrorArm(p.armL),
    anchor: p.anchor ? swapName(p.anchor) : undefined,
    at: p.at ? [-p.at[0], p.at[1]] : undefined,
    y: p.y,
  };
}

export function mirrorProp(p: Prop): Prop {
  switch (p.type) {
    case "box":
      return { ...p, at: [-p.at[0], p.at[1]], yaw: p.yaw ? -p.yaw : p.yaw };
    case "wall":
      return p.axis === "x" ? { ...p, at: -p.at, faces: (p.faces === 1 ? -1 : 1) as 1 | -1 } : p;
    case "stick":
      return { ...p, a: mirrorTarget(p.a), b: mirrorTarget(p.b) };
    case "roller":
      return { ...p, at: [-p.at[0], p.at[1]] };
    case "band":
      return { ...p, a: mirrorTarget(p.a), b: mirrorTarget(p.b) };
  }
}

/** The same animation for the other side: a mirror image, seen from the mirrored camera. */
export function mirrorAnim(a: Anim): Anim {
  return {
    ...a,
    frames: a.frames.map((f) => ({ ...f, pose: mirrorPose(f.pose) })),
    camera: { ...a.camera, az: -a.camera.az },
    spots: a.spots?.map((s) => swapName(s)),
    props: a.props?.map(mirrorProp),
  };
}

// ---------- the loop in time ----------

export interface Timeline {
  keys: Key[];
  /** seconds: move into frame i, then hold */
  move: number[];
  hold: number[];
  total: number;
  props: readonly Prop[];
}

export function timeline(anim: Anim): Timeline {
  const props = anim.props ?? [];
  const keys = anim.frames.map((f) => key(f.pose, props));
  const single = keys.length === 1;
  const move = anim.frames.map((f) => (single ? 0 : Math.max(0.05, f.move ?? 1.4)));
  const hold = anim.frames.map((f) => (single ? 4 : Math.max(0, f.hold ?? 0)));
  const total = move.reduce((a, b) => a + b, 0) + hold.reduce((a, b) => a + b, 0);
  return { keys, move, hold, total, props };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Where the loop is at `seconds`: the body, and how much it is "holding" (0..1, for breathing). */
export function sample(tl: Timeline, seconds: number): { sk: Skeleton; holding: number; frame: number } {
  const n = tl.keys.length;
  if (n === 1) return { sk: tl.keys[0].sk, holding: 1, frame: 0 };
  // the loop starts with frame 0 held, then moves to 1, …, finally moves back into 0
  let t = ((seconds % tl.total) + tl.total) % tl.total;
  for (let i = 0; i < n; i++) {
    if (t < tl.hold[i]) return { sk: tl.keys[i].sk, holding: 1, frame: i };
    t -= tl.hold[i];
    const j = (i + 1) % n;
    if (t < tl.move[j]) return { sk: solveBetween(tl.keys[i], tl.keys[j], ease(t / tl.move[j]), tl.props), holding: 0, frame: j };
    t -= tl.move[j];
  }
  return { sk: tl.keys[0].sk, holding: 1, frame: 0 };
}

/** The frame that shows the exercise best. */
export function mainFrame(anim: Anim): number {
  if (anim.main !== undefined) return clamp(anim.main, 0, anim.frames.length - 1);
  let best = 0;
  let bestHold = -1;
  anim.frames.forEach((f, i) => {
    const h = f.hold ?? 0;
    if (h > bestHold + 1e-9 || (Math.abs(h - bestHold) < 1e-9 && i === 1 && best === 0)) {
      best = i;
      bestHold = h;
    }
  });
  return best;
}

/** Seconds into the loop at which the main frame is being held (its middle). */
export function mainTime(tl: Timeline, main: number): number {
  let t = 0;
  for (let i = 0; i < tl.keys.length; i++) {
    if (i === main) return t + tl.hold[i] / 2;
    t += tl.hold[i] + tl.move[(i + 1) % tl.keys.length];
  }
  return 0;
}
