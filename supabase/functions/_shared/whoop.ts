// WHOOP (wearable, API v2): parsing, daily summaries, signatures, tokens and the coach line for the
// Edge Functions "whoop", "whoop-callback" and "whoop-webhook".
// Pure: no Deno-only imports and no I/O of its own (the API client gets `fetch` passed in, the token
// store is passed in), so the tests (vitest) import it directly. WebCrypto (crypto.subtle) only.
//
// Rules that come from WHOOP's API terms (Oct 2026):
// - No copies of records: only minimal DAILY SUMMARIES are kept, for at most KEEP_DAYS days (today and
//   the 13 days before). No single workouts, sport names, heart rate curves or profile data (the
//   numeric WHOOP user id is kept only to match webhooks to the person).
// - Tokens are encrypted before they reach the database (sealToken/openToken, AES-256-GCM, key in the
//   function secrets, bound to the person and the token kind).
// - WHOOP data reaches the coach only after the person's explicit opt-in (connections.consent_ai) and
//   then only as the one short line from whoopCoachLine (use whoopForCoach, which checks the consent).
//   No medical advice (WHOOP_COACH_RULE).
// - Shown with the attribution "Daten von WHOOP" (WHOOP_ATTRIBUTION).
// - Workouts never become goal time: training hours come from Nolio (the watch syncs there), so WHOOP
//   workouts are kept only as a daily count and minutes (no double counting).

export const WHOOP_API = "https://api.prod.whoop.com/developer";
export const WHOOP_AUTHORIZE_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
export const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
/** What the app asks for. read:body_measurement (height, weight, max heart rate) is not needed, so it
 *  is not requested (data minimisation). read:profile is needed for the numeric user id. */
export const WHOOP_SCOPES: readonly string[] = ["offline", "read:recovery", "read:cycles", "read:sleep", "read:workout", "read:profile"];
export const WHOOP_ATTRIBUTION = "Daten von WHOOP";
export const WHOOP_COACH_RULE =
  "WHOOP-Werte (Daten von WHOOP) sind nur eine grobe Orientierung für Energie, Schlaf und Belastung. " +
  "Keine medizinischen Aussagen, Diagnosen oder Behandlungsratschläge; bei gesundheitlichen Fragen auf Fachleute verweisen.";

export const DEFAULT_TZ = "Europe/Zurich";
export const KEEP_DAYS = 14; // today and the 13 days before; older summaries are deleted daily
export const SYNC_DAYS = 3; // reconciliation and "Jetzt holen": today and the 2 days before
export const PAGE_LIMIT = 25; // WHOOP's maximum page size
export const MAX_PAGES = 10; // per collection and run (14 days need 1-2 pages)
export const STATE_LENGTH = 8;
export const STATE_TTL_MS = 10 * 60_000;
export const TOKEN_SKEW_MS = 60_000; // refresh a minute before the access token runs out
export const SIGNATURE_TOLERANCE_MS = 24 * 3600_000; // shorter than the dedupe window (2 days)

const DAY_MS = 86_400_000;

// ---------- API shapes (v2; only the fields used here) ----------

export type ScoreState = "SCORED" | "PENDING_SCORE" | "UNSCORABLE" | string;

export interface WhoopCycle {
  id: number;
  user_id?: number;
  start: string;
  end?: string | null; // absent for the current cycle
  timezone_offset?: string | null;
  score_state?: ScoreState;
  score?: {
    strain?: number | null; // 0-21
    kilojoule?: number | null;
    average_heart_rate?: number | null;
    max_heart_rate?: number | null;
    step_count?: number | null;
  } | null;
  step_count?: number | null;
}

export interface WhoopRecovery {
  cycle_id: number;
  sleep_id: string;
  user_id?: number;
  created_at?: string;
  updated_at?: string;
  score_state: ScoreState;
  score?: {
    user_calibrating?: boolean;
    recovery_score?: number | null; // 0-100
    resting_heart_rate?: number | null;
    hrv_rmssd_milli?: number | null;
    spo2_percentage?: number | null; // 4.0 and newer only
    skin_temp_celsius?: number | null; // 4.0 and newer only
  } | null;
}

export interface WhoopStageSummary {
  total_in_bed_time_milli?: number | null;
  total_awake_time_milli?: number | null;
  total_no_data_time_milli?: number | null;
  total_light_sleep_time_milli?: number | null;
  total_slow_wave_sleep_time_milli?: number | null;
  total_rem_sleep_time_milli?: number | null;
  sleep_cycle_count?: number | null;
  disturbance_count?: number | null;
}

