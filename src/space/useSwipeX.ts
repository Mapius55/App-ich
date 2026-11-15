// Horizontal swipe hook: the Du ↔ Jetzt ↔ Ziele pager and discrete time paging.
// One pointer handler per element. The element has `touch-action: pan-y`, so native
// vertical scrolling always wins the vertical axis (the browser then cancels the
// pointer) and we only ever see horizontal intent. Decisions live in swipeMath.
import { useCallback, useRef } from "react";
import { CANCEL_MS, EDGE_GUARD } from "./gestures";
import { decideAxis, decideCommit, dirOf, discreteFollow, pagerFollow, velocity, type Sample } from "./swipeMath";

export interface SwipeInfo {
  dx: number; // finger travel (px)
  v: number; // release velocity (px/ms, signed like dx)
  width: number; // viewport width at the start
}

export interface SwipeXOptions {
  mode: "pager" | "discrete";
  enabled: boolean;
  /** the element that follows the finger (discrete: ×0.5, max 80 px) */
  follow?: () => HTMLElement | null;
  /** false = rubber-band at this end */
  canGo?: (dir: -1 | 1) => boolean;
  onStart?(): void;
  /** dir 1 = next (the finger moved left), -1 = previous */
  onCommit(dir: -1 | 1, info: SwipeInfo): void;
  onCancel?(info: SwipeInfo): void;
  /** pager: every frame of a drag, the layer offset after rubber-banding (the caller moves its layers) */
  onMove?(dx: number): void;
  /** checked at pointerdown on top of `enabled` (e.g. the pager's live scrollY gate) */
  gate?(): boolean;
}

const IGNORE = "input, textarea, select, [contenteditable=''], [contenteditable='true'], [data-no-swipe], .dock";
const DISCRETE_BACK_MS = 220;
// a committed time swipe leaves the content at the finger's offset: the level's period swap
// carries it on out in the same direction and resets it (usePeriodSwap); this is the
// safety net when nothing does
const DISCRETE_HOLD_MAX = 700;

function standalone(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// After a horizontal drag the browser may still fire a click on the button under the
// finger (mouse and pen do); swallow that one click. The next pointerdown or key ends
// it, so a real tap or click right after a swipe always goes through.
function swallowNextClick() {
  let t = 0;
  const off = () => {
    clearTimeout(t);
    window.removeEventListener("click", stop, { capture: true });
    window.removeEventListener("pointerdown", off, { capture: true });
    window.removeEventListener("keydown", off, { capture: true });
  };
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    off();
  };
  window.addEventListener("click", stop, { capture: true });
  window.addEventListener("pointerdown", off, { capture: true });
  window.addEventListener("keydown", off, { capture: true });
  t = window.setTimeout(off, 400);
}

interface Gesture {
  id: number;
  x0: number;
  y0: number;
  axis: "x" | null;
  dx: number;
  width: number;
  samples: Sample[];
  el: HTMLElement | null; // discrete: the following element
}

