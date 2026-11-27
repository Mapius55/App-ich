// The one persisted store of Kehrwasser. Everything lives in localStorage under "kehrwasser.v1";
// the running session plan is kept in memory and mirrored to sessionStorage, so a reload of #/session can resume.
// Nothing here ever throws: broken or missing data falls back to defaults, unavailable storage is ignored.
import { useRef, useSyncExternalStore } from "react";
import { DEFAULT_SETTINGS, EQUIPMENT, REGIONS, TAGS } from "./types.ts";
import type { Discipline, Equipment, HistoryEntry, Region, Routine, RoutineItem, SessionPlan, SessionStep, Settings, Side, Tag } from "./types.ts";

export const STORAGE_KEY = "kehrwasser.v1";
export const SESSION_KEY = "kehrwasser.session.v1";
const VERSION = 1;
const MAX_HISTORY = 3000;

/** The counter behind "Neu mischen": the suggestion of a day is seeded with mixSeed(day, n) from logic/mix.ts. */
export interface Shuffle {
  /** local day, YYYY-MM-DD */
  day: string;
  n: number;
}

export interface State {
  settings: Settings;
  /** exercise ids */
  favorites: string[];
  /** exercise ids the user never wants suggested */
  hidden: string[];
  /** newest first */
  history: HistoryEntry[];
  /** custom routines (custom: true) */
  routines: Routine[];
  onboarded: boolean;
  /** last chosen session length in minutes */
  minutes: number;
  shuffle: Shuffle;
  /** the session that is running or about to run; not part of the export */
  session: SessionPlan | null;
}

type Persisted = Omit<State, "session">;

export const DEFAULT_MINUTES = 12;
export const MIN_MINUTES = 3;
export const MAX_MINUTES = 90;

function defaults(): Persisted {
  return {
    settings: { ...DEFAULT_SETTINGS, focus: [...DEFAULT_SETTINGS.focus], equipment: [...DEFAULT_SETTINGS.equipment] },
    favorites: [],
    hidden: [],
    history: [],
    routines: [],
    onboarded: false,
    minutes: DEFAULT_MINUTES,
    shuffle: { day: "", n: 0 },
  };
}

// ---------- reading untrusted data ----------

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function int(v: unknown, fallback: number, min: number, max: number): number {
  return isNum(v) ? clamp(Math.round(v), min, max) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function oneOf<T extends string | number>(v: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(v) ? (v as T) : fallback;
}

function listOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T[]): T[] {
  if (!Array.isArray(v)) return fallback;
  const out: T[] = [];
  for (const x of v) if ((allowed as readonly unknown[]).includes(x) && !out.includes(x as T)) out.push(x as T);
  return out;
}

function ids(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) if (isStr(x) && !out.includes(x)) out.push(x);
  return out;
}

function readSettings(v: unknown): Settings {
  const d = defaults().settings;
  if (!isRec(v)) return d;
  return {
    uniform: bool(v.uniform, d.uniform),
    holdSeconds: int(v.holdSeconds, d.holdSeconds, 10, 300),
    moveSeconds: int(v.moveSeconds, d.moveSeconds, 10, 300),
    transitionSeconds: int(v.transitionSeconds, d.transitionSeconds, 0, 60),
    switchSeconds: int(v.switchSeconds, d.switchSeconds, 0, 60),
    firstSide: oneOf<Side>(v.firstSide, ["L", "R"], d.firstSide),
    haptics: bool(v.haptics, d.haptics),
    flash: bool(v.flash, d.flash),
    keepAwake: bool(v.keepAwake, d.keepAwake),
    discipline: oneOf<Discipline>(v.discipline, ["k1", "c1", "beide"], d.discipline),
    focus: listOf<Region>(v.focus, REGIONS, d.focus),
    equipment: listOf<Equipment>(v.equipment, EQUIPMENT, d.equipment),
    maxLevel: oneOf<1 | 2 | 3>(v.maxLevel, [1, 2, 3], d.maxLevel),
  };
}

function readItems(v: unknown): RoutineItem[] {
  if (!Array.isArray(v)) return [];
  const out: RoutineItem[] = [];
  for (const x of v) {
    if (!isRec(x) || !isStr(x.exercise)) continue;
    const item: RoutineItem = { exercise: x.exercise };
    if (isNum(x.seconds) && x.seconds > 0) item.seconds = clamp(Math.round(x.seconds), 5, 600);
    out.push(item);
  }
  return out;
}

function readRoutine(v: unknown): Routine | null {
  if (!isRec(v) || !isStr(v.id) || !isStr(v.name)) return null;
  return {
    id: v.id,
    name: v.name,
    subtitle: typeof v.subtitle === "string" ? v.subtitle : "",
    description: typeof v.description === "string" ? v.description : "",
    focus: listOf<Region>(v.focus, REGIONS, []),
    tags: listOf<Tag>(v.tags, TAGS, []),
    items: readItems(v.items),
    custom: true,
  };
}