export interface WhoopSleep {
  id: string;
  cycle_id?: number;
  user_id?: number;
  start: string;
  end: string;
  timezone_offset?: string | null;
  nap?: boolean;
  score_state?: ScoreState;
  score?: {
    stage_summary?: WhoopStageSummary | null;
    sleep_needed?: {
      baseline_milli?: number | null;
      need_from_sleep_debt_milli?: number | null;
      need_from_recent_strain_milli?: number | null;
      need_from_recent_nap_milli?: number | null;
    } | null;
    respiratory_rate?: number | null;
    sleep_performance_percentage?: number | null;
    sleep_consistency_percentage?: number | null;
    sleep_efficiency_percentage?: number | null;
  } | null;
}

export interface WhoopWorkout {
  id: string;
  user_id?: number;
  start: string;
  end: string;
  timezone_offset?: string | null;
  sport_name?: string | null; // read, never stored
  score_state?: ScoreState;
  score?: { strain?: number | null; kilojoule?: number | null; zone_durations?: Record<string, number> | null } | null;
}

export interface WhoopPage<T> {
  records?: T[];
  next_token?: string | null;
  nextToken?: string | null;
}

/** One row of public.whoop_days (without user_id / updated_at). */
export interface WhoopDay {
  day: string; // YYYY-MM-DD, the person's local day
  recovery_score: number | null;
  hrv_ms: number | null;
  resting_hr: number | null;
  spo2: number | null;
  skin_temp: number | null;
  sleep_minutes: number | null;
  sleep_performance: number | null;
  sleep_need_minutes: number | null;
  respiratory_rate: number | null;
  day_strain: number | null;
  kilojoule: number | null;
  steps: number | null;
  workout_count: number;
  workout_minutes: number;
}

// ---------- small helpers ----------

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A number inside [min, max], rounded to `digits` decimals; anything else is null (matches the table checks). */
export function bounded(v: unknown, min: number, max: number, digits = 0): number | null {
  if (!isNum(v)) return null;
  const f = 10 ** digits;
  const r = Math.round(v * f) / f;
  return r < min || r > max ? null : r;
}

export function validTimeZone(tz: unknown, fallback = DEFAULT_TZ): string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return fallback;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return fallback;
  }
}

/** The calendar day of an instant in a time zone (YYYY-MM-DD). */
export function localDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: validTimeZone(tz), year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** WHOOP's timezone_offset ("+01:00", "-05:00", "Z") in minutes east of UTC; null when unusable. */
export function parseOffset(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (t === "Z" || t === "z") return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(t);
  if (!m) return null;
  const h = +m[2];
  const min = +m[3];
  if (h > 14 || min > 59) return null;
  return (m[1] === "-" ? -1 : 1) * (h * 60 + min);
}

/** Local day of an instant: with the record's own UTC offset, else in the person's time zone. */
export function dayAt(iso: unknown, offset: unknown, tz: string, shiftMs = 0): string | null {
  if (typeof iso !== "string") return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const off = parseOffset(offset);
  if (off !== null) return new Date(t + shiftMs + off * 60_000).toISOString().slice(0, 10);
  return localDate(new Date(t + shiftMs), tz);
}

/** Minutes actually asleep: light + slow wave + REM, else time in bed minus awake and no-data time. */
export function asleepMinutes(st: WhoopStageSummary | null | undefined): number | null {
  if (!st) return null;
  const parts = [st.total_light_sleep_time_milli, st.total_slow_wave_sleep_time_milli, st.total_rem_sleep_time_milli];
  if (parts.every(isNum)) return (parts as number[]).reduce((a, b) => a + b, 0) / 60_000;
  if (isNum(st.total_in_bed_time_milli)) {
    const awake = isNum(st.total_awake_time_milli) ? st.total_awake_time_milli : 0;
    const noData = isNum(st.total_no_data_time_milli) ? st.total_no_data_time_milli : 0;
    return Math.max(0, st.total_in_bed_time_milli - awake - noData) / 60_000;
  }
  return null;
}

function sleepNeedMinutes(n: NonNullable<WhoopSleep["score"]>["sleep_needed"]): number | null {
  if (!n || !isNum(n.baseline_milli)) return null;
  const extra = [n.need_from_sleep_debt_milli, n.need_from_recent_strain_milli, n.need_from_recent_nap_milli].filter(isNum);
  return (n.baseline_milli + extra.reduce((a, b) => a + b, 0)) / 60_000;
}

const scored = (s: { score_state?: ScoreState; score?: unknown }) => s.score_state === "SCORED" && !!s.score;

// ---------- daily summaries ----------

/** The local day a single record belongs to (used by the webhook to know which day to recompute).
 *  Sleep (and so recovery, whose webhook id is the sleep's id): the day you wake up. Workout: the day it starts. */
