import { useEffect, useRef, useState } from "react";
import { Portal, type OrbState } from "./Portal";

// The portal as large as the free space allows (it shrinks a little when
// buttons or the text field need room below it).
export function FitPortal(props: { colors: string[]; daylight: number; speed: number; seed: number; state: OrbState; max?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let t = 0;
    const measure = () => {
      const s = Math.floor(Math.min(el.clientWidth, el.clientHeight, props.max ?? 440));
      setSize((old) => (Math.abs(old - s) > 6 ? s : old));
    };
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = window.setTimeout(measure, 120);
    });
    ro.observe(el);
    measure();
    return () => (ro.disconnect(), clearTimeout(t));
  }, [props.max]);

  return (
    <div className="voice-portal" ref={box}>
      {size > 40 && <Portal colors={props.colors} daylight={props.daylight} size={size} speed={props.speed} seed={props.seed} state={props.state} />}
    </div>
  );
}
