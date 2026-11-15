// The return from WHOOP's consent page: <app>#du/verbindungen?whoop=confirm&code=… (or whoop=error /
// whoop=denied / whoop=taken). Imported first by main.tsx, so it reads the hash once at page load, before anything
// else looks at it: the values go to sessionStorage (they survive a login screen) and the query leaves
// the URL (history.replaceState; #du/verbindungen stays, or nothing when onboarding started it).
// Later hash changes are caught too (the demo "returns" without a page load). Once logged in,
// Du › Verbindungen or onboarding takes the values (takeWhoopReturn) and confirms the link.
import { parseWhoopHash, readWhoopReturn, type WhoopReturn } from "./connections";

const RETURN_KEY = "ich.whoop.return";
const FROM_KEY = "ich.whoop.from";
/** fired on window when a return was caught after the page had loaded */
export const WHOOP_RETURN_EVENT = "ich:whoop-return";

function get(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function set(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the return is kept in memory for this page only */
  }
}

let memory: WhoopReturn | null = null;

/** Where the connect flow started: "onboarding" means onboarding continues after the return. */
export function setWhoopFrom(from: "onboarding" | "space" | null): void {
  set(FROM_KEY, from);
}
export function whoopFrom(): "onboarding" | "space" | null {
  const v = get(FROM_KEY);
  return v === "onboarding" || v === "space" ? v : null;
}

/** the waiting return, if any (not consumed) */
export function peekWhoopReturn(now = Date.now()): WhoopReturn | null {
  return readWhoopReturn(get(RETURN_KEY), now) ?? (memory && readWhoopReturn(JSON.stringify(memory), now));
}

/** the waiting return, consumed: whoever takes it confirms the link and shows the result */
export function takeWhoopReturn(now = Date.now()): WhoopReturn | null {
  const r = peekWhoopReturn(now);
  clearWhoopReturn();
  return r;
}

export function clearWhoopReturn(): void {
  memory = null;
  set(RETURN_KEY, null);
}

/** reads the hash; true when it carried a WHOOP return (then stored and removed from the URL) */
export function captureWhoopReturn(win: Window = window): boolean {
  const found = parseWhoopHash(win.location.hash);
  if (!found) return false;
  memory = found.ret;
  set(RETURN_KEY, JSON.stringify(found.ret));
  // started in onboarding: no deep link into Du afterwards
  const hash = whoopFrom() === "onboarding" ? "" : found.hash;
  try {
    win.history.replaceState(win.history.state, "", `${win.location.pathname}${win.location.search}${hash}`);
  } catch {
    /* sandboxed: the query stays, nothing else depends on it */
  }
  return true;
}

if (typeof window !== "undefined") {
  captureWhoopReturn();
  window.addEventListener("hashchange", () => {
    if (captureWhoopReturn()) window.dispatchEvent(new Event(WHOOP_RETURN_EVENT));
  });
}
