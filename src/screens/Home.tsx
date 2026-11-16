import { useEffect, useState } from "react";
import { backend } from "../lib/backend";
import { type OrbState } from "../components/Portal";
import { FitPortal } from "../components/FitPortal";
import { VoiceConversation } from "../components/VoiceConversation";
import * as coachBus from "../space/coachBus";
import { UpNext } from "../components/UpNext";
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
  onOpenPlan: () => void;
  onOpenSettings: () => void;
  /** a message the conversation sends by itself once it's ready (e.g. from "Tag mit dem Coach planen") */
  kickoff?: string | null;
  onKickoffSent?: () => void;
  eventsVersion: number;
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

export function Home({
  profile,
  palette,
  weather,
  context,
  day,
  focus,
  onEvent,
  onOpenMemories,
  onOpenPlan,
  onOpenSettings,
  kickoff,
  onKickoffSent,
  eventsVersion,
  onSignOut,
}: Props) {
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [menu, setMenu] = useState(false);
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

  const today = new Intl.DateTimeFormat("de-CH", { weekday: "short", day: "numeric", month: "short" }).format(new Date());

  const menuButton = (
    <button type="button" className="dock-round" onClick={() => setMenu(true)} aria-label="Menü" aria-expanded={menu}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M5 9h14M5 15h9" />
      </svg>
    </button>
  );

  return (
    <main className="screen home voice-screen">
      <header className="topbar">
        <span className="pill">{today}</span>
        {!online && <span className="pill">Offline</span>}
        <span className="pill">
          {palette.phase}
          {weather && ` · ${Math.round(weather.temperature)}°`}
        </span>
      </header>

      {menu && (
        <div className="menu-sheet" role="dialog" aria-modal="true" aria-label="Menü" onClick={() => setMenu(false)}>
          <div className="menu-inner" onClick={(e) => e.stopPropagation()}>
            <div className="topbar">
              <span className="pill">Menü</span>
              <button className="dock-round" onClick={() => setMenu(false)} aria-label="Menü schliessen">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <nav>
              <button onClick={() => (setMenu(false), onOpenPlan())}>Plan</button>
              <button onClick={() => (setMenu(false), onOpenMemories())}>Was ich über dich weiss</button>
              <button onClick={() => (setMenu(false), onOpenSettings())}>Einstellungen</button>
              <button onClick={() => (setMenu(false), onSignOut())}>Abmelden</button>
            </nav>
            <p className="menu-colors">
              <span className="pill">Farben heute</span>
              <span className="menu-swatches">
                {palette.colors.map((c, i) => (
                  <span key={i} className="swatch" style={{ background: c }} title={palette.names[i]} />
                ))}
              </span>
              <span className="menu-names">{palette.names.join(" · ")}</span>
            </p>
          </div>
        </div>
      )}

      <section className="voice-hero">
        <h1 className="title greeting">
          {greeting(palette.isDark)}
          {profile.display_name ? `, ${profile.display_name}` : ""}
        </h1>
        {focus && <p className="focus-quote">„{focus}“</p>}
        <UpNext refresh={eventsVersion} />
      </section>

      {/* The portal fills the free space: the conversation is voice only. */}
      <FitPortal colors={palette.orb} daylight={palette.daylight} clouds={palette.clouds} speed={palette.speed} seed={palette.seed} state={orbState} onTap={coachBus.hear} />

      <VoiceConversation
        mode="checkin"
        thread={day}
        context={context}
        onEvent={onEvent}
        onOrbState={setOrbState}
        leftButton={menuButton}
        kickoff={kickoff}
        onKickoffSent={onKickoffSent}
      />
    </main>
  );
}
