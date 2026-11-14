// The "living sky" palette engine.
//
// From the library of 100 colours (colors100.ts) it picks the ~10 that suit
// this moment and place best: the sun's height at your location (night, blue
// hour, sunrise, morning, day, golden hour, sunset), the live weather, the
// season, the altitude, your mood today and your favourite nature. A daily
// seed varies the choice a little, so no two days look the same. The ground
// stays almost black; all colour lives in the light.

import { adjust, hexToRgb, lightness, mix, rgbToOklab, withLightness } from "./color";
import { COLORS, type LibColor } from "./colors100";
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
  colors: string[]; // ~10 colours, ordered around the colour wheel (sky flow)
  names: string[]; // their names, same order
  orb: string[]; // 5 colours for the portal: [main, light, accent, deep, accent]
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
}

const PICK = 10;

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
      return "Morgen";
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

function letters(codes: string): string[] {
  return codes.split("");
}
function pairs(codes: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < codes.length; i += 2) out.push(codes.slice(i, i + 2));
  return out;
}

function hue(hex: string): number {
  const [, a, b] = rgbToOklab(hexToRgb(hex));
  return Math.atan2(b, a);
}
function distance(a: string, b: string): number {
  const A = rgbToOklab(hexToRgb(a));
  const B = rgbToOklab(hexToRgb(b));
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}

function scoreColor(
  col: LibColor,
  phase: Record<string, number>,
  weather: Record<string, number> | null,
  season: Record<string, number>,
  elevation: number | null | undefined,
  jitter: number,
): number {
  let score: number;
  if (col.phases) {
    const ms = letters(col.phases).map((p) => phase[p] ?? 0);
    const max = Math.max(...ms);
    score = max + 0.25 * (ms.reduce((a, b) => a + b, 0) - max);
  } else {
    score = 0.45; // weather colours: fit any time, but only in their weather
  }

  if (col.weather) {
    if (!weather) score += col.phases ? -0.05 : -1;
    else {
      const match = Math.min(1, letters(col.weather).reduce((a, w) => a + (weather[w] ?? 0), 0));
      score += match > 0 ? 0.8 * match : col.phases ? -0.35 : -1;
    }
  }

  if (col.seasons) {
    const match = Math.min(1, pairs(col.seasons).reduce((a, s) => a + (season[s] ?? 0), 0));
    score += 0.3 * match - 0.12 * (1 - match);
  }

  if (col.alp) score += elevation != null && elevation > 900 ? 0.35 : -0.25;

  return score + jitter;
}

function weatherAdjust(c: string, w: Weather | null | undefined): string {
  if (!w) return c;
  const cloud = Math.min(1, w.cloudCover / 100);
  let out = adjust(c, { chroma: 1 - 0.25 * cloud });
  if (w.kind === "fog") out = adjust(out, { chroma: 0.75 });
  if (w.kind === "clear") out = adjust(out, { chroma: 1.06 });
  return out;
}

function moodAdjust(c: string, mood: Mood | null | undefined): string {
  if (!mood) return c;
  const v = Math.max(-1, Math.min(1, mood.valence));
  let out = adjust(c, { chroma: 1 + 0.15 * v, dL: 0.02 * v });
  // A heavy day gets softer, calmer, gently cooler colours, never harsh.
  if (v < 0) out = mix(out, withLightness("#9aa6d6", lightness(out)), 0.18 * -v);
  return out;
}

export function computePalette(input: PaletteInput): Palette {
  const { date, lat, lon, weather, mood, nature, elevation } = input;
  const elev = solarElevation(date, lat, lon);
  const evening = isAfterSolarNoon(date, lat, lon);
  const phase = phaseMembership(elev, evening);
  const wx = weatherWeights(weather);
  const season = seasonWeights(date, lat);
  const day = localDayKey(date);

  // Score all 100 colours for this moment and place.
  const scored = COLORS.map((col) => {
    const jitter = (seededRandom(day + col.hex)() - 0.5) * 0.3;
    return { col, score: scoreColor(col, phase, wx, season, elevation, jitter) };
  }).sort((a, b) => b.score - a.score);

  // Take the best ones, skipping near-duplicates so the sky stays rich.
  const picked: { hex: string; name: string; score: number }[] = [];
  for (const { col, score } of scored) {
    if (picked.length >= PICK) break;
    if (picked.every((p) => distance(p.hex, col.hex) > 0.07)) picked.push({ hex: col.hex, name: col.name, score });
  }

  // The person's favourite nature joins the sky, matched to the light.
  if (nature?.colors?.length) {
    const avgL = picked.reduce((a, p) => a + lightness(p.hex), 0) / picked.length;
    const add = nature.colors.slice(0, 2).map((h, i) => ({
      hex: withLightness(h, avgL * 0.7 + lightness(h) * 0.3),
      name: `${nature.name} ${i + 1}`,
      score: 0,
    }));
    picked.splice(picked.length - add.length, add.length, ...add);
  }

  const finish = (h: string) => adjust(moodAdjust(weatherAdjust(h, weather), mood), { chroma: 1.08 });

  // Portal: the five strongest, arranged by role.
  const five = [...picked]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((p) => finish(p.hex))
    .sort((a, b) => lightness(b) - lightness(a));
  const orb = [five[1], five[0], five[2], five[4], five[3]];

  // Sky flow: ordered around the colour wheel for smooth transitions.
  const flow = [...picked].sort((a, b) => hue(a.hex) - hue(b.hex));
  const colors = flow.map((p) => finish(p.hex));

  const darkest = colors.reduce((d, c) => (lightness(c) < lightness(d) ? c : d), colors[0]);
  const glow = 0.6 + 0.3 * ramp(elev, -12, 18);
  const ground = withLightness(adjust(darkest, { chroma: 0.45 }), 0.075 + 0.05 * ramp(elev, -12, 18));

  const rand = seededRandom(day);
  const energy = mood ? Math.max(0, Math.min(1, mood.energy)) : 0.5;

  return {
    colors,
    names: flow.map((p) => p.name),
    orb,
    ground,
    glow,
    daylight: ramp(elev, -10, 14),
    bgTop: ground,
    bgBottom: withLightness(ground, lightness(ground) + 0.04),
    text: "#fbf8f4",
    textSoft: "rgba(251,248,244,0.66)",
    isDark: true,
    speed: 0.55 + energy * 0.8,
    seed: Math.floor(rand() * 1e9),
    phase: phaseLabel(phase, evening, elev),
  };
}
