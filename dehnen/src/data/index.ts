// The exercise catalogue as the app sees it: all texts from ./text/*.json, the built-in routines,
// and the small lookups every screen needs.
// Rule of the app: in a production build an exercise without an animation does not exist ("es gibt immer ein Video").
import { hasAnim } from "../figure/index.ts";
import { EQUIPMENT_LABEL, KIND_LABEL, POSITION_LABEL, REGION_LABEL, REGIONS } from "../types.ts";
import type { Equipment, ExerciseText, Kind, Position, Region, Routine, Tag } from "../types.ts";
import { REGION_SHORT } from "../logic/mix.ts";
import { ROUTINES as BUILT_IN } from "./routines.ts";

const files = import.meta.glob<ExerciseText[]>("./text/*.json", { eager: true, import: "default" });

function collect(): ExerciseText[] {
  const out: ExerciseText[] = [];
  const seen = new Set<string>();
  for (const key of Object.keys(files).sort()) {
    const list = files[key];
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      if (!e || typeof e.id !== "string" || typeof e.name !== "string" || !Array.isArray(e.regions) || e.regions.length === 0) continue;
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
    }
  }
  return out;
}

/** true in dev and when VITE_DEHNEN_ALL=1: exercises without an animation are shown too (with the placeholder figure). */
export const SHOW_ALL: boolean = import.meta.env.DEV || import.meta.env.VITE_DEHNEN_ALL === "1";

/** Every exercise text, with or without an animation. For tools and checks; screens use EXERCISES. */
export const ALL_EXERCISES: ExerciseText[] = collect();

/** The exercises the app shows: in a production build only those with an animation. */
export const EXERCISES: ExerciseText[] = SHOW_ALL ? ALL_EXERCISES : ALL_EXERCISES.filter((e) => hasAnim(e.id));

const index = new Map<string, ExerciseText>(EXERCISES.map((e) => [e.id, e]));

/** The exercise with this id, if the app shows it. */
export function byId(id: string): ExerciseText | undefined {
  return index.get(id);
}

/** True if the exercise exists and may be shown. */
export function exists(id: string): boolean {
  return index.has(id);
}

/** Resolves a list of ids, leaving out unknown ones (favourites, history, routine items). */
export function byIds(ids: readonly string[]): ExerciseText[] {
  const out: ExerciseText[] = [];
  for (const id of ids) {
    const e = index.get(id);
    if (e) out.push(e);
  }
  return out;
}

const families = new Map<string, ExerciseText[]>();
for (const e of EXERCISES) {
  const key = e.family || e.id;
  const list = families.get(key);
  if (list) list.push(e);
  else families.set(key, [e]);
}
for (const list of families.values()) {
  // the base first (variant: null), then the variations from easy to demanding, in the order they were written
  list.sort((a, b) => Number(a.variant !== null) - Number(b.variant !== null) || a.level - b.level);
}

/** All exercises of the variation family of this exercise (or of this family id): the base first, then its variations. */
export function family(id: string): ExerciseText[] {
  const e = index.get(id);
  return families.get(e ? e.family || e.id : id) ?? (e ? [e] : []);
}

/** The other members of the family: the variations to offer on an exercise screen. */
export function variations(id: string): ExerciseText[] {
  return family(id).filter((e) => e.id !== id);
}

const baseList: ExerciseText[] = [...families.values()].map((list) => list[0]!);

/** One entry per family: the base, or the first available variation if the base has no animation yet. */
export function bases(): ExerciseText[] {
  return baseList;
}

/** The main region of an exercise (the first of its regions). */
export function regionOf(e: ExerciseText): Region {
  return e.regions[0] ?? "huefte_seitlich";
}

/** The exercises whose main region (or, with any = true, one of their regions) is the given one. */
export function inRegion(region: Region, any = false): ExerciseText[] {
  return EXERCISES.filter((e) => (any ? e.regions.includes(region) : e.regions[0] === region));
}

/** The regions that have at least one exercise, in the order of REGIONS (lateral hip first). */
export function usedRegions(): Region[] {
  return REGIONS.filter((r) => EXERCISES.some((e) => e.regions[0] === r));
}

