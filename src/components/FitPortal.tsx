import { useEffect, useRef, useState } from "react";
import { Portal, type OrbState } from "./Portal";
import type { Clouds } from "../lib/palette";
import { circleTap } from "../space/gestures";

// The portal as large as the free space allows (it shrinks a little when
// buttons or the text field need room below it). `min` keeps at least that much room for it, so the
// colour flow never disappears (onboarding: a tall chooser on a small phone with large text).
// A tap on it (onTap) lets the coach speak: the voice waits for a tap on the circle, the hint or the mic.
export function FitPortal(props: { colors: string[]; daylight: number; clouds?: Clouds; speed: number; seed: number; state: OrbState; max?: number; min?: number; onTap?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);
  const down = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let t = 0;
    const measure = () => {
      const s = Math.max(props.min ?? 0, Math.floor(Math.min(el.clientWidth, el.clientHeight, props.max ?? 440)));
      setSize((old) => (Math.abs(old - s) > 6 ? s : old));
    };
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = window.setTimeout(measure, 120);
    });
    ro.observe(el);
    measure();
    return () => (ro.disconnect(), clearTimeout(t));
  }, [props.max, props.min]);

  return (
    <div
      className="voice-portal"
      ref={box}
      style={props.min ? { minHeight: props.min } : undefined}
      onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
      onClick={(e) => {
        // only a tap on the circle itself, not beside it, and never a drag
        const circle = e.currentTarget.querySelector(".portal")?.getBoundingClientRect();
        if (props.onTap && circle && circleTap(down.current, { x: e.clientX, y: e.clientY }, circle, false, Infinity)) props.onTap();
        down.current = null;
      }}
    >
      {size > 40 && <Portal colors={props.colors} daylight={props.daylight} clouds={props.clouds} size={size} speed={props.speed} seed={props.seed} state={props.state} />}
    </div>
  );
}
