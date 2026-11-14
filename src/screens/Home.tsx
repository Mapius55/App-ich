import { useEffect, useState } from "react";
import { Orb, type OrbState } from "../components/Orb";
import { Conversation } from "../components/Conversation";
import type { Palette } from "../lib/palette";
import type { Weather } from "../lib/weather";
import type { CoachContext, CoachEvent, Profile } from "../lib/types";

interface Props {
  profile: Profile;
  palette: Palette;
  weather: Weather | null;
  context: () => CoachContext;
  day: string;
  focus: string | null;
  onEvent: (e: CoachEvent) => void;
  onOpenMemories: () => void;
  onSignOut: () => void;
}

// Follows the actual light outside: in December it's "Guten Abend" at 17:00.
function greeting(isDark: boolean, d = new Date()): string {
  const h = d.getHours();
  if (h < 4) return "Gute Nacht";
  if (h < 11) return "Guten Morgen";
  if (h < 14) return "Hoi";
  if (h < 18 && !isDark) return "Schönen Nachmittag";
  return "Guten Abend";
}

export function Home({ profile, palette, weather, context, day, focus, onEvent, onOpenMemories, onSignOut }: Props) {
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [settled, setSettled] = useState(false);
  const [menu, setMenu] = useState(false);

  // The orb greets you alone for a moment, then makes room for the conversation.
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 1400);
    return () => clearTimeout(t);
  }, []);

  const size = Math.round(Math.min(240, window.innerWidth * 0.56));

  return (
    <main className={`screen home ${settled ? "settled" : "intro"}`}>
      <header className="topbar">
        <span className="sky-label">
          {palette.phase}
          {weather && ` · ${Math.round(weather.temperature)}°`}
        </span>
        <div className="menu-wrap">
          <button className="icon-btn ghost" onClick={() => setMenu((m) => !m)} aria-label="Menü" aria-expanded={menu}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="5" cy="12" r="1.2" />
              <circle cx="12" cy="12" r="1.2" />
              <circle cx="19" cy="12" r="1.2" />
            </svg>
          </button>
          {menu && (
            <div className="menu card" role="menu">
              <button role="menuitem" onClick={() => (setMenu(false), onOpenMemories())}>
                Was ich über dich weiss
              </button>
              <button role="menuitem" onClick={() => (setMenu(false), onSignOut())}>
                Abmelden
              </button>
            </div>
          )}
        </div>
      </header>

      <section className="hero">
        <div className="hero-orb" style={{ "--orb": `${size}px` } as React.CSSProperties}>
          <Orb colors={palette.orb} size={size} speed={palette.speed} seed={palette.seed} state={orbState} />
        </div>
        <h1 className="greeting">
          {greeting(palette.isDark)}
          {profile.display_name ? `, ${profile.display_name}` : ""}
        </h1>
        {focus && (
          <p className="focus">
            <span>Heute</span> {focus}
          </p>
        )}
      </section>

      <div className="home-conversation">
        <Conversation mode="checkin" thread={day} context={context} onEvent={onEvent} onOrbState={setOrbState} />
      </div>
    </main>
  );
}
