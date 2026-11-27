// Helpers and ready-made starting positions for writing poses. Copy a base and change what differs.
import type { Anim, Arm, Frame, Keyframe, Leg, Pose, Prop } from "./pose.ts";
import { norm, rot, slerp, type Vec } from "./vec.ts";

export const UP: Vec = [0, 1, 0];
export const DOWN: Vec = [0, -1, 0];
export const FWD: Vec = [0, 0, 1];
export const BACK: Vec = [0, 0, -1];
export const LEFT: Vec = [1, 0, 0];
export const RIGHT: Vec = [-1, 0, 0];

const rad = (d: number) => (d * Math.PI) / 180;

/** A direction in the front-back plane: 0 = straight down, 90 = forward (+Z), 180 = straight up, -90 = backward. */
export const sag = (deg: number): Vec => [0, -Math.cos(rad(deg)), Math.sin(rad(deg))];
/** A direction in the left-right plane: 0 = straight down, 90 = to the figure's left (+X), -90 = to its right, 180 = up. */
export const lat = (deg: number): Vec => [Math.sin(rad(deg)), -Math.cos(rad(deg)), 0];
/** A direction on the floor plane: 0 = forward (+Z), 90 = to the figure's left (+X), -90 = right, 180 = back. `rise` lifts it above the horizon in degrees. */
export const flat = (deg: number, rise = 0): Vec => [Math.sin(rad(deg)) * Math.cos(rad(rise)), Math.sin(rad(rise)), Math.cos(rad(deg)) * Math.cos(rad(rise))];
/** Turn a direction around an axis by degrees (right-hand rule). Around LEFT (+X): positive tips "up" toward "forward"… use the sheet to see. */
export const turn = (v: Vec, axis: Vec, deg: number): Vec => rot(v, axis, deg);
/** Between two directions (t = 0 … 1). */
export const between = (a: Vec, b: Vec, t: number): Vec => slerp(a, b, t);
export const dir = (x: number, y: number, z: number): Vec => norm([x, y, z]);

export const frame = (up: Vec, fwd: Vec): Frame => ({ up, fwd });
/** Turn a whole frame around an axis. */
export const turnFrame = (f: Frame, axis: Vec, deg: number): Frame => ({ up: rot(f.up, axis, deg), fwd: rot(f.fwd, axis, deg) });

/** Upright, looking along +Z. */
export const UPRIGHT: Frame = { up: UP, fwd: FWD };
/** Lying on the back, head toward -Z, feet toward +Z. */
export const ON_BACK: Frame = { up: BACK, fwd: UP };
/** Lying on the belly, head toward +Z. */
export const ON_BELLY: Frame = { up: FWD, fwd: DOWN };
/** On all fours: spine level, rising slightly to the shoulders, head toward +Z. */
export const ALL_FOURS: Frame = { up: [0, 0.2, 1], fwd: [0, -1, 0.2] };

/** Arms hanging by the sides (standing or sitting upright). */
export const armDownL: Arm = { upper: [0.14, -1, 0], fore: [0.06, -1, 0.14] };
export const armDownR: Arm = { upper: [-0.14, -1, 0], fore: [-0.06, -1, 0.14] };
/** Hands on the hips, elbows out. */
export const armHipL: Arm = { wrist: { at: "hipL", offset: [0.115, 0.1, 0.03] }, bend: [0.75, 0, -0.65], hand: [-0.3, -0.75, 0.6] };
export const armHipR: Arm = { wrist: { at: "hipR", offset: [-0.115, 0.1, 0.03] }, bend: [-0.75, 0, -0.65], hand: [0.3, -0.75, 0.6] };

/** Change some parts of a pose. */
export const withPose = (base: Pose, patch: Partial<Pose>): Pose => ({ ...base, ...patch });

/** A chair or bench to sit on: put it into `props` together with BASES.chairSit. */
export const CHAIR: Prop = { type: "box", at: [0, -0.04], size: [0.46, 0.43, 0.44] };

