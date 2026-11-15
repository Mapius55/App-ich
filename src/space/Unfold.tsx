// Unfold (§3.7): an entry, goal or habit grows from the tapped row into the content
// area (FLIP), the world dims and turns inert, the dock stays live with ✓ "Fertig".
// Every close path (✓, Escape, the scrim, pull-down, a navigation) runs through
// space.close(via) → the closer registered here → the form's useUnfoldClose handler
// (closeDecision, D6). The closer resolves true only after saving and collapsing.
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { AXIS_RATIO, AXIS_SLOP, PULL_CLOSE, PULL_V } from "./gestures";
import { useSpace, type CloseVia } from "./state";

type CloseHandler = (via: CloseVia) => Promise<boolean> | boolean;

export interface UnfoldProps {
  kindLabel: string; // "Eintrag", "Neuer Eintrag", "Ziel", "Neues Ziel", "Gewohnheit", "Neue Gewohnheit"
  origin: HTMLElement | null; // the tapped row (grow from / collapse into it)
  /** every close path inside the panel (scrim, Escape, pull) goes here; usually space.close */
  onRequestClose(via: CloseVia): Promise<boolean>;
  children: React.ReactNode;
}

interface Slot {
  setHandler(h: CloseHandler | null): void;
  requestClose(via: CloseVia): Promise<boolean>;
}
const UnfoldSlot = createContext<Slot | null>(null);

const OPEN_MS = 420;
const CLOSE_MS = 320;
const GONE_MS = 200; // origin gone or off screen: a plain fade
const REDUCED_MS = 160;
const SPRING_MS = 240;
const RADIUS = 22;
const DIM = 0.3;
const PULL_FOLLOW = 0.9;
const STEPS = 14; // keyframes per FLIP, so the corner radius can be counter-scaled

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// cubic-bezier as a function of time (bisection: robust for every curve we use)
function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const at = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}
const easeOut = bezier(0.2, 0.75, 0.2, 1);
const easeIo = bezier(0.6, 0, 0.2, 1);

interface Pose {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  r: number;
}
const IDENTITY: Pose = { tx: 0, ty: 0, sx: 1, sy: 1, r: RADIUS };

/** the panel's pose that makes it cover the origin rect */
function poseOver(origin: DOMRect, panel: DOMRect, radius: number): Pose {
  return {
    tx: origin.left - panel.left,
    ty: origin.top - panel.top,
    sx: Math.max(0.01, origin.width / panel.width),
    sy: Math.max(0.01, origin.height / panel.height),
    r: radius,
  };
}

function flipFrames(from: Pose, to: Pose, ease: (k: number) => number): Keyframe[] {
  const frames: Keyframe[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const k = i / STEPS;
    const e = ease(k);
    const mix = (a: number, b: number) => a + (b - a) * e;
    const sx = mix(from.sx, to.sx);
    const sy = mix(from.sy, to.sy);
    const r = mix(from.r, to.r);
    frames.push({
      offset: k,
      transform: `translate(${mix(from.tx, to.tx).toFixed(2)}px, ${mix(from.ty, to.ty).toFixed(2)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`,
      borderRadius: `${(r / sx).toFixed(2)}px / ${(r / sy).toFixed(2)}px`,
    });
  }
  return frames;
}

/** a usable origin rect: connected, sized, at least partly on screen */
function originRect(el: HTMLElement | null): { rect: DOMRect; radius: number } | null {
  if (!el || !el.isConnected) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return null;
  if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) return null;
  const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  return { rect, radius: Math.min(r, rect.width / 2, rect.height / 2) };
}

/** without a tapped row (dock "+"), the panel grows from the dock's left button */
function dockOrigin(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".voice-layer .dock-done, .voice-layer .dock-add");
}

const visible = (el: HTMLElement) =>
  typeof el.checkVisibility === "function" ? el.checkVisibility({ visibilityProperty: true } as CheckVisibilityOptions) : el.offsetParent !== null;

