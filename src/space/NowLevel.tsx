// Jetzt (level 0): pills, greeting, focus, the circle, the door line.
// Phase 0: the Portal lives in the orb slot here; the door line is a plain
// "DEIN TAG ⌄" (phase 1 moves UpNext's logic in and the Portal to OrbLayer).
import { useEffect, useState } from "react";
import { FitPortal } from "../components/FitPortal";
import type { OrbState } from "../components/Portal";
import type { Palette } from "../lib/palette";
import type { Weather } from "../lib/weather";
import type { Profile } from "../lib/types";
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

export function NowLevel({ profile, palette, weather, focus, orbState }: { profile: Profile; palette: Palette; weather: Weather | null; focus: string | null; orbState: OrbState }) {
  const { tour, level, today, go, goLevel } = useSpace();
  const online = useOnline();
  const [colorsOpen, setColorsOpen] = useState(false);
  const temp = weather ? Math.round(weather.temperature) : null;
  const phasePill = online ? `${palette.phase}${temp !== null ? ` · ${temp}°` : ""}` : `Offline · ${palette.phase}`;
  const tourHere = tour !== null && tour !== 2 && level === 0;

  return (
    <div className="now">
      <div className="now-pills">
        <button type="button" className="pill now-pill" onClick={() => go("du")} aria-label="Zu dir: was ich über dich weiss, Verbindungen, Einstellungen">
          ‹ Du
        </button>
        <button
          type="button"
          className="pill now-pill now-phase"
          onClick={() => setColorsOpen((o) => !o)}
          aria-expanded={colorsOpen}
          aria-label={`Farben heute: ${palette.phase}${temp !== null ? `, ${temp} Grad` : ""}`}
        >
          {phasePill}
        </button>
        <button type="button" className="pill now-pill" onClick={() => go("ziele")} aria-label="Zu deinen Zielen">
          Ziele ›
        </button>
      </div>

      {colorsOpen && (
        <div className="now-colors">
          <span className="now-swatches">
            {palette.colors.map((c, i) => (
              <span key={i} className="swatch" style={{ background: c }} title={palette.names[i]} />
            ))}
          </span>
          <span className="now-names">{palette.names.join(" · ")}</span>
        </div>
      )}

      <h1 className={`title now-greeting ${tourHere ? "sr-only" : ""}`}>
        {greeting(palette.isDark)}
        {profile.display_name ? `, ${profile.display_name}` : ""}
      </h1>
      {tourHere ? <TourBlock /> : focus && <p className="now-focus">„{focus}“</p>}

      <div className="now-orb">
        <FitPortal colors={palette.orb} daylight={palette.daylight} clouds={palette.clouds} speed={palette.speed} seed={palette.seed} state={orbState} max={300} />
      </div>

      <button type="button" className="now-door" onClick={() => goLevel(1, { day: today })} aria-label="Deinen Tag ansehen">
        <span className="now-door-label">Dein Tag</span>
        <span aria-hidden="true" className="now-door-chev">
          ⌄
        </span>
      </button>
    </div>
  );
}
