// Paging through time on a level: the swipe (A's useSwipeX in discrete mode), the
// chevrons, and the swap animation (old content leaves 24 px / 160 ms, new content
// enters 24 px / 240 ms, the title cross-fades). Plus small helpers shared by the levels.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { timeSwipeEnabled } from "../space/gestures";
import { stepAnchor, useSpace, type Level } from "../space/state";
import { useSwipeX } from "../space/useSwipeX";

const EASE_OUT = "cubic-bezier(.2,.75,.2,1)";

/** animate every [data-swap-fade] element inside `root` (the title and subline cross-fade) */
function fade(root: HTMLElement | null, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>("[data-swap-fade]")).map((el) => el.animate(frames, opts));
}

/** the current time, refreshed every `every` ms while `live` */
export function useNow(live: boolean, every = 30000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!live) return;
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), every);
    return () => clearInterval(t);
  }, [live, every]);
  return now;
}

/**
 * The period on screen lags the requested one by the exit animation: when `key`
 * changes, the page leaves and the title fades (the [data-swap-fade] elements in
 * titleRef), then `shown`
 * switches and the new content enters from the other side. Keys compare as strings
 * (YYYY-MM-DD, YYYY), so "later" means "next".
 */
export function usePeriodSwap(key: string, animate: boolean) {
  const [shown, setShown] = useState(key);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLElement | null>(null);
  const keyRef = useRef(key);
  keyRef.current = key;
  const leaving = useRef(false);
  const enterDir = useRef(0);
  const anims = useRef<Animation[]>([]);

  useEffect(() => {
    if (key === shown || leaving.current) return;
    const page = pageRef.current;
    if (!animate || !page || typeof page.animate !== "function") {
      setShown(key);
      return;
    }
    const dir = key > shown ? 1 : -1;
    leaving.current = true;
    const opts: KeyframeAnimationOptions = { duration: 160, easing: "ease-in", fill: "forwards" };
    const out = page.animate([{ transform: "none", opacity: 1 }, { transform: `translateX(${-24 * dir}px)`, opacity: 0 }], opts);
    const titles = fade(titleRef.current, [{ opacity: 1 }, { opacity: 0 }], opts);
    anims.current.forEach((a) => a.cancel());
    anims.current = [out, ...titles];
    const settle = () => {
      leaving.current = false;
      const next = keyRef.current;
      enterDir.current = next > shown ? 1 : next < shown ? -1 : 0;
      if (next === shown) {
        anims.current.forEach((a) => a.cancel());
        anims.current = [];
      }
      setShown(next);
    };
    out.finished.then(settle, settle);
  }, [key, shown, animate]);

  // the new period enters (runs before paint, so there is no flash of the new content in place)
  useLayoutEffect(() => {
    const dir = enterDir.current;
    enterDir.current = 0;
    if (!dir) return;
    const page = pageRef.current;
    if (!page || typeof page.animate !== "function") return;
    const enter = page.animate([{ transform: `translateX(${24 * dir}px)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 240, easing: EASE_OUT });
    const titles = fade(titleRef.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
    anims.current.forEach((a) => a.cancel());
    anims.current = [enter, ...titles];
  }, [shown]);

  return { shown, pageRef, titleRef };
}

/**
 * Time paging on a level: the anchor moves by one period. Swipe (discrete) only
 * while this level is the settled one and `allowed`; chevrons and keys always.
 */
export function useTimePaging(level: Level, o: { allowed?: boolean; canGo?: (dir: -1 | 1) => boolean } = {}) {
  const space = useSpace();
  const { setAnchor } = space;
  const anchorRef = useRef(space.anchor);
  anchorRef.current = space.anchor;
  const canGoRef = useRef(o.canGo);
  canGoRef.current = o.canGo;
  const followRef = useRef<HTMLDivElement | null>(null);

  const step = useCallback(
    (dir: -1 | 1) => {
      if (canGoRef.current && !canGoRef.current(dir)) return;
      setAnchor(stepAnchor(anchorRef.current, level, dir));
    },
    [setAnchor, level],
  );

  const swipe = useSwipeX({
    mode: "discrete",
    enabled: timeSwipeEnabled(space, level) && o.allowed !== false,
    follow: () => followRef.current,
    canGo: (dir) => (canGoRef.current ? canGoRef.current(dir) : true),
    onCommit: step,
  });

  return { step, swipeRef: swipe.ref, followRef };
}

/** shrink a one-line title until it fits its box (34 px down to `min`), re-checked on resize */
export function useFitText<T extends HTMLElement>(text: string, max = 34, min = 22) {
  const ref = useRef<T | null>(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    let size = max;
    el.style.fontSize = `${size}px`;
    while (size > min && el.scrollWidth > el.clientWidth + 1) {
      size -= 1;
      el.style.fontSize = `${size}px`;
    }
  }, [max, min]);
  useLayoutEffect(fit, [text, fit]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === w) return;
      w = el.clientWidth;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);
  return ref;
}

/** true for one moment after `on` turns true (arrival accents); never under reduced motion */
export function useArrival(on: boolean, reduced: boolean, ms: number): boolean {
  const [arriving, setArriving] = useState(false);
  const was = useRef(on);
  useEffect(() => {
    const rising = on && !was.current;
    was.current = on;
    if (!rising || reduced) return;
    setArriving(true);
    const t = setTimeout(() => setArriving(false), ms + 50);
    return () => {
      clearTimeout(t);
      setArriving(false);
    };
  }, [on, reduced, ms]);
  return arriving;
}
