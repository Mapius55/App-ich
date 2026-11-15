// Bringing an item into view inside a side layer (Ziele, Du).
import { useEffect, useRef } from "react";

/** scroll an item to the middle of its side layer (never the document: that would change the level) */
export function revealInSide(el: Element | null, reduced: boolean, onlyIfHidden = false): void {
  const side = el?.closest<HTMLElement>(".side");
  if (!el || !side) return;
  const r = el.getBoundingClientRect();
  const s = side.getBoundingClientRect();
  if (onlyIfHidden && r.top >= s.top + 80 && r.top + Math.min(r.height, 120) <= s.bottom - 140) return;
  const top = side.scrollTop + (r.top - s.top) - Math.max(0, (side.clientHeight - r.height) / 2);
  side.scrollTo({ top: Math.max(0, top), behavior: reduced ? "auto" : "smooth" });
}

/** a coach change that arrives while Ziele is shown: bring the item into view (it glows "neu") */
export function useRevealWhenFresh(ref: React.RefObject<Element | null>, fresh: boolean, active: boolean, reduced: boolean): void {
  const was = useRef(false); // a block that mounts fresh while Ziele is shown is a new item: reveal it too
  useEffect(() => {
    if (fresh && !was.current && active) revealInSide(ref.current, reduced, true);
    was.current = fresh;
  }, [fresh, active, reduced, ref]);
}
