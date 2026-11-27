// Kehrwasser: the session generator. Pure and deterministic: the same input gives the same session,
// a different seed a visibly different one. Never Math.random, never the clock.
//
// How a session is put together:
//   1. filter: equipment at hand, level, not hidden, wanted kinds; one exercise per variation family
//   2. fill the time pick by pick; every pick is steered by two scales that are kept level:
//      focus regions get about half of the time, and (when both kinds are there) mobilising about 40 %
//   3. inside that: regions with little time lately first, the boat's own exercises and favourites a bit more often
//   4. order: mobilise first, hold last, and inside each part grouped by position so nobody gets up needlessly
import { REGIONS } from "../types.ts";
import type { ExerciseText, HistoryEntry, Kind, Position, Region, RoutineItem, Settings } from "../types.ts";
import { exerciseSeconds, gapSeconds, readySeconds } from "./plan.ts";
import { addDays } from "./stats.ts";

export interface MixOptions {
  minutes: number;
  settings: Settings;
  exercises: ExerciseText[];
  /** exercise ids that never appear */
  hidden?: string[];
  /** exercise ids that get a small bonus */
  favorites?: string[];
  /** regions that get about half of the time; default settings.focus */
  focus?: Region[];
  /** share of the time for the focus regions, 0 to 1; default FOCUS_SHARE (a half). 1 = only the focus regions as long as they have exercises left */
  focusShare?: number;
  /** only these kinds; default (or empty) = mixed */
  kinds?: Kind[];
  seed: string;
  history?: HistoryEntry[];
  /** local day (YYYY-MM-DD) the 14 days of history are counted back from; default: the day at the start of the seed (see mixSeed), else the latest day in the history */
  today?: string;
}

export interface MixResult {
  title: string;
  items: RoutineItem[];
  /** the main regions actually covered, most time first */
  regions: Region[];
}

/** share of the exercise time that goes to the focus regions */
export const FOCUS_SHARE = 0.5;
/** share of the exercise time that goes to dynamisch/aktiv in a mixed session */
export const MOVE_SHARE = 0.4;
/** a session is never longer than the wish times this */
export const MAX_OVER = 1.1;
/** the stretch of history that counts for "little time lately" */
export const HISTORY_DAYS = 14;

const FAVORITE_BONUS = 1.35;
const BOAT_BONUS = 1.6;

/** short names for titles such as "Seitliche Hüfte und Flanke" */
export const REGION_SHORT: Record<Region, string> = {
  huefte_seitlich: "Seitliche Hüfte",
  hueftbeuger: "Hüftbeuger",
  adduktoren: "Adduktoren",
  gesaess_rotatoren: "Gesäss",
  hamstrings: "Beinrückseite",
  quadrizeps: "Oberschenkel",
  waden_sprunggelenk: "Waden",
  lws_ql: "Flanke",
  bws_rotation: "Brustwirbelsäule",
  schulter_lat: "Schultern",
  brust: "Brust",
  nacken: "Nacken",
  unterarm_handgelenk: "Unterarme",
};

export const TITLE_WHOLE_BODY = "Ganzer Körper";

/** from upright to lying; positions of one level need no real change of place */
const POSITION_ORDER: Position[] = ["stehend", "kniend", "vierfuessler", "hocke", "sitzend", "seitlage", "bauchlage", "rueckenlage"];
const POSITION_LEVEL: Record<Position, number> = {
  stehend: 0,
  kniend: 1,
  vierfuessler: 1,
  hocke: 1,
  sitzend: 2,
  seitlage: 3,
  bauchlage: 3,
  rueckenlage: 3,
};

/** The seed of the n-th suggestion of a day: the same day and number always give the same session. */
export function mixSeed(day: string, n: number): string {
  return `${day}#${Math.max(0, Math.floor(Number.isFinite(n) ? n : 0))}`;
}

// --- seeded random numbers ---------------------------------------------------------------

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted<T>(rand: () => number, list: T[], weight: (item: T) => number): T {
  const weights = list.map((item) => {
    const w = weight(item);
    return Number.isFinite(w) && w > 0 ? w : 0;
  });
  let sum = 0;
  for (const w of weights) sum += w;
  if (sum <= 0) return list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
  let r = rand() * sum;
  for (let i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r < 0) return list[i];
  }
  return list[list.length - 1];
}

// --- candidates --------------------------------------------------------------------------

interface Candidate {
  e: ExerciseText;
  /** seconds of the whole exercise: both sides and the switch */
  cost: number;
  region: Region;
  /** dynamisch or aktiv (the mobilising part); false = statisch */
  move: boolean;
  focus: boolean;
  /** only for the other boat: used when nothing else is left */
  avoid: boolean;
  weight: number;
}

function referenceDay(opts: MixOptions): string | null {
  if (opts.today) return opts.today.slice(0, 10);
  const inSeed = /^\d{4}-\d{2}-\d{2}/.exec(opts.seed);
  if (inSeed) return inSeed[0];
  let last: string | null = null;
  for (const h of opts.history ?? []) {
    if (typeof h.day === "string" && (last === null || h.day > last)) last = h.day;
  }
  return last;
}

