// Screen changes zoom through the portal (View Transitions API, where the
// browser has it; elsewhere screens simply fade in via CSS).
import { flushSync } from "react-dom";

type VT = { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void>; skipTransition?(): void };
let running: VT | null = null;

export function withTransition(fn: () => void) {
  const d = document as Document & { startViewTransition?: (cb: () => void) => VT };
  // While one transition plays, further changes just happen inside it. In the space never: iOS
  // stops a pan when a transition starts (WebKit bug 288795; with mandatory snap the stopped pan
  // goes back to Jetzt), and the space's own motion is its transition.
  if (
    !d.startViewTransition ||
    running ||
    document.documentElement.classList.contains("space-on") ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    fn();
    return;
  }
  const vt = d.startViewTransition(() => flushSync(fn));
  running = vt;
  const quiet = () => {};
  vt.ready.catch(quiet);
  vt.updateCallbackDone.catch(quiet);
  vt.finished.catch(quiet).finally(() => running === vt && (running = null));
}

/** ends a running screen transition at once (the space opens without a whole-page snapshot over it) */
export function skipScreenTransition(): void {
  running?.skipTransition?.();
}

/**
 * What an auth event does to the screen: the same person again (INITIAL_SESSION, SIGNED_IN on every
 * return to the app, TOKEN_REFRESHED about hourly) changes nothing; the first answer at start (the
 * session restored) just shows; a real sign-in or sign-out zooms.
 */
export function authChange(prev: string | null | undefined, next: string | null): "none" | "plain" | "transition" {
  if (prev === next) return "none";
  if (prev === undefined) return "plain";
  return "transition";
}
