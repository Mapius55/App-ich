// «Leben» (level 4): the pure part of life in weeks. No React, no backend; tested in
// tests/life.test.ts. 90 rows (the calendar years from the birth year on) × 52 columns
// (the weeks of that year), with lifeWeeks / weekCell from the shared plan helpers.
import { mix, mixLch } from "../lib/color";
import { LIFE_WEEKS_PER_YEAR, LIFE_YEARS, thousands, weekCell, type LifeWeeks } from "../lib/plan";
import type { Goal } from "../lib/types";
import { dreamWhen, fulfilledDay, isDream, monthYear } from "../places/bucket";
import { sameDayInYear } from "../space/state";

export { LIFE_YEARS, LIFE_WEEKS_PER_YEAR };

/** the gap between two cells, in CSS px */
export const LIFE_GAP = 1;
/** the first year the pickers offer */
export const FIRST_BIRTH_YEAR = 1920;

// ---------- geometry ----------

export interface LifeLayout {
  /** canvas backing store, device px */
  widthD: number;
  heightD: number;
  /** CSS size of the canvas (the backing store / dpr, so it stays crisp) */
  width: number;
  height: number;
  /** one cell plus one gap, CSS px (for hit tests and the overlays) */
  pitch: number;
  /** the cell's side, CSS px */
  cell: number;
  dpr: number;
  /** a cell's box in device px; neighbours share whole device pixels, so the grid stays crisp */
  box(row: number, col: number): { x: number; y: number; w: number; h: number };
  /** a cell's box in CSS px (overlays) */
  cssBox(row: number, col: number): { x: number; y: number; w: number; h: number };
}

/**
 * The grid for a container `width` CSS px wide: the grid is the container's width, the cell
 * (width − 51·gap) / 52, the height follows (square cells). Drawn in device pixels: the gap is
 * a whole device pixel (at least one), every cell starts on a whole device pixel.
 */
export function lifeLayout(width: number, dpr = 1): LifeLayout {
  const d = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const widthD = Math.max(LIFE_WEEKS_PER_YEAR * 2, Math.floor(width * d));
  const gapD = Math.max(1, Math.round(LIFE_GAP * d));
  const pitchD = (widthD + gapD) / LIFE_WEEKS_PER_YEAR;
  const heightD = Math.round(LIFE_YEARS * pitchD - gapD);
  const edge = (i: number) => Math.round(i * pitchD);
  const box = (row: number, col: number) => {
    const x = edge(col);
    const y = edge(row);
    return { x, y, w: Math.max(1, edge(col + 1) - gapD - x), h: Math.max(1, edge(row + 1) - gapD - y) };
  };
  return {
    widthD,
    heightD,
    width: widthD / d,
    height: heightD / d,
    pitch: pitchD / d,
    cell: (pitchD - gapD) / d,
    dpr: d,
    box,
    cssBox: (row, col) => {
      const b = box(row, col);
      return { x: b.x / d, y: b.y / d, w: b.w / d, h: b.h / d };
    },
  };
}

/** the cell under a point of the canvas (CSS px), clamped to the grid; null outside it */
export function cellAt(l: Pick<LifeLayout, "pitch" | "width" | "height">, x: number, y: number): { row: number; col: number } | null {
  if (!(x >= 0 && y >= 0 && x <= l.width && y <= l.height)) return null;
  return { row: Math.min(LIFE_YEARS - 1, Math.floor(y / l.pitch)), col: Math.min(LIFE_WEEKS_PER_YEAR - 1, Math.floor(x / l.pitch)) };
}

// ---------- the colour flow (the circle's own palette) ----------

/**
 * The stops of the flow a life is coloured with, from the circle's palette (palette.orb:
 * [main, light, accent, deep, accent2]): the second accent, the light tone, the accent and
 * the main colour. The light tone bridges the two accents, so the flow stays clean (no grey
 * or olive between far-apart hues), and every stop is lifted a little toward it so it reads
 * on the dark ground. Never the deep tone (it would sink into the ground).
 */
export function flowStops(orb: readonly string[]): string[] {
  const c = (i: number, fb: number) => orb[i] ?? orb[fb] ?? orb[0] ?? "#b9c8ff";
  const light = c(1, 0);
  return [mix(light, c(4, 2), 0.84), mix(light, c(2, 0), 0.22), mix(light, c(2, 0), 0.88), mix(light, c(0, 0), 0.86)];
}

/** n colours evenly along the stops (OKLCh, the shorter hue arc: no grey in between) */
export function flowRamp(stops: readonly string[], n: number): string[] {
  const out: string[] = [];
  if (!stops.length) return out;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const f = t * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(f));
    out.push(stops.length === 1 ? stops[0] : mixLch(stops[k], stops[k + 1], f - k));
  }
  return out;
}