export function recordDay(kind: "sleep" | "workout", rec: { start?: unknown; end?: unknown; timezone_offset?: unknown } | null, tz: string): string | null {
  if (!rec) return null;
  return kind === "sleep" ? dayAt(rec.end, rec.timezone_offset, tz) : dayAt(rec.start, rec.timezone_offset, tz);
}

export interface SummaryInput {
  cycles: WhoopCycle[];
  recoveries: WhoopRecovery[];
  sleeps: WhoopSleep[];
  workouts: WhoopWorkout[];
}

/**
 * Daily summaries for the local days from..to (inclusive), one row per day that has any value.
 * - Sleep: the day you wake up. Naps are left out; several main sleeps on one day add up, the scores
 *   (performance, need, respiratory rate) come from the longest one.
 * - Recovery: the day of its sleep (sleep_id), else the day of its cycle.
 * - Cycle (strain, kilojoule, steps): the day of the sleep its recovery points to, else the local day
 *   twelve hours after the cycle started (cycles begin around falling asleep). Two cycles on one day:
 *   the later one wins.
 * - Workouts: count and minutes on the day they start (no sport, no strain per workout).
 * Only SCORED values count; pending or unscorable records add nothing yet.
 */
export function summarizeDays(input: SummaryInput, opts: { tz: string; from: string; to: string }): WhoopDay[] {
  const tz = validTimeZone(opts.tz);
  const inRange = (d: string | null): d is string => !!d && d >= opts.from && d <= opts.to;

  // sleeps: wake-up day of every sleep (also unscored ones, so recoveries and cycles can follow them)
  const sleepDay = new Map<string, string>();
  for (const s of input.sleeps ?? []) {
    const d = recordDay("sleep", s, tz);
    if (d && typeof s.id === "string") sleepDay.set(s.id, d);
  }

  // cycles: day via the recovery's sleep, else start + 12 h
  const recoveryByCycle = new Map<number, WhoopRecovery>();
  for (const r of input.recoveries ?? []) if (isNum(r.cycle_id)) recoveryByCycle.set(r.cycle_id, r);
  const cycleDay = new Map<number, string>();
  for (const c of input.cycles ?? []) {
    if (!isNum(c.id)) continue;
    const rec = recoveryByCycle.get(c.id);
    const d = (rec && sleepDay.get(rec.sleep_id)) ?? dayAt(c.start, c.timezone_offset, tz, 12 * 3600_000);
    if (d) cycleDay.set(c.id, d);
  }

  const rows = new Map<string, WhoopDay>();
  const row = (day: string): WhoopDay => {
    let r = rows.get(day);
    if (!r) {
      r = {
        day,
        recovery_score: null,
        hrv_ms: null,
        resting_hr: null,
        spo2: null,
        skin_temp: null,
        sleep_minutes: null,
        sleep_performance: null,
        sleep_need_minutes: null,
        respiratory_rate: null,
        day_strain: null,
        kilojoule: null,
        steps: null,
        workout_count: 0,
        workout_minutes: 0,
      };
      rows.set(day, r);
    }
    return r;
  };

  // 1. cycles (the later cycle of a day wins)
  const cycleOfDay = new Map<string, WhoopCycle>();
  for (const c of input.cycles ?? []) {
    const d = cycleDay.get(c.id) ?? null;
    if (!inRange(d) || !scored(c)) continue;
    const prev = cycleOfDay.get(d);
    if (!prev || Date.parse(c.start) > Date.parse(prev.start)) cycleOfDay.set(d, c);
  }
  for (const [d, c] of cycleOfDay) {
    const r = row(d);
    r.day_strain = bounded(c.score?.strain, 0, 21, 1);
    r.kilojoule = bounded(c.score?.kilojoule, 0, 100_000);
    r.steps = bounded(c.score?.step_count ?? c.step_count, 0, 200_000);
  }

  // 2. sleep (naps left out)
  const mains = new Map<string, { s: WhoopSleep; minutes: number }[]>();
  for (const s of input.sleeps ?? []) {
    if (s.nap || !scored(s)) continue;
    const d = sleepDay.get(s.id) ?? null;
    if (!inRange(d)) continue;
    const minutes = asleepMinutes(s.score?.stage_summary);
    if (minutes === null) continue;
    const list = mains.get(d) ?? [];
    list.push({ s, minutes });
    mains.set(d, list);
  }
  for (const [d, list] of mains) {
    const r = row(d);
    const main = list.reduce((a, b) => (b.minutes > a.minutes ? b : a));
    r.sleep_minutes = bounded(Math.min(1440, list.reduce((a, b) => a + b.minutes, 0)), 0, 1440);
    r.sleep_performance = bounded(main.s.score?.sleep_performance_percentage, 0, 100);
    r.sleep_need_minutes = bounded(sleepNeedMinutes(main.s.score?.sleep_needed), 0, 1440);
    r.respiratory_rate = bounded(main.s.score?.respiratory_rate, 1, 60, 1);
  }

  // 3. recovery (on the day of its sleep, else of its cycle; the most recently updated wins)
  const recOfDay = new Map<string, WhoopRecovery>();
  for (const rec of input.recoveries ?? []) {
    if (!scored(rec)) continue;
    const d = sleepDay.get(rec.sleep_id) ?? cycleDay.get(rec.cycle_id) ?? null;
    if (!inRange(d)) continue;
    const prev = recOfDay.get(d);
    const t = (x: WhoopRecovery) => Date.parse(x.updated_at ?? x.created_at ?? "") || 0;
    if (!prev || t(rec) >= t(prev)) recOfDay.set(d, rec);
  }
  for (const [d, rec] of recOfDay) {
    const r = row(d);
    r.recovery_score = bounded(rec.score?.recovery_score, 0, 100);
    r.hrv_ms = bounded(rec.score?.hrv_rmssd_milli, 0, 999, 1);
    r.resting_hr = bounded(rec.score?.resting_heart_rate, 20, 250);
    r.spo2 = bounded(rec.score?.spo2_percentage, 50, 100, 1);
    r.skin_temp = bounded(rec.score?.skin_temp_celsius, 20, 45, 1);
  }

  // 4. workouts: count and minutes only
  for (const w of input.workouts ?? []) {
    const d = recordDay("workout", w, tz);
    if (!inRange(d)) continue;
    const ms = Date.parse(w.end) - Date.parse(w.start);
    if (!Number.isFinite(ms) || ms <= 0 || ms > DAY_MS) continue;
    const r = row(d);
    r.workout_count = Math.min(100, r.workout_count + 1);
    r.workout_minutes = Math.min(1440, r.workout_minutes + Math.round(ms / 60_000));
  }

  const hasValue = (r: WhoopDay) =>
    r.workout_count > 0 ||
    (Object.keys(r) as (keyof WhoopDay)[]).some((k) => k !== "day" && k !== "workout_count" && k !== "workout_minutes" && r[k] !== null);
  return [...rows.values()].filter(hasValue).sort((a, b) => a.day.localeCompare(b.day));
}