function recent(opts: MixOptions): { regions: Map<Region, number>; exercises: Map<string, number> } {
  const regions = new Map<Region, number>();
  const exercises = new Map<string, number>();
  const day = referenceDay(opts);
  if (!day || !opts.history) return { regions, exercises };
  const from = addDays(day, -(HISTORY_DAYS - 1));
  for (const h of opts.history) {
    if (typeof h.day !== "string" || h.day < from || h.day > day) continue;
    for (const region of REGIONS) {
      const s = h.regions?.[region];
      if (typeof s === "number" && s > 0) regions.set(region, (regions.get(region) ?? 0) + s);
    }
    for (const x of h.exercises ?? []) {
      if (x.seconds > 0) exercises.set(x.id, (exercises.get(x.id) ?? 0) + 1);
    }
  }
  return { regions, exercises };
}

function candidates(opts: MixOptions, focus: Set<Region>, doneLately: Map<string, number>): Candidate[] {
  const { settings } = opts;
  const hidden = new Set(opts.hidden ?? []);
  const favorites = new Set(opts.favorites ?? []);
  const kinds = opts.kinds && opts.kinds.length > 0 ? new Set<Kind>(opts.kinds) : null;
  const atHand = new Set<string>(settings.equipment);
  const seen = new Set<string>();
  const list: Candidate[] = [];
  // sorted by id, so the order the catalogue happens to be loaded in does not matter
  const sorted = [...opts.exercises].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const e of sorted) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    if (hidden.has(e.id) || e.level > settings.maxLevel) continue;
    if (!e.equipment.every((q) => atHand.has(q))) continue;
    if (kinds && !kinds.has(e.kind)) continue;
    const region = e.regions[0];
    if (!region) continue;

    const k1 = e.tags.includes("k1");
    const c1 = e.tags.includes("c1");
    const mine = settings.discipline === "beide" ? k1 || c1 : settings.discipline === "k1" ? k1 : c1;
    const avoid = (k1 || c1) && !mine;

    let weight = 1;
    if (mine) weight *= BOAT_BONUS;
    if (favorites.has(e.id)) weight *= FAVORITE_BONUS;
    weight /= 1 + 0.5 * (doneLately.get(e.id) ?? 0);

    list.push({ e, cost: exerciseSeconds(e, { exercise: e.id }, settings), region, move: e.kind !== "statisch", focus: focus.has(region), avoid, weight });
  }
  // a family with many variations is not more likely than one with a single exercise
  const familySize = new Map<string, number>();
  for (const c of list) familySize.set(c.e.family, (familySize.get(c.e.family) ?? 0) + 1);
  for (const c of list) c.weight /= familySize.get(c.e.family) ?? 1;
  return list;
}

// --- order -------------------------------------------------------------------------------

function downward(list: Candidate[]): Candidate[] {
  return [...list].sort((a, b) => POSITION_ORDER.indexOf(a.e.position) - POSITION_ORDER.indexOf(b.e.position));
}

/**
 * Mobilising first, holding last. Each part is grouped by position. The holds always go from
 * standing down to lying; the mobilising part runs the same way, unless running it upwards
 * (from the floor to standing) meets the first hold without a needless change of level.
 */
function arrange(picked: Candidate[]): Candidate[] {
  const moves = downward(picked.filter((c) => c.move));
  const holds = downward(picked.filter((c) => !c.move));
  if (moves.length === 0) return holds;
  if (holds.length === 0) return moves;
  const level = (c: Candidate): number => POSITION_LEVEL[c.e.position];
  const firstHold = level(holds[0]);
  const jumpDown = Math.abs(level(moves[moves.length - 1]) - firstHold);
  const jumpUp = Math.abs(level(moves[0]) - firstHold);
  return [...(jumpUp < jumpDown ? moves.reverse() : moves), ...holds];
}

// --- title -------------------------------------------------------------------------------

function titleFor(sorted: { region: Region; seconds: number }[], focus: Set<Region>): string {
  if (sorted.length === 0) return TITLE_WHOLE_BODY;
  let all = 0;
  for (const r of sorted) all += r.seconds;
  const share = (list: { seconds: number }[]): number => (all > 0 ? list.reduce((sum, r) => sum + r.seconds, 0) / all : 0);

  // the focus regions lead the title when they carry the session
  const inFocus = sorted.filter((r) => focus.has(r.region));
  const lead = inFocus.length > 0 && share(inFocus) >= 0.4 ? inFocus : sorted;
  if (lead.length >= 5 && share(lead.slice(0, 2)) < 0.5) return TITLE_WHOLE_BODY;
  if (lead === sorted && sorted.length >= 4 && share(sorted.slice(0, 2)) < 0.5) return TITLE_WHOLE_BODY;

  const names = [REGION_SHORT[lead[0].region]];
  const second = lead[1];
  if (second && (lead === inFocus || share([second]) >= 0.2)) names.push(REGION_SHORT[second.region]);
  return names.join(" und ");
}

