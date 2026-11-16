// --kb: how much of the layout viewport the on-screen keyboard covers (from
// visualViewport). Written only when the value changes, never per scroll frame.
import { useEffect } from "react";

export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let last = -1;
    let raf = 0;
    const update = () => {
      raf = 0;
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      // ignore tiny differences (URL bar, rounding)
      const next = kb < 60 ? 0 : kb;
      if (next === last) return;
      last = next;
      if (next) root.style.setProperty("--kb", `${next}px`);
      else root.style.removeProperty("--kb");
      // html[data-kb]: the on-screen keyboard is up (the voice layer hides for a detail's fields)
      if (next) root.dataset.kb = "true";
      else delete root.dataset.kb;
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    return () => {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      if (raf) cancelAnimationFrame(raf);
      root.style.removeProperty("--kb");
      delete root.dataset.kb;
    };
  }, []);
}
