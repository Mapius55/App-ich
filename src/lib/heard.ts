// Did she hear the coach's last words? The coach speaks only after her tap, so a greeting made on
// open may never be heard. This device keeps the last text whose sound really started (one entry,
// for the day's thread), so after a reload an unheard greeting still offers «Hören», and one from an
// earlier part of the day gives way to a fresh greeting, made only when she taps (no coach call for
// a glance at the app).

const KEY = "ich.heard";

/** a short, stable fingerprint of a text (FNV-1a, 32 bit) */
export function textHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

type Store = Pick<Storage, "getItem" | "setItem">;
const local = (): Store | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

/** its sound started: she heard it */
export function markHeard(thread: string, text: string, store: Store | null = local()): void {
  try {
    store?.setItem(KEY, `${thread}:${textHash(text.trim())}`);
  } catch {
    /* storage unavailable: the replay simply stays */
  }
}

/** true = heard on this device; false = not (or unknown: then the replay is offered) */
export function wasHeard(thread: string, text: string, store: Store | null = local()): boolean {
  try {
    return store?.getItem(KEY) === `${thread}:${textHash(text.trim())}`;
  } catch {
    return false;
  }
}

export const STALE_MS = 3 * 60 * 60 * 1000;

/** the part of the day a greeting speaks to: morning (before 11), day (11–17), evening (from 17) */
export function dayPart(d: Date): 0 | 1 | 2 {
  const h = d.getHours();
  return h < 11 ? 0 : h < 17 ? 1 : 2;
}

/** a greeting made at `at` no longer fits at `now`: about 3 h old, or from an earlier part of the day */
export function greetingStale(at: number, now: number): boolean {
  if (!(at > 0)) return false;
  return now - at >= STALE_MS || dayPart(new Date(now)) > dayPart(new Date(at));
}

/**
 * What Jetzt offers for the day's greeting while she has said nothing yet: "hear" = it was never
 * heard and still fits («Hören»); "fresh" = never heard and from an earlier part of the day (the hint;
 * her tap makes a fresh greeting); "none" = she spoke, heard it, or there is none.
 */
export function greetingOffer(o: { spoke: boolean; hasReply: boolean; heard: boolean; at: number; now: number }): "none" | "hear" | "fresh" {
  if (o.spoke || !o.hasReply || o.heard) return "none";
  return greetingStale(o.at, o.now) ? "fresh" : "hear";
}
