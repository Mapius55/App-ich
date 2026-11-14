// The "living sky" palette engine.
//
// Inputs: moment + place (sun elevation), season, live weather, today's mood
// and the person's favourite nature colours. Output: five orb colours, a
// background gradient and matching text colours. A daily seed adds a small
// variation, so the orb never looks exactly the same two days in a row.

import { adjust, lightness, mix, withLightness } from "./color";
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
  weather?: Weather | null;
  mood?: Mood | null;
  nature?: NaturePalette | null;
}

export interface Palette {
  orb: string[]; // 5 colours
  bgTop: string;
  bgBottom: string;
  text: string;
  textSoft: string;
  surface: string; // translucent panels
  isDark: boolean;
  speed: number; // animation speed multiplier
  seed: number;
  phase: string; // German label, e.g. "Sonnenuntergang"
}

interface Key {
  elev: number;
  phase: string;
  orb: string[];
  bg: [string, string];
}

const NIGHT: Key = {
  elev: -18,
  phase: "Nacht",
  orb: ["#3b3a8f", "#6c4fb3", "#2a3f7a", "#a07fd6", "#d79ac9"],
  bg: ["#0f1230", "#1d1b45"],
};
const DAY: Key = {
  elev: 32,
  phase: "Tag",
  orb: ["#a9d6f2", "#ffe0b8", "#ffbfa3", "#bfe3d2", "#cdbff0"],
  bg: ["#f7f4ef", "#e9eef6"],
};

// Morning: night → blue dawn → dawn → early morning → morning → day
const MORNING: Key[] = [
  NIGHT,
  { elev: -8, phase: "Morgendämmerung", orb: ["#3f5aa8", "#7b74c9", "#c793c9", "#2b3a7a", "#9fb6e8"], bg: ["#151c46", "#36386e"] },
  { elev: -1, phase: "Sonnenaufgang", orb: ["#ffc7a8", "#f4a6b8", "#c9b6e4", "#ffe3a3", "#9fc0ea"], bg: ["#4a4a85", "#e8a9b0"] },
  { elev: 5, phase: "Früher Morgen", orb: ["#ffd8bd", "#f8c0cc", "#d7c9ef", "#fff0c2", "#bcdcf3"], bg: ["#f4e6ec", "#fbe2d2"] },
  { elev: 15, phase: "Morgen", orb: ["#d6ebf7", "#ffeccf", "#fbd3cf", "#d3eee2", "#e2d9f6"], bg: ["#f8f5f0", "#ecf1f7"] },
  DAY,
];

// Evening: day → late afternoon → golden hour → sunset → blue hour → night
const EVENING: Key[] = [
  NIGHT,
  { elev: -8, phase: "Blaue Stunde", orb: ["#4c5bb8", "#8a6cc9", "#d784b4", "#2f3c86", "#f0a59a"], bg: ["#1c2150", "#3b2f68"] },
  { elev: -2, phase: "Sonnenuntergang", orb: ["#ff8a5b", "#ff6f91", "#c86dd7", "#7d5bc4", "#ffc070"], bg: ["#3a2a5e", "#c4607a"] },
  { elev: 5, phase: "Goldene Stunde", orb: ["#ffb37a", "#ffd27f", "#ff9a8b", "#f7a1c4", "#b9a3e3"], bg: ["#fbe3cc", "#f5bfa9"] },
  { elev: 14, phase: "Später Nachmittag", orb: ["#ffc9a3", "#ffe0b0", "#f5b2c0", "#c9b8ea", "#a9d3f0"], bg: ["#fdf1e6", "#f7dcd2"] },
  DAY,
];

function interpolate(track: Key[], elev: number): { orb: string[]; bg: [string, string]; phase: string } {
  if (elev <= track[0].elev) return { orb: track[0].orb, bg: track[0].bg, phase: track[0].phase };
  const last = track[track.length - 1];
  if (elev >= last.elev) return { orb: last.orb, bg: last.bg, phase: last.phase };
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i];
    const b = track[i + 1];
    if (elev >= a.elev && elev <= b.elev) {
      const t = (elev - a.elev) / (b.elev - a.elev);
      // ease so each phase lingers a little before blending into the next
      const e = t * t * (3 - 2 * t);
      return {
        orb: a.orb.map((c, k) => mix(c, b.orb[k], e)),
        bg: [mix(a.bg[0], b.bg[0], e), mix(a.bg[1], b.bg[1], e)],
        phase: e < 0.5 ? a.phase : b.phase,
      };
    }
  }
  return { orb: last.orb, bg: last.bg, phase: last.phase };
}

// Season accents, blended by distance to the season's centre day.
const SEASONS = [
  { centre: 15, accent: "#cfe0f5", chroma: 0.86, name: "Winter" }, // mid-January
  { centre: 105, accent: "#c6efc9", chroma: 1.04, name: "Frühling" }, // mid-April
  { centre: 196, accent: "#ffd27a", chroma: 1.12, name: "Sommer" }, // mid-July
  { centre: 288, accent: "#e8a25a", chroma: 1.0, name: "Herbst" }, // mid-October
];

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86400000);
}

