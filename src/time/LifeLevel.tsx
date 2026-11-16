// Leben (level 4, at the very bottom): life in weeks. 90 rows (the calendar years from
// the birth year on) × 52 weeks, drawn on one DPR-aware canvas. Lived weeks are filled in
// the circle's colour flow by their place in life, so a life reads as one flow; this week
// is brighter and breathes softly (still under reduced motion); the weeks ahead are faint
// dots. Fulfilled dreams are a small bright point at the week they came true, planned
// dreams a ring at their target week. A row opens that year in Jahr; a dream's point
// shows it on the Bucket List. No sideways paging here: there is one life.
// Without a birth year it asks for it (only the year), and nothing else.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { backend } from "../lib/backend";
import { mix } from "../lib/color";
import { lifeWeeks } from "../lib/plan";
import type { Profile } from "../lib/types";
import { usePlanData } from "../space/data";
import { useSpace } from "../space/state";
import { LevelHeader } from "./LevelHeader";
import {
  LIFE_ASK,
  LIFE_ASK_HINT,
  LIFE_WEEKS_PER_YEAR,
  LIFE_YEARS,
  birthYearOptions,
  cellAt,
  flowRamp,
  flowStops,
  laterHint,
  lifeCount,
  lifeLayout,
  lifeLine,
  lifeMarkers,
  lifePosition,
  lifeSummary,
  markerAt,
  rowTarget,
  type LifeLayout,
  type LifeMarker,
} from "./lifeGrid";
import "./life.css";

export interface LifeLevelProps {
  titleId: string;
  active: boolean; // this level is the settled one (at Jetzt)
  profile: Profile;
  /** the circle's palette (palette.orb): the flow a life is coloured with */
  colors: readonly string[];
  onProfile(patch: Partial<Profile>): void;
}

const RAMP = 256;
const TEXT = "251,248,244"; // --text on the dark ground
const GROUND = "rgba(16,12,20,0.88)"; // about the almost-black ground under the sky
const HINT_MS = 2600;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function LifeLevel({ titleId, active, profile, colors, onProfile }: LifeLevelProps) {
  const birthYear = typeof profile.birth_year === "number" ? profile.birth_year : null;
  const { today } = useSpace();
  const weeks = useMemo(() => (birthYear !== null ? lifeWeeks(birthYear, today) : null), [birthYear, today]);
  const count = weeks ? lifeCount(weeks) : null;
  const headRef = useRef<HTMLElement | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef(0);
  useEffect(() => () => clearTimeout(hintTimer.current), []);
  const showHint = useCallback((text: string) => {
    setHint(text);
    clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), HINT_MS);
  }, []);

  return (
    <div className="tl tl-life" data-active={active || undefined}>
      <LevelHeader
        titleId={titleId}
        title="Leben"
        srTitle="Leben in Wochen"
        sub={
          weeks ? (
            <>
              {lifeLine(weeks)}
              {count && (
                <span className="lf-count" aria-hidden={hint ? true : undefined}>
                  {hint ?? count}
                </span>
              )}
            </>
          ) : undefined
        }
        fadeRef={headRef}
      />
      <span className="sr-only" aria-live="polite">
        {hint ?? ""}
      </span>
      {birthYear !== null && weeks ? (
        <LifeGrid birthYear={birthYear} weeks={weeks} colors={colors} onLater={showHint} />
      ) : (
        <LifeAsk onProfile={onProfile} onSaved={() => headRef.current?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true })} />
      )}
    </div>
  );
}

// ---------- the grid ----------

/** the container's width (the grid is as wide as the level) and the screen's pixel ratio */
function useCanvasSize(ref: React.RefObject<HTMLElement | null>): { width: number; dpr: number } {
  const [width, setWidth] = useState(0);
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    const watch = () => {
      setDpr(window.devicePixelRatio || 1);
      mq?.removeEventListener("change", watch);
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      mq.addEventListener("change", watch);
    };
    watch();
    return () => mq?.removeEventListener("change", watch);
  }, []);
  return { width, dpr };
}

