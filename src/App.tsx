import { useCallback, useEffect, useState } from "react";
import { backend } from "./lib/backend";
import { storeCoords, storedCoords, type Coords } from "./lib/location";
import { localDayKey, type Mood } from "./lib/palette";
import { useSky } from "./lib/useSky";
import type { CoachEvent, Profile } from "./lib/types";
import { Sphere } from "./components/Sphere";
import { BrushBackground } from "./components/BrushBackground";
import { Login } from "./screens/Login";
import { Onboarding } from "./screens/Onboarding";
import { Home } from "./screens/Home";
import { Memories } from "./screens/Memories";

export default function App() {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [coords, setCoords] = useState<Coords | null>(() => storedCoords());
  const [mood, setMood] = useState<Mood | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [view, setView] = useState<"home" | "memories">("home");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [day, setDay] = useState(() => localDayKey());

  const { palette, weather, context } = useSky(coords, mood, profile?.nature_palette ?? null);

  // Session: restored automatically, so a returning person skips the login.
  useEffect(() => {
    backend.currentUserId().then(setUserId);
    return backend.onAuthChange((id) => setUserId(id));
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
        setProfile(p);
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
    r.setProperty("--brush-light", palette.brush[0]);
    r.setProperty("--brush-mid", palette.brush[1]);
    r.setProperty("--brush-shade", palette.brush[2]);
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
    }
  }, []);

  const onCoords = useCallback((c: Coords) => {
    setCoords(c);
    backend.updateProfile({ lat: c.lat, lon: c.lon }).catch(() => {});
  }, []);

  return (
    <>
      <BrushBackground
        colors={{ bgTop: palette.bgTop, bgBottom: palette.bgBottom, light: palette.brush[0], mid: palette.brush[1], shade: palette.brush[2] }}
      />
      {screen()}
    </>
  );

  function screen() {
  if (userId === undefined || (userId && !profile && !loadError)) {
    return (
      <main className="screen center">
        <Sphere colors={palette.orb} size={170} speed={palette.speed} seed={palette.seed} state="thinking" />
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
        onDone={() => setProfile((p) => (p ? { ...p, onboarded: true } : p))}
      />
    );
  }

  if (view === "memories") return <Memories onBack={() => setView("home")} />;

  return (
    <Home
      profile={profile}
      palette={palette}
      weather={weather}
      context={context}
      day={day}
      focus={focus}
      onEvent={onEvent}
      onOpenMemories={() => setView("memories")}
      onSignOut={() => backend.signOut()}
    />
  );
  }
}
