// Connections (WHOOP, Nolio, Polar, Garmin, Strava): the pure parts, shared by Du › Verbindungen,
// the connection chooser in onboarding and the demo backend. No DOM, no storage (see whoopReturn.ts).
import type { NolioStatus, WhoopDay, WhoopStatus } from "./types";
import { addDays } from "./plan";

// ---------- the return from WHOOP (#du/verbindungen?whoop=…) ----------

export type WhoopReturnResult = "confirm" | "connected" | "error" | "denied";

export interface WhoopReturn {
  result: WhoopReturnResult;
  /** the single-use confirmation code (only with result "confirm") */
  code: string | null;
  /** when the app saw it (ms) */
  at: number;
}

/** at least 32 URL-safe characters (the server's code), bounded */
export const WHOOP_CODE_RE = /^[A-Za-z0-9_-]{32,512}$/;
/** the server's code is valid 10 minutes; a stored return older than this is dropped */
export const WHOOP_RETURN_TTL_MS = 15 * 60_000;

/**
 * "#du/verbindungen?whoop=confirm&code=…" → the return and the hash without its query
 * ("#du/verbindungen"). Null when the hash carries no whoop parameter. A confirm without a
 * valid code counts as an error; "connected" is what the older callback sends.
 */
export function parseWhoopHash(hash: string, now = Date.now()): { ret: WhoopReturn; hash: string } | null {
  const q = hash.indexOf("?");
  if (q < 0) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(hash.slice(q + 1));
  } catch {
    return null;
  }
  const w = params.get("whoop");
  if (w === null) return null;
  const base = hash.slice(0, q);
  let result: WhoopReturnResult = "error";
  let code: string | null = null;
  if (w === "confirm") {
    const c = params.get("code") ?? "";
    if (WHOOP_CODE_RE.test(c)) {
      result = "confirm";
      code = c;
    }
  } else if (w === "connected") result = "connected";
  else if (w === "denied") result = "denied";
  return { ret: { result, code, at: now }, hash: base === "#" ? "" : base };
}

/** a stored return (sessionStorage JSON) if it is well-formed and still fresh, else null */
export function readWhoopReturn(raw: string | null, now = Date.now()): WhoopReturn | null {
  if (!raw) return null;
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  const r = j as Partial<WhoopReturn> | null;
  if (!r || typeof r !== "object" || typeof r.at !== "number") return null;
  if (!["confirm", "connected", "error", "denied"].includes(String(r.result))) return null;
  if (now - r.at > WHOOP_RETURN_TTL_MS || r.at - now > 60_000) return null;
  if (r.result === "confirm" && !(typeof r.code === "string" && WHOOP_CODE_RE.test(r.code))) return null;
  return { result: r.result as WhoopReturnResult, code: r.result === "confirm" ? (r.code as string) : null, at: r.at };
}

// ---------- row states ----------

/**
 * What the WHOOP row shows. `undefined` = still loading, `null` = the function is not deployed or
 * unreachable, `failed` = the status call errored otherwise (the row offers "Nochmal versuchen").
 */
export type WhoopRowKind = "loading" | "soon" | "unreachable" | "connect" | "pending" | "reconnect" | "connected";

export function whoopRowKind(s: WhoopStatus | null | undefined, failed = false): WhoopRowKind {
  if (failed) return "unreachable";
  if (s === undefined) return "loading";
  if (s === null) return "soon";
  if (s.status === "needs_reconnect") return s.available ? "reconnect" : "soon";
  if (s.connected || s.status === "connected") return "connected"; // the values stay visible even if the server lost its setup
  if (!s.available) return "soon";
  if (s.status === "pending") return "pending";
  return "connect";
}

export type NolioRowKind = "loading" | "soon" | "unreachable" | "ready";

/** Nolio is only there for the owner of the app (available); everyone else sees "Bald verfügbar". */
export function nolioRowKind(s: NolioStatus | null | undefined, failed = false): NolioRowKind {
  if (failed) return "unreachable";
  if (s === undefined) return "loading";
  if (s === null || !s.available) return "soon";
  return "ready";
}

