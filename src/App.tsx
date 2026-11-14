import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { backend } from "./lib/backend";
import { storeCoords, storedCoords, type Coords } from "./lib/location";
import { localDayKey, type Mood } from "./lib/palette";
import { useSky } from "./lib/useSky";
import type { CoachEvent, Profile } from "./lib/types";
import { Portal } from "./components/Portal";
import { SkyBackground } from "./components/SkyBackground";
import { Login } from "./screens/Login";
import { Onboarding } from "./screens/Onboarding";
import { Home } from "./screens/Home";
import { Memories } from "./screens/Memories";
import { Calendar } from "./screens/Calendar";
import { Settings } from "./screens/Settings";

// Screen changes zoom through the portal (View Transitions API, where the
// browser has it; elsewhere screens simply fade in via CSS).
type VT = { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void> };
let transitionRunning = false;
function withTransition(fn: () => void) {
  const d = document as Document & { startViewTransition?: (cb: () => void) => VT };
  // While one transition plays, further changes just happen inside it.
  if (!d.startViewTransition || transitionRunning || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    fn();
    return;
  }
  transitionRunning = true;
  const vt = d.startViewTransition(() => flushSync(fn));
  const quiet = () => {};
  vt.ready.catch(quiet);
  vt.updateCallbackDone.catch(quiet);
  vt.finished.catch(quiet).finally(() => (transitionRunning = false));
}

export default function App() {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [coords, setCoords] = useState<Coords | null>(() => storedCoords());
  const [mood, setMood] = useState<Mood | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [view, setView] = useState<"home" | "memories" | "calendar" | "settings">("home");
  const [eventsVersion, setEventsVersion] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [day, setDay] = useState(() => localDayKey());

  const { palette, weather, context } = useSky(coords, mood, profile?.nature_palette ?? null);

  // Session: restored automatically, so a returning person skips the login.
  useEffect(() => {
    backend.currentUserId().then(setUserId);
    return backend.onAuthChange((id) => withTransition(() => setUserId(id)));
  }, []);

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      return;
    }
    setLoadError(null);
    backend
      .getProfile()
      .then((p) => {
        withTransition(() => setProfile(p));
        // keep the time zone current, so notifications arrive at your local time
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (p.timezone !== tz) backend.updateProfile({ timezone: tz }).catch(() => {});
        if (!storedCoords() && p.lat != null && p.lon != null) {
          const c = { lat: p.lat, lon: p.lon };
          storeCoords(c);
          setCoords(c);
        }
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [userId]);

  // New day → new conversation thread and fresh mood.
  useEffect(() => {
    const id = setInterval(() => setDay(localDayKey()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!profile?.onboarded) return;
    setMood(null);
    setFocus(null);
    backend.getDay(day).then((d) => {
      if (d) {
        setMood(d.mood);
        setFocus(d.focus);
      }
    });
  }, [day, profile?.onboarded]);

  // Sky colours drive the whole page.
  useEffect(() => {
    const r = document.documentElement.style;
    r.setProperty("--bg-top", palette.bgTop);
    r.setProperty("--bg-bottom", palette.bgBottom);
    r.setProperty("--sky-1", palette.colors[0]);
    r.setProperty("--sky-2", palette.colors[Math.floor(palette.colors.length / 2)]);
    r.setProperty("--text", palette.text);
    r.setProperty("--text-soft", palette.textSoft);
    r.setProperty("--accent", palette.orb[1]);
    document.documentElement.dataset.sky = palette.isDark ? "dark" : "light";
  }, [palette]);

  const onEvent = useCallback((e: CoachEvent) => {
    switch (e.type) {
      case "mood":
        setMood(e.mood);
        break;
      case "focus":
        setFocus(e.focus);
        break;
      case "palette":
        setProfile((p) => (p ? { ...p, nature_palette: e.nature } : p));
        break;
      case "profile":
        setProfile((p) => (p ? { ...p, ...e.profile, onboarded: p.onboarded } : p));
        break;
      case "event_created":
      case "event_updated":
      case "event_deleted":
        setEventsVersion((v) => v + 1);
        break;
    }
  }, []);

  const onCoords = useCallback((c: Coords) => {
    setCoords(c);
    backend.updateProfile({ lat: c.lat, lon: c.lon }).catch(() => {});
  }, []);

  return (
    <>
      <SkyBackground colors={palette.colors} ground={palette.ground} glow={palette.glow} />
      {screen()}
    </>
  );

  function screen() {
  if (userId === undefined || (userId && !profile && !loadError)) {
    return (
      <main className="screen center">
        <Portal colors={palette.orb} daylight={palette.daylight} size={220} speed={palette.speed} seed={palette.seed} state="thinking" interactive={false} />
      </main>
    );
  }

  if (!userId) return <Login palette={palette} />;

  if (loadError || !profile) {
    return (
      <main className="screen center">
        <p className="form-error">{loadError}</p>
        <button className="btn ghost" onClick={() => backend.signOut()}>
          Abmelden
        </button>
      </main>
    );
  }

  if (!profile.onboarded) {
    return (
      <Onboarding
        palette={palette}
        context={context}
        onEvent={onEvent}
        onCoords={onCoords}
        hasCoords={!!coords}
        onDone={() => withTransition(() => setProfile((p) => (p ? { ...p, onboarded: true } : p)))}
      />
    );
  }

  if (view === "memories") return <Memories onBack={() => withTransition(() => setView("home"))} />;
  if (view === "calendar") return <Calendar onBack={() => withTransition(() => (setView("home"), setEventsVersion((v) => v + 1)))} />;
  if (view === "settings")
    return (
      <Settings
        profile={profile}
        hasCoords={!!coords}
        onBack={() => withTransition(() => setView("home"))}
        onProfile={(patch) => setProfile((p) => (p ? { ...p, ...patch } : p))}
        onCoords={(c) => (c ? onCoords(c) : setCoords(null))}
        onOpenCalendar={() => withTransition(() => setView("calendar"))}
      />
    );

  return (
    <Home
      profile={profile}
      palette={palette}
      weather={weather}
      context={context}
      day={day}
      focus={focus}
      onEvent={onEvent}
      onOpenMemories={() => withTransition(() => setView("memories"))}
      onOpenCalendar={() => withTransition(() => setView("calendar"))}
      onOpenSettings={() => withTransition(() => setView("settings"))}
      eventsVersion={eventsVersion}
      onSignOut={() => backend.signOut()}
    />
  );
  }
}
