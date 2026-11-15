// Jetzt (level 0, §3.1): three pills, the greeting, the focus, the orb slot (the
// fixed OrbLayer draws the circle over it) and the door line to the day.
import { useEffect, useRef, useState } from "react";
import { backend } from "../lib/backend";
import { localMidnightIso, timeHM } from "../lib/dates";
import type { Palette } from "../lib/palette";
import { addDays, dayOf } from "../lib/plan";
import { pressOrb } from "../lib/orbSignals";
import type { Weather } from "../lib/weather";
import type { CalendarEvent, Profile } from "../lib/types";
import { usePlanData } from "./data";
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

export interface DoorLine {
  label: string; // "HEUTE" | "MORGEN" | "" (with "DEIN TAG" as the text)
  text: string; // "17:00 Lauftraining" | "Ganztags: Rennen" | "Nichts mehr geplant" | "Dein Tag"
  aria: string;
  day: string;
  id?: string;
}

const GRACE_MS = 30 * 60 * 1000; // a timed entry counts until 30 min after its start

/**
 * The door line (moved over from UpNext): the next entry today, an all-day entry,
 * after 20:00 tomorrow's first entry, "Nichts mehr geplant", or "Dein Tag" when
 * nothing is planned in the next 8 days.
 */
export function doorLine(events: CalendarEvent[], now: Date): DoorLine {
  const today = dayOf(now);
  const tomorrow = addDays(today, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 8).getTime();
  const start = (e: CalendarEvent) => new Date(e.starts_at).getTime();
  const on = (day: string) => events.filter((e) => dayOf(new Date(e.starts_at)) === day).sort((a, b) => start(a) - start(b));
  const pick = (day: string, timedFrom: number) => {
    const list = on(day);
    return list.find((e) => !e.all_day && start(e) > timedFrom) ?? list.find((e) => e.all_day) ?? null;
  };
  const tell = (e: CalendarEvent, day: string, word: "heute" | "morgen"): DoorLine => ({
    label: word === "heute" ? "Heute" : "Morgen",
    text: e.all_day ? `Ganztags: ${e.title}` : `${timeHM(e.starts_at)} ${e.title}`,
    aria: e.all_day ? `Als Nächstes: ${e.title} ${word}, ganztags. Deinen Tag ansehen` : `Als Nächstes: ${e.title} ${word} um ${timeHM(e.starts_at)}. Deinen Tag ansehen`,
    day,
    id: e.id,
  });

  const next = pick(today, now.getTime() - GRACE_MS);
  if (next) return tell(next, today, "heute");
  if (now.getHours() >= 20) {
    const t = pick(tomorrow, -Infinity);
    if (t) return tell(t, tomorrow, "morgen");
  }
  const later = events.some((e) => (e.all_day ? dayOf(new Date(e.starts_at)) > today : start(e) > now.getTime()) && start(e) < end);
  if (later) return { label: "Heute", text: "Nichts mehr geplant", aria: "Heute ist nichts mehr geplant. Deinen Tag ansehen", day: today };
  return { label: "", text: "Dein Tag", aria: "Deinen Tag ansehen", day: today };
}

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

  // (the slot never captures the pointer: vertical drags scroll, sideways drags page)
  const press = (down: boolean) => () => pressOrb(down);

  return (
    <div className="now">
      <div className="now-top">
        <div className="now-pills">
          <button type="button" className="pill now-pill now-side" onClick={() => go("du")} aria-label="Zu dir: was ich über dich weiss, Verbindungen, Einstellungen">
            ‹ Du
          </button>
          <button
            type="button"
            className="pill now-pill now-phase"
            onClick={() => setColorsOpen((o) => !o)}
            aria-expanded={colorsOpen}
            aria-controls="now-colors"
            aria-label={`Farben heute: ${palette.phase}${temp !== null ? `, ${temp} Grad` : ""}`}
          >
            <span className="now-phase-text">{phasePill}</span>
          </button>
          <button type="button" className="pill now-pill now-side" onClick={() => go("ziele")} aria-label="Zu deinen Zielen">
            Ziele ›
          </button>
        </div>

        <div id="now-colors" className="now-colors" data-open={colorsOpen || undefined} inert={!colorsOpen}>
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