const legStraightL: Leg = { thigh: [0.04, -1, 0], shank: [0, -1, 0] };
const legStraightR: Leg = { thigh: [-0.04, -1, 0], shank: [0, -1, 0] };
const kneelL: Leg = { thigh: [0.04, -1, 0], shank: [0, -0.03, -1], point: 68 };
const kneelR: Leg = { thigh: [-0.04, -1, 0], shank: [0, -0.03, -1], point: 68 };

/** The starting positions. All are symmetric or have the LEFT side as the working side. A standing figure looks along +Z. */
export const BASES = {
  /** Standing, arms by the sides. */
  stand: { pelvis: UPRIGHT, legL: legStraightL, legR: legStraightR, armL: armDownL, armR: armDownR },
  /** Kneeling upright on both knees, insteps on the floor. */
  tallKneel: { pelvis: UPRIGHT, legL: kneelL, legR: kneelR, armL: armDownL, armR: armDownR },
  /** Half kneeling: LEFT knee on the floor under the hip (the knee stays at [0, 0]), right foot planted in front at floor [-0.2, 0.46], hands on the hips. */
  halfKneel: {
    pelvis: UPRIGHT,
    legL: { thigh: [0.02, -1, 0], shank: [0, -0.03, -1], point: 68 },
    legR: { ankle: { floor: [-0.2, 0.46] } },
    armL: armHipL,
    armR: armHipR,
    anchor: "kneeL",
  },
  /** Low lunge: LEFT knee on the floor behind (at [0, 0]), right foot planted far in front at floor [-0.2, 0.68], hips sunk forward, torso upright. */
  lunge: {
    pelvis: { up: [0, 1, 0.12], fwd: [0, -0.12, 1] },
    chest: UPRIGHT,
    legL: { thigh: sag(-24), shank: [0, -0.02, -1], point: 68 },
    legR: { ankle: { floor: [-0.2, 0.68] } },
    armL: armHipL,
    armR: armHipR,
    anchor: "kneeL",
  },
  /** On all fours: pelvis over [0, 0], knees under the hips, hands planted under the shoulders at floor [±0.185, 0.46]. */
  quadruped: {
    pelvis: ALL_FOURS,
    head: { up: [0, 0.25, 1], fwd: [0, -1, 0.25] },
    legL: { thigh: [0.02, -1, 0], shank: [0, -0.03, -1], point: 68 },
    legR: { thigh: [-0.02, -1, 0], shank: [0, -0.03, -1], point: 68 },
    armL: { wrist: { floor: [0.185, 0.46] } },
    armR: { wrist: { floor: [-0.185, 0.46] } },
  },
  /** Sitting on the heels (seiza), hands on the thighs. */
  heelSit: {
    pelvis: UPRIGHT,
    legL: { thigh: [0.1, -0.36, 1], shank: [0, 0.03, -1], point: 72 },
    legR: { thigh: [-0.1, -0.36, 1], shank: [0, 0.03, -1], point: 72 },
    armL: { wrist: { at: "kneeL", offset: [0, 0.1, -0.24] }, bend: [0.5, -0.2, -0.8] },
    armR: { wrist: { at: "kneeR", offset: [0, 0.1, -0.24] }, bend: [-0.5, -0.2, -0.8] },
  },
  /** Child's pose: sitting back on the heels, torso folded forward over the thighs, arms long in front on the floor. */
  childPose: {
    pelvis: { up: [0, 0.3, 1], fwd: [0, -1, 0.3] },
    chest: { up: [0, -0.26, 1], fwd: [0, -1, -0.26] },
    head: { up: [0, -0.45, 1], fwd: [0, -1, -0.45] },
    legL: { thigh: [0.16, -0.36, 1], shank: [0, 0.03, -1], point: 72 },
    legR: { thigh: [-0.16, -0.36, 1], shank: [0, 0.03, -1], point: 72 },
    armL: { wrist: { under: "shoulderL", offset: [0.04, 0.5] }, bend: [0.6, 0.3, 0] },
    armR: { wrist: { under: "shoulderR", offset: [-0.04, 0.5] }, bend: [-0.6, 0.3, 0] },
    anchor: "kneeL",
    at: [0.2, 0],
  },
  /** Deep squat, feet flat, knees wide, arms forward between the knees. */
  squat: {
    pelvis: { up: [0, 0.9, 0.44], fwd: [0, -0.44, 0.9] },
    legL: { thigh: [0.42, 0.42, 0.8], shank: [-0.12, -1, -0.22], foot: [0.3, 0, 1] },
    legR: { thigh: [-0.42, 0.42, 0.8], shank: [0.12, -1, -0.22], foot: [-0.3, 0, 1] },
    armL: { upper: [0.1, -0.35, 1], fore: [-0.35, 0.25, 0.9] },
    armR: { upper: [-0.1, -0.35, 1], fore: [0.35, 0.25, 0.9] },
  },
  /** Sitting on the floor, legs long in front (as in the kayak), hands beside the hips. */
  longSit: {
    pelvis: UPRIGHT,
    legL: { thigh: [0.05, -0.04, 1], shank: [0, -0.02, 1] },
    legR: { thigh: [-0.05, -0.04, 1], shank: [0, -0.02, 1] },
    armL: { wrist: { floor: [0.27, -0.06] }, bend: [0.4, 0, -1], hand: [0.2, 0, 1] },
    armR: { wrist: { floor: [-0.27, -0.06] }, bend: [-0.4, 0, -1], hand: [-0.2, 0, 1] },
  },
  /** Sitting cross-legged, hands on the knees. */
  crossSit: {
    pelvis: UPRIGHT,
    legL: { thigh: [0.78, -0.1, 0.62], shank: [-0.98, -0.06, -0.06], foot: [-0.8, -0.05, 0.6] },
    legR: { thigh: [-0.78, -0.1, 0.62], shank: [0.94, -0.06, 0.24], foot: [0.8, -0.05, 0.6] },
    armL: { wrist: { at: "kneeL", offset: [-0.03, 0.09, -0.04] }, bend: [0.5, -0.6, -0.5] },
    armR: { wrist: { at: "kneeR", offset: [0.03, 0.09, -0.04] }, bend: [-0.5, -0.6, -0.5] },
  },
  /** Butterfly: sitting, soles together, knees out, hands at the feet. */
  butterfly: {
    pelvis: { up: [0, 1, 0.14], fwd: [0, -0.14, 1] },
    chest: { up: [0, 1, 0.34], fwd: [0, -0.34, 1] },
    head: { up: [0, 1, 0.3], fwd: [0, -0.3, 1] },
    legL: { thigh: [0.86, 0.12, 0.5], shank: [-0.86, -0.3, 0.42], foot: [-0.25, 0, 1] },
    legR: { thigh: [-0.86, 0.12, 0.5], shank: [0.86, -0.3, 0.42], foot: [0.25, 0, 1] },
    armL: { wrist: { at: "ankleL", offset: [0.04, 0.08, -0.03] }, bend: [0.8, -0.3, -0.4] },
    armR: { wrist: { at: "ankleR", offset: [-0.04, 0.08, -0.03] }, bend: [-0.8, -0.3, -0.4] },
  },
  /** Straddle sit: legs wide and long, torso upright, hands on the floor in front. */
  straddle: {
    pelvis: UPRIGHT,
    legL: { thigh: [0.82, -0.04, 0.57], shank: [0.82, -0.02, 0.57] },
    legR: { thigh: [-0.82, -0.04, 0.57], shank: [-0.82, -0.02, 0.57] },
    armL: { wrist: { floor: [0.14, 0.22] }, bend: [0.8, 0.2, -0.3] },
    armR: { wrist: { floor: [-0.14, 0.22] }, bend: [-0.8, 0.2, -0.3] },
  },
  /** 90/90 sit: LEFT leg in front (shin across), right leg to the side and back, torso upright over the front leg. */
  sit9090: {
    pelvis: UPRIGHT,
    legL: { thigh: [0.38, -0.08, 1], shank: [-1, -0.02, 0.08], point: 45 },
    legR: { thigh: [-1, -0.08, 0.12], shank: [0.1, -0.02, -1], point: 60 },
    armL: { wrist: { floor: [0.3, 0.12] }, bend: [0.7, 0, -0.6] },
    armR: { wrist: { floor: [-0.22, 0.2] }, bend: [-0.7, 0, -0.6] },
  },
  /** Pigeon: LEFT shin across in front, right leg long behind, torso upright, hands on the floor beside the hips. */
  pigeon: {
    pelvis: { up: [0, 0.6, 0.8], fwd: [0, -0.8, 0.6] },
    chest: { up: [0, 1, 0.22], fwd: [0, -0.22, 1] },
    head: UPRIGHT,
    legL: { thigh: [0.5, -0.1, 0.86], shank: [-1, -0.04, 0.2], point: 45 },
    legR: { thigh: [-0.05, -0.12, -1], shank: [0, -0.02, -1], point: 72 },
    armL: { wrist: { floor: [0.33, 0.2] }, bend: [0.6, 0, -0.7] },
    armR: { wrist: { floor: [-0.3, 0.2] }, bend: [-0.6, 0, -0.7] },
  },
  /** Downward dog: hands and feet on the floor, hips high. */
  downDog: {
    pelvis: { up: [0, -0.64, 0.77], fwd: [0, -0.77, -0.64] },
    head: { up: [0, -0.8, 0.6], fwd: [0, -0.6, -0.8] },
    legL: { thigh: [0.03, -0.82, -0.57], shank: [0, -0.82, -0.57], foot: [0, -0.22, 1] },
    legR: { thigh: [-0.03, -0.82, -0.57], shank: [0, -0.82, -0.57], foot: [0, -0.22, 1] },
    armL: { wrist: { floor: [0.2, 0.62] }, bend: [0.8, 0.3, 0] },
    armR: { wrist: { floor: [-0.2, 0.62] }, bend: [-0.8, 0.3, 0] },
  },
  /** High plank: hands under the shoulders, body in one line. */
  plank: {
    pelvis: { up: [0, 0.3, 1], fwd: [0, -1, 0.3] },
    head: { up: [0, 0.35, 1], fwd: [0, -1, 0.35] },
    legL: { thigh: [0.03, -0.3, -1], shank: [0, -0.3, -1], point: -25 },
    legR: { thigh: [-0.03, -0.3, -1], shank: [0, -0.3, -1], point: -25 },
    armL: { wrist: { under: "shoulderL" } },
    armR: { wrist: { under: "shoulderR" } },
  },
  /** Lying on the back, legs long, arms beside the body. Head toward -Z, feet toward +Z. */
  supine: {
    pelvis: ON_BACK,
    legL: { thigh: [0.06, -0.03, 1], shank: [0, -0.04, 1] },
    legR: { thigh: [-0.06, -0.03, 1], shank: [0, -0.04, 1] },
    armL: { upper: [0.28, -0.1, 1], fore: [0.1, 0, 1] },
    armR: { upper: [-0.28, -0.1, 1], fore: [-0.1, 0, 1] },
  },
  /** Lying on the back, knees bent, feet flat on the floor. */
  supineHook: {
    pelvis: ON_BACK,
    legL: { thigh: [0.05, 0.72, 0.7], shank: [0, -0.8, 0.6], foot: [0, 0, 1] },
    legR: { thigh: [-0.05, 0.72, 0.7], shank: [0, -0.8, 0.6], foot: [0, 0, 1] },
    armL: { upper: [0.28, -0.1, 1], fore: [0.1, 0, 1] },
    armR: { upper: [-0.28, -0.1, 1], fore: [-0.1, 0, 1] },
  },
  /** Lying on the belly, legs long, forehead resting on the hands. Head toward +Z. */
  prone: {
    pelvis: ON_BELLY,
    head: { up: [0, 0.12, 1], fwd: [0, -1, 0.12] },
    legL: { thigh: [0.05, -0.03, -1], shank: [0, -0.1, -1], point: 72 },
    legR: { thigh: [-0.05, -0.03, -1], shank: [0, -0.1, -1], point: 72 },
    armL: { upper: [1, -0.12, 0.45], fore: [-0.75, 0, 0.66], hand: [-0.9, 0, 0.4] },
    armR: { upper: [-1, -0.12, 0.45], fore: [0.75, 0, 0.66], hand: [0.9, 0, 0.4] },
  },
  /** Lying on the RIGHT side (the LEFT side is on top), legs slightly bent, head on the lower arm, belly facing -X. Head toward -Z. Good camera: az -90. */
  sideLying: {
    pelvis: { up: [0, 0.1, -1], fwd: [-1, 0, 0] },
    chest: { up: [0, 0.16, -1], fwd: [-1, 0, 0] },
    head: { up: [0, -0.1, -1], fwd: [-1, 0, 0] },
    legL: { thigh: [-0.3, -0.02, 1], shank: [0.22, -0.02, 1], foot: [-1, 0, 0.1] },
    legR: { thigh: [-0.3, 0, 1], shank: [0.22, 0, 1], foot: [-1, 0, 0.1] },
    armL: { wrist: { floor: [-0.3, -0.38] }, bend: [0, 1, 0.3], hand: [0, 0, -1] },
    armR: { upper: [-0.1, -0.05, -1], fore: [-0.3, 0.25, -0.9] },
  },
  /** Sitting on a chair (add CHAIR to props), feet flat, hands on the thighs. */
  chairSit: {
    pelvis: UPRIGHT,
    legL: { thigh: [0.08, -0.03, 1], shank: [0, -1, 0.04] },
    legR: { thigh: [-0.08, -0.03, 1], shank: [0, -1, 0.04] },
    armL: { wrist: { at: "kneeL", offset: [0, 0.09, -0.14] }, bend: [0.5, -0.2, -0.8] },
    armR: { wrist: { at: "kneeR", offset: [0, 0.09, -0.14] }, bend: [-0.5, -0.2, -0.8] },
  },
} satisfies Record<string, Pose>;