/** where a week sits in a life, 0..1 (row by row, week by week): its place on the flow */
export function lifePosition(row: number, col: number): number {
  return Math.max(0, Math.min(1, (row * LIFE_WEEKS_PER_YEAR + col) / (LIFE_YEARS * LIFE_WEEKS_PER_YEAR - 1)));
}

// ---------- the dreams on the grid ----------

export interface LifeMarker {
  id: string;
  title: string;
  /** "done": a fulfilled dream at the week it came true; "planned": an open dream at its target week */
  kind: "done" | "planned";
  row: number;
  col: number;
  /** "erfüllt im August 2025" / "geplant für Februar 2027" */
  when: string;
}

/** fulfilled dreams at the week of done_at, active dreams with a target date at that week; outside the 90 years: left out */
export function lifeMarkers(goals: readonly Goal[], birthYear: number): LifeMarker[] {
  const out: LifeMarker[] = [];
  for (const g of goals) {
    if (!isDream(g)) continue;
    if (g.status === "done") {
      const day = fulfilledDay(g);
      const cell = weekCell(day, birthYear);
      if (cell) out.push({ id: g.id, title: g.title, kind: "done", ...cell, when: `erfüllt im ${monthYear(day)}` });
    } else if (g.status === "active" && g.target_date) {
      const cell = weekCell(g.target_date, birthYear);
      if (cell) out.push({ id: g.id, title: g.title, kind: "planned", ...cell, when: `geplant für ${dreamWhen(g.target_date)}` });
    }
  }
  return out.sort((a, b) => a.row - b.row || a.col - b.col || a.title.localeCompare(b.title));
}

/** the marker nearest to a point (CSS px) within `radius`, else null */
export function markerAt(markers: readonly LifeMarker[], l: Pick<LifeLayout, "cssBox">, x: number, y: number, radius: number): LifeMarker | null {
  let best: LifeMarker | null = null;
  let bestD = radius;
  for (const m of markers) {
    const b = l.cssBox(m.row, m.col);
    const dist = Math.hypot(b.x + b.w / 2 - x, b.y + b.h / 2 - y);
    if (dist <= bestD) {
      best = m;
      bestD = dist;
    }
  }
  return best;
}

// ---------- a tap on a row ----------

/**
 * A row is a calendar year. Up to next year it opens in Jahr (anchor: today's date in that
 * year); later years only answer quietly.
 */
export function rowTarget(row: number, birthYear: number, today: string): { year: number; day: string } | { year: number; later: true } {
  const year = birthYear + row;
  if (year > Number(today.slice(0, 4)) + 1) return { year, later: true };
  return { year, day: sameDayInYear(today, year) };
}

/** the quiet answer for a year further ahead */
export const laterHint = (year: number): string => `${year} liegt noch vor dir.`;

// ---------- texts ----------

export const LIFE_LINE = "Jede Woche ein Punkt. Diese hier leuchtet.";

/** the line under the title; without a current week in the grid (more than 90 years) only its first half */
export function lifeLine(w: LifeWeeks): string {
  return w.currentRow >= 0 ? LIFE_LINE : "Jede Woche ein Punkt.";
}
export const LIFE_ASK = "Wann bist du geboren? Dann zeige ich dir dein Leben in Wochen.";
export const LIFE_ASK_HINT = "Nur das Jahr, nichts weiter.";

/** "Woche 1’843 von 4’680" (the current week is lived + 1); null when today lies outside the grid */
export function lifeCount(w: LifeWeeks): string | null {
  if (w.currentRow < 0) return null;
  return `Woche ${thousands(w.lived + 1)} von ${thousands(w.total)}`;
}

/** the canvas's name for screen readers: what the picture shows, calm (no countdown) */
export function lifeSummary(w: LifeWeeks, markers: readonly LifeMarker[]): string {
  const parts = [`Leben in Wochen: 90 Jahre zu je 52 Wochen, ${w.total} Punkte`];
  if (w.currentRow >= 0) parts.push(`diese Woche ist Woche ${w.lived + 1}, sie leuchtet`);
  const done = markers.filter((m) => m.kind === "done").length;
  const planned = markers.length - done;
  if (done) parts.push(`${done} ${done === 1 ? "erfüllter Traum" : "erfüllte Träume"} als heller Punkt`);
  if (planned) parts.push(`${planned} ${planned === 1 ? "geplanter Traum" : "geplante Träume"} als Ring`);
  return `${parts.join(", ")}.`;
}

/** the years a birth-year picker offers: this year down to 1920 (plus a stored year outside that) */
export function birthYearOptions(thisYear: number, current?: number | null): number[] {
  const out: number[] = [];
  for (let y = thisYear; y >= FIRST_BIRTH_YEAR; y--) out.push(y);
  if (typeof current === "number" && Number.isInteger(current) && !out.includes(current)) {
    out.push(current);
    out.sort((a, b) => b - a);
  }
  return out;
}