function readRoutines(v: unknown): Routine[] {
  if (!Array.isArray(v)) return [];
  const out: Routine[] = [];
  for (const x of v) {
    const r = readRoutine(x);
    if (r && !out.some((o) => o.id === r.id)) out.push(r);
  }
  return out;
}

function readHistoryEntry(v: unknown): HistoryEntry | null {
  if (!isRec(v) || !isStr(v.id) || !isStr(v.at) || !isStr(v.day) || !isNum(v.seconds)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.day)) return null;
  const exercises: { id: string; seconds: number }[] = [];
  if (Array.isArray(v.exercises)) {
    for (const x of v.exercises) if (isRec(x) && isStr(x.id) && isNum(x.seconds)) exercises.push({ id: x.id, seconds: Math.max(0, Math.round(x.seconds)) });
  }
  const regions: Partial<Record<Region, number>> = {};
  if (isRec(v.regions)) {
    for (const r of REGIONS) {
      const s = v.regions[r];
      if (isNum(s) && s > 0) regions[r] = Math.round(s);
    }
  }
  return {
    id: v.id,
    at: v.at,
    day: v.day,
    source: typeof v.source === "string" ? v.source : "",
    title: typeof v.title === "string" ? v.title : "",
    seconds: Math.max(0, Math.round(v.seconds)),
    completed: bool(v.completed, false),
    exercises,
    regions,
  };
}

function sortHistory(list: HistoryEntry[]): HistoryEntry[] {
  return [...list].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, MAX_HISTORY);
}

function readHistory(v: unknown): HistoryEntry[] {
  if (!Array.isArray(v)) return [];
  const out: HistoryEntry[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    const e = readHistoryEntry(x);
    if (e && !seen.has(e.id)) {
      seen.add(e.id);
      out.push(e);
    }
  }
  return sortHistory(out);
}

function readShuffle(v: unknown): Shuffle {
  if (!isRec(v) || typeof v.day !== "string") return { day: "", n: 0 };
  return { day: v.day, n: int(v.n, 0, 0, 1_000_000) };
}

function readPersisted(v: unknown): Persisted {
  if (!isRec(v)) return defaults();
  return {
    settings: readSettings(v.settings),
    favorites: ids(v.favorites),
    hidden: ids(v.hidden),
    history: readHistory(v.history),
    routines: readRoutines(v.routines),
    onboarded: bool(v.onboarded, false),
    minutes: int(v.minutes, DEFAULT_MINUTES, MIN_MINUTES, MAX_MINUTES),
    shuffle: readShuffle(v.shuffle),
  };
}

function readTarget(v: unknown): { exercise: string; side: Side | null } | null {
  if (!isRec(v) || !isStr(v.exercise)) return null;
  return { exercise: v.exercise, side: v.side === "L" || v.side === "R" ? v.side : null };
}

function readStep(v: unknown): SessionStep | null {
  if (!isRec(v) || !isNum(v.seconds) || v.seconds < 0) return null;
  if (v.type === "exercise") {
    if (!isStr(v.exercise) || !isNum(v.index) || !isNum(v.of)) return null;
    return { type: "exercise", exercise: v.exercise, side: v.side === "L" || v.side === "R" ? v.side : null, seconds: v.seconds, index: v.index, of: v.of };
  }
  const next = readTarget(v.next);
  if (!next) return null;
  if (v.type === "ready") return { type: "ready", seconds: v.seconds, next };
  if (v.type === "transition") return { type: "transition", reason: v.reason === "switch" ? "switch" : "next", seconds: v.seconds, next };
  return null;
}

function readSession(v: unknown): SessionPlan | null {
  if (!isRec(v) || !Array.isArray(v.steps) || v.steps.length === 0) return null;
  const steps: SessionStep[] = [];
  for (const x of v.steps) {
    const s = readStep(x);
    if (!s) return null;
    steps.push(s);
  }
  return {
    source: typeof v.source === "string" ? v.source : "mix",
    title: typeof v.title === "string" ? v.title : "",
    steps,
    seconds: isNum(v.seconds) ? v.seconds : steps.reduce((sum, s) => sum + s.seconds, 0),
  };
}

// ---------- storage ----------