export function Unfold({ kindLabel, origin, onRequestClose, children }: UnfoldProps) {
  const { registerCloser, reduced } = useSpace();
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const handler = useRef<CloseHandler | null>(null);
  const requestRef = useRef(onRequestClose);
  requestRef.current = onRequestClose;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const from = useRef<HTMLElement | null>(origin ?? dockOrigin());
  const anims = useRef<Animation[]>([]);
  const dimAnim = useRef<Animation | null>(null);
  const pullY = useRef(0);
  const closing = useRef(false);
  const lastVia = useRef<CloseVia | null>(null);
  const before = useRef<Element | null>(document.activeElement);

  const slot = useMemo<Slot>(
    () => ({
      setHandler: (h) => void (handler.current = h),
      requestClose: (via) => requestRef.current(via),
    }),
    [],
  );

  const run = (el: Element, frames: Keyframe[], o: KeyframeAnimationOptions): Promise<void> => {
    const a = el.animate(frames, o);
    anims.current.push(a);
    return a.finished.then(
      () => undefined,
      () => undefined,
    );
  };
  const settleRunning = () => {
    for (const a of anims.current) {
      try {
        a.finish();
      } catch {
        /* already done */
      }
    }
    anims.current = [];
  };
  const dim = (to: number, ms: number) => {
    const world = document.querySelector<HTMLElement>(".space");
    if (!world) return;
    const now = dimAnim.current ? Number(getComputedStyle(world).opacity) : 1;
    dimAnim.current?.cancel();
    dimAnim.current = world.animate([{ opacity: now }, { opacity: to }], { duration: ms, easing: "ease", fill: "forwards" });
  };

  // open: FLIP from the origin (radius → 22), content fades in from 60 %, the world dims
  useLayoutEffect(() => {
    const panel = panelRef.current!;
    const content = contentRef.current!;
    if (reducedRef.current) {
      run(panel, [{ opacity: 0 }, { opacity: 1 }], { duration: REDUCED_MS, easing: "ease" });
      dim(DIM, REDUCED_MS);
      return;
    }
    const o = originRect(from.current);
    dim(DIM, OPEN_MS);
    if (!o) {
      run(panel, [{ opacity: 0, transform: "translate(0, 24px) scale(0.98)" }, { opacity: 1, transform: "none" }], { duration: OPEN_MS, easing: "cubic-bezier(.2,.75,.2,1)" });
      return;
    }
    run(panel, flipFrames(poseOver(o.rect, panel.getBoundingClientRect(), o.radius), IDENTITY, easeOut), { duration: OPEN_MS, easing: "linear" });
    run(content, [{ opacity: 0, offset: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 1, offset: 1 }], { duration: OPEN_MS, easing: "linear" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // first focus: the title of a new item, else the dialog itself (no keyboard for a look)
  useEffect(() => {
    const panel = panelRef.current!;
    const first = panel.querySelector<HTMLElement>("[data-autofocus]") ?? panel;
    first.focus({ preventScroll: true });
  }, []);

  // collapse back into the origin (from wherever a pull left the panel)
  const collapse = async (): Promise<void> => {
    settleRunning();
    const panel = panelRef.current;
    const content = contentRef.current;
    if (!panel || !content) return;
    const dy = pullY.current;
    const ms = reducedRef.current ? REDUCED_MS : CLOSE_MS;
    const o = reducedRef.current ? null : originRect(from.current);
    dim(1, o ? CLOSE_MS : reducedRef.current ? REDUCED_MS : GONE_MS);
    if (!o) {
      await run(panel, [{ opacity: 1, transform: dy ? `translate(0, ${dy}px)` : "none" }, { opacity: 0, transform: dy ? `translate(0, ${dy}px)` : "none" }], {
        duration: reducedRef.current ? ms : GONE_MS,
        easing: "ease",
        fill: "forwards",
      });
      return;
    }
    // the layout box (without the pull offset)
    const r = panel.getBoundingClientRect();
    const box = new DOMRect(r.left, r.top - dy, r.width, r.height);
    panel.style.transform = "";
    const startPose: Pose = { ...IDENTITY, ty: dy };
    await Promise.all([
      run(panel, flipFrames(startPose, poseOver(o.rect, box, o.radius), easeIo), { duration: CLOSE_MS, easing: "linear", fill: "forwards" }),
      run(content, [{ opacity: 1 }, { opacity: 0, offset: 0.35 }, { opacity: 0 }], { duration: CLOSE_MS, easing: "linear", fill: "forwards" }),
    ]);
  };

  const springBack = () => {
    const panel = panelRef.current;
    const dy = pullY.current;
    pullY.current = 0;
    if (!panel) return;
    panel.style.transform = "";
    if (!dy || reducedRef.current) return;
    run(panel, [{ transform: `translate(0, ${dy}px)` }, { transform: "none" }], { duration: SPRING_MS, easing: "cubic-bezier(.2,.75,.2,1)" });
  };

  // Space.close(via) → this closer → the form's handler (save / ask / refuse) → collapse → true
  useEffect(() => {
    registerCloser(async (via) => {
      if (closing.current) return false;
      const h = handler.current;
      let ok = true;
      try {
        ok = h ? await h(via) : true;
      } catch {
        ok = false;
      }
      if (!ok) {
        springBack();
        return false;
      }
      closing.current = true;
      lastVia.current = via;
      await collapse();
      return true;
    });
    return () => registerCloser(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerCloser]);

  // unmount: the world un-dims for sure; focus goes back to the row (not after a navigation)
  useEffect(
    () => () => {
      for (const a of anims.current) a.cancel();
      dimAnim.current?.cancel();
      const back = lastVia.current === "nav" ? null : from.current?.isConnected ? from.current : before.current;
      requestAnimationFrame(() => {
        if (document.querySelector(".detail-root .unfold")) return; // another detail opened meanwhile
        if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
      });
    },
    [],
  );

  // Escape closes; Tab stays inside the panel and the dock
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (e.defaultPrevented || closing.current) return;
        const t = e.target as Element | null;
        if (t?.closest?.(".voice-layer")) return; // the typed coach field handles its own Escape
        e.preventDefault();
        requestRef.current("escape");
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const dock = document.querySelector(".voice-layer");
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE), ...(dock ? [...dock.querySelectorAll<HTMLElement>(FOCUSABLE)] : [])].filter(visible);
      if (!items.length) return;
      const i = items.indexOf(document.activeElement as HTMLElement);
      if (i === -1) {
        e.preventDefault();
        (e.shiftKey ? items[items.length - 1] : items[0]).focus();
      } else if (!e.shiftKey && i === items.length - 1) {
        e.preventDefault();
        items[0].focus();
      } else if (e.shiftKey && i === 0) {
        e.preventDefault();
        items[items.length - 1].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // pull down: the grip/header any time, the body only at scrollTop 0; follows ×0.9,
  // commits at dy > 96 px or v > 0.6 px/ms, else springs back
  useEffect(() => {
    const panel = panelRef.current!;
    type Drag = { x0: number; y0: number; head: boolean; body: HTMLElement | null; mode: "undecided" | "pull" | "no"; lastY: number; lastT: number; v: number; dy: number };
    let d: Drag | null = null;

    const start = (x: number, y: number, t: number, target: HTMLElement) => {
      d = null;
      if (closing.current) return;
      if (target === document.activeElement && target.matches("input, textarea, [contenteditable]")) return; // selecting text
      if (target.closest("select, [data-no-pull]")) return;
      d = { x0: x, y0: y, head: !!target.closest("[data-unfold-head]"), body: target.closest<HTMLElement>(".unfold-body"), mode: "undecided", lastY: y, lastT: t, v: 0, dy: 0 };
    };
    /** true when the move belongs to the pull (the caller prevents the default) */
    const move = (x: number, y: number, t: number): boolean => {
      if (!d || d.mode === "no") return false;
      if (d.mode === "undecided") {
        const dx = x - d.x0;
        const dy0 = y - d.y0;
        if (Math.abs(dx) < AXIS_SLOP && Math.abs(dy0) < AXIS_SLOP) return d.head;
        const atTop = d.head || !d.body || d.body.scrollTop <= 0;
        if (dy0 > 0 && Math.abs(dy0) > Math.abs(dx) * AXIS_RATIO && atTop) {
          d.mode = "pull";
          d.y0 = y;
          d.lastY = y;
          d.lastT = t;
          settleRunning();
        } else {
          d.mode = "no";
          return false;
        }
      }
      const dt = t - d.lastT;
      if (dt > 0) d.v = 0.7 * ((y - d.lastY) / dt) + 0.3 * d.v;
      d.lastY = y;
      d.lastT = t;
      d.dy = Math.max(0, y - d.y0);
      pullY.current = d.dy * PULL_FOLLOW;
      panel.style.transform = `translate3d(0, ${pullY.current.toFixed(1)}px, 0)`;
      return true;
    };
    const end = () => {
      const g = d;
      d = null;
      if (!g || g.mode !== "pull") return;
      if (g.dy > PULL_CLOSE || g.v > PULL_V) requestRef.current("pull").then((ok) => !ok && springBack());
      else springBack();
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return void (d = null);
      const p = e.touches[0];
      start(p.clientX, p.clientY, e.timeStamp, e.target as HTMLElement);
    };
    const onTouchMove = (e: TouchEvent) => {
      const p = e.touches[0];
      if (p && move(p.clientX, p.clientY, e.timeStamp) && e.cancelable) e.preventDefault();
    };
    const onTouchEnd = () => end();
    // a mouse can pull the grip/header too (desktop)
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (!target.closest("[data-unfold-head]") || target.closest("input, textarea, button")) return;
      start(e.clientX, e.clientY, e.timeStamp, target);
      const mv = (ev: PointerEvent) => move(ev.clientX, ev.clientY, ev.timeStamp) && ev.preventDefault();
      const up = () => {
        window.removeEventListener("pointermove", mv);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        end();
      };
      window.addEventListener("pointermove", mv);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    };

    panel.addEventListener("touchstart", onTouchStart, { passive: true });
    panel.addEventListener("touchmove", onTouchMove, { passive: false });
    panel.addEventListener("touchend", onTouchEnd);
    panel.addEventListener("touchcancel", onTouchEnd);
    panel.addEventListener("pointerdown", onPointerDown);
    return () => {
      panel.removeEventListener("touchstart", onTouchStart);
      panel.removeEventListener("touchmove", onTouchMove);
      panel.removeEventListener("touchend", onTouchEnd);
      panel.removeEventListener("touchcancel", onTouchEnd);
      panel.removeEventListener("pointerdown", onPointerDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the scrim never scrolls what is under it (wheel on desktop; touch-action covers touch)
  const scrimRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrimRef.current!;
    const stop = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", stop, { passive: false });
    return () => el.removeEventListener("wheel", stop);
  }, []);

  return (
    <UnfoldSlot.Provider value={slot}>
      <div ref={scrimRef} className="unfold-scrim" aria-hidden="true" onClick={() => !closing.current && requestRef.current("backdrop")} />
      <div ref={panelRef} className="unfold" role="dialog" aria-modal="true" aria-label={kindLabel} tabIndex={-1}>
        <div ref={contentRef} className="unfold-content">
          <div className="unfold-head" data-unfold-head="">
            <span className="unfold-grip" aria-hidden="true" />
            <span className="unfold-kind">{kindLabel}</span>
          </div>
          {children}
        </div>
      </div>
    </UnfoldSlot.Provider>
  );
}

/** a form inside an Unfold decides what closing means (save, ask, refuse) */
export function useUnfoldClose(handler: CloseHandler): void {
  const slot = useContext(UnfoldSlot);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!slot) return;
    slot.setHandler((via) => ref.current(via));
    return () => slot.setHandler(null);
  }, [slot]);
}

/** inside an Unfold: close it the way ✓ / Escape would (null outside, e.g. in the old sheets) */
export function useUnfold(): { requestClose(via: CloseVia): Promise<boolean> } | null {
  return useContext(UnfoldSlot);
}
