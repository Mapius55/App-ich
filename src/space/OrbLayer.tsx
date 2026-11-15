// The circle's fixed layer (§5 with the user's feedback): ONE Portal. At Jetzt it sits
// over NowLevel's orb slot; scrolling down or paging sideways docks it, scaled down,
// at the top centre (the same canvas, never a CSS ball). Docked and settled it stops
// drawing (the canvas keeps its last frame); while the coach listens, thinks or
// speaks it redraws at a low rate. Positions are written imperatively, never React
// state per frame.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Portal, type OrbState } from "../components/Portal";
import type { Palette } from "../lib/palette";
import type { TourStep } from "./state";
import { dockEase } from "./swipeMath";

/** the orb slot in document coordinates at p = 0 (its centre and the square that fits) */
export interface OrbSlot {
  cx: number;
  cy: number;
  size: number;
}

export interface OrbApi {
  /** d = max(p, q), 0 = over the slot, 1 = docked */
  dock(d: number): void;
}

const DOCK_SIZE = 36;
const DOCKED_AT = 0.98;
const DOCKED_AFTER_MS = 250;
const DOCKED_FPS = 12;

export interface OrbLayerProps {
  apiRef: { current: OrbApi | null };
  palette: Palette;
  state: OrbState;
  slot: OrbSlot | null;
  /** settled away from Jetzt: the docked circle is a button */
  away: boolean;
  detailOpen: boolean;
  reduced: boolean;
  tour: TourStep | null;
  atJetzt: boolean;
  onBack(): void;
}

function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return hidden;
}

export function OrbLayer({ apiRef, palette, state, slot, away, detailOpen, reduced, tour, atJetzt, onBack }: OrbLayerProps) {
  const moveRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const slotRef = useRef(slot);
  slotRef.current = slot;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const lastD = useRef(0);
  const lastCss = useRef("");
  const lastPose = useRef<0 | 1 | null>(null);
  const [docked, setDocked] = useState(false);
  const dockedRef = useRef(false);
  dockedRef.current = docked;
  const dockTimer = useRef(0);
  const hidden = useDocumentHidden();

  useLayoutEffect(() => {
    const paint = (d: number) => {
      lastD.current = d;
      // settled docked → pause after 250 ms; leaving the dock unpauses at once
      if (d >= DOCKED_AT) {
        if (!dockedRef.current && !dockTimer.current)
          dockTimer.current = window.setTimeout(() => {
            dockTimer.current = 0;
            setDocked(true);
          }, DOCKED_AFTER_MS);
      } else {
        clearTimeout(dockTimer.current);
        dockTimer.current = 0;
        if (dockedRef.current) {
          dockedRef.current = false;
          setDocked(false);
        }
      }
      const el = moveRef.current;
      const s = slotRef.current;
      if (!el || !s || !s.size) return;
      const dockCx = document.documentElement.clientWidth / 2;
      const dockCy = anchorRef.current?.offsetTop ?? 73;
      // reduced motion: no travel, the big circle swaps to the docked one at d = 0.5 with a fade
      const pose = d >= 0.5 ? 1 : 0;
      const e = reducedRef.current ? pose : dockEase(d);
      const cx = s.cx + (dockCx - s.cx) * e;
      const cy = s.cy + (dockCy - s.cy) * e;
      const sc = 1 + (DOCK_SIZE / s.size - 1) * e;
      const css = `translate3d(${(cx - s.size / 2).toFixed(2)}px,${(cy - s.size / 2).toFixed(2)}px,0) scale(${sc.toFixed(4)})`;
      if (css !== lastCss.current) {
        el.style.transform = css;
        lastCss.current = css;
      }
      if (reducedRef.current && lastPose.current !== null && lastPose.current !== pose) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
      lastPose.current = pose;
    };
    apiRef.current = { dock: paint };
    return () => {
      apiRef.current = null;
      clearTimeout(dockTimer.current);
    };
  }, [apiRef]);

  // a new slot (or a resize): put the circle where it belongs for the last d
  useLayoutEffect(() => {
    lastCss.current = "";
    apiRef.current?.dock(lastD.current);
  }, [slot?.cx, slot?.cy, slot?.size, reduced, apiRef]);
  useEffect(() => {
    const on = () => {
      lastCss.current = "";
      apiRef.current?.dock(lastD.current);
    };
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [apiRef]);

  const active = state !== "idle";
  const paused = detailOpen || hidden || (docked && !active);
  const fps = docked && active ? DOCKED_FPS : undefined;
  const size = slot?.size ?? 0;
  const finger = tour === 1 && atJetzt && !reduced && slot;

  return (
    <div className="orb-layer" data-docked={docked ? "true" : "false"} data-orb-state={state}>
      <span ref={anchorRef} className="orb-dock-anchor" aria-hidden="true" />
      <div ref={moveRef} className="orb-move" style={{ width: size, height: size }}>
        <div className="orb-nudge">
          <div className="orb-breathe">
            {size > 0 && (
              <Portal
                colors={palette.orb}
                daylight={palette.daylight}
                clouds={palette.clouds}
                size={size}
                speed={palette.speed}
                seed={palette.seed}
                state={state}
                interactive={false}
                paused={paused}
                fps={fps}
              />
            )}
          </div>
        </div>
      </div>
      {finger && (
        <span
          className="tour-finger"
          aria-hidden="true"
          style={{ left: slot.cx - 23, top: slot.cy + slot.size * 0.3 - 23, ["--travel" as string]: `${-Math.round(slot.size * 0.6)}px` }}
        />
      )}
      {away && <button type="button" className="orb-dock" aria-label="Zurück zum Kreis" onClick={onBack} />}
    </div>
  );
}