/** a canvas drawn once per change of its inputs (never per frame) */
function useLifeCanvas(canvasRef: React.RefObject<HTMLCanvasElement | null>, layout: LifeLayout | null, draw: (ctx: CanvasRenderingContext2D, l: LifeLayout) => void) {
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout) return;
    if (canvas.width !== layout.widthD) canvas.width = layout.widthD;
    if (canvas.height !== layout.heightD) canvas.height = layout.heightD;
    const ctx = canvas.getContext("2d");
    if (ctx) draw(ctx, layout);
  }, [canvasRef, layout, draw]);
}

function LifeGrid({
  birthYear,
  weeks,
  colors,
  onLater,
}: {
  birthYear: number;
  weeks: ReturnType<typeof lifeWeeks>;
  colors: readonly string[];
  onLater(text: string): void;
}) {
  const { today, reduced, goLevel, go } = useSpace();
  const { goals } = usePlanData();
  const bodyRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { width, dpr } = useCanvasSize(stageRef);
  const [scroll, setScroll] = useState(false);
  const [band, setBand] = useState<{ row: number; n: number } | null>(null);

  const markers = useMemo(() => lifeMarkers(goals ?? [], birthYear), [goals, birthYear]);
  const layout: LifeLayout | null = useMemo(() => (width > 0 ? lifeLayout(width, dpr) : null), [width, dpr]);
  const ramp = useMemo(() => flowRamp(flowStops(colors), RAMP), [colors]);
  const colourAt = useCallback((row: number, col: number) => ramp[Math.round(lifePosition(row, col) * (RAMP - 1))], [ramp]);

  // draw once per change (size, palette, birth year, today, dreams): never per frame
  const draw = useCallback((ctx: CanvasRenderingContext2D, l: LifeLayout) => drawLife(ctx, l, weeks, markers, colourAt), [weeks, markers, colourAt]);
  useLifeCanvas(canvasRef, layout, draw);

  // the part under the title scrolls in place when the grid is taller than the room
  // (most phones): it starts with this week in view
  useLayoutEffect(() => {
    const box = bodyRef.current;
    if (!box || !layout) return;
    const measure = () => setScroll(layout.height > box.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [layout]);
  const placed = useRef("");
  useLayoutEffect(() => {
    const box = bodyRef.current;
    if (!box || !layout || !scroll || weeks.currentRow < 0) return;
    const key = `${birthYear}|${Math.round(layout.width)}`;
    if (placed.current === key) return;
    placed.current = key;
    const y = layout.cssBox(weeks.currentRow, weeks.currentCol).y;
    if (y + layout.pitch * 4 > box.clientHeight) box.scrollTop = Math.max(0, y - box.clientHeight * 0.45);
  }, [layout, scroll, birthYear, weeks.currentRow, weeks.currentCol]);

  // a tap: a dream's point shows it on the Bucket List, a row opens its year in Jahr
  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!layout) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const hit = markerAt(markers, layout, x, y, Math.max(14, layout.pitch * 2.2));
    if (hit) {
      go("ziele", { highlight: hit.id });
      return;
    }
    const cell = cellAt(layout, x, y);
    if (!cell) return;
    const t = rowTarget(cell.row, birthYear, today);
    if ("later" in t) {
      onLater(laterHint(t.year));
      return;
    }
    if (!reduced) setBand((b) => ({ row: cell.row, n: (b?.n ?? 0) + 1 }));
    goLevel(3, { day: t.day });
  };

  const now = layout && weeks.currentRow >= 0 ? layout.cssBox(weeks.currentRow, weeks.currentCol) : null;
  const nowColour = weeks.currentRow >= 0 ? colourAt(weeks.currentRow, weeks.currentCol) : undefined;
  const decades = [10, 20, 30, 40, 50, 60, 70, 80];

  return (
    <>
      <div className={`lf-body${scroll ? " scroll" : ""}`} ref={bodyRef}>
        <div className="lf-stage" ref={stageRef} style={layout ? { height: `${layout.height}px` } : undefined}>
          <canvas
            ref={canvasRef}
            className="lf-canvas"
            role="img"
            aria-label={lifeSummary(weeks, markers)}
            style={layout ? { width: `${layout.width}px`, height: `${layout.height}px` } : undefined}
            onClick={onClick}
          />
          {layout && (
            <>
              <span className="lf-ticks" aria-hidden="true">
                {decades.map((d) => (
                  <span key={d} className="lf-tick" style={{ top: `${layout.cssBox(d, 0).y}px` }}>
                    <span className="lf-tick-label">{d}</span>
                  </span>
                ))}
              </span>
              {now && (
                <span
                  className="lf-now"
                  aria-hidden="true"
                  style={{ left: `${now.x + now.w / 2}px`, top: `${now.y + now.h / 2}px`, ["--lf-cell" as string]: `${now.w}px`, ["--lf-now" as string]: nowColour }}
                />
              )}
              {band && (
                <span key={band.n} className="lf-band" aria-hidden="true" style={{ top: `${layout.cssBox(band.row, 0).y - 1}px`, height: `${layout.pitch + 1}px` }} />
              )}
            </>
          )}
        </div>
      </div>
      <DreamList markers={markers} />
    </>
  );
}

