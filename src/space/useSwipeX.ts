// Horizontal swipe hook: the Du ↔ Jetzt ↔ Ziele pager and discrete time paging.
// STUB (phase 0): returns a no-op ref. The signature is final (A fills it in phase 1).
import { useCallback } from "react";

export interface SwipeXOptions {
  mode: "pager" | "discrete";
  enabled: boolean;
  /** the element that follows the finger (discrete: ×0.5, max 80 px) */
  follow?: () => HTMLElement | null;
  /** false = rubber-band at this end */
  canGo?: (dir: -1 | 1) => boolean;
  onStart?(): void;
  /** dir 1 = next (the finger moved left), -1 = previous */
  onCommit(dir: -1 | 1): void;
  onCancel?(): void;
}

export function useSwipeX(o: SwipeXOptions): { ref: (el: HTMLElement | null) => void } {
  void o;
  const ref = useCallback((el: HTMLElement | null) => void el, []);
  return { ref };
}