export type BaseName = keyof typeof BASES;

// ---------- the rhythm of the loops (the same for every exercise) ----------

/** A stretch that is held: `start` is the way in (shown briefly), `end` is the stretch (held, with breathing). */
export function hold(start: Pose, end: Pose): Pick<Anim, "frames" | "main"> {
  return { frames: [{ pose: start, move: 1.8, hold: 0.9 }, { pose: end, move: 1.8, hold: 3.6 }], main: 1 };
}

/** A stretch with a stop on the way: start → middle → end (held) → start. */
export function hold3(start: Pose, middle: Pose, end: Pose): Pick<Anim, "frames" | "main"> {
  return { frames: [{ pose: start, move: 1.8, hold: 0.7 }, { pose: middle, move: 1.5, hold: 0.3 }, { pose: end, move: 1.5, hold: 3.6 }], main: 2 };
}

/** A movement that repeats: the poses are passed through evenly, one round takes `tempo` seconds (the exercise's "tempo"). `pause` holds each pose briefly. */
export function flow(tempo: number, poses: Pose[], main = 1, pause = 0): Pick<Anim, "frames" | "main"> {
  const move = Math.max(0.3, tempo / poses.length - pause);
  const frames: Keyframe[] = poses.map((pose) => ({ pose, move, hold: pause }));
  return { frames, main: Math.min(main, poses.length - 1) };
}
