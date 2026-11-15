// The time column is the document scroller (D2): four 100svh sections with
// mandatory snap. Per frame only `onFrame(p)` runs (imperative writes, no React
// state); React state changes only on settle (scrollend, else SETTLE_IDLE idle).
import { useCallback, useEffect, useRef, useState } from "react";
import { SETTLE_IDLE } from "./gestures";
import type { Level } from "./state";

const clampLevel = (n: number): Level => Math.max(0, Math.min(3, n)) as Level;

export interface Levels {
  /** ref callbacks for the four sections */
  sectionRef: (level: Level) => (el: HTMLElement | null) => void;
  /** Tag mounts after the first paint, Woche the first time p > 0.3, Jahr the first time p > 1.3 */
  mounted: { day: boolean; week: boolean; year: boolean };
  /** scroll to a level; resolves on settle */
  scrollToLevel: (level: Level, behavior: ScrollBehavior) => Promise<void>;
  /** the current progress 0..3 (scrollY / section height) */
  progress: () => number;
  /** the section element of a level */
  section: (level: Level) => HTMLElement | null;
}

export function useLevels(o: { initial: Level; onSettle: (level: Level) => void; onFrame: (p: number) => void; onMotion?: (moving: boolean) => void; snap: boolean }): Levels {
  const sections = useRef<(HTMLElement | null)[]>([null, null, null, null]);
  const refs = useRef(([0, 1, 2, 3] as Level[]).map((l) => (el: HTMLElement | null) => void (sections.current[l] = el)));
  const [mounted, setMounted] = useState({ day: o.initial >= 1, week: o.initial >= 1, year: o.initial >= 2 });
  const mountedRef = useRef(mounted);
  mountedRef.current = mounted;
  const cb = useRef(o);
  cb.current = o;
  const waiters = useRef<{ level: Level; done: () => void }[]>([]);

  const height = () => sections.current[0]?.offsetHeight || window.innerHeight;
  const top = (l: Level) => sections.current[l]?.offsetTop ?? l * height();
  const progress = useCallback(() => window.scrollY / height(), []);

  const mountUpTo = useCallback((p: number) => {
    const m = mountedRef.current;
    if ((p > 0.3 && !m.week) || (p > 1.3 && !m.year) || (p > 0 && !m.day)) {
      const next = { day: true, week: m.week || p > 0.3, year: m.year || p > 1.3 };
      mountedRef.current = next;
      setMounted(next);
    }
  }, []);

  // Tag after the first paint (two frames: the first paints Jetzt)
  useEffect(() => {
    if (mountedRef.current.day) return;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => {
        mountedRef.current = { ...mountedRef.current, day: true };
        setMounted(mountedRef.current);
      });
    });
    return () => (cancelAnimationFrame(r1), cancelAnimationFrame(r2));
  }, []);

  const settle = useCallback(() => {
    const level = clampLevel(Math.round(progress()));
    cb.current.onSettle(level);
    cb.current.onMotion?.(false);
    // a programmatic move resolves when it arrived (an earlier scroll's end does not count)
    const arrived = waiters.current.filter((w) => w.level === level);
    waiters.current = waiters.current.filter((w) => w.level !== level);
    arrived.forEach((w) => w.done());
  }, [progress]);

  useEffect(() => {
    let idle = 0;
    let raf = 0;
    let moving = false;
    const frame = () => {
      raf = 0;
      const p = progress();
      mountUpTo(p);
      cb.current.onFrame(p);
    };
    const onScroll = () => {
      if (!moving) {
        moving = true;
        cb.current.onMotion?.(true);
      }
      if (!raf) raf = requestAnimationFrame(frame);
      clearTimeout(idle);
      idle = window.setTimeout(end, SETTLE_IDLE);
    };
    const end = () => {
      clearTimeout(idle);
      moving = false;
      // make sure the last position is painted before settling
      if (raf) cancelAnimationFrame(raf), (raf = 0);
      frame();
      settle();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scrollend", end);
    return () => {
      clearTimeout(idle);
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("scrollend", end);
    };
  }, [mountUpTo, settle, progress]);

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
