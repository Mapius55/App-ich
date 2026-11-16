import { useCallback, useEffect, useRef, useState } from "react";
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
import { Plan } from "./screens/Plan";
import { Settings } from "./screens/Settings";
import { Space } from "./space/Space";
import { spaceEnabled, tourSeen } from "./space/flags";
import { planData, resetPlanData } from "./space/data";
import { markFresh } from "./space/fresh";
import { resubscribePushIfNeeded, signOutDevice } from "./lib/push";
import { authChange, skipScreenTransition, withTransition } from "./lib/screenTransition";

export default function App() {
  // the new navigation ("space") is the default; ?space=0 (or «Alte Ansicht öffnen») keeps the old one
  const space = spaceEnabled();
  // the short tour: once per device, the first time the space opens (incl. right after onboarding)
  const [startTour] = useState(() => space && !tourSeen());
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const userIdRef = useRef<string | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [coords, setCoords] = useState<Coords | null>(() => storedCoords());
  const [mood, setMood] = useState<Mood | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [view, setView] = useState<"home" | "memories" | "plan" | "settings">("home");
  const [eventsVersion, setEventsVersion] = useState(0);
  const [planVersion, setPlanVersion] = useState(0);
  // A message the coach conversation sends by itself once Home is open
  // ("Tag mit dem Coach planen"); cleared as soon as it went out.
  const [kickoff, setKickoff] = useState<string | null>(null);
  const [planFromSettings, setPlanFromSettings] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [day, setDay] = useState(() => localDayKey());

  const { palette, weather, context } = useSky(coords, mood, profile?.nature_palette ?? null);

  // Session: restored automatically, so a returning person skips the login. Only a real sign-in or
  // sign-out zooms: supabase-js repeats the same person's session at start, on every return to the
  // app and at each token refresh, and a whole-page transition then would cut the first swipe short.
  useEffect(() => {
    const applyUserId = (id: string | null) => {
      userIdRef.current = id;
      setUserId(id);
    };
    backend.currentUserId().then(applyUserId);
    return backend.onAuthChange((id) => {
      const how = authChange(userIdRef.current, id);
      if (how === "none") return;
      if (how === "plain") applyUserId(id);
      else withTransition(() => applyUserId(id));
    });
  }, []);

  useEffect(() => {
    resetPlanData();
    if (!userId) {
      setProfile(null);
      return;
    }
    setLoadError(null);
    backend
      .getProfile()
      .then((p) => {
        // the space opens by itself (its circle and levels are the motion), never inside a whole-page
        // snapshot; a Login → loading transition still running ends here
        if (space && p.onboarded) {
          skipScreenTransition();
          setProfile(p);
        } else withTransition(() => setProfile(p));
        // keep the time zone current, so notifications arrive at your local time
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (p.timezone !== tz) backend.updateProfile({ timezone: tz }).catch(() => {});
        // after the move to a new address the new service worker has no push subscription: renew it silently
        void resubscribePushIfNeeded(p);
        if (!storedCoords() && p.lat != null && p.lon != null) {
          const c = { lat: p.lat, lon: p.lon };
          storeCoords(c);
          setCoords(c);
        }
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    r.setProperty("--orb-0", palette.orb[0]);
    r.setProperty("--orb-1", palette.orb[1]);
    r.setProperty("--orb-2", palette.orb[2]);
    r.setProperty("--orb-4", palette.orb[4] ?? palette.orb[2]);
    document.documentElement.dataset.sky = palette.isDark ? "dark" : "light";
  }, [palette]);

  const onEvent = useCallback((e: CoachEvent) => {
    if (space) spaceOnEvent(e);
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
      case "goal_saved":
      case "goal_deleted":
      case "time_logged":
      case "habit_saved":
      case "habit_logged":
        setPlanVersion((v) => v + 1);
        break;
    }
  }, [space]);

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
        <Portal colors={palette.orb} daylight={palette.daylight} clouds={palette.clouds} size={220} speed={palette.speed} seed={palette.seed} state="thinking" interactive={false} />
      </main>
    );
  }

  if (!userId) return <Login palette={palette} />;

  if (loadError || !profile) {
    return (
      <main className="screen center">
        <p className="form-error">{loadError}</p>
        <button className="btn ghost" onClick={() => void signOutDevice()}>
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
        onDone={() => {
          const done = () => setProfile((p) => (p ? { ...p, onboarded: true } : p));
          // into the space at once: the tour's first step asks for a swipe up
          if (space) {
            skipScreenTransition();
            done();
          } else withTransition(done);
        }}
      />
    );
  }

  if (space)
    return (
      <Space
        profile={profile}
        palette={palette}
        weather={weather}
        context={context}
        day={day}
        focus={focus}
        hasCoords={!!coords}
        onEvent={onEvent}
        onProfile={(patch) => setProfile((p) => (p ? { ...p, ...patch } : p))}
        onCoords={(c) => (c ? onCoords(c) : setCoords(null))}
        startTour={startTour}
      />
    );

  if (view === "memories") return <Memories onBack={() => withTransition(() => setView("home"))} />;
  if (view === "plan")
    return (
      <Plan
        eventsVersion={eventsVersion}
        planVersion={planVersion}
        showConnect={planFromSettings}
        onBack={() => withTransition(() => (setView(planFromSettings ? "settings" : "home"), setEventsVersion((v) => v + 1)))}
        onPlanDay={() => withTransition(() => (setKickoff("Lass uns meinen Tag planen."), setView("home"), setEventsVersion((v) => v + 1)))}
      />
    );
  if (view === "settings")
    return (
      <Settings
        profile={profile}
        hasCoords={!!coords}
        onBack={() => withTransition(() => setView("home"))}
        onProfile={(patch) => setProfile((p) => (p ? { ...p, ...patch } : p))}
        onCoords={(c) => (c ? onCoords(c) : setCoords(null))}
        onOpenCalendar={() => withTransition(() => (setPlanFromSettings(true), setView("plan")))}
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
      onOpenMemories={() => withTransition(() => (setKickoff(null), setView("memories")))}
      onOpenPlan={() => withTransition(() => (setKickoff(null), setPlanFromSettings(false), setView("plan")))}
      onOpenSettings={() => withTransition(() => (setKickoff(null), setView("settings")))}
      kickoff={kickoff}
      onKickoffSent={() => setKickoff(null)}
      eventsVersion={eventsVersion}
      onSignOut={() => void signOutDevice()}
    />
  );
  }
}

// Coach changes in the space: the shared plan data reloads, and the touched item glows "neu".
function spaceOnEvent(e: CoachEvent) {
  switch (e.type) {
    case "event_created":
    case "event_updated":
      markFresh(e.event.id);
      planData.bumpEvents();
      break;
    case "event_deleted":
      planData.bumpEvents();
      break;
    case "goal_saved":
      markFresh(e.goal.id);
      planData.bumpPlan();
      break;
    case "time_logged":
      markFresh(e.goal_id);
      planData.bumpPlan();
      break;
    case "habit_saved":
      markFresh(e.habit.id);
      planData.bumpPlan();
      break;
    case "habit_logged":
      markFresh(e.habit_id);
      planData.bumpPlan();
      break;
    case "goal_deleted":
      planData.bumpPlan();
      break;
  }
}
