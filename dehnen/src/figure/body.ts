// The body as round shapes: every part is the hull of a few spheres that sit on the skeleton.
import type { Lr, SpotName } from "./pose.ts";
import type { Skeleton } from "./solve.ts";
import { add, cross, madd, mul, norm, type Vec } from "./vec.ts";

export interface Sphere {
  c: Vec;
  r: number;
}

export type Part = "skin" | "top" | "shorts" | "hair";

export interface Blob {
  id: string;
  part: Part;
  s: Sphere[];
}

export type Limb = "legL" | "legR" | "armL" | "armR";

const sp = (c: Vec, r: number): Sphere => ({ c, r });

/** All body parts of a solved skeleton. `skip` leaves limbs out (used while they are not solved yet). `breath` 0..1 widens the ribs a little. */
export function bodyBlobs(sk: Skeleton, breath = 0, skip?: Partial<Record<Limb, boolean>>): Blob[] {
  const P = sk.p;
  const pb = sk.pelvisB;
  const cb = sk.chestB;
  const hb = sk.headB;
  const midLeft = norm(add(pb.left, cb.left), pb.left);
  const S = madd(P.chest, cb.up, 0.13);
  const out: Blob[] = [];
  const ribs = 0.1 * (1 + 0.035 * breath);

  out.push({ id: "pelvis", part: "shorts", s: [sp(P.hipL, 0.09), sp(P.hipR, 0.09), sp(madd(P.waist, pb.left, 0.055), 0.088), sp(madd(P.waist, pb.left, -0.055), 0.088)] });
  out.push({
    id: "belly",
    part: "top",
    s: [sp(madd(P.waist, midLeft, 0.058), 0.085), sp(madd(P.waist, midLeft, -0.058), 0.085), sp(madd(P.chest, cb.left, 0.07), 0.097), sp(madd(P.chest, cb.left, -0.07), 0.097)],
  });
  out.push({
    id: "ribs",
    part: "top",
    s: [sp(madd(P.chest, cb.left, 0.075), ribs), sp(madd(P.chest, cb.left, -0.075), ribs), sp(madd(S, cb.left, 0.13), 0.068), sp(madd(S, cb.left, -0.13), 0.068)],
  });
  out.push({ id: "neck", part: "skin", s: [sp(madd(S, cb.up, 0.03), 0.045), sp(madd(P.head, hb.up, -0.06), 0.042)] });
  out.push({
    id: "head",
    part: "skin",
    s: [sp(P.head, 0.1), sp(add(madd(P.head, hb.up, -0.05), mul(hb.fwd, 0.03)), 0.074), sp(add(madd(P.head, hb.fwd, 0.097), mul(hb.up, -0.012)), 0.017)],
  });
  out.push({ id: "hair", part: "hair", s: [sp(add(madd(P.head, hb.up, 0.02), mul(hb.fwd, -0.026)), 0.1)] });

  for (const side of ["L", "R"] as Lr[]) {
    if (!skip?.[`leg${side}`]) {
      const leg = sk.leg[side];
      const hip = P[`hip${side}`];
      const knee = P[`knee${side}`];
      const ankle = P[`ankle${side}`];
      const mid = madd(hip, leg.thigh, 0.2);
      out.push({ id: `thighUp${side}`, part: "shorts", s: [sp(hip, 0.087), sp(mid, 0.077)] });
      out.push({ id: `thighLow${side}`, part: "skin", s: [sp(mid, 0.075), sp(knee, 0.056)] });
      out.push({ id: `shank${side}`, part: "skin", s: [sp(knee, 0.053), sp(madd(madd(knee, leg.shank, 0.12), leg.shinFront, -0.012), 0.057), sp(ankle, 0.037)] });
      out.push({
        id: `foot${side}`,
        part: "skin",
        s: [
          sp(add(madd(ankle, leg.foot, -0.03), mul(leg.footUp, -0.04)), 0.04),
          sp(add(madd(ankle, leg.foot, 0.115), mul(leg.footUp, -0.048)), 0.032),
          sp(add(madd(ankle, leg.foot, 0.168), mul(leg.footUp, -0.057)), 0.023),
        ],
      });
    }
    if (!skip?.[`arm${side}`]) {
      const arm = sk.arm[side];
      const sh = P[`shoulder${side}`];
      const el = P[`elbow${side}`];
      const wr = P[`wrist${side}`];
      out.push({ id: `sleeve${side}`, part: "top", s: [sp(sh, 0.058), sp(madd(sh, arm.upper, 0.1), 0.05)] });
      out.push({ id: `upperArm${side}`, part: "skin", s: [sp(madd(sh, arm.upper, 0.09), 0.047), sp(el, 0.04)] });
      out.push({ id: `forearm${side}`, part: "skin", s: [sp(el, 0.04), sp(wr, 0.03)] });
      out.push({ id: `hand${side}`, part: "skin", s: [sp(wr, 0.03), sp(madd(wr, arm.hand, 0.08), 0.038), sp(madd(wr, arm.hand, 0.145), 0.028)] });
    }
  }
  return out;
}