function attach(root: HTMLElement, opts: { current: SwipeXOptions }): () => void {
  let g: Gesture | null = null;
  let raf = 0;
  let springTimer = 0;

  const render = () => {
    raf = 0;
    if (!g?.axis) return;
    const o = opts.current;
    const can = o.canGo ? o.canGo(dirOf(g.dx)) : true;
    if (o.mode === "pager") o.onMove?.(pagerFollow(g.dx, g.width, can));
    else if (g.el) g.el.style.transform = `translate3d(${discreteFollow(g.dx, can)}px,0,0)`;
  };

  // discrete: bring the content home (a spring on cancel, at once under reduced motion)
  const release = (el: HTMLElement | null, ms: number) => {
    if (!el) return;
    clearTimeout(springTimer);
    delete el.dataset.held;
    if (reducedMotion() || ms === 0) {
      el.style.transition = "";
      el.style.transform = "";
      el.style.willChange = "";
      return;
    }
    el.style.transition = `transform ${ms}ms var(--ease-out)`;
    el.style.transform = "";
    springTimer = window.setTimeout(() => {
      el.style.transition = "";
      el.style.willChange = "";
    }, ms + 40);
  };
  // discrete commit: stay at the finger's offset (data-held) until the new period enters
  const hold = (el: HTMLElement | null) => {
    if (!el) return;
    clearTimeout(springTimer);
    el.style.transition = "";
    el.dataset.held = "";
    springTimer = window.setTimeout(() => {
      if (el.dataset.held !== undefined) release(el, DISCRETE_BACK_MS);
    }, DISCRETE_HOLD_MAX);
  };

  const down = (e: PointerEvent) => {
    const o = opts.current;
    if (g || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (!o.enabled || (o.gate && !o.gate())) return;
    const t = e.target as Element | null;
    if (t?.closest?.(IGNORE)) return;
    // in a browser tab the edges belong to the browser's back / forward swipe
    if (e.pointerType === "touch" && !standalone() && (e.clientX < EDGE_GUARD || e.clientX > window.innerWidth - EDGE_GUARD)) return;
    g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, axis: null, dx: 0, width: window.innerWidth, samples: [{ t: e.timeStamp, x: e.clientX }], el: null };
  };

  const move = (e: PointerEvent) => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.axis) {
      const axis = decideAxis(dx, dy);
      if (!axis) return;
      if (axis === "y") {
        g = null; // the native scroll takes it
        return;
      }
      g.axis = "x";
      try {
        root.setPointerCapture(g.id);
      } catch {
        /* pointer already gone */
      }
      const o = opts.current;
      o.onStart?.();
      if (o.mode === "discrete") {
        g.el = o.follow?.() ?? null;
        if (g.el) {
          clearTimeout(springTimer);
          delete g.el.dataset.held;
          g.el.style.transition = "none";
          g.el.style.willChange = "transform";
        }
      }
    }
    g.dx = dx;
    g.samples.push({ t: e.timeStamp, x: e.clientX });
    if (g.samples.length > 12) g.samples.shift();
    if (!raf) raf = requestAnimationFrame(render);
  };

  const finish = (e: PointerEvent, cancelled: boolean) => {
    if (!g || e.pointerId !== g.id) return;
    const was = g;
    g = null;
    if (!was.axis) return;
    if (raf) cancelAnimationFrame(raf), (raf = 0);
    try {
      root.releasePointerCapture(was.id);
    } catch {
      /* not captured */
    }
    swallowNextClick();
    const o = opts.current;
    const v = cancelled ? 0 : velocity(was.samples, e.timeStamp);
    let dir = cancelled ? 0 : decideCommit(o.mode, was.dx, v, was.width);
    if (dir && o.canGo && !o.canGo(dir)) dir = 0;
    const info: SwipeInfo = { dx: was.dx, v, width: was.width };
    if (o.mode === "discrete") {
      if (dir && !reducedMotion()) hold(was.el);
      else release(was.el, dir ? 0 : DISCRETE_BACK_MS);
    }
    if (dir) o.onCommit(dir, info);
    else o.onCancel?.(info);
  };
  const up = (e: PointerEvent) => finish(e, false);
  const cancel = (e: PointerEvent) => finish(e, true);

  root.addEventListener("pointerdown", down);
  root.addEventListener("pointermove", move);
  root.addEventListener("pointerup", up);
  root.addEventListener("pointercancel", cancel);
  return () => {
    root.removeEventListener("pointerdown", down);
    root.removeEventListener("pointermove", move);
    root.removeEventListener("pointerup", up);
    root.removeEventListener("pointercancel", cancel);
    if (raf) cancelAnimationFrame(raf);
    clearTimeout(springTimer);
  };
}

/** spring-back time of a cancelled pager drag (the caller animates its layers) */
export const PAGER_CANCEL_MS = CANCEL_MS;

export function useSwipeX(o: SwipeXOptions): { ref: (el: HTMLElement | null) => void } {
  const opts = useRef(o);
  opts.current = o;
  const detach = useRef<(() => void) | null>(null);
  // React calls the ref with null on unmount, which detaches the listeners
  const ref = useCallback((el: HTMLElement | null) => {
    detach.current?.();
    detach.current = el ? attach(el, opts) : null;
  }, []);
  return { ref };
}
