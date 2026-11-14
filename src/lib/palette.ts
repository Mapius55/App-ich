// The "living sky" palette engine.
//
// From the library of 100 colours (colors100.ts) it picks the ~10 that suit
// this moment and place best: the sun's height at your location (night, blue
// hour, sunrise, morning, day, golden hour, sunset), the live weather, the
// season, the altitude, your mood today and your favourite nature. A daily
// seed varies the choice a little, so no two days look the same. The ground
// stays almost black; all colour lives in the light.

import { adjust, lightness, mixLch, withLightness } from "./color";
import { ROLES, WORLDS, type Role, type World } from "./worlds";
import { isAfterSolarNoon, solarElevation } from "./sun";
import type { Weather } from "./weather";

export interface Mood {
  valence: number; // -1 (schwer) .. 1 (leicht, froh)
  energy: number; // 0 (müde) .. 1 (voller Energie)
  word?: string;
}

export interface NaturePalette {
  name: string;
  colors: string[];
}

export interface PaletteInput {
  date: Date;
  lat: number;
  lon: number;
  elevation?: number | null; // metres above sea level
  weather?: Weather | null;
  mood?: Mood | null;
  nature?: NaturePalette | null;
}

export interface Palette {
  colors: string[]; // the world's 5 colours for the sky: main, accent, accent2, light, deep
  names: string[]; // name(s) of the colour world(s) in use
  orb: string[]; // 5 colours for the portal: [main, light, accent, deep, accent2]
  ground: string; // the almost-black ground
  glow: number; // how much light is in the sky: ~0.6 at night … 0.9 by day
  daylight: number; // 0 deep night … 1 full day (the portal gets deeper at night)
  bgTop: string;
  bgBottom: string;
  text: string;
  textSoft: string;
  isDark: boolean;
  speed: number; // animation speed multiplier
  seed: number;
  phase: string; // German label, e.g. "Sonnenuntergang"
  clouds: Clouds; // what the sky in the portal shows
}

/** How the clouds in the portal look: coverage and the mix of cloud types (0..1 each). */
export interface Clouds {
  cover: number; // how much of the sky is cloud
  cirrus: number; // fine, high veils
  stratus: number; // flat, wide layers (overcast, rain)
}

/** Clouds after the real weather; a pleasant mix when the weather is unknown. */
export function cloudsFor(w: Weather | null | undefined): Clouds {
  if (!w) return { cover: 0.5, cirrus: 0.5, stratus: 0.1 };
  const c = Math.min(1, Math.max(0, w.cloudCover / 100));
  switch (w.kind) {
    case "clear":
      return { cover: 0.22 + 0.2 * c, cirrus: 0.75, stratus: 0 };
    case "partly":
      return { cover: 0.45 + 0.25 * c, cirrus: 0.45, stratus: 0.1 };
    case "cloudy":
      return { cover: 0.75, cirrus: 0.1, stratus: 0.6 };
    case "fog":
      return { cover: 0.55, cirrus: 0, stratus: 0.95 };
    case "rain":
      return { cover: 0.85, cirrus: 0, stratus: 0.8 };
    case "snow":
      return { cover: 0.7, cirrus: 0.15, stratus: 0.55 };
    case "storm":
      return { cover: 0.92, cirrus: 0, stratus: 0.7 };
  }
}

// ---------- helpers ----------

const tri = (x: number, a: number, peak: number, b: number) =>
  x <= a || x >= b ? 0 : x < peak ? (x - a) / (peak - a) : (b - x) / (b - peak);
const ramp = (x: number, a: number, b: number) => Math.max(0, Math.min(1, (x - a) / (b - a)));

/** How strongly each light phase applies right now (0..1 each). */
function phaseMembership(elev: number, evening: boolean): Record<string, number> {
  return {
    N: 1 - ramp(elev, -14, -8),
    B: tri(elev, -14, -8, -2),
    D: evening ? 0 : tri(elev, -6, 0, 9),
    M: evening ? 0 : tri(elev, 3, 12, 26),
    T: ramp(elev, 12, 26),
    A: evening ? tri(elev, 1, 10, 24) : 0,
    S: evening ? tri(elev, -6, 0, 7) : 0,
  };
}

function phaseLabel(m: Record<string, number>, evening: boolean, elev: number): string {
  const top = Object.entries(m).sort((a, b) => b[1] - a[1])[0][0];
  switch (top) {
    case "N":
      return "Nacht";
    case "B":
      return evening ? "Blaue Stunde" : "Morgendämmerung";
    case "D":
      return "Sonnenaufgang";
    case "M":
      return "Vormittag";
    case "A":
      return elev < 10 ? "Goldene Stunde" : "Nachmittag";
    case "S":
      return "Sonnenuntergang";
    default:
      return "Tag";
  }
}

function weatherWeights(w: Weather | null | undefined): Record<string, number> | null {
  if (!w) return null;
  switch (w.kind) {
    case "clear":
      return { c: 1 };
    case "partly":
      return { c: 0.55, w: 0.45 };
    case "cloudy":
      return { w: 1 };
    case "fog":
      return { f: 1, w: 0.3 };
    case "rain":
      return { r: 1, w: 0.4 };
    case "snow":
      return { s: 1, w: 0.3 };
    case "storm":
      return { g: 1, r: 0.6 };
  }
}