// ---------- sync windows ----------

export interface SyncWindow {
  from: string; // first local day written
  to: string; // last local day written (today)
  start: string; // WHOOP query "start" (UTC, with two days of margin)
  end: string | null; // WHOOP query "end", null = up to now
}

/** The oldest day that is kept (today and the 13 days before). */
export const keepFrom = (today: string) => addDays(today, -(KEEP_DAYS - 1));

/** Recent days (reconciliation, "Jetzt holen"), or all kept days on the first run, after a gap or when asked. */
export function syncWindow(today: string, lastSyncAt: string | null, now: Date, opts: { full?: boolean } = {}): SyncWindow {
  const last = lastSyncAt ? Date.parse(lastSyncAt) : NaN;
  const recent = Number.isFinite(last) && now.getTime() - last < (SYNC_DAYS - 1) * DAY_MS;
  const days = opts.full || !recent ? KEEP_DAYS : SYNC_DAYS;
  const from = addDays(today, -(days - 1));
  return { from, to: today, start: `${addDays(from, -2)}T00:00:00.000Z`, end: null };
}

/** One day (a webhook changed a record of that day). Null when the day is outside what is kept. */
export function dayWindow(day: string, today: string, now: Date): SyncWindow | null {
  if (day < keepFrom(today) || day > today) return null;
  const end = Date.parse(`${addDays(day, 2)}T00:00:00Z`);
  return { from: day, to: day, start: `${addDays(day, -2)}T00:00:00.000Z`, end: end < now.getTime() ? new Date(end).toISOString() : null };
}

// ---------- the coach line ----------

type CoachDay = Pick<WhoopDay, "day"> & Partial<Omit<WhoopDay, "day">>;

