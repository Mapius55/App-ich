// The space: one T-shaped place. The time column (Jetzt, Tag, Woche, Jahr) is the
// document scroller; Du and Ziele are fixed layers left and right of Jetzt.
// Phase 0 skeleton: stacked snapped sections, settle → state, hash sync, sides by
// buttons, the docked circle, the dock's left slot, voice mounted once.
// Phase 1 (A) adds the pager, docking, Portal pause, resume, tour nudges.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { backend } from "../lib/backend";
import type { Coords } from "../lib/location";
import type { Palette } from "../lib/palette";
import { daySubline, weekRange } from "../lib/dates";
import type { Weather } from "../lib/weather";
import type { CoachContext, CoachEvent, Profile } from "../lib/types";
import { unlockAudio } from "../lib/voice";
import type { OrbState } from "../components/Portal";
import { VoiceConversation } from "../components/VoiceConversation";
import { DayLevel } from "../time/DayLevel";
import { WeekLevel } from "../time/WeekLevel";
import { YearLevel } from "../time/YearLevel";
import { GoalsPlace } from "../places/GoalsPlace";
import { YouPlace } from "../places/YouPlace";
import * as coachBus from "./coachBus";
import { planData } from "./data";
import { describeView } from "./describeView";
import { DetailHost } from "./DetailHost";
import { DockLeft } from "./Dock";
import { markTourSeen } from "./flags";
import { NowLevel } from "./NowLevel";
import { OrbLayer } from "./OrbLayer";
import { SkipNav } from "./SkipNav";
import { TourCaption } from "./Tour";
import { useLevels } from "./useLevels";
import {
  SpaceContext,
  fromHash,
  stepAnchor,
  toHash,
  type AddKey,
  type CloseVia,
  type Detail,
  type DuSection,
  type Level,
  type Place,
  type SpaceApi,
  type SpaceState,
  type TourStep,
} from "./state";

export interface SpaceProps {
  profile: Profile;
  palette: Palette;
  weather: Weather | null;
  context: () => CoachContext;
  day: string; // today, YYYY-MM-DD (also the conversation thread)
  focus: string | null;
  hasCoords: boolean;
  onEvent: (e: CoachEvent) => void;
  onProfile: (patch: Partial<Profile>) => void;
  onCoords: (c: Coords | null) => void;
  startTour: boolean;
}

export const TITLE_IDS = { tag: "lvl-tag-title", woche: "lvl-woche-title", jahr: "lvl-jahr-title", ziele: "place-ziele-title", du: "place-du-title" } as const;

const FLASH_MS = 1600;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const isTextField = (el: Element | null) =>
  !!el &&
  ((el instanceof HTMLInputElement && !["button", "checkbox", "radio", "range", "submit", "reset", "color", "file"].includes(el.type)) ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLElement && el.isContentEditable));

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

function addKeyOf(s: Pick<SpaceState, "place" | "level">): AddKey | null {
  if (s.place === "ziele") return "ziele";
  if (s.place === "du") return "du";
  return s.level === 1 ? "tag" : s.level === 2 ? "woche" : null;
}

function announcement(s: Pick<SpaceState, "place" | "level" | "anchor" | "today">): string {
  if (s.place === "ziele") return "Ziele";
  if (s.place === "du") return "Du";
  if (s.level === 1) return `Tag, ${daySubline(s.anchor, s.today)}`;
  if (s.level === 2) return `Woche, ${weekRange(s.anchor).replace(/\s?–\s?/, " bis ")}`;
  if (s.level === 3) return `Jahr ${s.anchor.slice(0, 4)}`;
  return "Jetzt";
}

