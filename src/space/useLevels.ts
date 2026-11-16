// The time column is the document scroller (D2): five 100svh sections with
// mandatory snap. Per frame only `onFrame(p)` runs (imperative writes, no React
// state); React state changes only on settle (scrollend, else SETTLE_IDLE idle).
// It also drives the motion store (motion.ts): busy from the touch until the settle.
import { useCallback, useEffect, useRef, useState } from "react";
import { SETTLE_IDLE, STILL_VALVE, atSnapPoint } from "./gestures";
import { motion, whenStill } from "./motion";
import type { Level } from "./state";

export const LAST_LEVEL: Level = 4; // Leben
const clampLevel = (n: number): Level => Math.max(0, Math.min(LAST_LEVEL, n)) as Level;
const LEVELS: Level[] = [0, 1, 2, 3, 4];

export interface Levels {
  /** ref callbacks for the five sections */
  sectionRef: (level: Level) => (el: HTMLElement | null) => void;
  /** Tag mounts after the first paint, Woche once p passed 0.3, Jahr once p passed 1.3, Leben once p passed 2.3 (applied on settle) */
  mounted: { day: boolean; week: boolean; year: boolean; life: boolean };
  /** scroll to a level; resolves on settle */
  scrollToLevel: (level: Level, behavior: ScrollBehavior) => Promise<void>;
  /** the current progress 0..4 (scrollY / section height) */
  progress: () => number;
  /** the section element of a level */
  section: (level: Level) => HTMLElement | null;
}