/** "7 Std 10", "45 Min". */
export function hoursMinutes(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} Min`;
  return `${Math.floor(m / 60)} Std ${String(m % 60).padStart(2, "0")}`;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** "steigend" / "sinkend" / "stabil": the latest three values against the earlier ones (oldest first). */
function direction(values: number[], threshold: (base: number) => number): string | null {
  if (values.length < 5) return null;
  const recent = avg(values.slice(-3));
  const before = avg(values.slice(0, -3));
  const diff = recent - before;
  if (Math.abs(diff) < threshold(before)) return "stabil";
  return diff > 0 ? "steigend" : "sinkend";
}

/**
 * One short German line for the coach, e.g.
 * "WHOOP (heute): Erholung 72 %, HRV 64 ms, Ruhepuls 48; Schlaf 7 Std 10 (Leistung 88 %); gestern Belastung 12.4.
 *  7 Tage: Erholung Ø 66 % (steigend), HRV stabil, Schlaf Ø 7 Std 05."
 * Null when there is nothing from the last 7 days. Data only, no judgement (see WHOOP_COACH_RULE).
 * Only for people who allowed it: call whoopForCoach, which checks consent_ai.
 */
export function whoopCoachLine(days: CoachDay[], today: string): string | null {
  const week = addDays(today, -6);
  const byDay = new Map<string, CoachDay>();
  for (const d of days ?? []) if (d && typeof d.day === "string" && d.day >= week && d.day <= today) byDay.set(d.day, d);
  if (!byDay.size) return null;

  const yesterday = addDays(today, -1);
  const hasNight = (d?: CoachDay) => !!d && (isNum(d.recovery_score) || isNum(d.sleep_minutes));
  const refDay = hasNight(byDay.get(today)) ? today : hasNight(byDay.get(yesterday)) ? yesterday : null;
  const ref = refDay ? byDay.get(refDay) : undefined;

  const groups: string[] = [];
  if (ref) {
    const body = [
      isNum(ref.recovery_score) ? `Erholung ${Math.round(ref.recovery_score)} %` : null,
      isNum(ref.hrv_ms) ? `HRV ${Math.round(ref.hrv_ms)} ms` : null,
      isNum(ref.resting_hr) ? `Ruhepuls ${Math.round(ref.resting_hr)}` : null,
    ].filter(Boolean);
    if (body.length) groups.push(body.join(", "));
    if (isNum(ref.sleep_minutes)) {
      groups.push(`Schlaf ${hoursMinutes(ref.sleep_minutes)}${isNum(ref.sleep_performance) ? ` (Leistung ${Math.round(ref.sleep_performance)} %)` : ""}`);
    }
  }
  const y = byDay.get(yesterday);
  if (y && (isNum(y.day_strain) || (y.workout_count ?? 0) > 0)) {
    const n = y.workout_count ?? 0;
    const workouts = n > 0 ? `${n} ${n === 1 ? "Training" : "Trainings"}, ${hoursMinutes(y.workout_minutes ?? 0)}` : "";
    groups.push(isNum(y.day_strain) ? `gestern Belastung ${y.day_strain.toFixed(1)}${workouts ? ` (${workouts})` : ""}` : `gestern ${workouts}`);
  }

  // 7-day trend, oldest first
  const series = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  const rec = series.map((d) => d.recovery_score).filter(isNum);
  const hrv = series.map((d) => d.hrv_ms).filter(isNum);
  const sleep = series.map((d) => d.sleep_minutes).filter(isNum);
  const trend: string[] = [];
  if (rec.length >= 3) {
    const dir = direction(rec, () => 7);
    trend.push(`Erholung Ø ${Math.round(avg(rec))} %${dir ? ` (${dir})` : ""}`);
  }
  if (hrv.length >= 5) trend.push(`HRV ${direction(hrv, (base) => Math.max(3, base * 0.07))}`);
  if (sleep.length >= 3) trend.push(`Schlaf Ø ${hoursMinutes(avg(sleep))}`);

  if (!groups.length && !trend.length) return null;
  const head = refDay === today ? "WHOOP (heute): " : refDay === yesterday ? "WHOOP (gestern): " : "WHOOP: ";
  const first = groups.length ? `${head}${groups.join("; ")}.` : "WHOOP:";
  return trend.length ? `${first} 7 Tage: ${trend.join(", ")}.` : first;
}

/** The coach line only for a connected person who switched on "Coach darf WHOOP-Daten sehen". */
export function whoopForCoach(
  connection: { consent_ai?: boolean | null; status?: string | null } | null | undefined,
  days: CoachDay[],
  today: string,
): string | null {
  if (!connection || connection.consent_ai !== true || connection.status !== "connected") return null;
  return whoopCoachLine(days, today);
}

// ---------- OAuth ----------

const URL_SAFE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export const STATE_RE = /^[A-Za-z0-9_-]{8}$/;

/** Exactly 8 random URL-safe characters (WHOOP wants at least 8). 64 symbols, so no modulo bias. */
export function randomState(bytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return [...bytes(STATE_LENGTH)].map((b) => URL_SAFE[b & 63]).join("");
}

export function authorizeUrl(p: { clientId: string; redirectUri: string; state: string; scopes?: readonly string[] }): string {
  const q: [string, string][] = [
    ["client_id", p.clientId],
    ["redirect_uri", p.redirectUri],
    ["response_type", "code"],
    ["scope", (p.scopes ?? WHOOP_SCOPES).join(" ")],
    ["state", p.state],
  ];
  return `${WHOOP_AUTHORIZE_URL}?${q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}

