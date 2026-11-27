// Kehrwasser: shared data contract (texts, routines, settings, sessions, history).
// Everything here is plain data. The animated figure has its own types in ./figure/.

export const REGIONS = [
  "huefte_seitlich",
  "hueftbeuger",
  "adduktoren",
  "gesaess_rotatoren",
  "hamstrings",
  "quadrizeps",
  "waden_sprunggelenk",
  "lws_ql",
  "bws_rotation",
  "schulter_lat",
  "brust",
  "nacken",
  "unterarm_handgelenk",
] as const;
export type Region = (typeof REGIONS)[number];

export const REGION_LABEL: Record<Region, string> = {
  huefte_seitlich: "Seitliche Hüfte",
  hueftbeuger: "Hüftbeuger",
  adduktoren: "Adduktoren",
  gesaess_rotatoren: "Gesäss & Rotatoren",
  hamstrings: "Beinrückseite",
  quadrizeps: "Oberschenkel vorne",
  waden_sprunggelenk: "Waden & Sprunggelenk",
  lws_ql: "Unterer Rücken & Flanke",
  bws_rotation: "Brustwirbelsäule",
  schulter_lat: "Schultern & Lat",
  brust: "Brust",
  nacken: "Nacken",
  unterarm_handgelenk: "Unterarme & Handgelenke",
};

/** statisch = hold a stretch; dynamisch = move through the range; aktiv = controlled end-range strength (CARs, lift-offs). */
export const KINDS = ["statisch", "dynamisch", "aktiv"] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_LABEL: Record<Kind, string> = {
  statisch: "Dehnen",
  dynamisch: "Mobilisieren",
  aktiv: "Aktiv",
};

export const POSITIONS = ["stehend", "kniend", "sitzend", "rueckenlage", "bauchlage", "seitlage", "vierfuessler", "hocke"] as const;
export type Position = (typeof POSITIONS)[number];
export const POSITION_LABEL: Record<Position, string> = {
  stehend: "Stehend",
  kniend: "Kniend",
  sitzend: "Sitzend",
  rueckenlage: "Rückenlage",
  bauchlage: "Bauchlage",
  seitlage: "Seitlage",
  vierfuessler: "Vierfüssler",
  hocke: "Hocke",
};

export const EQUIPMENT = ["wand", "stuhl", "paddel", "rolle", "band", "block"] as const;
export type Equipment = (typeof EQUIPMENT)[number];
export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  wand: "Wand",
  stuhl: "Stuhl oder Bank",
  paddel: "Paddel oder Stab",
  rolle: "Faszienrolle",
  band: "Band oder Gurt",
  block: "Block oder Kissen",
};

export const TAGS = ["aufwaermen", "cooldown", "abend", "morgen", "k1", "c1"] as const;
export type Tag = (typeof TAGS)[number];

/** One exercise as written in data/text/*.json. Unilateral exercises are described for the LEFT side as the target side. */
export interface ExerciseText {
  /** kebab-case, a-z 0-9 and "-", unique across all files */
  id: string;
  /** German name, at most 36 characters */
  name: string;
  /** common English or yoga name, if there is one */
  alias?: string;
  /** id of the base exercise of this variation family (the base itself carries its own id) */
  family: string;
  /** what makes this one a variation of the base, e.g. "mit Seitneigung"; null for the base */
  variant: string | null;
  kind: Kind;
  position: Position;
  /** first entry = main region */
  regions: Region[];
  equipment: Equipment[];
  /** true = done left and right (described for the left side) */
  unilateral: boolean;
  /** 1 easy, 2 medium, 3 demanding */
  level: 1 | 2 | 3;
  /** suggested seconds: per side if unilateral, else in total */
  seconds: number;
  /** dynamisch/aktiv only: seconds for one repetition */
  tempo?: number;
  tags: Tag[];
  /** one sentence: what it is and what it is good for */
  intro: string;
  /** 2 to 4 short steps */
  steps: string[];
  /** 1 to 3 very short cues for the player (max 60 characters each) */
  cues: string[];
  /** the most common mistake, one sentence */
  avoid: string;
  /** where you should feel it, short */
  feel: string;
  /** why it helps in canoe slalom, one sentence */
  slalom: string;
  /** optional caution, one sentence */
  caution?: string;
  /** notes for the animator: start pose, end pose, what moves, tempo */
  motion: string;
}

export type Side = "L" | "R";

export interface RoutineItem {
  exercise: string;
  /** overrides the exercise's own seconds (per side if unilateral); ignored while "gleichmässig" is on */
  seconds?: number;
}

export interface Routine {
  id: string;
  name: string;
  /** one short line under the name */
  subtitle: string;
  description: string;
  focus: Region[];
  tags: Tag[];
  items: RoutineItem[];
  /** true = made by the user in the app */
  custom?: boolean;
}

export type Discipline = "k1" | "c1" | "beide";

export interface Settings {
  /** every hold and every mobilisation lasts the same; transitions too (default on) */
  uniform: boolean;
  /** seconds per static hold (per side) while uniform is on */
  holdSeconds: number;
  /** seconds per dynamic or active exercise (per side) while uniform is on */
  moveSeconds: number;
  /** seconds to change position between two exercises */
  transitionSeconds: number;
  /** seconds to switch sides within one exercise */
  switchSeconds: number;
  firstSide: Side;
  /** vibration at changes, where the device supports it (never a sound) */
  haptics: boolean;
  /** a soft flash of the screen at changes, visible from the corner of the eye */
  flash: boolean;
  keepAwake: boolean;
  discipline: Discipline;
  /** regions that get extra weight in suggested sessions */
  focus: Region[];
  /** equipment at hand; exercises needing something else are left out of suggestions */
  equipment: Equipment[];
  /** highest level used in suggestions */
  maxLevel: 1 | 2 | 3;
}

export const DEFAULT_SETTINGS: Settings = {
  uniform: true,
  holdSeconds: 45,
  moveSeconds: 45,
  transitionSeconds: 8,
  switchSeconds: 5,
  firstSide: "L",
  haptics: true,
  flash: true,
  keepAwake: true,
  discipline: "beide",
  focus: ["huefte_seitlich", "hueftbeuger", "lws_ql"],
  equipment: ["wand", "stuhl", "paddel"],
  maxLevel: 3,
};

/** One step of a running session. The player walks through these in order. */
export type SessionStep =
  | {
      type: "ready";
      /** get into position before the first exercise */
      seconds: number;
      next: { exercise: string; side: Side | null };
    }
  | {
      type: "exercise";
      exercise: string;
      side: Side | null;
      seconds: number;
      /** position of this exercise in the session, 1-based, and the number of exercises */
      index: number;
      of: number;
    }
  | {
      type: "transition";
      /** "switch" = same exercise, other side; "next" = a new exercise */
      reason: "switch" | "next";
      seconds: number;
      next: { exercise: string; side: Side | null };
    };

export interface SessionPlan {
  /** routine id, or "mix" for a generated session */
  source: string;
  title: string;
  steps: SessionStep[];
  /** total seconds of all steps */
  seconds: number;
}

export interface HistoryEntry {
  id: string;
  /** ISO timestamp of the end */
  at: string;
  /** local day, YYYY-MM-DD */
  day: string;
  source: string;
  title: string;
  /** seconds actually spent in exercises (without pauses and skipped parts) */
  seconds: number;
  /** true = went through to the end */
  completed: boolean;
  exercises: { id: string; seconds: number }[];
  /** seconds per region (main region of each exercise) */
  regions: Partial<Record<Region, number>>;
}
