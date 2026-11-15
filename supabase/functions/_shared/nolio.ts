// Nolio (training platform, REST API v2): parsing and mapping for the Edge Function "nolio".
// Pure: no Deno-only imports and no I/O of its own (the API client gets `fetch` passed in),
// so the tests (vitest) import it directly.
//
// Rules that come from Nolio's API terms:
// - Rows recorded through Strava or WHOOP (or marked with a `restriction`) keep their measurements
//   in Nolio: they never count toward goal hours and must never reach the AI. They are kept only as a
//   flagged stub (day, sport, source).
// - Garmin data is shown with the attribution "Garmin <model>" (see deviceAttribution).
// - Planned trainings are the trainer's: they are mirrored as calendar entries, never rewritten.

import { zonedToUtc } from "./ics.ts";
import { addDays } from "./plan.ts";

export const NOLIO_BASE = "https://www.nolio.io";
export const DEFAULT_TZ = "Europe/Zurich";
export const FIRST_SYNC_DAYS = 120; // history fetched on the first run
export const OVERLAP_DAYS = 3; // later runs start this many days before the last one
export const PLAN_DAYS = 28; // planned trainings: today … +28 days
export const COMPETITION_DAYS = 365; // planned competitions anchor the season: a year ahead
export const NOTES_MAX = 2000;
export const TITLE_MAX = 200;
export const PAGE_LIMIT = 100; // Nolio's maximum page size
/** Connectors whose measurements may only stay in Nolio. */
export const RESTRICTED_SOURCES: readonly string[] = ["strava", "whoop"];

// ---------- API shapes (v2; only the fields used here) ----------

export interface Quantity {
  value: number | null;
  unit?: string | null;
}
export interface Restriction {
  code?: string;
  source?: string;
  message?: string;
  fields?: string[];
}
/** A completed training (`trn_…`, /api/v2/real/trainings/) or competition (`cmp_…`, /api/v2/real/competitions/). */
export interface NolioRealEvent {
  id: string;
  name?: string | null;
  date_start: string; // YYYY-MM-DD (local)
  hour_start?: string | null; // HH:MM:SS
  sport?: string | null; // spt_…
  duration?: Quantity | null; // first part only
  total_duration?: Quantity | null; // whole multi-part workout
  distance?: Quantity | null;
  total_distance?: Quantity | null;
  load?: { coggan?: number | null; foster?: number | null } | null;
  debrief?: { rpe?: number | null; feeling?: number | null } | null;
  source?: string | null; // connector slug: garmin, strava, manual, …
  device_name?: string | null; // e.g. edge_520_plus
  planned?: string | null; // ptrn_… / pcmp_…
  restriction?: Restriction | null;
}
/** A planned training (`ptrn_…`) or competition (`pcmp_…`, adds event/location/goal_type). */
export interface NolioPlannedEvent {
  id: string;
  name?: string | null;
  date_start: string; // YYYY-MM-DD
  time?: string | null; // HH:MM, never together with moment
  moment?: string | null; // morning | noon | afternoon | evening
  sport?: string | null;
  description?: string | null;
  duration?: Quantity | null;
  total_duration?: Quantity | null;
  distance?: Quantity | null;
  total_distance?: Quantity | null;
  event?: string | null;
  location?: string | null;
  goal_type?: string | null; // 'a' main goal, 'b' secondary
}
export interface NolioSport {
  id: string;
  name?: string | null;
  slug?: string | null;
  sport_base?: string | null; // parent sport id
}
export interface NolioPage<T> {
  data: T[];
  has_more: boolean;
}
export type SportIndex = Map<string, NolioSport>;

// ---------- rows written by the sync ----------

/** public.nolio_trainings without user_id / synced_at. */
export interface TrainingRow {
  id: string;
  kind: "training" | "competition";
  day: string;
  started_at: string | null;
  sport: string | null;
  sport_name: string | null;
  minutes: number | null;
  distance_km: number | null;
  load: number | null;
  rpe: number | null;
  feeling: number | null;
  source: string | null;
  device_name: string | null;
  restricted: boolean;
  raw_name: string | null;
  planned_id: string | null;
}

