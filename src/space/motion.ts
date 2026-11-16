// Quiet while moving (cause B of the iPhone "can't scroll down from Jetzt"): from the first touch
// until the time column settled, nothing may change the layout. WebKit re-snaps a root mandatory
// snap container after a layout change, to the snap index it last knew (Jetzt during the first
// drag), and during momentum the re-snap cuts the fling short. The first seconds after entry are
// full of arriving data (the greeting, the door line, Tag, goals, the connections), all under the
// finger. So those updates wait here: `whenStill` runs them at once when still, otherwise once the
// column rests; `useStill` holds a rendered value while moving. useLevels drives the state; in the
// old view nothing sets it, so everything runs at once there.
import { useCallback, useRef, useSyncExternalStore } from "react";

let busy = false;
let queue: (() => void)[] = [];
const subs = new Set<() => void>();

function flush(): void {
  // in order; a callback that throws does not hold back the rest, and one that starts a new move
  // leaves the remaining ones queued
  while (!busy && queue.length) {
    const fn = queue.shift()!;
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  }
}

export const motion = {
  busy: (): boolean => busy,
  subscribe(fn: () => void): () => void {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  /** idempotent; turning still runs what waited, in order */
  set(on: boolean): void {
    if (on === busy) return;
    busy = on;
    if (!on) flush();
    subs.forEach((f) => f());
  },
};

/** runs fn now when still, else once the space is still again */
export function whenStill(fn: () => void): void {
  if (!busy) fn();
  else queue.push(fn);
}

/** `value` while still; while moving the last value rendered still (one re-render when it turns still, only if it changed meanwhile) */
export function useStill<T>(value: T): T {
  const ref = useRef({ shown: value, latest: value });
  ref.current.latest = value;
  if (!busy) ref.current.shown = value;
  const get = useCallback(() => (busy ? ref.current.shown : ref.current.latest), []);
  return useSyncExternalStore(motion.subscribe, get, get);
}

export function resetMotionForTests(): void {
  busy = false;
  queue = [];
  subs.clear();
}
