import { useEffect, useState } from "react";
import { backend } from "../lib/backend";
import { Sphere, type OrbState } from "../components/Sphere";
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

  // Once a day, a little after the greeting, the coach quietly tidies its notes:
  // unimportant or too personal entries it made itself are removed.
  useEffect(() => {
    const key = `ich.tidy.${profile.id}`;
    let last: string | null = null;
    try {
      last = localStorage.getItem(key);
    } catch {
      /* storage unavailable */
    }
    if (last === day) return;
    const t = setTimeout(() => {
      backend
        .tidy(context())
        .then(() => {
          try {
            localStorage.setItem(key, day);
          } catch {
            /* storage unavailable */
          }
        })
        .catch(() => {});
    }, 45 * 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, profile.id]);

  const size = Math.round(Math.min(250, window.innerWidth * 0.6));
  const today = new Intl.DateTimeFormat("de-CH", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  return (
    <main className={`screen home ${settled ? "settled" : "intro"}`}>
      <header className="topbar">
        <div className="topbar-info">
          <span className="eyebrow">{today}</span>
          <span className="eyebrow">
            {palette.phase}
            {weather && ` · ${Math.round(weather.temperature)}°`}
          </span>
        </div>
        <button className="icon-btn" onClick={() => setMenu(true)} aria-label="Menü" aria-expanded={menu}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
            <path d="M4 9h16M8 15h12" />
          </svg>
        </button>
      </header>

      {menu && (
        <div className="menu-sheet" role="dialog" aria-modal="true" aria-label="Menü" onClick={() => setMenu(false)}>
          <div className="menu-inner" onClick={(e) => e.stopPropagation()}>
            <div className="topbar">
              <span className="eyebrow">Menü</span>
              <button className="icon-btn" onClick={() => setMenu(false)} aria-label="Menü schliessen">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <nav>
              <button onClick={() => (setMenu(false), onOpenMemories())}>
                Was ich über dich <em>weiss</em>
              </button>
              <button onClick={() => (setMenu(false), onSignOut())}>Abmelden</button>
            </nav>
          </div>
        </div>
      )}

      <section className="hero">
        <div className="hero-sphere" style={{ "--orb": `${size}px` } as React.CSSProperties}>
          <Sphere colors={palette.orb} size={size} speed={palette.speed} seed={palette.seed} state={orbState} />
        </div>
        <h1 className="display greeting">
          {greeting(palette.isDark)}
          {profile.display_name && (
            <>
              , <em>{profile.display_name}</em>
            </>
          )}
        </h1>
        {focus && (
          <div className="focus">
            <span className="eyebrow">Heute</span>
            <span className="focus-text">{focus}</span>
          </div>
        )}
      </section>

      <div className="home-conversation">
        <Conversation mode="checkin" thread={day} context={context} onEvent={onEvent} onOrbState={setOrbState} />
      </div>
    </main>
  );
}