/** What the mapping needs to know about a goal. created_day = local day the goal was created. */
export interface GoalForMapping {
  id: string;
  status: string;
  sports: string[] | null;
  effort_hours: number | null;
  target_date: string | null;
  created_day: string | null;
}

/** A goal_time row (source 'nolio') as the sync wants it. */
export interface GoalTimeRow {
  external_id: string;
  goal_id: string;
  day: string;
  minutes: number;
}
export interface ExistingGoalTime extends GoalTimeRow {
  id: string;
}

/** A calendar entry (public.events, source 'nolio') as the sync wants it. */
export interface EventRow {
  external_id: string;
  title: string;
  kind: "block" | "termin";
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  notes: string | null;
  location: string | null;
  goal_id: string | null;
  reminder_minutes: number;
}
export interface ExistingEvent extends Omit<EventRow, "reminder_minutes"> {
  id: string;
}

// ---------- small helpers ----------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

/** trimmed text, cut to `max` characters (with …), null when empty */
export function clean(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\r\n?/g, "\n").trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

/** A Nolio quantity in seconds (read: unit 's'; write units tolerated). */
export function toSeconds(q: Quantity | null | undefined): number | null {
  if (!q || !isNum(q.value) || q.value < 0) return null;
  const unit = (q.unit ?? "s").toLowerCase();
  if (unit === "s") return q.value;
  if (unit === "min") return q.value * 60;
  if (unit === "h") return q.value * 3600;
  return null;
}

/** A Nolio quantity in kilometres (read: unit 'km'). */
export function toKm(q: Quantity | null | undefined): number | null {
  if (!q || !isNum(q.value) || q.value < 0) return null;
  const unit = (q.unit ?? "km").toLowerCase();
  if (unit === "km") return q.value;
  if (unit === "m") return q.value / 1000;
  if (unit === "mi") return q.value * 1.609344;
  return null;
}

