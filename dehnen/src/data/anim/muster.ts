// Five worked examples (also the reference for everyone who writes animations). See scripts/dehnen/POSEN.md.
import { ALL_FOURS, armHipL, armHipR, BASES, flat, flow, hold, sag, UP, UPRIGHT, withPose } from "../../figure/bases.ts";
import type { AnimSet, Pose } from "../../figure/pose.ts";

// --- standing, legs crossed: the left hip pushes out to the left, the torso leans to the right ---
const standHips: Pose = withPose(BASES.stand, { armL: armHipL, armR: armHipR, anchor: "ankleR" });
const crossed: Pose = {
  pelvis: { up: [0.24, 0.97, 0], fwd: [0, 0, 1] }, // the left side of the pelvis drops
  chest: { up: [-0.2, 0.98, 0], fwd: [0, 0, 1] }, // the torso bends to the right
  head: { up: [-0.1, 1, 0], fwd: [0, 0, 1] },
  legL: { thigh: [-0.33, -0.94, -0.07], shank: [-0.28, -0.95, -0.17] }, // crossed behind the right leg
  legR: { thigh: [0.05, -1, 0], shank: [0.05, -1, 0] },
  armL: armHipL,
  armR: armHipR,
  anchor: "ankleR", // the right foot never moves
};

// --- half kneeling: the pelvis glides forward, the left thigh slopes back ---
const kneelForward: Pose = withPose(BASES.halfKneel, {
  pelvis: { up: [0, 1, -0.06], fwd: [0, 0.06, 1] }, // slightly tucked under
  chest: UPRIGHT,
  legL: { thigh: sag(-19), shank: [0, -0.03, -1], point: 68 },
  // legR stays { ankle: { floor: [-0.2, 0.46] } }: the front foot is planted, the knee travels forward by itself
});

// --- cat and cow: only pelvis, spine and head move; the hands stay planted ---
const cat: Pose = withPose(BASES.quadruped, {
  pelvis: { up: [0, 0.6, 1], fwd: [0, -1, 0.6] },
  chest: { up: [0, -0.1, 1], fwd: [0, -1, -0.1] },
  head: { up: [0, -0.9, 1], fwd: [0, -1, -0.9] },
});
const cow: Pose = withPose(BASES.quadruped, {
  pelvis: { up: [0, -0.12, 1], fwd: [0, -1, -0.12] },
  chest: { up: [0, 0.42, 1], fwd: [0, -1, 0.42] },
  head: { up: [0, 0.75, 1], fwd: [0, -1, 0.75] },
});

// --- sitting as in the kayak, paddle on the shoulders, the chest turns left and right ---
const kayak = (turn: number): Pose => ({
  pelvis: UPRIGHT,
  chest: { up: UP, fwd: flat(turn) }, // flat(48) = turned 48° to the figure's left
  legL: { thigh: [0.2, 0.28, 1], shank: [0.04, -0.42, 1] },
  legR: { thigh: [-0.2, 0.28, 1], shank: [-0.04, -0.42, 1] },
  // "body" = relative to the chest [left, up, fwd]: the arms turn with the chest
  armL: { space: "body", upper: [0.75, -0.6, -0.25], fore: [0.45, 0.85, 0.15], hand: [1, 0, 0] },
  armR: { space: "body", upper: [-0.75, -0.6, -0.25], fore: [-0.45, 0.85, 0.15], hand: [-1, 0, 0] },
});

// --- side lying over the roller: the left side arches up, the left arm goes overhead ---
const overRoller = (armUp: boolean): Pose => ({
  pelvis: { up: [0, 0.3, -1], fwd: [-1, 0, 0] }, // on the right side, belly toward -X, pelvis sloping down to the feet
  chest: { up: [0, -0.3, -1], fwd: [-1, 0, 0] }, // the ribs slope down to the head: an arch over the roller
  head: { up: [0, -0.25, -1], fwd: [-1, 0, 0] },
  legL: { thigh: [0, -0.3, 1], shank: [0, -0.12, 1], foot: [-1, 0, 0.1] }, // top leg long
  legR: { thigh: [-1, -0.25, 0.25], shank: [0.15, -0.05, 1], foot: [-1, 0, 0.1] }, // bottom leg bent in front
  armL: armUp ? { upper: [0, 0.25, -1], fore: [0, -0.2, -1] } : { wrist: { at: "hipL", offset: [-0.02, 0.12, 0] }, bend: [0.2, 1, -0.3] },
  armR: { upper: [-0.15, -0.3, -1], fore: [-0.1, 0.05, -1] }, // bottom arm long under the head
});

export const anims: AnimSet = {
  "hs-stand-ueberkreuzt": { ...hold(standHips, crossed), camera: { az: 12, el: 10 }, spots: ["hipSideL", "outerThighL"] },
  "hb-halbkniestand": { ...hold(BASES.halfKneel, kneelForward), camera: { az: 70 }, spots: ["hipFrontL"] },
  "rq-katze-kuh": { ...flow(6, [cat, cow], 0, 0.4), camera: { az: 65, el: 14 }, spots: ["lowBack", "midBack"] },
  "bw-paddel-rotation-sitz": {
    ...flow(6, [kayak(0), kayak(48), kayak(0), kayak(-48)]),
    camera: { az: 25, el: 18 },
    spots: ["midBack"],
    props: [{ type: "stick", a: { at: "handL" }, b: { at: "handR" }, extend: 0.3, paddle: true }],
  },
  "hs-seitlage-rolle": {
    ...hold(overRoller(false), overRoller(true)),
    camera: { az: -75, el: 16 },
    spots: ["flankL", "hipSideL", "latL"],
    props: [{ type: "roller", at: [0, -0.16], axis: "x", length: 0.5 }],
  },
};