// ---------- routines ----------

function playable(r: Routine): Routine {
  const items = r.items.filter((it) => index.has(it.exercise));
  return items.length === r.items.length ? r : { ...r, items };
}

/** The built-in routines; items whose exercise the app cannot show are left out, routines left with fewer than two are dropped. */
export const ROUTINES: Routine[] = BUILT_IN.map(playable).filter((r) => r.items.length >= 2);

/** Built-in routines followed by the user's own (pass useStore((s) => s.routines)). */
export function allRoutines(custom: readonly Routine[] = []): Routine[] {
  return [...ROUTINES, ...custom.map(playable)];
}

/** A routine by id, built-in or custom. */
export function routineById(id: string, custom: readonly Routine[] = []): Routine | undefined {
  return ROUTINES.find((r) => r.id === id) ?? custom.map(playable).find((r) => r.id === id);
}

// ---------- labels ----------

/** Short region names for chips, titles and tight places (REGION_LABEL in types.ts has the full ones). */
export { REGION_SHORT };

export const LEVEL_LABEL: Record<1 | 2 | 3, string> = { 1: "Leicht", 2: "Mittel", 3: "Fordernd" };

export const TAG_LABEL: Record<Tag, string> = {
  aufwaermen: "Aufwärmen",
  cooldown: "Nach dem Training",
  abend: "Abend",
  morgen: "Morgen",
  k1: "K1",
  c1: "C1",
};

export const regionLabel = (r: Region): string => REGION_LABEL[r] ?? r;
export const regionShort = (r: Region): string => REGION_SHORT[r] ?? r;
export const kindLabel = (k: Kind): string => KIND_LABEL[k] ?? k;
export const positionLabel = (p: Position): string => POSITION_LABEL[p] ?? p;
export const equipmentLabel = (q: Equipment): string => EQUIPMENT_LABEL[q] ?? q;
export const levelLabel = (l: 1 | 2 | 3): string => LEVEL_LABEL[l] ?? "";
export const tagLabel = (t: Tag): string => TAG_LABEL[t] ?? t;

/** The quiet line under an exercise name: "Dehnen · Kniend · beide Seiten". */
export function exerciseMeta(e: ExerciseText): string {
  const parts = [kindLabel(e.kind), positionLabel(e.position)];
  if (e.unilateral) parts.push("beide Seiten");
  return parts.join(" · ");
}

/** "Wand, Stuhl oder Bank", or "Ohne Material". */
export function equipmentLine(e: ExerciseText): string {
  return e.equipment.length ? e.equipment.map(equipmentLabel).join(", ") : "Ohne Material";
}

// ---------- search ----------

/**
 * Makes text comparable: lower case, umlauts and their two-letter spellings fall together
 * ("Hüfte", "Huefte" and "hufte" all become "hufte"), accents and punctuation are dropped.
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ae/g, "a")
    .replace(/oe/g, "o")
    .replace(/ue/g, "u")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const haystacks = new WeakMap<ExerciseText, string>();

function haystack(e: ExerciseText): string {
  let h = haystacks.get(e);
  if (h === undefined) {
    h = normalize(
      [e.name, e.alias ?? "", e.variant ?? "", ...e.regions.map(regionLabel), ...e.regions.map(regionShort), kindLabel(e.kind), positionLabel(e.position), ...e.equipment.map(equipmentLabel), ...e.tags.map(tagLabel), e.feel].join(" "),
    );
    haystacks.set(e, h);
  }
  return h;
}

/** True if every word of the query occurs in the exercise (name, alias, variation, regions, kind, position, material). An empty query matches. */
export function matches(e: ExerciseText, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  const h = haystack(e);
  return q.split(" ").every((word) => h.includes(word));
}

/** The exercises matching a query; hits in the name come first. */
export function search(query: string, list: readonly ExerciseText[] = EXERCISES): ExerciseText[] {
  const q = normalize(query);
  if (!q) return [...list];
  const hits = list.filter((e) => matches(e, q));
  const inName = (e: ExerciseText) => (normalize(e.name).includes(q) ? 0 : 1);
  return hits.sort((a, b) => inName(a) - inName(b));
}