function storage(kind: "local" | "session"): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function readJson(kind: "local" | "session", key: string): unknown {
  try {
    const raw = storage(kind)?.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function writeJson(kind: "local" | "session", key: string, value: unknown): void {
  try {
    const s = storage(kind);
    if (!s) return;
    if (value === null) s.removeItem(key);
    else s.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the app keeps working from memory
  }
}

function persistedOf(s: State): Persisted {
  const { session: _session, ...rest } = s;
  return rest;
}

function load(): State {
  const raw = readJson("local", STORAGE_KEY);
  const data = isRec(raw) && isRec(raw.data) ? raw.data : raw;
  return { ...readPersisted(data), session: readSession(readJson("session", SESSION_KEY)) };
}

// ---------- the store ----------

let state: State = load();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function commit(next: State, opts: { persist?: boolean } = {}): void {
  if (next === state) return;
  const sessionChanged = next.session !== state.session;
  state = next;
  if (opts.persist !== false) writeJson("local", STORAGE_KEY, { v: VERSION, data: persistedOf(state) });
  if (sessionChanged) writeJson("session", SESSION_KEY, state.session);
  emit();
}

function update(patch: Partial<Persisted>): void {
  commit({ ...state, ...patch });
}

if (typeof window !== "undefined") {
  // another tab or window of the app changed the data
  window.addEventListener("storage", (e) => {
    if (e.key !== null && e.key !== STORAGE_KEY) return;
    const raw = readJson("local", STORAGE_KEY);
    const data = isRec(raw) && isRec(raw.data) ? raw.data : raw;
    state = { ...readPersisted(data), session: state.session };
    emit();
  });
}

export function getState(): State {
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is((a as Rec)[k], (b as Rec)[k])) return false;
  return true;
}

/**
 * Read a part of the store: const settings = useStore((s) => s.settings).
 * The selector may build a small object or array; the result is compared shallowly, so the component
 * only re-renders when one of the selected values changed.
 */
export function useStore<T>(selector: (s: State) => T): T {
  const cache = useRef<{ state: State; selector: (s: State) => T; value: T } | null>(null);
  const get = (): T => {
    const c = cache.current;
    if (c && c.state === state && c.selector === selector) return c.value;
    const next = selector(state);
    const value = c && shallowEqual(c.value, next) ? c.value : next;
    cache.current = { state, selector, value };
    return value;
  };
  return useSyncExternalStore(subscribe, get, get);
}

// ---------- actions ----------

/** Change some settings: setSettings({ holdSeconds: 60 }). Values are checked and clamped. */
export function setSettings(patch: Partial<Settings>): void {
  update({ settings: readSettings({ ...state.settings, ...patch }) });
}

function toggled(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function toggleFavorite(id: string): void {
  if (!id) return;
  update({ favorites: toggled(state.favorites, id) });
}

export function toggleHidden(id: string): void {
  if (!id) return;
  update({ hidden: toggled(state.hidden, id) });
}

/** Adds a finished (or stopped) session; an entry with the same id is replaced. */
export function addHistory(entry: HistoryEntry): void {
  const e = readHistoryEntry(entry);
  if (!e) return;
  update({ history: sortHistory([e, ...state.history.filter((h) => h.id !== e.id)]) });
}

export function removeHistory(id: string): void {
  update({ history: state.history.filter((h) => h.id !== id) });
}

/** Creates or replaces a custom routine (matched by id). */
export function saveRoutine(routine: Routine): void {
  const r = readRoutine(routine);
  if (!r) return;
  const exists = state.routines.some((x) => x.id === r.id);
  update({ routines: exists ? state.routines.map((x) => (x.id === r.id ? r : x)) : [...state.routines, r] });
}

export function deleteRoutine(id: string): void {
  update({ routines: state.routines.filter((r) => r.id !== id) });
}

export function setOnboarded(value = true): void {
  update({ onboarded: value });
}

export function setMinutes(minutes: number): void {
  update({ minutes: int(minutes, DEFAULT_MINUTES, MIN_MINUTES, MAX_MINUTES) });
}

/** "Neu mischen": raises the counter of the given day (a new day starts again at 0). */
export function reshuffle(day: string): void {
  update({ shuffle: { day, n: state.shuffle.day === day ? state.shuffle.n + 1 : 1 } });
}

/** Sets the session the player runs (null = none). Kept for a reload of #/session, not exported, not synced. */
export function setSession(plan: SessionPlan | null): void {
  commit({ ...state, session: plan }, { persist: false });
}

/** Everything the user made, as a JSON string (for a backup file). */
export function exportData(): string {
  return JSON.stringify({ app: "kehrwasser", v: VERSION, exportedAt: new Date().toISOString(), data: persistedOf(state) }, null, 2);
}

/** Replaces all data with a backup made by exportData(). Returns false (and changes nothing) if the text is not a backup. */
export function importData(json: string): boolean {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return false;
  }
  if (!isRec(raw)) return false;
  const data = isRec(raw.data) ? raw.data : raw;
  const known = ["settings", "favorites", "hidden", "history", "routines"];
  if (raw.app !== "kehrwasser" && !known.some((k) => k in data)) return false;
  commit({ ...readPersisted(data), session: state.session });
  return true;
}

/** Deletes everything and starts again with the defaults (the onboarding shows again). */
export function resetAll(): void {
  commit({ ...defaults(), session: null });
}

// ---------- small helpers ----------

/** A new unique id (history entries, custom routines). */
export function newId(prefix = ""): string {
  let core: string;
  try {
    core = crypto.randomUUID();
  } catch {
    core = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  return prefix ? `${prefix}-${core}` : core;
}