/** The time zone if the runtime knows it, else Europe/Zurich. */
export function validTimeZone(tz: unknown): string {
  if (typeof tz !== "string" || !tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

/** "YYYY-MM-DD" of a moment in a time zone. */
export function localDay(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Restricted rows (Strava, WHOOP, or a Nolio `restriction`) never count and never reach the AI. */
export function isRestricted(t: Pick<NolioRealEvent, "restriction" | "source">): boolean {
  if (t.restriction) return true;
  return RESTRICTED_SOURCES.includes(String(t.source ?? "").trim().toLowerCase());
}

/** Compares strings in constant time (for shared secrets). */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// ---------- sports ----------

export function sportIndex(sports: NolioSport[]): SportIndex {
  const m: SportIndex = new Map();
  for (const s of sports) if (s && typeof s.id === "string") m.set(s.id, s);
  return m;
}

/** "Course à pied" / "course-a-pied" / "COURSE_A_PIED" → "course a pied" */
export function normalizeSport(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();
}

interface SportKeys {
  ids: Set<string>;
  names: Set<string>;
}

/** Everything a goal's `sports` entry may name for this sport: its id, name, slug, and those of its parent sports. */
export function sportKeys(sportId: string | null | undefined, index: SportIndex, knownName?: string | null): SportKeys {
  const keys: SportKeys = { ids: new Set(), names: new Set() };
  if (knownName) keys.names.add(normalizeSport(knownName));
  let id = sportId ?? null;
  for (let depth = 0; id && depth < 4 && !keys.ids.has(id); depth++) {
    keys.ids.add(id);
    const s = index.get(id);
    if (!s) break;
    for (const n of [s.name, s.slug]) if (n) keys.names.add(normalizeSport(n));
    id = s.sport_base ?? null;
  }
  return keys;
}

function namesSport(entries: string[], keys: SportKeys): boolean {
  return entries.some((e) => {
    if (typeof e !== "string" || !e.trim()) return false;
    const v = e.trim();
    return keys.ids.has(v) || keys.names.has(normalizeSport(v));
  });
}

/** Sport ids (and their parents) still missing from the catalogue, for single lookups. */
export function missingSports(ids: Iterable<string | null | undefined>, index: SportIndex): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    let cur = id ?? null;
    for (let depth = 0; cur && depth < 4; depth++) {
      const s = index.get(cur);
      if (!s) {
        if (/^spt_[A-Za-z0-9]{1,64}$/.test(cur)) out.add(cur);
        break;
      }
      cur = s.sport_base ?? null;
    }
  }
  return [...out];
}

// ---------- goals ----------

/** A goal collects time from the day it was created (earlier hours belong in prior_hours) up to its target date. */
function goalCountsOn(g: GoalForMapping, day: string): boolean {
  if (g.created_day && day < g.created_day) return false;
  if (g.target_date && day > g.target_date) return false;
  return true;
}

/**
 * The goal a training on `day` counts toward:
 * - active goals whose `sports` name its sport (id, name or slug, also of a parent sport); with
 *   several, the one whose target date comes first;
 * - if no active goal has sports set and exactly ONE active goal has an effort estimate, that one;
 * - otherwise none.
 */
export function mapToGoal(keys: SportKeys, day: string, goals: GoalForMapping[]): string | null {
  const active = goals.filter((g) => g.status === "active");
  const withSports = active.filter((g) => Array.isArray(g.sports) && g.sports.some((s) => typeof s === "string" && s.trim()));
  if (withSports.length) {
    const hits = withSports
      .filter((g) => goalCountsOn(g, day) && namesSport(g.sports!, keys))
      .sort((a, b) => (a.target_date ?? "9999-12-31").localeCompare(b.target_date ?? "9999-12-31") || a.id.localeCompare(b.id));
    return hits[0]?.id ?? null;
  }
  const withEffort = active.filter((g) => isNum(g.effort_hours) && g.effort_hours > 0);
  if (withEffort.length === 1 && goalCountsOn(withEffort[0], day)) return withEffort[0].id;
  return null;
}

// ---------- completed trainings ----------

/** A completed training or race → a nolio_trainings row (null when the row is unusable). */
export function parseRealEvent(t: NolioRealEvent, opts: { tz: string; sports: SportIndex; kind?: "training" | "competition" }): TrainingRow | null {
  if (!t || typeof t.id !== "string" || !t.id || t.id.length > 100) return null;
  if (typeof t.date_start !== "string" || !DAY_RE.test(t.date_start)) return null;
  const sport = typeof t.sport === "string" && t.sport ? t.sport : null;
  const base = {
    id: t.id,
    kind: opts.kind ?? (t.id.startsWith("cmp_") ? "competition" : "training"),
    day: t.date_start,
    sport,
    sport_name: clean(sport ? opts.sports.get(sport)?.name : null, 100),
    source: clean(t.source, 50)?.toLowerCase() ?? null,
  } as const;
  if (isRestricted(t)) {
    // only what Nolio itself owns (day, sport) and the flag: no name, no measurements
    return { ...base, started_at: null, minutes: null, distance_km: null, load: null, rpe: null, feeling: null, device_name: null, restricted: true, raw_name: null, planned_id: null };
  }
  const secs = toSeconds(t.total_duration) ?? toSeconds(t.duration);
  const km = toKm(t.total_distance) ?? toKm(t.distance);
  const hm = typeof t.hour_start === "string" ? /^(\d{2}):(\d{2})/.exec(t.hour_start) : null;
  const load = isNum(t.load?.coggan) ? t.load!.coggan! : isNum(t.load?.foster) ? t.load!.foster! : null;
  const rpe = t.debrief?.rpe;
  const feeling = t.debrief?.feeling;
  return {
    ...base,
    started_at: hm ? zonedToUtc(`${t.date_start}T${hm[1]}:${hm[2]}`, opts.tz) : null,
    minutes: secs === null ? null : Math.round(secs / 60),
    distance_km: km === null ? null : round(km, 3),
    load: load === null ? null : round(load, 1),
    rpe: Number.isInteger(rpe) && rpe! >= 1 && rpe! <= 10 ? rpe! : null,
    feeling: Number.isInteger(feeling) && feeling! >= 1 && feeling! <= 5 ? feeling! : null,
    device_name: clean(t.device_name, 100),
    restricted: false,
    raw_name: clean(t.name, TITLE_MAX),
    planned_id: clean(t.planned, 100),
  };
}

/** Goal time for the trainings that count: not restricted, at least a minute, mapped to a goal. */
export function goalTimeFor(
  trainings: Pick<TrainingRow, "id" | "day" | "sport" | "sport_name" | "minutes" | "restricted">[],
  goals: GoalForMapping[],
  sports: SportIndex,
): GoalTimeRow[] {
  const out: GoalTimeRow[] = [];
  for (const t of trainings) {
    if (t.restricted || !isNum(t.minutes) || t.minutes < 1) continue;
    const goal = mapToGoal(sportKeys(t.sport, sports, t.sport_name), t.day, goals);
    if (goal) out.push({ external_id: t.id, goal_id: goal, day: t.day, minutes: Math.min(1440, Math.round(t.minutes)) });
  }
  return out;
}

/**
 * What to change in goal_time (source 'nolio'). `trainings` are all stored trainings of the person.
 * - a training that is gone, restricted or without minutes loses its row;
 * - a row whose goal is no longer active (done, paused, dropped) keeps its goal: finished goals keep
 *   their hours (minutes and day still follow a corrected training);
 * - otherwise the row follows the current mapping (new, moved to another goal, or removed).
 */
export function diffGoalTime(
  existing: ExistingGoalTime[],
  desired: GoalTimeRow[],
  trainings: Pick<TrainingRow, "id" | "day" | "minutes" | "restricted">[],
  goalStatus: Map<string, string>,
): { upserts: GoalTimeRow[]; deletes: string[] } {
  const want = new Map(desired.map((d) => [d.external_id, d]));
  const byId = new Map(trainings.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const upserts: GoalTimeRow[] = [];
  const deletes: string[] = [];
  for (const e of existing) {
    if (seen.has(e.external_id)) {
      deletes.push(e.id); // cannot happen with the unique index, but never count twice
      continue;
    }
    seen.add(e.external_id);
    const t = byId.get(e.external_id);
    const countable = t && !t.restricted && isNum(t.minutes) && t.minutes >= 1;
    if (!countable) {
      deletes.push(e.id);
      continue;
    }
    const status = goalStatus.get(e.goal_id);
    const target: GoalTimeRow | null = status !== undefined && status !== "active"
      ? { external_id: e.external_id, goal_id: e.goal_id, day: t.day, minutes: Math.min(1440, Math.round(t.minutes!)) }
      : want.get(e.external_id) ?? null;
    if (!target) deletes.push(e.id);
    else if (target.goal_id !== e.goal_id || target.day !== e.day || target.minutes !== e.minutes) upserts.push(target);
  }
  for (const d of desired) if (!seen.has(d.external_id)) upserts.push(d);
  return { upserts, deletes };
}

// ---------- planned trainings and competitions → calendar ----------

const MOMENT: Record<string, string> = { morning: "morgens", noon: "mittags", afternoon: "nachmittags", evening: "abends" };

/** "1:30 h · 12 km" */
export function volumeLabel(secs: number | null, km: number | null): string | null {
  const parts: string[] = [];
  if (secs !== null && secs >= 60) {
    const m = Math.round(secs / 60);
    parts.push(m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} h` : `${m} min`);
  }
  if (km !== null && km > 0) parts.push(`${String(round(km, 1)).replace(".", ",")} km`);
  return parts.length ? parts.join(" · ") : null;
}

/** A planned training (kind 'block') or competition (kind 'termin', all-day) → a calendar entry. */
export function plannedToEvent(
  p: NolioPlannedEvent,
  opts: { tz: string; sports: SportIndex; goals: GoalForMapping[]; kind: "training" | "competition" },
): EventRow | null {
  if (!p || typeof p.id !== "string" || !p.id || p.id.length > 100) return null;
  if (typeof p.date_start !== "string" || !DAY_RE.test(p.date_start)) return null;
  const competition = opts.kind === "competition";
  const sport = typeof p.sport === "string" && p.sport ? p.sport : null;
  const sportName = clean(sport ? opts.sports.get(sport)?.name : null, 100);
  const time = typeof p.time === "string" ? /^(\d{2}):(\d{2})/.exec(p.time) : null;
  const secs = toSeconds(p.total_duration) ?? toSeconds(p.duration);
  const km = toKm(p.total_distance) ?? toKm(p.distance);
  const allDay = competition || !time;

  const title =
    clean(p.name, TITLE_MAX) ?? (competition ? clean(p.event, TITLE_MAX) : null) ?? (sportName ? clean(`Training ${sportName}`, TITLE_MAX)! : competition ? "Wettkampf" : "Training");
  const starts_at = zonedToUtc(allDay ? p.date_start : `${p.date_start}T${time![1]}:${time![2]}`, opts.tz);
  const ends_at = !allDay && secs !== null && secs > 0 ? new Date(Date.parse(starts_at) + Math.min(secs, 86400) * 1000).toISOString() : null;

  const lines: (string | null)[] = [];
  if (competition) {
    const event = clean(p.event, 200);
    if (event && event !== title) lines.push(event);
    if (p.goal_type === "a") lines.push("A-Wettkampf (Hauptziel)");
    else if (p.goal_type === "b") lines.push("B-Wettkampf");
    if (time) lines.push(`Start: ${time[1]}:${time[2]}`);
  }
  if (!time && typeof p.moment === "string" && MOMENT[p.moment]) lines.push(`Tageszeit: ${MOMENT[p.moment]}`);
  const volume = volumeLabel(secs, km);
  if (volume) lines.push(`Geplant: ${volume}`);
  const description = clean(p.description, NOTES_MAX);
  if (description) lines.push((lines.length ? "\n" : "") + description);

  return {
    external_id: p.id,
    title,
    kind: competition ? "termin" : "block",
    starts_at,
    ends_at,
    all_day: allDay,
    notes: clean(lines.filter(Boolean).join("\n"), NOTES_MAX),
    location: competition ? clean(p.location, 200) : null,
    goal_id: mapToGoal(sportKeys(sport, opts.sports, sportName), p.date_start, opts.goals),
    reminder_minutes: allDay ? -480 : 30,
  };
}

const sameTime = (a: string | null, b: string | null) => (a === null || b === null ? a === b : Date.parse(a) === Date.parse(b));

/**
 * What to change in the calendar. `existing`: the person's Nolio entries from today on (plus any
 * with an id still planned). New ones are inserted (upsert on the external id, so an entry moved from
 * the past comes along), changed ones updated (the reminder stays as the person set it), and entries
 * of today or later that are no longer planned removed. `deletable` limits the removal to the kinds
 * whose Nolio list was read completely.
 */
export function diffEvents(
  existing: ExistingEvent[],
  desired: EventRow[],
  deletable: { block: boolean; termin: boolean },
  fromIso: string,
): { inserts: EventRow[]; updates: { id: string; patch: Partial<EventRow> }[]; deletes: string[] } {
  const want = new Map<string, EventRow>();
  for (const d of desired) if (!want.has(d.external_id)) want.set(d.external_id, d);
  const have = new Map<string, ExistingEvent>();
  const deletes: string[] = [];
  for (const e of existing) {
    if (have.has(e.external_id)) deletes.push(e.id);
    else have.set(e.external_id, e);
  }
  const inserts: EventRow[] = [];
  const updates: { id: string; patch: Partial<EventRow> }[] = [];
  for (const d of want.values()) {
    const e = have.get(d.external_id);
    if (!e) {
      inserts.push(d);
      continue;
    }
    const patch: Partial<EventRow> = {};
    if (e.title !== d.title) patch.title = d.title;
    if (e.kind !== d.kind) patch.kind = d.kind;
    if (e.all_day !== d.all_day) patch.all_day = d.all_day;
    if (!sameTime(e.starts_at, d.starts_at)) patch.starts_at = d.starts_at;
    if (!sameTime(e.ends_at, d.ends_at)) patch.ends_at = d.ends_at;
    if ((e.notes ?? null) !== d.notes) patch.notes = d.notes;
    if ((e.location ?? null) !== d.location) patch.location = d.location;
    if ((e.goal_id ?? null) !== d.goal_id) patch.goal_id = d.goal_id;
    if (patch.all_day !== undefined) patch.reminder_minutes = d.reminder_minutes; // the old offset means something else now
    if (Object.keys(patch).length) updates.push({ id: e.id, patch });
  }
  const from = Date.parse(fromIso);
  for (const e of have.values()) {
    if (want.has(e.external_id) || Date.parse(e.starts_at) < from) continue;
    if (deletable[e.kind]) deletes.push(e.id);
  }
  return { inserts, updates, deletes };
}

// ---------- windows ----------

export interface SyncWindow {
  today: string;
  /** completed trainings: from … to (inclusive) */
  from: string;
  to: string;
  /** planned trainings: today … planTo; planned competitions: today … competitionTo */
  planTo: string;
  competitionTo: string;
}

/** 120 days back on the first run, later from the last sync minus 3 days (at most a year back). */
export function syncWindow(lastSyncAt: string | null, now: Date, tz: string): SyncWindow {
  const today = localDay(now, tz);
  const last = lastSyncAt && Number.isFinite(Date.parse(lastSyncAt)) ? localDay(new Date(lastSyncAt), tz) : null;
  let from = last ? addDays(last, -OVERLAP_DAYS) : addDays(today, -FIRST_SYNC_DAYS);
  if (from > today) from = addDays(today, -OVERLAP_DAYS);
  const oldest = addDays(today, -366);
  if (from < oldest) from = oldest;
  return { today, from, to: addDays(today, 1), planTo: addDays(today, PLAN_DAYS), competitionTo: addDays(today, COMPETITION_DAYS) };
}

// ---------- errors ----------

export class NolioError extends Error {
  status: number; // HTTP status, 0 = network
  code: string | null; // Nolio's error.code
  retryAfter: number | null; // seconds (429)
  constructor(status: number, code: string | null, retryAfter: number | null = null) {
    super(`nolio ${status}${code ? ` ${code}` : ""}`);
    this.name = "NolioError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/** Seconds from a Retry-After header (seconds or HTTP date); 60 when missing or unreadable. */
export function parseRetryAfter(header: string | null | undefined, now = Date.now()): number {
  if (header) {
    const s = header.trim();
    if (/^\d+$/.test(s)) return Math.min(Number(s), 86400);
    const t = Date.parse(s);
    if (Number.isFinite(t)) return Math.max(0, Math.min(Math.ceil((t - now) / 1000), 86400));
  }
  return 60;
}

export function errorCode(body: unknown): string | null {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === "string" && code.length <= 80 ? code : null;
}

/** German message for the app (stored in nolio_sync.last_error). */
export function nolioErrorMessage(e: unknown, tz: string = DEFAULT_TZ, now = Date.now()): string {
  if (!(e instanceof NolioError)) return "Der Nolio-Abgleich ist fehlgeschlagen. Nächster Versuch beim nächsten Abgleich.";
  if (e.status === 401) return "Nolio lehnt den Schlüssel ab (ungültig oder widerrufen). Bitte in Nolio einen neuen Schlüssel erstellen und als NOLIO_API_KEY hinterlegen.";
  if (e.status === 403) {
    if (e.code === "subscription_required" || e.code === "api_access_denied")
      return "Nolio verweigert den Zugriff: Die Nolio-API braucht ein bezahltes Nolio-Abo.";
    if (e.code === "missing_scope") return "Dem Nolio-Schlüssel fehlen Rechte: nötig sind real:read und planned:read.";
    if (e.code === "wrong_api_version") return "Der Nolio-Schlüssel gehört zur alten API. Bitte in Nolio eine neue persönliche Anwendung und einen neuen Schlüssel erstellen.";
    return `Nolio verweigert den Zugriff${e.code ? ` (${e.code})` : ""}.`;
  }
  if (e.status === 429) {
    const at = new Intl.DateTimeFormat("de-CH", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(now + (e.retryAfter ?? 60) * 1000));
    return `Nolio-Limit erreicht. Nächster Versuch ab ${at} Uhr.`;
  }
  if (e.status === 0 || e.status >= 500) return "Nolio ist gerade nicht erreichbar. Nächster Versuch beim nächsten Abgleich.";
  return `Nolio hat die Anfrage abgelehnt (${e.status}${e.code ? `, ${e.code}` : ""}).`;
}

// ---------- API client (fetch is passed in) ----------

export interface NolioClientOptions {
  key: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** wait for a 429 at most this long (seconds) before giving up; Edge Functions can't wait an hour */
  maxWaitSec?: number;
  timeoutMs?: number;
}
type Params = Record<string, string | number | undefined>;

export function nolioClient(opts: NolioClientOptions) {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxWait = opts.maxWaitSec ?? 10;
  const timeoutMs = opts.timeoutMs ?? 20000;

  async function get<T>(path: string, params: Params = {}): Promise<T> {
    if (!/^\/api\/v2\/[a-z0-9_/-]*\/$/i.test(path)) throw new Error("bad nolio path");
    const url = new URL(path, NOLIO_BASE);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(url.toString(), {
          headers: { Authorization: `Bearer ${opts.key}`, Accept: "application/json" },
          signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined,
        });
      } catch {
        if (attempt < 1) {
          await sleep(2000);
          continue;
        }
        throw new NolioError(0, "network");
      }
      if (res.ok) {
        try {
          return (await res.json()) as T;
        } catch {
          throw new NolioError(502, "bad_json");
        }
      }
      const code = errorCode(await res.json().catch(() => null));
      if (res.status === 429) {
        const wait = parseRetryAfter(res.headers.get("Retry-After"));
        if (attempt < 1 && wait <= maxWait) {
          await sleep(wait * 1000);
          continue;
        }
        throw new NolioError(429, code ?? "throttled", wait);
      }
      if ((res.status === 503 || res.status === 502) && attempt < 1) {
        await sleep(2000);
        continue;
      }
      throw new NolioError(res.status, code);
    }
  }

  /** Every page of a list (limit + starting_after + has_more), at most `maxPages`; `truncated` when cut off. */
  async function list<T extends { id: string }>(path: string, params: Params = {}, maxPages = 20): Promise<{ items: T[]; truncated: boolean }> {
    const items: T[] = [];
    let after: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const r = await get<NolioPage<T>>(path, { ...params, limit: PAGE_LIMIT, starting_after: after });
      const data = Array.isArray(r?.data) ? r.data.filter((x) => x && typeof x.id === "string") : [];
      items.push(...data);
      if (!r?.has_more || !data.length) return { items, truncated: false };
      const last = data[data.length - 1].id;
      if (last === after) return { items, truncated: true };
      after = last;
    }
    return { items, truncated: true };
  }

  return { get, list };
}

// ---------- for the app and the coach ----------

/** "Garmin Edge 520 Plus" for Garmin rows (required wherever Garmin data is shown), else null. */
export function deviceAttribution(source: string | null | undefined, device: string | null | undefined): string | null {
  if (String(source ?? "").trim().toLowerCase() !== "garmin") return null;
  const model = String(device ?? "")
    .replace(/^garmin[\s_-]*/i, "")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => (/^\d/.test(w) || w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
  return model ? `Garmin ${model}` : "Garmin";
}

/**
 * The only shape in which Nolio trainings may be given to the coach (AI): restricted rows
 * (Strava, WHOOP, Nolio `restriction`) are left out completely.
 */
export function trainingsForCoach<T extends Pick<TrainingRow, "restricted" | "source">>(rows: T[]): T[] {
  return rows.filter((r) => !r.restricted && !isRestricted({ source: r.source, restriction: null }));
}
