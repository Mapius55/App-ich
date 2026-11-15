// The time column is the document scroller (D2): four 100svh sections with
// mandatory snap. React state changes only on settle (scrollend, else idle).
// Phase 0: settle detection, lazy-mount flags, programmatic moves, snap on/off.
import { useCallback, useEffect, useRef, useState } from "react";
import { SETTLE_IDLE } from "./gestures";
import type { Level } from "./state";

const clampLevel = (n: number): Level => Math.max(0, Math.min(3, n)) as Level;

export interface Levels {
  /** ref callbacks for the four sections */
  sectionRef: (level: Level) => (el: HTMLElement | null) => void;
  /** Woche mounts the first time p > 0.3, Jahr the first time p > 1.3 */
  mounted: { week: boolean; year: boolean };
  /** scroll to a level; resolves on settle */
  scrollToLevel: (level: Level, behavior: ScrollBehavior) => Promise<void>;
}

export function useLevels(o: { initial: Level; onSettle: (level: Level) => void; snap: boolean }): Levels {
  const sections = useRef<(HTMLElement | null)[]>([null, null, null, null]);
  const refs = useRef(([0, 1, 2, 3] as Level[]).map((l) => (el: HTMLElement | null) => (sections.current[l] = el)));
  const [mounted, setMounted] = useState({ week: o.initial >= 1, year: o.initial >= 2 });
  const mountedRef = useRef(mounted);
  mountedRef.current = mounted;
  const onSettle = useRef(o.onSettle);
  onSettle.current = o.onSettle;
  const waiters = useRef<(() => void)[]>([]);

  const height = () => sections.current[0]?.offsetHeight || window.innerHeight;
  const top = (l: Level) => sections.current[l]?.offsetTop ?? l * height();

  const mountUpTo = useCallback((p: number) => {
    const m = mountedRef.current;
    if ((p > 0.3 && !m.week) || (p > 1.3 && !m.year)) setMounted({ week: m.week || p > 0.3, year: m.year || p > 1.3 });
  }, []);

  const settle = useCallback(() => {
    const level = clampLevel(Math.round(window.scrollY / height()));
    onSettle.current(level);
    const w = waiters.current;
    waiters.current = [];
    w.forEach((f) => f());
  }, []);

  useEffect(() => {
    let idle = 0;
    const onScroll = () => {
      mountUpTo(window.scrollY / height());
      clearTimeout(idle);
      idle = window.setTimeout(settle, SETTLE_IDLE);
    };
    const onEnd = () => {
      clearTimeout(idle);
      settle();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scrollend", onEnd);
    return () => {
      clearTimeout(idle);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("scrollend", onEnd);
    };
  }, [mountUpTo, settle]);

  // deep link: jump to the initial level once laid out; snapping starts one frame later
  useEffect(() => {
    const root = document.documentElement;
    if (o.initial > 0) window.scrollTo({ top: top(o.initial), behavior: "auto" });
    const raf = requestAnimationFrame(() => root.classList.add("space-snap"));
    return () => {
      cancelAnimationFrame(raf);
      root.classList.remove("space-snap");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("space-nosnap", !o.snap);
  }, [o.snap]);

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
        waiters.current.push(finish);
        window.setTimeout(() => {
          if (!done) settle();
        }, 1500);
        window.scrollTo({ top: target, behavior });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mountUpTo, settle],
  );

  return { sectionRef: (l) => refs.current[l], mounted, scrollToLevel };
}