export function Space(props: SpaceProps) {
  const { profile, palette, weather, day: today, focus, hasCoords, onEvent, onProfile, onCoords } = props;

  // A deep link (#tag/…) opens there and never starts the tour.
  const initial = useMemo(() => {
    const h = window.location.hash;
    const s = h ? fromHash(h, today) : null;
    return { s, deepLink: !!s && !(s.place === "jetzt" && s.level === 0) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [place, setPlace] = useState<Place>(initial.s?.place ?? "jetzt");
  const [level, setLevel] = useState<Level>(initial.s?.level ?? 0);
  const [anchor, setAnchorState] = useState(initial.s?.anchor ?? today);
  const [yearGoal, setYearGoalState] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailOrigin, setDetailOrigin] = useState<HTMLElement | null>(null);
  const [duSection, setDuSection] = useState<DuSection | null>(initial.s?.duSection ?? null);
  const [tour, setTourState] = useState<TourStep | null>(() => (props.startTour && !initial.deepLink ? 1 : null));
  const [highlight, setHighlight] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const reduced = useReducedMotion();
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [announce, setAnnounce] = useState("");

  const state: SpaceState = { place, level, anchor, today, yearGoal, detail, detailOrigin, duSection, tour, highlight, typing, reduced };
  const stateRef = useRef(state);
  stateRef.current = state;

  const levels = useLevels({ initial: initial.s?.place === "jetzt" ? initial.s.level : 0, onSettle: setLevel, snap: !typing });

  // ---------- the API (stable functions reading the latest state) ----------

  const closer = useRef<((via: CloseVia) => Promise<boolean>) | null>(null);
  const closing = useRef<Promise<boolean> | null>(null);
  const adds = useRef<Partial<Record<AddKey, () => void>>>({});
  const [addsVersion, setAddsVersion] = useState(0);
  const flashTimer = useRef(0);

  const close = useCallback(async (via: CloseVia = "done"): Promise<boolean> => {
    if (!stateRef.current.detail) return true;
    if (closing.current) return closing.current;
    const run = (async () => {
      let ok = true;
      try {
        ok = closer.current ? await closer.current(via) : true;
      } catch {
        ok = false;
      }
      if (ok) {
        setDetail(null);
        setDetailOrigin(null);
      }
      return ok;
    })();
    closing.current = run;
    try {
      return await run;
    } finally {
      closing.current = null;
    }
  }, []);

  const flash = useCallback((id: string) => {
    setHighlight(id);
    clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setHighlight(null), FLASH_MS);
  }, []);

  const go = useCallback(
    async (p: Place, o?: { highlight?: string; duSection?: DuSection }) => {
      if (stateRef.current.detail && !(await close("nav"))) return;
      setDuSection(p === "du" ? (o?.duSection ?? null) : null);
      const moved = stateRef.current.place !== p;
      setPlace(p);
      if (o?.highlight) flash(o.highlight);
      if (moved) await wait(stateRef.current.reduced ? 0 : 340);
    },
    [close, flash],
  );

  const goLevel = useCallback(
    async (l: Level, o?: { day?: string; highlight?: string; yearGoal?: string | null }) => {
      if (stateRef.current.detail && !(await close("nav"))) return;
      if (o?.day) setAnchorState(o.day);
      if (o && "yearGoal" in o) setYearGoalState(o.yearGoal ?? null);
      if (stateRef.current.place !== "jetzt") {
        setPlace("jetzt");
        setDuSection(null);
        await wait(stateRef.current.reduced ? 0 : 340);
      }
      await levels.scrollToLevel(l, stateRef.current.reduced ? "auto" : "smooth");
      if (o?.highlight) flash(o.highlight);
    },
    [close, flash, levels.scrollToLevel],
  );

  const setAnchor = useCallback((d: string) => setAnchorState(d), []);
  const setYearGoal = useCallback((id: string | null) => setYearGoalState(id), []);
  const open = useCallback((d: Detail, origin?: HTMLElement | null) => {
    setDetail(d);
    setDetailOrigin(origin ?? null);
  }, []);
  const registerCloser = useCallback((fn: ((via: CloseVia) => Promise<boolean>) | null) => {
    closer.current = fn;
  }, []);
  const registerAdd = useCallback((key: AddKey, fn: (() => void) | null) => {
    const had = !!adds.current[key];
    if (fn) adds.current[key] = fn;
    else delete adds.current[key];
    if (had !== !!fn) setAddsVersion((v) => v + 1);
  }, []);
  const ask = useCallback((text: string) => {
    unlockAudio().catch(() => {});
    coachBus.ask(text);
  }, []);
  const setTour = useCallback((step: TourStep | null) => {
    if (step === null && stateRef.current.tour !== null) markTourSeen();
    setTourState(step);
  }, []);
  const startTour = useCallback(async () => {
    await go("jetzt");
    await goLevel(0);
    setTourState(1);
  }, [go, goLevel]);

  const api: SpaceApi = useMemo(
    () => ({ ...state, go, goLevel, setAnchor, setYearGoal, open, close, registerCloser, flash, registerAdd, ask, startTour, setTour }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [place, level, anchor, today, yearGoal, detail, detailOrigin, duSection, tour, highlight, typing, reduced],
  );

  // ---------- global behaviour ----------

  // a tour requested later (e.g. after onboarding while mounted)
  useEffect(() => {
    if (props.startTour && !initial.deepLink) setTourState((t) => t ?? 1);
  }, [props.startTour, initial.deepLink]);

  // html data attributes: the test contract and the CSS hooks (the class before the first scroll)
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add("space-on");
    return () => {
      root.classList.remove("space-on");
      for (const k of ["place", "level", "detail", "typing", "tour"]) delete root.dataset[k];
    };
  }, []);
  useEffect(() => {
    const d = document.documentElement.dataset;
    d.place = place;
    d.level = String(level);
    if (detail) d.detail = detail.kind;
    else delete d.detail;
    if (typing) d.typing = "true";
    else delete d.typing;
    if (tour) d.tour = String(tour);
    else delete d.tour;
  }, [place, level, detail, typing, tour]);

  // hash (replaceState only) and the polite announcement after every settle
  useEffect(() => {
    const hash = toHash({ place, level, anchor, duSection });
    if (hash !== window.location.hash) history.replaceState(history.state, "", `${window.location.pathname}${window.location.search}${hash}`);
  }, [place, level, anchor, duSection]);
  useEffect(() => {
    setAnnounce(announcement({ place, level, anchor, today }));
    // only on settle (place / level), not on every anchor step
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place, level]);

  // after 1 s settled at Jetzt, the anchor returns to today and the year filter goes
  useEffect(() => {
    if (place !== "jetzt" || level !== 0 || detail) return;
    const t = setTimeout(() => {
      setAnchorState(today);
      setYearGoalState(null);
    }, 1000);
    return () => clearTimeout(t);
  }, [place, level, detail, today]);

  // typing: snap off while a text field has focus; on blur back to the level's top
  useEffect(() => {
    const update = () => setTyping(isTextField(document.activeElement));
    const onOut = () => setTimeout(update, 0);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", onOut);
    };
  }, []);
  const wasTyping = useRef(false);
  useEffect(() => {
    if (wasTyping.current && !typing && stateRef.current.place === "jetzt") levels.scrollToLevel(stateRef.current.level, "auto");
    wasTyping.current = typing;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typing]);

  // keyboard map (§8.3), only outside text fields; components that consume a key
  // listen on document and call preventDefault(), so this window listener skips it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTextField(document.activeElement)) return;
      const s = stateRef.current;
      const handled = () => e.preventDefault();
      if (s.detail) {
        if (e.key === "Escape") (handled(), close("escape"));
        return;
      }
      switch (e.key) {
        case "Escape":
          handled();
          if (s.tour) setTour(null);
          else if (s.place !== "jetzt") go("jetzt");
          else if (s.level > 0) goLevel(0);
          break;
        case "ArrowDown":
        case "PageDown":
          if (s.place === "jetzt") (handled(), goLevel(Math.min(3, s.level + 1) as Level));
          break;
        case "ArrowUp":
        case "PageUp":
          if (s.place === "jetzt") (handled(), goLevel(Math.max(0, s.level - 1) as Level));
          break;
        case "Home":
          handled();
          go("jetzt").then(() => goLevel(0));
          break;
        case "End":
          handled();
          goLevel(3);
          break;
        case "ArrowRight":
        case "ArrowLeft": {
          const dir = e.key === "ArrowRight" ? 1 : -1;
          handled();
          if (s.place !== "jetzt") {
            if ((s.place === "du" && dir === 1) || (s.place === "ziele" && dir === -1)) go("jetzt");
          } else if (s.level === 0) go(dir === 1 ? "ziele" : "du");
          else setAnchorState(stepAnchor(s.anchor, s.level, dir));
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, go, goLevel, setTour]);

  // "Mit dem Coach planen" etc.: coachBus → the conversation's kickoff, one at a time
  // (phase 1 replaces this bridge with VoiceConversation's own coachBus subscription)
  const [kickoff, setKickoff] = useState<string | null>(null);
  const kickoffRef = useRef<string | null>(null);
  const asks = useRef<string[]>([]);
  const pump = useCallback(() => {
    if (kickoffRef.current !== null || !asks.current.length) return;
    kickoffRef.current = asks.current.shift()!;
    setKickoff(kickoffRef.current);
  }, []);
  useEffect(
    () =>
      coachBus.onAsk((text) => {
        asks.current.push(text);
        pump();
      }),
    [pump],
  );
  const onKickoffSent = useCallback(() => {
    kickoffRef.current = null;
    setKickoff(null);
  }, []);
  // the next ask goes out only after a render with no kickoff (the conversation re-arms on null)
  useEffect(() => {
    if (kickoff === null) pump();
  }, [kickoff, pump]);

  // the coach sees where the person is
  const contextRef = useRef(props.context);
  contextRef.current = props.context;
  const context = useCallback((): CoachContext => {
    const goals = planData.get().goals;
    const view = describeView(stateRef.current, (id) => goals?.find((g) => g.id === id)?.title ?? null);
    return { ...contextRef.current(), view };
  }, []);

  // once a day, a little after the greeting, the coach quietly tidies its notes
  useEffect(() => {
    const key = `ich.tidy.${profile.id}`;
    let last: string | null = null;
    try {
      last = localStorage.getItem(key);
    } catch {
      /* storage unavailable */
    }
    if (last === today) return;
    const t = setTimeout(() => {
      backend
        .tidy(contextRef.current())
        .then(() => {
          try {
            localStorage.setItem(key, today);
          } catch {
            /* storage unavailable */
          }
        })
        .catch(() => {});
    }, 45 * 1000);
    return () => clearTimeout(t);
  }, [today, profile.id]);

  const addKey = addKeyOf(state);
  void addsVersion; // re-render when a handler (dis)appears
  const onAdd = addKey ? (adds.current[addKey] ?? null) : null;
  const sideShown = place !== "jetzt";
  const atLevel = (l: Level) => place === "jetzt" && level === l;

  const onSkip = (p: Place, l?: Level) => {
    if (p !== "jetzt") go(p);
    else go("jetzt").then(() => goLevel(l ?? 0));
  };

  return (
    <SpaceContext.Provider value={api}>
      <SkipNav onGo={onSkip} />
      <div className="space" inert={!!detail}>
        <OrbLayer />
        <main className="time" inert={sideShown} aria-hidden={sideShown || undefined}>
          <section ref={levels.sectionRef(0)} className="lvl" data-level={0} aria-current={atLevel(0) || undefined} aria-label="Jetzt">
            <div className="lvl-inner">
              <NowLevel profile={profile} palette={palette} weather={weather} focus={focus} orbState={orbState} />
            </div>
          </section>
          <section ref={levels.sectionRef(1)} className="lvl" data-level={1} aria-current={atLevel(1) || undefined} aria-labelledby={TITLE_IDS.tag}>
            <div className="lvl-inner">
              <DayLevel titleId={TITLE_IDS.tag} active={atLevel(1)} weather={weather} />
            </div>
          </section>
          <section ref={levels.sectionRef(2)} className="lvl" data-level={2} aria-current={atLevel(2) || undefined} aria-labelledby={TITLE_IDS.woche}>
            <div className="lvl-inner">{levels.mounted.week && <WeekLevel titleId={TITLE_IDS.woche} active={atLevel(2)} />}</div>
          </section>
          <section ref={levels.sectionRef(3)} className="lvl" data-level={3} aria-current={atLevel(3) || undefined} aria-labelledby={TITLE_IDS.jahr}>
            <div className="lvl-inner">{levels.mounted.year && <YearLevel titleId={TITLE_IDS.jahr} active={atLevel(3)} />}</div>
          </section>
        </main>
        <section id="du" className="side" role="region" aria-labelledby={TITLE_IDS.du} inert={place !== "du"} data-shown={place === "du" || undefined}>
          <div className="side-inner">
            <YouPlace titleId={TITLE_IDS.du} active={place === "du"} profile={profile} palette={palette} hasCoords={hasCoords} onProfile={onProfile} onCoords={onCoords} />
          </div>
        </section>
        <section id="ziele" className="side" role="region" aria-labelledby={TITLE_IDS.ziele} inert={place !== "ziele"} data-shown={place === "ziele" || undefined}>
          <div className="side-inner">
            <GoalsPlace titleId={TITLE_IDS.ziele} active={place === "ziele"} />
          </div>
        </section>
      </div>
      <div className="detail-root">
        <DetailHost />
      </div>
      <div className="voice-layer" data-compact={place !== "jetzt" || level > 0 || undefined}>
        <VoiceConversation
          mode="checkin"
          thread={today}
          context={context}
          onEvent={onEvent}
          onOrbState={setOrbState}
          leftButton={<DockLeft detailOpen={!!detail} addKey={addKey} onAdd={onAdd} onDone={() => close("done")} />}
          kickoff={kickoff}
          onKickoffSent={onKickoffSent}
        />
      </div>
      <TourCaption />
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
    </SpaceContext.Provider>
  );
}