export function useLevels(o: {
  initial: Level;
  onSettle: (level: Level) => void;
  onFrame: (p: number) => void;
  onMotion?: (moving: boolean) => void;
  snap: boolean;
  /** the time column is hidden (a side is shown): the level to keep, else null. A document
      scroll then neither moves the levels nor settles; with `snap` it goes straight back
      (e.g. a drag that chained from a fixed layer). */
  hold?: () => { level: Level; snap: boolean } | null;
}): Levels {
  const sections = useRef<(HTMLElement | null)[]>(LEVELS.map(() => null));
  const refs = useRef(LEVELS.map((l) => (el: HTMLElement | null) => void (sections.current[l] = el)));
  const [mounted, setMounted] = useState({ day: o.initial >= 1, week: o.initial >= 1, year: o.initial >= 2, life: o.initial >= 3 });
  const mountedRef = useRef(mounted);
  mountedRef.current = mounted;
  const cb = useRef(o);
  cb.current = o;
  const waiters = useRef<{ level: Level; done: () => void }[]>([]);
  const fingers = useRef(0); // touches on the screen (a settle under a resting finger stays busy)

  const height = () => sections.current[0]?.offsetHeight || window.innerHeight;
  const top = (l: Level) => sections.current[l]?.offsetTop ?? l * height();
  const progress = useCallback(() => window.scrollY / height(), []);

  const mountUpTo = useCallback((p: number) => {
    const m = mountedRef.current;
    if ((p > 0.3 && !m.week) || (p > 1.3 && !m.year) || (p > 2.3 && !m.life) || (p > 0 && !m.day)) {
      const next = { day: true, week: m.week || p > 0.3, year: m.year || p > 1.3, life: m.life || p > 2.3 };
      mountedRef.current = next;
      setMounted(next);
    }
  }, []);
  // During a touch scroll a mount would change the scroller's layout, and the browser
  // re-snaps on layout changes: the fling would be cancelled and snap back. So the
  // furthest p is only noted per frame, and the mount happens on settle.
  const reached = useRef(0);

  // Tag after the first paint (two frames: the first paints Jetzt), not under a moving finger
  useEffect(() => {
    if (mountedRef.current.day) return;
    let r2 = 0;
    let alive = true;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() =>
        whenStill(() => {
          if (!alive || mountedRef.current.day) return;
          mountedRef.current = { ...mountedRef.current, day: true };
          setMounted(mountedRef.current);
        }),
      );
    });
    return () => ((alive = false), cancelAnimationFrame(r1), cancelAnimationFrame(r2));
  }, []);

  const settle = useCallback(() => {
    reached.current = Math.max(reached.current, progress());
    mountUpTo(reached.current);
    const level = clampLevel(Math.round(progress()));
    cb.current.onSettle(level);
    cb.current.onMotion?.(false);
    // at rest: what waited (data, the mounts' layouts) may render now
    if (!fingers.current) motion.set(false);
    // a programmatic move resolves when it arrived (an earlier scroll's end does not count)
    const arrived = waiters.current.filter((w) => w.level === level);
    waiters.current = waiters.current.filter((w) => w.level !== level);
    arrived.forEach((w) => w.done());
  }, [progress, mountUpTo]);

  useEffect(() => {
    let idle = 0;
    let raf = 0;
    let moving = false;
    let live = true;
    // A finger resting mid-drag is not a settle: wait for the touch to end. Where the
    // browser fires scrollend, the idle timer is only a safety net (slow frames would
    // otherwise "settle" in the middle of a fling).
    let touches = 0;
    let scrolledSinceTouch = false;
    let rearms = 0;
    let valve = 0;
    const idleMs = "onscrollend" in window ? Math.max(SETTLE_IDLE, 800) : SETTLE_IDLE;
    const frame = () => {
      raf = 0;
      const p = progress();
      if (p > reached.current) reached.current = p;
      cb.current.onFrame(p);
    };
    // motion store: busy from the touch (or a programmatic scroll) until the settle. The valve: busy
    // with no touch and no scroll for STILL_VALVE turns still (a lost touchend, a scroll that never came).
    const busy = () => {
      motion.set(true);
      clearTimeout(valve);
      valve = window.setTimeout(function check() {
        if (touches) valve = window.setTimeout(check, STILL_VALVE);
        else motion.set(false);
      }, STILL_VALVE);
    };
    const arm = () => {
      clearTimeout(idle);
      if (moving) idle = window.setTimeout(onIdle, idleMs);
    };
    // a settle by timer only on a snap point (a slow frame mid-fling is no rest); scrollend settles as it comes.
    // (A top past the end counts as the end: in a Safari tab the viewport can be taller than a section.)
    const onIdle = () => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (cb.current.snap && moving && !touches && rearms < 10 && !atSnapPoint(window.scrollY, height(), sections.current.map((el, l) => el?.offsetTop ?? l * height()), maxScroll)) {
        rearms++;
        arm();
        return;
      }
      end();
    };
    const onScroll = () => {
      const held = cb.current.hold?.() ?? null;
      if (held && !moving) {
        const t = top(held.level);
        if (held.snap && Math.abs(window.scrollY - t) > 0.5) window.scrollTo({ top: t, behavior: "auto" });
        return;
      }
      scrolledSinceTouch = true;
      rearms = 0;
      // (also programmatic moves: goLevel, the keys, the door)
      if (cb.current.snap) busy();
      if (!moving) {
        moving = true;
        cb.current.onMotion?.(true);
      }
      if (!raf) raf = requestAnimationFrame(frame);
      arm();
    };
    const end = () => {
      clearTimeout(idle);
      if (touches > 0 || !moving) return;
      moving = false;
      rearms = 0;
      // make sure the last position is painted before settling
      if (raf) cancelAnimationFrame(raf), (raf = 0);
      frame();
      settle();
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!live) return;
      touches = fingers.current = e.touches.length;
      if (touches) return;
      // a tap or a sideways pager drag: still at once, so what the tap opens renders at once
      if (!moving && !scrolledSinceTouch) motion.set(false);
      else arm();
    };
    // pointerdown comes before touchstart, and a first touch changes the screen from it (the sound
    // unlock ends «Tippe irgendwo, um mich zu hören»): that change must already wait
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      scrolledSinceTouch = false;
      if (cb.current.snap) busy();
    };
    const onTouchStart = (e: TouchEvent) => {
      touches = fingers.current = e.touches.length;
      scrolledSinceTouch = false;
      // typing: snap is off, a re-snap is impossible, nothing needs to wait
      if (cb.current.snap) busy();
      // a target removed mid-gesture (e.g. «Tippe irgendwo, um mich zu hören» when the sound unlocks)
      // no longer passes its touchend on to window; its own listeners still get it (both firing is harmless)
      const t = e.target;
      if (t instanceof Node && t !== document) {
        t.addEventListener("touchend", onTouchEnd as EventListener, { once: true, passive: true });
        t.addEventListener("touchcancel", onTouchEnd as EventListener, { once: true, passive: true });
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scrollend", end);
    window.addEventListener("pointerdown", onPointerDown, { passive: true, capture: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true, capture: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true, capture: true });
    return () => {
      live = false;
      clearTimeout(idle);
      clearTimeout(valve);
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("scrollend", end);
      window.removeEventListener("pointerdown", onPointerDown, { capture: true });
      window.removeEventListener("touchstart", onTouchStart, { capture: true });
      window.removeEventListener("touchend", onTouchEnd, { capture: true });
      window.removeEventListener("touchcancel", onTouchEnd, { capture: true });
      fingers.current = 0;
      motion.set(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settle, progress]);

  // deep link: jump to the initial level once laid out; snapping starts one frame later
  useEffect(() => {
    const root = document.documentElement;
    if (o.initial > 0) window.scrollTo({ top: top(o.initial), behavior: "auto" });
    cb.current.onFrame(progress());
    const raf = requestAnimationFrame(() => root.classList.add("space-snap"));
    return () => {
      cancelAnimationFrame(raf);
      root.classList.remove("space-snap");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("space-nosnap", !o.snap);
    // without snap nothing can re-snap: what waits may render
    if (!o.snap) motion.set(false);
    return () => root.classList.remove("space-nosnap");
  }, [o.snap]);

  // a new viewport height (rotation, URL bar): keep the current level in place
  useEffect(() => {
    let last = window.innerHeight;
    let t = 0;
    const on = () => {
      if (window.innerHeight === last) return;
      last = window.innerHeight;
      clearTimeout(t);
      t = window.setTimeout(() => cb.current.onFrame(progress()), 50);
    };
    window.addEventListener("resize", on);
    return () => (window.removeEventListener("resize", on), clearTimeout(t));
  }, [progress]);

  const scrollToLevel = useCallback(
    (level: Level, behavior: ScrollBehavior) =>
      new Promise<void>((resolve) => {
        mountUpTo(level);
        const target = top(level);
        if (Math.abs(window.scrollY - target) < 1) {
          settle();
          resolve();
          return;
        }
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        waiters.current.push({ level, done: finish });
        window.setTimeout(() => {
          if (done) return;
          waiters.current = waiters.current.filter((w) => w.done !== finish);
          settle();
          finish();
        }, 1500);
        window.scrollTo({ top: target, behavior });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mountUpTo, settle],
  );

  return { sectionRef: (l) => refs.current[l], mounted, scrollToLevel, progress, section: (l) => sections.current[l] };
}