// --- the generator -----------------------------------------------------------------------

export function mix(opts: MixOptions): MixResult {
  const { settings } = opts;
  const minutes = Number.isFinite(opts.minutes) ? Math.max(0, opts.minutes) : 0;
  const target = minutes * 60;
  const limit = target * MAX_OVER;
  const rand = mulberry32(hashString(opts.seed));

  const focusList = opts.focus ?? settings.focus ?? [];
  const focus = new Set<Region>(focusList);
  const focusShare = typeof opts.focusShare === "number" && Number.isFinite(opts.focusShare) ? Math.min(1, Math.max(0, opts.focusShare)) : FOCUS_SHARE;
  const lately = recent(opts);
  const pool = candidates(opts, focus, lately.exercises);
  if (target <= 0 || pool.length === 0) return { title: TITLE_WHOLE_BODY, items: [], regions: [] };

  const mixed = pool.some((c) => c.move) && pool.some((c) => !c.move);
  const ready = readySeconds(settings);
  const gap = gapSeconds(settings);

  // how much each region got lately, relative to what is usual outside the focus
  const others = REGIONS.filter((r) => !focus.has(r));
  let usual = 0;
  for (const r of others) usual += lately.regions.get(r) ?? 0;
  usual = Math.max(60, others.length > 0 ? usual / others.length : 0);
  const need = (region: Region): number => 1 / (1 + (lately.regions.get(region) ?? 0) / usual);

  const picked: Candidate[] = [];
  const families = new Set<string>();
  const picksIn = new Map<Region, number>();
  const time = { focus: 0, other: 0, move: 0, hold: 0 };
  let total = 0;

  for (;;) {
    const open = pool.filter((c) => !families.has(c.e.family));
    const own = open.filter((c) => !c.avoid);
    const usable = own.length > 0 ? own : open;
    if (usable.length === 0) break;

    const lead = picked.length === 0 ? ready : gap;
    const remaining = target - total;
    // an exercise fits when it brings the session closer to the wished time and stays under the limit
    const fits = usable.filter((c) => {
      const add = lead + c.cost;
      return add < 2 * remaining && total + add <= limit;
    });
    let choice: Candidate[];
    if (fits.length > 0) {
      const slack = Math.min(20, target * 0.03);
      const snug = fits.filter((c) => lead + c.cost <= remaining + slack);
      choice = snug.length > 0 ? snug : fits;
    } else if (picked.length === 0) {
      // a session always has at least one exercise: the shortest there is
      let shortest = Infinity;
      for (const c of usable) shortest = Math.min(shortest, c.cost);
      choice = usable.filter((c) => c.cost === shortest);
    } else {
      break;
    }

    // keep the two scales level: focus against the rest, mobilising against holding
    const wantFocus = focus.size > 0 && focusShare > 0 && time.focus * (1 - focusShare) <= time.other * focusShare;
    const wantMove = time.move * (1 - MOVE_SHARE) <= time.hold * MOVE_SHARE;
    const rightKind = (c: Candidate): boolean => !mixed || c.move === wantMove;
    const tiers = [
      choice.filter((c) => c.focus === wantFocus && rightKind(c)),
      choice.filter((c) => c.focus === wantFocus),
      choice.filter(rightKind),
      choice,
    ];
    const tier = tiers.find((t) => t.length > 0) ?? choice;

    // first the region, then an exercise in it: a region with many exercises is not more likely
    const regions = REGIONS.filter((r) => tier.some((c) => c.region === r));
    const region = pickWeighted(rand, regions, (r) => {
      const n = picksIn.get(r) ?? 0;
      return focus.has(r) ? 1 / (1 + 1.5 * n) : need(r) / (1 + 3 * n);
    });
    const c = pickWeighted(
      rand,
      tier.filter((x) => x.region === region),
      (x) => x.weight,
    );

    picked.push(c);
    families.add(c.e.family);
    picksIn.set(c.region, (picksIn.get(c.region) ?? 0) + 1);
    total += lead + c.cost;
    if (c.focus) time.focus += c.cost;
    else time.other += c.cost;
    if (c.move) time.move += c.cost;
    else time.hold += c.cost;
  }

  const ordered = arrange(picked);

  const perRegion = new Map<Region, number>();
  for (const c of picked) perRegion.set(c.region, (perRegion.get(c.region) ?? 0) + c.cost);
  const rank = (r: Region): number => {
    const f = focusList.indexOf(r);
    return f === -1 ? focusList.length + REGIONS.indexOf(r) : f;
  };
  const sorted = [...perRegion]
    .map(([region, seconds]) => ({ region, seconds }))
    .sort((a, b) => b.seconds - a.seconds || rank(a.region) - rank(b.region));

  return {
    title: titleFor(sorted, focus),
    items: ordered.map((c) => ({ exercise: c.e.id })),
    regions: sorted.map((r) => r.region),
  };
}