/** the dreams on the grid, for screen readers and the keyboard (it shows itself while focused) */
function DreamList({ markers }: { markers: readonly LifeMarker[] }) {
  const { go } = useSpace();
  if (!markers.length) return null;
  return (
    <div className="lf-dreams">
      <h3 className="lf-dreams-label">Träume in deinem Leben</h3>
      <ul>
        {markers.map((m) => (
          <li key={`${m.id}-${m.kind}`}>
            <button type="button" className="lf-dream" onClick={() => go("ziele", { highlight: m.id })}>
              {m.title}, {m.when}
              <span className="sr-only">. Auf der Bucket List zeigen</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** everything on the canvas, in device pixels */
function drawLife(ctx: CanvasRenderingContext2D, l: LifeLayout, w: ReturnType<typeof lifeWeeks>, markers: readonly LifeMarker[], colourAt: (row: number, col: number) => string) {
  const d = l.dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, l.widthD, l.heightD);
  const sample = l.box(0, 0);
  const radius = Math.min(sample.w, sample.h) * 0.26;
  const rect = (b: { x: number; y: number; w: number; h: number }, r = radius) => {
    if (typeof ctx.roundRect === "function" && r > 0.4) ctx.roundRect(b.x, b.y, b.w, b.h, r);
    else ctx.rect(b.x, b.y, b.w, b.h);
  };

  // the weeks ahead: faint dots, one path
  ctx.beginPath();
  const dot = Math.max(0.7 * d, Math.min(sample.w, sample.h) * 0.2);
  for (let row = 0; row < LIFE_YEARS; row++) {
    for (let col = 0; col < LIFE_WEEKS_PER_YEAR; col++) {
      if (row * LIFE_WEEKS_PER_YEAR + col <= w.lived) continue;
      const b = l.box(row, col);
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      ctx.moveTo(cx + dot, cy);
      ctx.arc(cx, cy, dot, 0, Math.PI * 2);
    }
  }
  ctx.fillStyle = `rgba(${TEXT},0.2)`;
  ctx.fill();

  // the lived weeks: filled in the flow, by their place in life
  ctx.globalAlpha = 0.9;
  for (let i = 0; i < Math.min(w.lived, LIFE_YEARS * LIFE_WEEKS_PER_YEAR); i++) {
    const row = Math.floor(i / LIFE_WEEKS_PER_YEAR);
    const col = i % LIFE_WEEKS_PER_YEAR;
    ctx.beginPath();
    rect(l.box(row, col));
    ctx.fillStyle = colourAt(row, col);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // the dreams: fulfilled = a small point in the flow (quieter than this week), planned = a ring
  for (const m of markers) {
    const b = l.box(m.row, m.col);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const cell = Math.min(b.w, b.h);
    const r = m.kind === "done" ? Math.max(1.7 * d, cell * 0.36) : Math.max(3.4 * d, cell * 0.82);
    ctx.save();
    if (m.row * LIFE_WEEKS_PER_YEAR + m.col <= w.lived) {
      // among the filled weeks a thin ring of the ground keeps the point apart from them
      ctx.beginPath();
      ctx.arc(cx, cy, r + 1.1 * d, 0, Math.PI * 2);
      ctx.fillStyle = GROUND;
      ctx.fill();
    } else ctx.clearRect(b.x, b.y, b.w, b.h); // ahead: no faint dot inside the ring
    if (m.kind === "done") {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = mix(colourAt(m.row, m.col), "#ffffff", 0.35);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, r - 0.65 * d, 0, Math.PI * 2);
      ctx.lineWidth = 1.3 * d;
      ctx.strokeStyle = `rgba(${TEXT},0.92)`;
      ctx.stroke();
    }
    ctx.restore();
  }

  // this week: the one bright cell. A little larger, warm white with a glow, set apart by a ring
  // of the ground, so it reads among pale lived weeks too and stays clear without the breathing
  // halo (a CSS overlay; still under reduced motion). Drawn last: no dream point covers it.
  if (w.currentRow >= 0) {
    const b = l.box(w.currentRow, w.currentCol);
    const c = colourAt(w.currentRow, w.currentCol);
    const grow = (k: number) => ({ x: b.x - k * d, y: b.y - k * d, w: b.w + 2 * k * d, h: b.h + 2 * k * d });
    ctx.save();
    ctx.beginPath();
    rect(grow(2.6), radius + 2.6 * d);
    ctx.fillStyle = GROUND;
    ctx.fill();
    ctx.shadowColor = mix(c, "#ffffff", 0.5);
    ctx.shadowBlur = 8 * d;
    ctx.beginPath();
    rect(grow(1), radius + d);
    ctx.fillStyle = "#fff8ec";
    ctx.fill();
    ctx.restore();
  }
}

// ---------- without a birth year ----------

function LifeAsk({ onProfile, onSaved }: { onProfile(patch: Partial<Profile>): void; onSaved(): void }) {
  const { today } = useSpace();
  const thisYear = Number(today.slice(0, 4));
  const years = useMemo(() => birthYearOptions(thisYear), [thisYear]);
  const [year, setYear] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const y = Number(year);
    if (!year || busy) return;
    setBusy(true);
    setError(null);
    try {
      await backend.updateProfile({ birth_year: y });
      onProfile({ birth_year: y });
      requestAnimationFrame(onSaved);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="lf-ask">
        <p className="lf-ask-q">{LIFE_ASK}</p>
        <form className="lf-ask-row" onSubmit={save}>
          <select className="lf-year" value={year} onChange={(e) => setYear(e.target.value)} aria-label="Geburtsjahr" disabled={busy}>
            <option value="">Jahr wählen</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button type="submit" className="btn primary lf-show" disabled={!year || busy}>
            Zeigen
          </button>
        </form>
        <p className="lf-ask-hint">{LIFE_ASK_HINT}</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <LifePreview />
    </>
  );
}

const NONE_LIVED = { total: LIFE_YEARS * LIFE_WEEKS_PER_YEAR, lived: -1, currentRow: -1, currentCol: -1 };

/** the empty grid, faint, under the question: what «Zeigen» will fill */
function LifePreview() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { width, dpr } = useCanvasSize(stageRef);
  const layout = useMemo(() => (width > 0 ? lifeLayout(width, dpr) : null), [width, dpr]);
  const draw = useCallback((ctx: CanvasRenderingContext2D, l: LifeLayout) => drawLife(ctx, l, NONE_LIVED, [], () => ""), []);
  useLifeCanvas(canvasRef, layout, draw);
  return (
    <div className="lf-preview" aria-hidden="true">
      <div ref={stageRef} className="lf-preview-stage">
        <canvas ref={canvasRef} className="lf-canvas" style={layout ? { width: `${layout.width}px`, height: `${layout.height}px` } : undefined} />
      </div>
    </div>
  );
}