export type TokenGrant =
  | { grant: "authorization_code"; code: string; redirectUri: string; clientId: string; clientSecret: string }
  | { grant: "refresh_token"; refreshToken: string; clientId: string; clientSecret: string };

/** Form body for the token endpoint (client_secret_post). */
export function tokenRequestBody(g: TokenGrant): URLSearchParams {
  const b = new URLSearchParams();
  if (g.grant === "authorization_code") {
    b.set("grant_type", "authorization_code");
    b.set("code", g.code);
    b.set("redirect_uri", g.redirectUri);
  } else {
    b.set("grant_type", "refresh_token");
    b.set("refresh_token", g.refreshToken);
    b.set("scope", "offline");
  }
  b.set("client_id", g.clientId);
  b.set("client_secret", g.clientSecret);
  return b;
}

export interface TokenSet {
  access_token: string;
  refresh_token: string | null;
  expires_at: string; // ISO
  scope: string | null;
}

export function parseTokenResponse(j: unknown, now = Date.now()): TokenSet | null {
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  if (typeof o.access_token !== "string" || !o.access_token) return null;
  const secs = isNum(o.expires_in) && o.expires_in > 0 ? Math.min(o.expires_in, 30 * 86_400) : 3600;
  return {
    access_token: o.access_token,
    refresh_token: typeof o.refresh_token === "string" && o.refresh_token ? o.refresh_token : null,
    expires_at: new Date(now + secs * 1000).toISOString(),
    scope: typeof o.scope === "string" ? o.scope.slice(0, 500) : null,
  };
}

/** The numeric WHOOP user id (int64) taken from the raw JSON text, so no digit is lost to float precision. */
export function extractUserId(raw: string): string | null {
  const m = /"user_id"\s*:\s*"?(\d{1,20})"?/.exec(raw ?? "");
  return m ? m[1].replace(/^0+(?=\d)/, "") : null;
}

// ---------- token encryption (AES-256-GCM, key from the function secret WHOOP_TOKEN_KEY) ----------

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

const keyCache = new Map<string, Promise<CryptoKey>>();
function tokenKey(secret: string): Promise<CryptoKey> {
  let k = keyCache.get(secret);
  if (!k) {
    k = crypto.subtle
      .importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"])
      .then((base) =>
        crypto.subtle.deriveKey(
          { name: "HKDF", hash: "SHA-256", salt: enc.encode("app-ich/whoop-tokens"), info: enc.encode("v1") },
          base,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"],
        )
      );
    keyCache.set(secret, k);
  }
  return k;
}