// Season accents, blended by distance to the season's centre day.
const SEASONS = [
  { centre: 15, code: "wi", name: "Winter" },
  { centre: 105, code: "fr", name: "Frühling" },
  { centre: 196, code: "so", name: "Sommer" },
  { centre: 288, code: "he", name: "Herbst" },
];

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86400000);
}

function seasonWeights(date: Date, lat: number): Record<string, number> {
  let doy = dayOfYear(date);
  if (lat < 0) doy = (doy + 182) % 365; // southern hemisphere
  const out: Record<string, number> = {};
  let sum = 0;
  for (const s of SEASONS) {
    let dist = Math.abs(doy - s.centre);
    dist = Math.min(dist, 365 - dist);
    out[s.code] = Math.max(0, 1 - dist / 91);
    sum += out[s.code];
  }
  for (const k in out) out[k] /= sum || 1;
  return out;
}

export function seasonName(date: Date, lat: number): string {
  const w = seasonWeights(date, lat);
  return SEASONS.reduce((best, s) => (w[s.code] > w[best.code] ? s : best), SEASONS[0]).name;
}

/** Deterministic 0..1 random from a string (stable per day). */
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function localDayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function scoreWorld(
  w: World,
  phase: Record<string, number>,
  weather: Record<string, number> | null,
  season: Record<string, number>,
  elevation: number | null | undefined,
  jitter: number,
): number {
  const ms = w.phases.split("").map((p) => phase[p] ?? 0);
  const max = Math.max(...ms);
  let score = max + 0.2 * (ms.reduce((a, b) => a + b, 0) - max);

  const strongWeather = weather ? Math.max(weather.r ?? 0, weather.f ?? 0, weather.s ?? 0, weather.g ?? 0) : 0;
  if (w.weather) {
    const match = weather ? Math.min(1, w.weather.split("").reduce((a, k) => a + (weather[k] ?? 0), 0)) : 0;
    score += match > 0 ? 1.2 * match : -2; // weather worlds only in their weather
  } else if (strongWeather > 0.6) {
    score -= 0.5 * strongWeather; // rain, fog, snow, storm: prefer their own worlds
  }

  if (w.seasons) {
    const match = Math.min(1, (w.seasons.match(/.{2}/g) ?? []).reduce((a, s) => a + (season[s] ?? 0), 0));
    score += match > 0.35 ? 0.35 * match : -0.8;
  }
  if (w.alp) score += elevation != null && elevation > 900 ? 0.6 : -1.2;
  return score + jitter;
}

function moodAdjust(c: string, mood: Mood | null | undefined): string {
  if (!mood) return c;
  const v = Math.max(-1, Math.min(1, mood.valence));
  // a heavy day: softer and a bit calmer; a light day: a touch more colour
  return adjust(c, { chroma: 1 + 0.12 * v, dL: 0.015 * v });
}

export function computePalette(input: PaletteInput): Palette {
  const { date, lat, lon, weather, mood, nature, elevation } = input;
  const elev = solarElevation(date, lat, lon);
  const evening = isAfterSolarNoon(date, lat, lon);
  const phase = phaseMembership(elev, evening);
  const wx = weatherWeights(weather);
  const season = seasonWeights(date, lat);
  const day = localDayKey(date);

  // Score every world for this moment and place; a small daily jitter varies close calls.
  const ranked = WORLDS.map((w) => ({ w, s: scoreWorld(w, phase, wx, season, elevation, (seededRandom(day + w.id)() - 0.5) * 0.24) })).sort(
    (a, b) => b.s - a.s,
  );
  const [first, second] = ranked;
  // Blend the two best worlds smoothly: as the sun moves, one world fades into the next.
  const gap = first.s - second.s;
  const t = gap >= 0.4 ? 0 : 0.5 * (1 - gap / 0.4);
  const role = (r: Role) => {
    let c = t > 0 ? mixLch(first.w[r], second.w[r], t) : first.w[r];
    c = moodAdjust(c, mood);
    if (weather?.kind === "clear") c = adjust(c, { chroma: 1.05 });
    return c;
  };
  const w = Object.fromEntries(ROLES.map((r) => [r, role(r)])) as Record<Role, string>;

  // Your favourite nature lends its colour to the accent, matched to the light.
  if (nature?.colors?.length) {
    const n = withLightness(nature.colors[0], lightness(w.accent2));
    w.accent2 = mixLch(w.accent2, n, 0.6);
  }

  const daylight = ramp(elev, -10, 14);
  const ground = withLightness(adjust(w.deep, { chroma: 0.55 }), 0.075 + 0.045 * daylight);
  const rand = seededRandom(day);
  const energy = mood ? Math.max(0, Math.min(1, mood.energy)) : 0.5;

  return {
    colors: [w.main, w.accent, w.accent2, w.light, w.deep],
    names: t > 0.15 ? [first.w.name, second.w.name] : [first.w.name],
    orb: [w.main, w.light, w.accent, w.deep, w.accent2],
    ground,
    glow: 0.6 + 0.3 * ramp(elev, -12, 18),
    daylight,
    bgTop: ground,
    bgBottom: withLightness(ground, lightness(ground) + 0.04),
    text: "#fbf8f4",
    textSoft: "rgba(251,248,244,0.66)",
    isDark: true,
    speed: 0.55 + energy * 0.8,
    seed: Math.floor(rand() * 1e9),
    phase: phaseLabel(phase, evening, elev),
    clouds: cloudsFor(weather),
  };
}
