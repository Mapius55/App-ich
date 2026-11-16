// "neu vom Coach": items the coach just created or changed glow until seen.
// TTL 10 min, kept in sessionStorage "ich.fresh" (memory only when storage fails).
import { useEffect, useSyncExternalStore } from "react";

export const FRESH_TTL = 10 * 60 * 1000;
const KEY = "ich.fresh";
const SEEN_MS = 2000;

type Store = Record<string, number>; // id → when it was marked
let store: Store | null = null;
const listeners = new Set<() => void>();
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

function prune(s: Store, now = Date.now()): Store {
  for (const [id, t] of Object.entries(s)) if (!(now - t < FRESH_TTL) || t > now + FRESH_TTL) delete s[id];
  return s;
}

function load(): Store {
  if (store) return store;
  let s: Store = {};
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") for (const [id, t] of Object.entries(parsed)) if (typeof t === "number") s[id] = t;
  } catch {
    /* storage unavailable */
  }
  store = prune(s);
  scheduleExpiry();
  return store;
}

function save(): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(store ?? {}));
  } catch {
    /* storage unavailable */
  }
}

function notify(): void {
  listeners.forEach((l) => l());
}

// one timer for the next item to expire, so glowing items stop on their own
function scheduleExpiry(): void {
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  const times = Object.values(store ?? {});
  if (!times.length) return;
  const wait = Math.max(0, Math.min(...times) + FRESH_TTL - Date.now()) + 20;
  expiryTimer = setTimeout(() => {
    prune(load());
    save();
    scheduleExpiry();
    notify();
  }, wait);
}

export function markFresh(id: string): void {
  if (!id) return;
  load()[id] = Date.now();
  save();
  scheduleExpiry();
  notify();
}

export function isFresh(id: string): boolean {
  const t = load()[id];
  if (t === undefined) return false;
  const age = Date.now() - t;
  return age >= -FRESH_TTL && age < FRESH_TTL;
}

export function markSeen(id: string): void {
  const s = load();
  if (!(id in s)) return;
  delete s[id];
  save();
  scheduleExpiry();
  notify();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** true while the item is fresh; re-renders when it is marked, seen or expires */
export function useFresh(id: string | null | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (id ? isFresh(id) : false),
    () => false,
  );
}

/** marks the item seen once it has been ≥ 50 % visible for 2 s (only while it is fresh) */
export function useSeenWhenVisible(ref: React.RefObject<Element | null>, id: string | null | undefined): void {
  const fresh = useFresh(id);
  useEffect(() => {
    const el = ref.current;
    if (!fresh || !id || !el || typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const io = new IntersectionObserver(
      ([entry]) => {
        const visible = entry.isIntersecting && entry.intersectionRatio >= 0.5;
        if (visible && !timer) timer = setTimeout(() => markSeen(id), SEEN_MS);
        if (!visible && timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: [0, 0.5, 1] },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [ref, id, fresh]);
}

/** tests only: forget everything (memory and storage) */
export function resetFreshForTests(): void {
  store = {};
  save();
  scheduleExpiry();
  notify();
}