/** The soft value on the right of "VERBINDUNGEN": what is connected, e.g. "WHOOP · Nolio". */
export function connectionsValue(whoop: WhoopStatus | null | undefined, nolio: NolioStatus | null | undefined): string | null {
  const on: string[] = [];
  if (whoopRowKind(whoop) === "connected") on.push("WHOOP");
  if (nolioRowKind(nolio) === "ready" && nolio?.connected) on.push("Nolio");
  return on.length ? on.join(" · ") : null;
}

/** The soft value on the right of "DEIN KÖRPER": the latest recovery (today or yesterday), else whether WHOOP is there. */
export function bodyValue(whoop: WhoopStatus | null | undefined, today: string): string {
  if (whoopRowKind(whoop) !== "connected" || !whoop) return "Noch nicht verbunden";
  const recent = whoop.days.find((d) => d.recovery_score !== null && d.day >= addDays(today, -1) && d.day <= today);
  return recent ? `Erholung ${Math.round(recent.recovery_score!)} %` : "WHOOP";
}

// ---------- labels ----------

/** "gerade eben", "vor 5 Min", "vor 2 Std", "gestern", "vor 3 Tagen", "am 3.11." */
export function agoLabel(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const min = Math.floor((now - t) / 60_000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std`;
  const d = Math.floor(h / 24);
  if (d === 1) return "gestern";
  if (d < 7) return `vor ${d} Tagen`;
  const date = new Date(t);
  return `am ${date.getDate()}.${date.getMonth() + 1}.`;
}

/** sleep in minutes → "7:10" (hours:minutes) */
export function sleepLabel(minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes <= 0) return null;
  const m = Math.round(minutes);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** strain 0–21 → "12.4" */
export function strainLabel(v: number | null | undefined): string | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return (Math.round(v * 10) / 10).toFixed(1);
}

export interface StripDay {
  day: string;
  recovery: number | null; // %
  sleep: number | null; // minutes
  strain: number | null; // 0–21
}

/** The last `n` days up to today, oldest first; days without a summary stay as gaps (null). */
export function whoopStrip(days: WhoopDay[], today: string, n = 14): StripDay[] {
  const by = new Map(days.map((d) => [d.day, d]));
  const out: StripDay[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    const d = by.get(day);
    out.push({ day, recovery: d?.recovery_score ?? null, sleep: d?.sleep_minutes ?? null, strain: d?.day_strain ?? null });
  }
  return out;
}

/** the newest value of a strip metric, with its day */
export function latest<K extends keyof Omit<StripDay, "day">>(strip: StripDay[], key: K): { day: string; value: number } | null {
  for (let i = strip.length - 1; i >= 0; i--) {
    const v = strip[i][key];
    if (v !== null) return { day: strip[i].day, value: v };
  }
  return null;
}

/** the average of a strip metric over the days that have it */
export function average<K extends keyof Omit<StripDay, "day">>(strip: StripDay[], key: K): number | null {
  const xs = strip.map((d) => d[key]).filter((v): v is number => v !== null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** "Jetzt holen" at most once a minute (the server skips more anyway) */
export const SYNC_GAP_MS = 60_000;
export function canSyncNow(lastSyncAt: string | null | undefined, lastTapAt: number | null, now = Date.now()): boolean {
  const last = Math.max(lastSyncAt ? Date.parse(lastSyncAt) || 0 : 0, lastTapAt ?? 0);
  return now - last >= SYNC_GAP_MS;
}

// ---------- services: one line each ----------

export type ServiceKey = "whoop" | "nolio" | "iphone" | "polar" | "garmin" | "strava";

export const SERVICE_NAMES: Record<ServiceKey, string> = {
  whoop: "WHOOP",
  nolio: "Nolio",
  iphone: "iPhone-Kalender",
  polar: "Polar",
  garmin: "Garmin",
  strava: "Strava",
};

/** what each service would give the coach (Du › Verbindungen, under the name) */
export const SERVICE_LINES = {
  whoop: "Schlaf, Erholung und Belastung. Nur kurze Tageswerte der letzten 14 Tage.",
  nolio: "Die Trainings, die dein Trainer plant, und was du davon gemacht hast. Sie zählen bei deinen Zielen.",
  polar: "Würde Trainings, Schlaf und Erholung von deiner Polar-Uhr lesen.",
  garmin: "Würde Trainings, Schlaf und Erholung von deiner Garmin-Uhr lesen.",
  garminViaNolio: "Deine Garmin-Trainings kommen schon über Nolio zu mir.",
  strava:
    "Strava erlaubt nicht, seine Daten an einen KI-Coach weiterzugeben. Darum verbinde ich es nicht. Verbinde lieber deine Uhr direkt: WHOOP, später Polar, oder Garmin über Nolio.",
} as const;

/** the one-line reason in the onboarding chooser when a service can't be connected (yet) */
export function unavailableReason(key: ServiceKey, o: { nolio?: boolean } = {}): string {
  switch (key) {
    case "whoop":
      return "WHOOP kommt bald. Dann lese ich Schlaf, Erholung und Belastung.";
    case "nolio":
      return "Nolio kommt bald.";
    case "polar":
      return "Polar kommt bald. Dann lese ich Trainings, Schlaf und Erholung von deiner Uhr.";
    case "garmin":
      return o.nolio ? SERVICE_LINES.garminViaNolio : "Garmin kommt bald. Dann lese ich Trainings, Schlaf und Erholung von deiner Uhr.";
    case "strava":
      return "Strava erlaubt nicht, seine Daten an einen KI-Coach weiterzugeben. Verbinde lieber deine Uhr direkt.";
    case "iphone":
      return "";
  }
}

// ---------- which trainings count toward a goal (goals.sports) ----------

export interface SportGroup {
  key: string;
  label: string;
  /**
   * What goals.sports stores for this group. The sync matches a training when an entry names its sport
   * (name or slug, also of a parent sport, accents and case ignored), and Nolio names sports in the
   * account's language, so each group carries its German, English and French names.
   */
  names: string[];
}

export const SPORT_GROUPS: SportGroup[] = [
  { key: "laufen", label: "Laufen", names: ["Laufen", "Running", "Course à pied", "Trail"] },
  { key: "velo", label: "Velo", names: ["Velo", "Cycling", "Cyclisme", "Bike"] },
  { key: "schwimmen", label: "Schwimmen", names: ["Schwimmen", "Swimming", "Natation"] },
  { key: "kraft", label: "Kraft", names: ["Krafttraining", "Strength training", "Musculation", "Renforcement musculaire"] },
  { key: "ski", label: "Ski und Langlauf", names: ["Langlauf", "Ski de fond", "Cross-country skiing", "Ski"] },
  { key: "wandern", label: "Wandern", names: ["Wandern", "Hiking", "Randonnée"] },
  { key: "triathlon", label: "Triathlon", names: ["Triathlon"] },
];

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();

/** the groups a goal's sports name (any of their names) */
export function sportGroupsOn(sports: string[] | null | undefined): Set<string> {
  const have = new Set((sports ?? []).filter((s) => typeof s === "string").map(norm));
  return new Set(SPORT_GROUPS.filter((g) => g.names.some((n) => have.has(norm(n)))).map((g) => g.key));
}

/** goals.sports with one group switched on or off; entries outside the groups (e.g. Nolio ids) stay */
export function toggleSportGroup(sports: string[] | null | undefined, key: string, on: boolean): string[] | null {
  const group = SPORT_GROUPS.find((g) => g.key === key);
  const list = (sports ?? []).filter((s) => typeof s === "string" && s.trim());
  if (!group) return list.length ? list : null;
  const names = new Set(group.names.map(norm));
  const rest = list.filter((s) => !names.has(norm(s)));
  const out = on ? [...rest, ...group.names] : rest;
  return out.length ? out.slice(0, 30) : null;
}
