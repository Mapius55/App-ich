// The animated figure: a silent, looping drawing of one exercise ("the short video"), and a still for lists.
import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import type { Side } from "../types.ts";
import { stageOf } from "./registry.ts";
import { fitStage, frame, paint, svgBody, viewOf } from "./render.ts";

export interface FigureProps {
  /** exercise id */
  exercise: string;
  /** which side is the target; "L" is how the exercise is authored, "R" mirrors it. Default "L". */
  side?: Side | null;
  /** false freezes the loop on the main pose. Default true. */
  playing?: boolean;
  /** show the glow where the stretch should be felt. Default true. */
  spots?: boolean;
  /** let the person turn the view by dragging sideways. Default false. */
  rotatable?: boolean;
  /** width / height of the stage. Default 1 (square). The figure always fills the width of its parent. */
  ratio?: number;
  className?: string;
  style?: CSSProperties;
  /** accessible description, e.g. the exercise name */
  label?: string;
}

/** The looping, silent animation of one exercise (a canvas). No sound, no video element: nothing here can interrupt music. */
export function Figure({ exercise, side, playing = true, spots = true, rotatable = false, ratio = 1, className, style, label }: FigureProps) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const st = useMemo(() => stageOf(exercise, side), [exercise, side]);
  const live = useRef({ playing, spots, turn: 0 });
  live.current.playing = playing;
  live.current.spots = spots;

  useEffect(() => {
    live.current.turn = 0;
  }, [exercise, side]);

  useEffect(() => {
    const el = box.current;
    const cv = canvas.current;
    if (!el || !cv || !st) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let visible = true;
    let t = st.mainTime;
    let last = 0;
    let lastDraw = -1;
    let drawnKey = "";

    const size = () => {
      const r = el.getBoundingClientRect();
      w = Math.max(1, Math.round(r.width));
      h = Math.max(1, Math.round(r.height));
      dpr = Math.min(3, window.devicePixelRatio || 1);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      drawnKey = "";
    };

    const draw = (time: number) => {
      const view = viewOf(st.anim.camera);
      view.az += live.current.turn;
      const key = `${time.toFixed(3)}|${view.az.toFixed(1)}|${live.current.spots}|${w}x${h}`;
      if (key === drawnKey) return;
      drawnKey = key;
      const fit = fitStage(st, view, w, h);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      paint(ctx, frame(st, time, view, fit, { spots: live.current.spots }));
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.visibilityState !== "visible") {
        last = 0;
        return;
      }
      if (live.current.playing) {
        if (last) t += Math.min(0.1, (now - last) / 1000);
        last = now;
        // about 30 pictures a second are plenty for slow movement and spare the battery
        if (now - lastDraw < 30) return;
        lastDraw = now;
        draw(t);
      } else {
        last = 0;
        t = st.mainTime;
        draw(st.mainTime);
      }
    };

    size();
    draw(t);
    raf = requestAnimationFrame(loop);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(size) : null;
    ro?.observe(el);
    const io = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver((e) => (visible = e[e.length - 1].isIntersecting)) : null;
    io?.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
    };
  }, [st]);

  // turning the view by dragging sideways
  useEffect(() => {
    const el = box.current;
    if (!el || !rotatable) return;
    let startX = 0;
    let startTurn = 0;
    let active = false;
    const down = (e: PointerEvent) => {
      active = true;
      startX = e.clientX;
      startTurn = live.current.turn;
    };
    const move = (e: PointerEvent) => {
      if (!active) return;
      live.current.turn = startTurn + (e.clientX - startX) * 0.6;
    };
    const up = () => (active = false);
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [rotatable]);

  return (
    <div
      ref={box}
      className={className}
      role="img"
      aria-label={label ?? exercise}
      style={{ position: "relative", width: "100%", aspectRatio: String(ratio), touchAction: rotatable ? "pan-y" : undefined, cursor: rotatable ? "grab" : undefined, ...style }}
    >
      {st ? <canvas ref={canvas} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} /> : null}
    </div>
  );
}

export interface FigureStillProps {
  exercise: string;
  side?: Side | null;
  ratio?: number;
  className?: string;
  style?: CSSProperties;
  label?: string;
}

const stills = new Map<string, string>();

/** A still picture of the main pose (inline SVG, cheap enough for long lists). */
export function FigureStill({ exercise, side, ratio = 1, className, style, label }: FigureStillProps) {
  const W = 160;
  const H = Math.round(W / ratio);
  const key = `${exercise}|${side === "R" ? "R" : "L"}|${H}`;
  let inner = stills.get(key);
  if (inner === undefined) {
    const st = stageOf(exercise, side);
    if (st) {
      const view = viewOf(st.anim.camera);
      inner = svgBody(frame(st, st.mainTime, view, fitStage(st, view, W, H, 0.06), { spots: false }), `k${key.replace(/[^a-zA-Z0-9]/g, "_")}`);
    } else inner = "";
    stills.set(key, inner);
  }
  return (
    <svg
      className={className}
      role="img"
      aria-label={label ?? exercise}
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", aspectRatio: String(ratio), display: "block", ...style }}
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}