function seasonBlend(date: Date, lat: number): { accent: string; chroma: number; name: string } {
  let doy = dayOfYear(date);
  if (lat < 0) doy = (doy + 182) % 365; // southern hemisphere
  const weights = SEASONS.map((s) => {
    let dist = Math.abs(doy - s.centre);
    dist = Math.min(dist, 365 - dist);
    return Math.max(0, 1 - dist / 91);
  });
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  let accent = SEASONS[0].accent;
  let acc = 0;
  let chroma = 0;
  weights.forEach((w, i) => {
    const wn = w / sum;
    chroma += SEASONS[i].chroma * wn;
    if (wn > 0) {
      accent = acc === 0 ? SEASONS[i].accent : mix(accent, SEASONS[i].accent, wn / (acc + wn));
      acc += wn;
    }
  });
  const strongest = weights.indexOf(Math.max(...weights));
  return { accent, chroma, name: SEASONS[strongest].name };
}

export function seasonName(date: Date, lat: number): string {
  return seasonBlend(date, lat).name;
}

function weatherAdjust(c: string, w: Weather | null | undefined, night: boolean): string {
  if (!w) return c;
  const cloud = Math.min(1, w.cloudCover / 100);
  let out = adjust(c, { chroma: 1 - 0.35 * cloud });
  const grey = night ? "#3a3f55" : "#c3c6d0";
  out = mix(out, withLightness(grey, lightness(out)), 0.18 * cloud);
  switch (w.kind) {
    case "clear":
      return adjust(out, { chroma: 1.06 });
    case "rain":
      return adjust(mix(out, withLightness("#7d8fa8", lightness(out)), 0.22), { chroma: 0.8 });
    case "snow":
      return mix(out, night ? "#9aa8c8" : "#eef3fb", 0.28);
    case "fog":
      return adjust(mix(out, withLightness("#d6d6dc", lightness(out)), 0.3), { chroma: 0.7 });
    case "storm":
      return adjust(mix(out, withLightness("#4a4e6e", lightness(out)), 0.28), { chroma: 0.85 });
    default:
      return out;
  }
}

function moodAdjust(c: string, mood: Mood | null | undefined): string {
  if (!mood) return c;
  const v = Math.max(-1, Math.min(1, mood.valence));
  let out = adjust(c, { chroma: 1 + 0.15 * v, dL: 0.025 * v });
  // A heavy day gets softer, calmer, gently cooler colours — never harsh.
  if (v < 0) out = mix(out, withLightness("#9aa6d6", lightness(out)), 0.18 * -v);
  return out;
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

export function computePalette(input: PaletteInput): Palette {
  const { date, lat, lon, weather, mood, nature } = input;
  const elev = solarElevation(date, lat, lon);
  const track = isAfterSolarNoon(date, lat, lon) ? EVENING : MORNING;
  const base = interpolate(track, elev);
  const night = elev < -4;

  const season = seasonBlend(date, lat);
  const rand = seededRandom(localDayKey(date));
  const dailyHue = (rand() - 0.5) * 12; // ±6° — today is a little different from yesterday

  let orb = base.orb.map((c) => {
    let x = mix(c, withLightness(season.accent, lightness(c)), 0.12);
    x = adjust(x, { chroma: season.chroma, hue: dailyHue });
    x = weatherAdjust(x, weather, night);
    x = moodAdjust(x, mood);
    // The orb is the light source of the screen: keep it a touch more vivid than the sky.
    return adjust(x, { chroma: 1.18 });
  });

  // Weave in the person's own nature colours, matched to the current light.
  if (nature?.colors?.length) {
    const n = nature.colors;
    const slots: [number, number][] = [
      [1, 0.55],
      [3, 0.5],
      [4, 0.25],
    ];
    slots.forEach(([slot, w], i) => {
      const nc = n[i % n.length];
      const matched = withLightness(nc, lightness(orb[slot]) * 0.7 + lightness(nc) * 0.3);
      orb[slot] = mix(orb[slot], matched, w);
    });
  }

  let [bgTop, bgBottom] = base.bg.map((c) => {
    let x = mix(c, withLightness(season.accent, lightness(c)), 0.08);
    x = weatherAdjust(x, weather, night);
    if (mood) x = adjust(x, { chroma: 1 + 0.08 * mood.valence });
    return x;
  }) as [string, string];

  const isDark = (lightness(bgTop) + lightness(bgBottom)) / 2 < 0.62;
  const energy = mood ? Math.max(0, Math.min(1, mood.energy)) : 0.5;

  return {
    orb,
    bgTop,
    bgBottom,
    isDark,
    text: isDark ? "#fbf6f1" : "#2a2440",
    textSoft: isDark ? "rgba(251,246,241,0.68)" : "rgba(42,36,64,0.62)",
    surface: isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.55)",
    speed: 0.55 + energy * 0.8,
    seed: Math.floor(rand() * 1e9),
    phase: base.phase,
  };
}