/** Where a "feel it here" glow sits: a point on the surface and its size. */
export function spotAt(sk: Skeleton, name: SpotName): Sphere {
  const P = sk.p;
  const pb = sk.pelvisB;
  const cb = sk.chestB;
  const S = madd(P.chest, cb.up, 0.13);
  switch (name) {
    case "lowBack":
      return sp(madd(P.waist, pb.fwd, -0.085), 0.1);
    case "midBack":
      return sp(madd(P.chest, cb.fwd, -0.095), 0.11);
    case "upperBack":
      return sp(madd(S, cb.fwd, -0.08), 0.1);
    case "belly":
      return sp(add(madd(P.waist, pb.fwd, 0.085), mul(pb.up, 0.04)), 0.1);
    case "neckBack":
      return sp(add(madd(P.neck, cb.fwd, -0.04), mul(cb.up, 0.04)), 0.05);
    case "neckFront":
      return sp(add(madd(P.neck, cb.fwd, 0.04), mul(cb.up, 0.03)), 0.045);
  }
  const side = name.slice(-1) as Lr;
  const base = name.slice(0, -1);
  const sgn = side === "L" ? 1 : -1;
  const leg = sk.leg[side];
  const arm = sk.arm[side];
  const hip = P[`hip${side}`];
  const knee = P[`knee${side}`];
  const ankle = P[`ankle${side}`];
  const sh = P[`shoulder${side}`];
  const lat = mul(pb.left, sgn);
  const clat = mul(cb.left, sgn);
  const midLeft = mul(norm(add(pb.left, cb.left), pb.left), sgn);
  const t = leg.thigh;
  const tf = leg.thighFront;
  const outer = mul(cross(tf, t), sgn);
  switch (base) {
    case "hipSide":
      return sp(add(madd(hip, lat, 0.08), mul(pb.up, 0.02)), 0.09);
    case "hipFront":
      return sp(madd(hip, norm(add(pb.fwd, tf), pb.fwd), 0.075), 0.08);
    case "glute":
      return sp(add(madd(hip, pb.fwd, -0.085), mul(pb.up, -0.01)), 0.1);
    case "groin":
      return sp(add(madd(hip, t, 0.12), mul(outer, -0.065)), 0.075);
    case "innerThigh":
      return sp(add(madd(hip, t, 0.24), mul(outer, -0.06)), 0.085);
    case "outerThigh":
      return sp(add(madd(hip, t, 0.24), mul(outer, 0.065)), 0.09);
    case "quad":
      return sp(add(madd(hip, t, 0.22), mul(tf, 0.07)), 0.09);
    case "hamstring":
      return sp(add(madd(hip, t, 0.24), mul(tf, -0.07)), 0.095);
    case "kneeBack":
      return sp(madd(knee, norm(add(tf, leg.shinFront), tf), -0.05), 0.06);
    case "calf":
      return sp(add(madd(knee, leg.shank, 0.14), mul(leg.shinFront, -0.05)), 0.075);
    case "shin":
      return sp(add(madd(knee, leg.shank, 0.2), mul(leg.shinFront, 0.045)), 0.065);
    case "ankle":
      return sp(ankle, 0.06);
    case "foot":
      return sp(madd(ankle, leg.foot, 0.1), 0.06);
    case "flank":
      return sp(add(madd(P.waist, midLeft, 0.105), mul(pb.up, 0.035)), 0.09);
    case "lat":
      return sp(add(madd(P.chest, clat, 0.115), mul(cb.fwd, -0.03)), 0.1);
    case "chest":
      return sp(add(add(madd(S, clat, 0.09), mul(cb.fwd, 0.085)), mul(cb.up, -0.07)), 0.08);
    case "shoulder":
      return sp(add(madd(sh, clat, 0.03), mul(cb.fwd, 0.03)), 0.075);
    case "shoulderBack":
      return sp(madd(sh, cb.fwd, -0.05), 0.075);
    case "triceps":
    case "biceps":
      return sp(madd(sh, arm.upper, 0.16), 0.07);
    case "forearm":
      return sp(madd(P[`elbow${side}`], arm.fore, 0.12), 0.06);
    case "wrist":
      return sp(P[`wrist${side}`], 0.05);
    case "neckSide":
      return sp(add(madd(P.neck, clat, 0.045), mul(cb.up, 0.035)), 0.05);
  }
  return sp(P.pelvis, 0.08);
}
