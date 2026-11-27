// How a pose and an animation are written down. See docs in scripts/dehnen/POSEN.md.
//
// World: +Y up, the floor is y = 0. A standing figure looks along +Z, its LEFT is +X. Lengths in metres.
// A pose says, for every body segment, which way it points (a direction vector, any length).
// The figure is then set down on the floor (or on a box) by itself.

import type { Vec } from "./vec.ts";

/** An orientation given by two directions (need not be exactly at right angles; `up` wins). */
export interface Frame {
  /** pelvis/chest: along the spine toward the head. head: toward the crown. */
  up: Vec;
  /** pelvis/chest: where the belly / the breastbone faces. head: where the face looks. */
  fwd: Vec;
}

export type Lr = "L" | "R";
export type JointBase = "hip" | "knee" | "ankle" | "toe" | "heel" | "shoulder" | "elbow" | "wrist" | "hand";
export type JointName = "pelvis" | "waist" | "chest" | "neck" | "head" | `${JointBase}${Lr}`;

/** A point in space for a hand or foot to go to. */
export type Target =
  | Vec // a world point (the floor is y = 0; x and z are relative to where the anchor stands)
  | { at: JointName; offset?: Vec } // a joint of the figure (as placed), plus a world offset
  | { floor: readonly [number, number] } // on the floor at [x, z]
  | { under: JointName; offset?: readonly [number, number] }; // on the floor straight below a joint, plus [dx, dz]

/** A leg by directions. */
export interface LegDirs {
  /** hip → knee */
  thigh: Vec;
  /** knee → ankle */
  shank: Vec;
  /** heel → toes. Default: at a right angle to the shank, toward the front of the shin. */
  foot?: Vec;
  /** instead of `foot`: degrees of pointing the foot (0 = right angle, 90 = foot in line with the shank, negative = toes pulled up) */
  point?: number;
  /** "world" (default) or "body" = relative to the pelvis: [left, up, fwd] */
  space?: "world" | "body";
}

/** A leg by where the ankle is (solved like an arm reaching). Needs `y` in the pose if both legs carry the body. */
export interface LegReach {
  ankle: Target;
  /** which way the knee points (world). Default: where the pelvis faces, slightly outward. */
  bend?: Vec;
  foot?: Vec;
  point?: number;
}

export type Leg = LegDirs | LegReach;

/** An arm by directions. */
export interface ArmDirs {
  /** shoulder → elbow */
  upper: Vec;
  /** elbow → wrist */
  fore: Vec;
  /** wrist → fingertips. Default: same as `fore`. */
  hand?: Vec;
  /** "world" (default) or "body" = relative to the chest: [left, up, fwd] */
  space?: "world" | "body";
}

/** An arm by where the WRIST is. The elbow bends toward `bend`. */
export interface ArmReach {
  wrist: Target;
  /** which way the elbow points (world). Default: down and back, slightly outward. */
  bend?: Vec;
  /** wrist → fingertips. Default: along the forearm; on the floor: flat, pointing where the chest's up/fwd point. */
  hand?: Vec;
}

export type Arm = ArmDirs | ArmReach;

export interface Pose {
  pelvis: Frame;
  /** default: same as pelvis (straight spine) */
  chest?: Frame;
  /** default: same as chest */
  head?: Frame;
  legL: Leg;
  legR: Leg;
  armL: Arm;
  armR: Arm;
  /** this joint stays at `at` on the floor plane (x, z). Default "pelvis" at [0, 0]. Keep it the same through an animation, on a part that does not move. */
  anchor?: JointName;
  at?: readonly [number, number];
  /** height of the pelvis centre above the floor. Omit it: the figure then rests on the floor or on a box/roller/block by itself. */
  y?: number;
}

export type SpotBase =
  | "hipSide" // outside of the hip: TFL, gluteus medius
  | "hipFront" // front of the hip: hip flexor
  | "glute"
  | "groin" // inside of the thigh near the hip: adductors
  | "innerThigh"
  | "outerThigh" // IT band
  | "quad"
  | "hamstring"
  | "kneeBack"
  | "calf"
  | "shin"
  | "ankle"
  | "foot"
  | "flank" // side of the waist: QL, obliques
  | "lat" // side of the ribs
  | "chest" // pec
  | "shoulder" // front and side of the shoulder
  | "shoulderBack"
  | "triceps"
  | "biceps"
  | "forearm"
  | "wrist"
  | "neckSide";
export type SpotName = `${SpotBase}${Lr}` | "lowBack" | "midBack" | "upperBack" | "belly" | "neckBack" | "neckFront";

export type Prop =
  /** a box: chair seat, bench, step, block. `at` = centre of its footprint [x, z] (world, relative to the anchor), `size` = [width x, height y, depth z]. The body rests on it. */
  | { type: "box"; at: readonly [number, number]; size: Vec; yaw?: number; base?: number }
  /** a wall: a vertical plane. axis "z": at z = `at`, the room is on the side given by `faces` (+1: room toward +z, -1: toward -z). axis "x" likewise. */
  | { type: "wall"; axis: "x" | "z"; at: number; faces: 1 | -1 }
  /** the paddle or a stick through two points (usually the two hands), sticking out `extend` metres at both ends. */
  | { type: "stick"; a: Target; b: Target; extend?: number; paddle?: boolean }
  /** a foam roller lying on the floor: centre [x, z], axis along "x" or "z". The body rests on it. */
  | { type: "roller"; at: readonly [number, number]; axis: "x" | "z"; length?: number; radius?: number }
  /** a strap between two points */
  | { type: "band"; a: Target; b: Target };

export interface Keyframe {
  pose: Pose;
  /** seconds to move here from the frame before (for the first frame: from the last one, when the loop closes). Default 1.4. */
  move?: number;
  /** seconds to stay here. Default 0. */
  hold?: number;
}

export interface Camera {
  /** where the camera stands, in degrees around the figure: 0 = in front (looking at the face of a figure that faces +Z), 90 = at its left side, -90 = at its right side, 180 = behind. */
  az: number;
  /** degrees above the horizon. Default 12. */
  el?: number;
}

export interface Anim {
  /** at least one frame. The loop runs 0 → 1 → … → last → 0. For a static stretch: frame 0 = way in (start position), frame 1 = the stretch with a long hold. */
  frames: Keyframe[];
  /** index of the frame that shows the exercise best (used for stills). Default: the frame with the longest hold. */
  main?: number;
  camera: Camera;
  /** where it should be felt, for the LEFT-side version */
  spots?: SpotName[];
  props?: Prop[];
  /** turn the mat by 90° (long side along X). Default: chosen from the footprint. */
  matAcross?: boolean;
}

export type AnimSet = Record<string, Anim>;

export const isLegReach = (l: Leg): l is LegReach => "ankle" in l;
export const isArmReach = (a: Arm): a is ArmReach => "wrist" in a;
