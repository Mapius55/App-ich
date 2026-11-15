// Jetzt (level 0, §3.1): three pills, the greeting, the focus, the orb slot (the
// fixed OrbLayer draws the circle over it) and the door line to the day.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { backend } from "../lib/backend";
import { localMidnightIso } from "../lib/dates";
import type { Palette } from "../lib/palette";
import { addDays } from "../lib/plan";
import { pressOrb } from "../lib/orbSignals";
import type { Weather } from "../lib/weather";
import type { CalendarEvent, Profile } from "../lib/types";
import { usePlanData } from "./data";
import { doorLine, type DoorLine } from "./doorLine";
import type { OrbSlot } from "./OrbLayer";
import { useSpace } from "./state";
import { TourBlock } from "./Tour";

// Follows the actual light outside: in December it's "Guten Abend" at 17:00.
export function greeting(isDark: boolean, d = new Date()): string {
  const h = d.getHours();
  if (h < 4) return "Gute Nacht";
  if (h < 11) return "Guten Morgen";
  if (h < 14) return "Hoi";
  if (h < 18 && !isDark) return "Schönen Nachmittag";
  return "Guten Abend";
}

export const NOW_TITLE_ID = "now-title";

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** the events of the next 8 days, reloaded when the plan data says events changed and every minute */
function useDoorLine(today: string): DoorLine | null {
  const { eventsVersion } = usePlanData();
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let alive = true;
    backend
      .listEvents(localMidnightIso(today), localMidnightIso(addDays(today, 9)))
      .then((ev) => alive && setEvents(ev))
      .catch(() => alive && setEvents((e) => e ?? []));
    return () => {
      alive = false;
    };
  }, [today, eventsVersion]);
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(id);
  }, []);
  return events ? doorLine(events, now) : null;
}