/** "v1.<iv>.<ciphertext>"; `context` (e.g. "<user id>:refresh") is bound in, so sealed values can't be swapped between rows. */
export async function sealToken(plain: string, secret: string, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(context) }, await tokenKey(secret), enc.encode(plain));
  return `v1.${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
}

/** Throws when the value was not sealed with this key and context. */
export async function openToken(sealed: string, secret: string, context: string): Promise<string> {
  const [v, iv, ct] = (sealed ?? "").split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("token: unknown format");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64url(iv), additionalData: enc.encode(context) },
    await tokenKey(secret),
    fromB64url(ct),
  );
  return dec.decode(plain);
}

// ---------- single-flight refresh ----------

export type RefreshClaim =
  | { state: "claimed"; lock: string; refresh: string } // this caller refreshes
  | { state: "busy" } // someone else is refreshing right now
  | { state: "no_refresh" } // no refresh token stored
  | { state: "missing" }; // not connected

/** What validAccessToken needs from the database. `claim` must be atomic (row lock); `save` must write the
 *  new access AND refresh token in one statement and release the lock (refresh tokens rotate). */
export interface TokenStore {
  read(): Promise<{ access: string; expiresAt: string } | null>;
  claim(): Promise<RefreshClaim>;
  save(lock: string, t: TokenSet): Promise<void>;
  release(lock: string): Promise<void>;
  exchange(refreshToken: string): Promise<TokenSet>;
  sleep?(ms: number): Promise<void>;
  now?(): number;
}

/** A usable access token: the stored one while it is valid, else exactly one refresh at a time
 *  (the others wait for its result instead of spending the rotating refresh token a second time). */
export async function validAccessToken(store: TokenStore, opts: { force?: boolean; waitMs?: number; pollMs?: number } = {}): Promise<string> {
  const now = store.now ?? Date.now;
  const sleep = store.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const row = await store.read();
  if (!row) throw new WhoopError(401, "not_connected");
  const fresh = (iso: string) => Date.parse(iso) - TOKEN_SKEW_MS > now();
  if (!opts.force && fresh(row.expiresAt)) return row.access;

  const claim = await store.claim();
  if (claim.state === "missing") throw new WhoopError(401, "not_connected");
  if (claim.state === "no_refresh") throw new WhoopError(401, "no_refresh_token");
  if (claim.state === "busy") {
    const waitMs = opts.waitMs ?? 6000;
    const pollMs = opts.pollMs ?? 400;
    for (let waited = 0; waited < waitMs; waited += pollMs) {
      await sleep(pollMs);
      const r = await store.read();
      if (!r) throw new WhoopError(401, "not_connected");
      if (r.expiresAt !== row.expiresAt && fresh(r.expiresAt)) return r.access;
    }
    throw new WhoopError(503, "refresh_busy");
  }
  try {
    const t = await store.exchange(claim.refresh);
    await store.save(claim.lock, t);
    return t.access_token;
  } catch (e) {
    await store.release(claim.lock).catch(() => {});
    throw e;
  }
}

// ---------- webhooks ----------

export const WHOOP_EVENT_TYPES = [
  "recovery.updated",
  "recovery.deleted",
  "workout.updated",
  "workout.deleted",
  "sleep.updated",
  "sleep.deleted",
] as const;
export type WhoopEventType = (typeof WHOOP_EVENT_TYPES)[number];

export interface WhoopWebhookEvent {
  userId: string; // WHOOP's numeric user id, as text
  id: string; // sleep/workout uuid (for recovery events: the SLEEP's uuid)
  type: WhoopEventType;
  traceId: string;
}

/** Constant-time comparison of two strings. */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** base64(HMAC-SHA256(timestamp + raw body, client secret)) */
export async function whoopSignature(rawBody: string, timestamp: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(timestamp + rawBody)));
  let s = "";
  for (const b of mac) s += String.fromCharCode(b);
  return btoa(s);
}

/**
 * Checks X-WHOOP-Signature against X-WHOOP-Signature-Timestamp + the raw body. A numeric timestamp
 * (milliseconds, or seconds) older or newer than a day is refused; replays inside that day are caught
 * by the trace_id dedupe (kept 2 days).
 */
export async function verifyWhoopSignature(
  rawBody: string,
  timestamp: string | null | undefined,
  signature: string | null | undefined,
  secret: string,
  opts: { now?: number; toleranceMs?: number } = {},
): Promise<boolean> {
  if (!secret || typeof rawBody !== "string" || !timestamp || !signature) return false;
  const ts = timestamp.trim();
  if (/^\d{9,16}$/.test(ts)) {
    const n = Number(ts);
    const ms = n < 1e12 ? n * 1000 : n;
    if (Math.abs((opts.now ?? Date.now()) - ms) > (opts.toleranceMs ?? SIGNATURE_TOLERANCE_MS)) return false;
  }
  const expected = await whoopSignature(rawBody, ts, secret);
  return safeEqual(signature.trim(), expected);
}

export function parseWebhookEvent(raw: string): WhoopWebhookEvent | null {
  let o: Record<string, unknown>;
  try {
    const j = JSON.parse(raw);
    if (!j || typeof j !== "object" || Array.isArray(j)) return null;
    o = j as Record<string, unknown>;
  } catch {
    return null;
  }
  const type = o.type;
  if (typeof type !== "string" || !(WHOOP_EVENT_TYPES as readonly string[]).includes(type)) return null;
  const userId = extractUserId(raw);
  const id = typeof o.id === "string" ? o.id : isNum(o.id) ? String(o.id) : null;
  const traceId = typeof o.trace_id === "string" ? o.trace_id : null;
  if (!userId || !id || !/^[A-Za-z0-9-]{1,64}$/.test(id) || !traceId || traceId.length > 200) return null;
  return { userId, id, type: type as WhoopEventType, traceId };
}

// ---------- API client ----------

export class WhoopError extends Error {
  constructor(
    public status: number,
    public code: string | null = null,
    public retryAfter: number | null = null,
  ) {
    super(`whoop ${status}${code ? ` ${code}` : ""}`);
    this.name = "WhoopError";
  }
}

/** Retry-After in seconds (number or HTTP date); 60 when missing, at most an hour. */
export function parseRetryAfter(header: string | null | undefined, now = Date.now()): number {
  if (!header) return 60;
  const t = header.trim();
  if (/^\d+$/.test(t)) return Math.min(3600, Math.max(1, +t));
  const d = Date.parse(t);
  return Number.isFinite(d) ? Math.min(3600, Math.max(1, Math.ceil((d - now) / 1000))) : 60;
}

/** Errors that mean the person has to connect WHOOP again. */
export const needsReconnect = (e: unknown) =>
  e instanceof WhoopError && (e.status === 401 || e.code === "invalid_grant" || e.code === "no_refresh_token");

/** German message for connections.last_error (shown in the app). */
export function whoopErrorMessage(e: unknown): string {
  if (needsReconnect(e)) return "WHOOP hat den Zugriff beendet. Bitte verbinde WHOOP neu.";
  if (e instanceof WhoopError && e.status === 429) return "WHOOP bremst gerade (zu viele Anfragen). Ich versuche es später nochmal.";
  if (e instanceof WhoopError && (e.status >= 500 || e.status === 0)) return "WHOOP ist gerade nicht erreichbar. Ich versuche es später nochmal.";
  return "Der Abgleich mit WHOOP hat nicht geklappt. Ich versuche es später nochmal.";
}

export interface WhoopClientOptions {
  fetch: typeof fetch;
  token: () => Promise<string>;
  /** Called once after a 401: a forced refresh. Null = give up. */
  onUnauthorized?: () => Promise<string | null>;
  base?: string;
  maxWaitSec?: number; // wait this long for a 429 before giving up (default 3)
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function whoopClient(opts: WhoopClientOptions) {
  const base = opts.base ?? WHOOP_API;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  // one token promise for all requests of this client: parallel requests read (or refresh) it once
  let current: Promise<string> | null = null;
  const share = (p: Promise<string>) => {
    const shared = p.catch((e) => {
      if (current === shared) current = null;
      throw e;
    });
    current = shared;
    return shared;
  };
  const token = () => current ?? share(opts.token());

  async function request(method: "GET" | "DELETE", path: string, query?: Record<string, string>): Promise<Response> {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    let retried401 = false;
    let waited429 = false;
    let retried5xx = false;
    for (;;) {
      const used = await token();
      let res: Response;
      try {
        res = await opts.fetch(url.toString(), {
          method,
          headers: { Authorization: `Bearer ${used}`, Accept: "application/json" },
          signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(opts.timeoutMs ?? 15_000) : undefined,
        });
      } catch {
        throw new WhoopError(0, "network");
      }
      if (res.status === 401 && !retried401 && opts.onUnauthorized) {
        retried401 = true;
        await res.body?.cancel();
        // only the first request that sees the old token refreshes; the others wait for that result
        if ((await token().catch(() => null)) === used) {
          const refresh = opts.onUnauthorized;
          share(refresh().then((t) => {
            if (!t) throw new WhoopError(401);
            return t;
          }));
        }
        continue;
      }
      if (res.status === 429) {
        const wait = parseRetryAfter(res.headers.get("Retry-After"));
        await res.body?.cancel();
        if (!waited429 && wait <= (opts.maxWaitSec ?? 3)) {
          waited429 = true;
          await sleep(wait * 1000);
          continue;
        }
        throw new WhoopError(429, "rate_limited", wait);
      }
      if (res.status >= 500 && !retried5xx) {
        retried5xx = true;
        await res.body?.cancel();
        await sleep(1000);
        continue;
      }
      return res;
    }
  }

  return {
    /** GET a record; null when WHOOP says it does not exist (e.g. deleted in the meantime). */
    async get<T>(path: string, query?: Record<string, string>): Promise<T | null> {
      const res = await request("GET", path, query);
      if (res.status === 404) {
        await res.body?.cancel();
        return null;
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new WhoopError(res.status);
      }
      return (await res.json()) as T;
    },
    /** All records of a collection (newest first), page by page. `truncated` when maxPages ran out. */
    async list<T>(path: string, query: { start?: string; end?: string | null }, maxPages = MAX_PAGES): Promise<{ items: T[]; truncated: boolean }> {
      const items: T[] = [];
      let next: string | null = null;
      for (let page = 0; page < maxPages; page++) {
        const q: Record<string, string> = { limit: String(PAGE_LIMIT) };
        if (query.start) q.start = query.start;
        if (query.end) q.end = query.end;
        if (next) q.nextToken = next;
        const body: WhoopPage<T> | null = await this.get<WhoopPage<T>>(path, q);
        if (Array.isArray(body?.records)) items.push(...body.records);
        next = body?.next_token || body?.nextToken || null;
        if (!next) return { items, truncated: false };
      }
      return { items, truncated: true };
    },
    /** DELETE /v2/user/access: ends the app's access at WHOOP. True when WHOOP confirmed (or it was gone already). */
    async revoke(): Promise<boolean> {
      const res = await request("DELETE", "/v2/user/access");
      await res.body?.cancel();
      return res.ok || res.status === 401;
    },
  };
}

export type WhoopClient = ReturnType<typeof whoopClient>;