/** offsetLeft/Top up to the document (layout positions, untouched by transforms) */
function docOffset(el: HTMLElement): { left: number; top: number } {
  let left = 0;
  let top = 0;
  let n: HTMLElement | null = el;
  while (n) {
    left += n.offsetLeft;
    top += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return { left, top };
}

export interface NowLevelProps {
  profile: Profile;
  palette: Palette;
  weather: Weather | null;
  focus: string | null;
  onSlot(slot: OrbSlot): void;
}

export function NowLevel({ profile, palette, weather, focus, onSlot }: NowLevelProps) {
  const { tour, level, place, today, go, goLevel } = useSpace();
  const online = useOnline();
  const [colorsOpen, setColorsOpen] = useState(false);
  const door = useDoorLine(today);
  const slotRef = useRef<HTMLDivElement>(null);
  const onSlotRef = useRef(onSlot);
  onSlotRef.current = onSlot;
  const temp = weather ? Math.round(weather.temperature) : null;
  const phasePill = online ? `${palette.phase}${temp !== null ? ` · ${temp}°` : ""}` : `Offline · ${palette.phase}`;
  const tourHere = tour !== null && tour !== 2 && level === 0 && place === "jetzt";

  // the orb slot: an empty box; its largest square (max 300) is where the circle sits
  useEffect(() => {
    const el = slotRef.current;
    if (!el) return;
    let t = 0;
    const measure = () => {
      const size = Math.max(0, Math.floor(Math.min(el.clientWidth, el.clientHeight, 300)));
      const { left, top } = docOffset(el);
      onSlotRef.current({ size, cx: left + el.clientWidth / 2, cy: top + el.clientHeight / 2 });
    };
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = window.setTimeout(measure, 120);
    });
    ro.observe(el);
    measure();
    return () => (ro.disconnect(), clearTimeout(t));
  }, []);

  // Farben heute opens and closes in 320 ms: tell the circle at once where its slot will
  // be, so it glides along with the content (the measure above confirms once it rests)
  const colorsRef = useRef<HTMLDivElement>(null);
  const colorsWere = useRef(colorsOpen);
  useLayoutEffect(() => {
    if (colorsWere.current === colorsOpen) return;
    colorsWere.current = colorsOpen;
    const el = slotRef.current;
    const panel = colorsRef.current;
    const inner = panel?.firstElementChild as HTMLElement | null;
    if (!el || !panel || !inner) return;
    // (read in one layout: the grid row starts its transition from the old height)
    const delta = (colorsOpen ? inner.scrollHeight : 0) - panel.offsetHeight;
    if (Math.abs(delta) < 1) return;
    const height = Math.max(0, el.clientHeight - delta);
    const { left, top } = docOffset(el);
    onSlotRef.current({ size: Math.max(0, Math.floor(Math.min(el.clientWidth, height, 300))), cx: left + el.clientWidth / 2, cy: top + delta + height / 2 });
  }, [colorsOpen]);

  // The tour's block replaces greeting and focus in one render (step 2 → 3 when Jetzt is back, a new
  // step, the end): the layout is final already, so the circle gets its slot at once and glides
  // straight there, instead of sitting over the new caption until the observer above settles.
  const tourShown = tourHere ? tour : null;
  const tourWas = useRef(tourShown);
  useLayoutEffect(() => {
    if (tourWas.current === tourShown) return;
    tourWas.current = tourShown;
    const el = slotRef.current;
    if (!el) return;
    const { left, top } = docOffset(el);
    onSlotRef.current({ size: Math.max(0, Math.floor(Math.min(el.clientWidth, el.clientHeight, 300))), cx: left + el.clientWidth / 2, cy: top + el.clientHeight / 2 });
  }, [tourShown]);

  // (the slot never captures the pointer: vertical drags scroll, sideways drags page)
  const press = (down: boolean) => () => pressOrb(down);

  return (
    <div className="now">
      <div className="now-top">
        <div className="now-pills">
          <button type="button" className="now-pill now-side" onClick={() => go("du")} aria-label="Zu dir: was ich über dich weiss, Verbindungen, Einstellungen">
            <span className="pill">‹ Du</span>
          </button>
          <button
            type="button"
            className="now-pill now-phase"
            onClick={() => setColorsOpen((o) => !o)}
            aria-expanded={colorsOpen}
            aria-controls="now-colors"
            aria-label={`Farben heute: ${palette.phase}${temp !== null ? `, ${temp} Grad` : ""}`}
          >
            <span className="pill">
              <span className="now-phase-text">{phasePill}</span>
            </span>
          </button>
          <button type="button" className="now-pill now-side" onClick={() => go("ziele")} aria-label="Zu deinen Zielen">
            <span className="pill">Ziele ›</span>
          </button>
        </div>

        <div ref={colorsRef} id="now-colors" className="now-colors" data-open={colorsOpen || undefined} inert={!colorsOpen}>
          <div className="now-colors-inner">
            <span className="now-colors-label">Farben heute</span>
            <span className="now-swatches">
              {palette.colors.map((c, i) => (
                <span key={i} className="swatch" style={{ background: c }} title={palette.names[i]} />
              ))}
            </span>
            <span className="now-names">{palette.names.join(" · ")}</span>
          </div>
        </div>

        <h1 id={NOW_TITLE_ID} tabIndex={-1} className={`now-greeting ${tourHere ? "sr-only" : ""}`}>
          {greeting(palette.isDark)}
          {profile.display_name ? `, ${profile.display_name}` : ""}
        </h1>
        {tourHere ? <TourBlock /> : focus && <p className="now-focus">„{focus}“</p>}
      </div>

      <div
        ref={slotRef}
        className="now-orb"
        aria-hidden="true"
        onPointerDown={press(true)}
        onPointerUp={press(false)}
        onPointerCancel={press(false)}
        onPointerLeave={press(false)}
      />

      <button
        type="button"
        className="now-door"
        onClick={() => goLevel(1, { day: door?.day ?? today, highlight: door?.id })}
        aria-label={door?.aria ?? "Deinen Tag ansehen"}
      >
        {door?.label ? <span className="now-door-label">{door.label}</span> : null}
        <span className={door?.label ? "now-door-text" : "now-door-label"}>{door?.text ?? "Dein Tag"}</span>
        <svg className="now-door-chev" aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}
