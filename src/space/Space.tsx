// The space: one T-shaped place. The time column (Jetzt, Tag, Woche, Jahr) is the
// document scroller; Du and Ziele are fixed layers left and right of Jetzt, moved by
// one custom pointer pager that is live only at Jetzt (and on the sides). The circle
// lives in a fixed layer and docks at the top as you leave Jetzt.
//
// Per frame nothing goes through React: one scroll listener (useLevels) and the pager
// write transform/opacity to at most four elements (orb, the two sections in view or
// the two moving layers, Jetzt's content). React state changes only on settle.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { backend } from "../lib/backend";
import type { Coords } from "../lib/location";
import type { Palette } from "../lib/palette";
import { daySubline, weekRange } from "../lib/dates";
import { weekStart } from "../lib/plan";
import { pressOrb } from "../lib/orbSignals";
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
import { markTourSeen, tourSeen } from "./flags";
import { CANCEL_MS, RESUME_KEEP_MS, pagerEnabled } from "./gestures";
import { NOW_TITLE_ID, NowLevel } from "./NowLevel";
import { OrbLayer, type OrbApi, type OrbSlot } from "./OrbLayer";
import { SkipNav } from "./SkipNav";
import { easeOut, settleMs } from "./swipeMath";
import { TourCaption } from "./Tour";
import { useKeyboardInset } from "./useKeyboardInset";
import { useLevels } from "./useLevels";
import { useSwipeX } from "./useSwipeX";
import {
  SpaceContext,
  fromHash,
  showsTarget,
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
  type Target,
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
const GO_MS = 420; // a pill / key / button move between places (--t-normal)
const WILL_CHANGE_KEEP = 300;
const POS: Record<Place, -1 | 0 | 1> = { du: -1, jetzt: 0, ziele: 1 };
const PLACE_AT: Record<-1 | 0 | 1, Place> = { [-1]: "du", 0: "jetzt", 1: "ziele" };

const isTextField = (el: Element | null) =>
  !!el &&
  ((el instanceof HTMLInputElement && !["button", "checkbox", "radio", "range", "submit", "reset", "color", "file"].includes(el.type)) ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLElement && el.isContentEditable));
// the page width, cached (read on resize, never per frame)
let pageW = 0;
const pageWidth = () => pageW || (pageW = document.documentElement.clientWidth || window.innerWidth);
if (typeof window !== "undefined") window.addEventListener("resize", () => (pageW = 0));
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

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

/** the heading programmatic and keyboard navigation moves focus to */
function headingOf(s: Pick<SpaceState, "place" | "level">): HTMLElement | null {
  const id =
    s.place === "ziele" ? TITLE_IDS.ziele : s.place === "du" ? TITLE_IDS.du : s.level === 1 ? TITLE_IDS.tag : s.level === 2 ? TITLE_IDS.woche : s.level === 3 ? TITLE_IDS.jahr : NOW_TITLE_ID;
  return document.getElementById(id);
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
  const [level, setLevel] = useState<Level>(initial.s?.place === "jetzt" ? initial.s.level : 0);
  const [anchor, setAnchorState] = useState(initial.s?.anchor ?? today);
  const [yearGoal, setYearGoalState] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailOrigin, setDetailOrigin] = useState<HTMLElement | null>(null);
  const [duSection, setDuSection] = useState<DuSection | null>(initial.s?.duSection ?? null);
  // the row open in Du, as Du reports it (by hand too): the hash follows it
  const [duOpen, setDuOpenState] = useState<DuSection | null>(initial.s?.duSection ?? null);
  // (tourSeen() again: App decides once per page load, and the tour may have ended since, e.g. before a re-login)
  const [tour, setTourState] = useState<TourStep | null>(() => (props.startTour && !tourSeen() && !initial.deepLink ? 1 : null));
  const [highlight, setHighlight] = useState<string | null>(null);
  const [typing, setTyping] = useState<false | "detail" | "field">(false);
  const reduced = useReducedMotion();
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [voiceActive, setVoiceActive] = useState(false);
  const [typedOpen, setTypedOpen] = useState(false); // the dock's typed field is open
  const [announce, setAnnounce] = useState("");
  const [slot, setSlot] = useState<OrbSlot | null>(null);

  const state: SpaceState = { place, level, anchor, today, yearGoal, detail, detailOrigin, duSection, tour, highlight, typing: !!typing, reduced };
  const stateRef = useRef(state);
  stateRef.current = state;

  useKeyboardInset();

  // ---------- motion: progress p (vertical), pager offset x (horizontal) ----------

  const orbApi = useRef<OrbApi | null>(null);
  const spaceRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLElement>(null);
  const duRef = useRef<HTMLElement>(null);
  const zieleRef = useRef<HTMLElement>(null);
  const inners = useRef<(HTMLDivElement | null)[]>([null, null, null, null]);
  const innerRefs = useRef([0, 1, 2, 3].map((k) => (el: HTMLDivElement | null) => void (inners.current[k] = el)));
  const motion = useRef({ p: initial.s?.place === "jetzt" ? (initial.s.level as number) : 0, x: -POS[initial.s?.place ?? "jetzt"] * pageWidth(), pagerStyled: false, anim: 0, dragBase: 0 });
  const lastLevelCss = useRef<string[]>(["", "", "", ""]);
  // a programmatic move in flight (the 1 s anchor reset at Jetzt must not fire half way;
  // the hidden time column may scroll while a side is shown)
  const navigating = useRef(0);
  const lastPagerCss = useRef<string[]>(["", "", ""]);
  const willChangeTimer = useRef(0);

  // depth cue (D24) and Jetzt's fade/lift: one write per section, only when it changes
  const paintLevels = useCallback((p: number, d: number) => {
    const red = stateRef.current.reduced;
    for (let k = 0; k < 4; k++) {
      const el = inners.current[k];
      if (!el) continue;
      const t = p - k;
      let scale = 1;
      let op = 1;
      let lift = 0;
      if (!red && Math.abs(t) < 1) {
        if (t > 0) {
          scale = 1 - 0.04 * t; // leaving: 1 → 0.96, → 0.35
          op = 1 - 0.65 * t;
        } else if (t < 0) {
          scale = 1 - 0.03 * t; // arriving: 1.03 → 1, 0.35 → 1
          op = 1 + 0.65 * t;
        }
      }
      if (k === 0) {
        op = Math.min(op, Math.max(0, 1 - 2 * d)); // Jetzt's content: 1 − 2d
        if (!red) lift = -12 * Math.min(1, 2 * d);
      }
      const tf = scale !== 1 || lift !== 0 ? `translate3d(0,${lift.toFixed(2)}px,0) scale(${scale.toFixed(4)})` : "";
      const o = op !== 1 ? op.toFixed(3) : "";
      const css = `${tf}|${o}`;
      if (css === lastLevelCss.current[k]) continue;
      lastLevelCss.current[k] = css;
      el.style.transform = tf;
      el.style.opacity = o;
    }
  }, []);

  // the pager's two moving layers (the time column and the side coming in)
  const paintPager = useCallback((x: number) => {
    const W = pageWidth();
    const css = [`translate3d(${x.toFixed(2)}px,0,0)`, x < 0 ? `translate3d(${(W + x).toFixed(2)}px,0,0)` : "", x > 0 ? `translate3d(${(x - W).toFixed(2)}px,0,0)` : ""];
    const els = [timeRef.current, zieleRef.current, duRef.current];
    css.forEach((c, i) => {
      if (c === lastPagerCss.current[i] || !els[i]) return;
      lastPagerCss.current[i] = c;
      els[i]!.style.transform = c;
    });
    motion.current.pagerStyled = true;
  }, []);

  const paint = useCallback(() => {
    const m = motion.current;
    const q = Math.min(1, Math.abs(m.x) / pageWidth());
    const d = Math.min(1, Math.max(m.p, q));
    orbApi.current?.dock(d);
    paintLevels(m.p, d);
  }, [paintLevels]);

  // will-change only while scrolling or dragging, removed 300 ms after settle
  const setMoving = useCallback((on: boolean) => {
    clearTimeout(willChangeTimer.current);
    const root = spaceRef.current;
    if (!root) return;
    if (on) root.classList.add("is-moving");
    else willChangeTimer.current = window.setTimeout(() => root.classList.remove("is-moving"), WILL_CHANGE_KEEP);
    orbApi.current?.moving(on);
  }, []);

  const levels = useLevels({
    initial: initial.s?.place === "jetzt" ? initial.s.level : 0,
    onSettle: setLevel,
    onFrame: (p) => {
      motion.current.p = p;
      paint();
    },
    onMotion: setMoving,
    snap: !typing,
    // on a side the time column is hidden: a drag that chains to the document (e.g. from a
    // toast in the fixed voice layer) must not move it (only programmatic moves may)
    // (while a field has focus the browser may scroll to show it: the column waits, and goes
    // back once the field lets go, below)
    hold: () => {
      const s = stateRef.current;
      return s.place !== "jetzt" && !navigating.current && !motion.current.anim ? { level: s.level, snap: !s.typing } : null;
    },
  });

  // the pager offset of a settled place
  const baseX = (p: Place) => -POS[p] * pageWidth();

  // animate the pager to x (eased), painting every frame; 0 ms = jump
  const animatePager = useCallback(
    (to: number, ms: number) =>
      new Promise<void>((resolve) => {
        const m = motion.current;
        cancelAnimationFrame(m.anim);
        const from = m.x;
        if (ms <= 0 || Math.abs(to - from) < 0.5) {
          m.x = to;
          paintPager(to);
          paint();
          resolve();
          return;
        }
        setMoving(true);
        const t0 = performance.now();
        const step = (now: number) => {
          const k = Math.min(1, (now - t0) / ms);
          m.x = from + (to - from) * easeOut(k);
          paintPager(m.x);
          paint();
          if (k < 1) m.anim = requestAnimationFrame(step);
          else {
            m.anim = 0;
            resolve();
          }
        };
        m.anim = requestAnimationFrame(step);
      }),
    [paint, paintPager, setMoving],
  );

  // a settled place: CSS (.space[data-place]) holds the layers again
  const releasePager = useCallback(
    (p: Place) => {
      const m = motion.current;
      if (m.anim) return;
      m.x = baseX(p);
      if (m.pagerStyled) {
        for (const el of [timeRef.current, zieleRef.current, duRef.current]) if (el) el.style.transform = "";
        lastPagerCss.current = ["", "", ""];
        m.pagerStyled = false;
      }
      paint();
      setMoving(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paint, setMoving],
  );
  // (in a layout effect, so the new data-place and the cleared inline styles paint together)
  useLayoutEffect(() => releasePager(place), [place, releasePager]);

  // a new width (rotation): the settled pager offset follows
  useEffect(() => {
    const on = () => {
      if (motion.current.anim || motion.current.pagerStyled) return;
      motion.current.x = baseX(stateRef.current.place);
      paint();
    };
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint]);

  // first paint: the circle and the levels where the (deep-linked) state puts them
  useLayoutEffect(() => {
    motion.current.x = baseX(stateRef.current.place);
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // after programmatic or keyboard navigation: focus the new heading (or the flashed row)
  const focusAfterNav = useCallback(async (to: Pick<SpaceState, "place" | "level">, flashed?: string) => {
    if (stateRef.current.tour || stateRef.current.detail) return;
    await nextFrame();
    await nextFrame();
    const s = stateRef.current;
    if (s.place !== to.place || (to.place === "jetzt" && s.level !== to.level)) return; // moved on meanwhile
    if (flashed) {
      const hit = document.querySelector<HTMLElement>(".space .lvl[aria-current] .is-flash, .space .side[data-shown] .is-flash");
      const target = hit && (hit.matches("button, [tabindex], a[href]") ? hit : hit.querySelector<HTMLElement>("button, [tabindex], a[href]"));
      if (target) return target.focus({ preventScroll: true });
    }
    headingOf(to)?.focus({ preventScroll: true });
  }, []);

  // move the pager to a place and settle there
  const pagerTo = useCallback(
    async (p: Place, ms: number) => {
      // arriving on a side: its title rises 8 px, 60 ms behind the layer
      const side = p === "ziele" ? zieleRef.current : p === "du" ? duRef.current : null;
      if (side && stateRef.current.place !== p && !stateRef.current.reduced)
        side.querySelector("h2")?.animate([{ transform: "translate3d(0,8px,0)", opacity: 0.4 }, { transform: "none", opacity: 1 }], { duration: Math.max(ms, 240), delay: 60, easing: "cubic-bezier(.2,.75,.2,1)", fill: "backwards" });
      await animatePager(baseX(p), stateRef.current.reduced ? 0 : ms);
      if (stateRef.current.place === p) releasePager(p);
      else setPlace(p);
      await nextFrame();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [animatePager, releasePager],
  );

  const go = useCallback(
    async (p: Place, o?: { highlight?: string; duSection?: DuSection }) => {
      if (stateRef.current.detail && !(await close("nav"))) return;
      if (p === "du") {
        setDuSection(o?.duSection ?? null);
        if (o?.duSection) setDuOpenState(o.duSection);
      } else setDuSection(null);
      if (stateRef.current.place !== p || motion.current.x !== baseX(p)) await pagerTo(p, GO_MS);
      if (o?.highlight) flash(o.highlight);
      focusAfterNav({ place: p, level: stateRef.current.level }, o?.highlight);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [close, flash, pagerTo, focusAfterNav],
  );

  const goLevel = useCallback(
    async (l: Level, o?: { day?: string; highlight?: string; yearGoal?: string | null }) => {
      if (stateRef.current.detail && !(await close("nav"))) return;
      navigating.current++;
      try {
        if (o?.day) setAnchorState(o.day);
        if (o && "yearGoal" in o) setYearGoalState(o.yearGoal ?? null);
        if (stateRef.current.place !== "jetzt") {
          setDuSection(null);
          await pagerTo("jetzt", GO_MS);
        }
        await levels.scrollToLevel(l, stateRef.current.reduced ? "auto" : "smooth");
      } finally {
        navigating.current--;
      }
      if (o?.highlight) flash(o.highlight);
      focusAfterNav({ place: "jetzt", level: l }, o?.highlight);
    },
    [close, flash, pagerTo, levels.scrollToLevel, focusAfterNav],
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
  const setDuOpen = useCallback((section: DuSection | null) => setDuOpenState(section), []);
  const startTour = useCallback(async () => {
    await go("jetzt");
    await goLevel(0);
    setTourState(1);
  }, [go, goLevel]);

  const api: SpaceApi = useMemo(
    () => ({ ...state, go, goLevel, setAnchor, setYearGoal, open, close, registerCloser, flash, registerAdd, ask, startTour, setTour, setDuOpen }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [place, level, anchor, today, yearGoal, detail, detailOrigin, duSection, tour, highlight, typing, reduced],
  );

  // ---------- the pager: Du ↔ Jetzt ↔ Ziele, live only at Jetzt (settled near the top) and on a side ----------

  const pager = useSwipeX({
    mode: "pager",
    enabled: !detail && !typing,
    gate: () => pagerEnabled(stateRef.current, window.scrollY),
    canGo: (dir) => Math.abs(POS[stateRef.current.place] + dir) <= 1,
    onStart: () => {
      pressOrb(false);
      const m = motion.current;
      cancelAnimationFrame(m.anim);
      m.anim = 0;
      m.dragBase = m.x;
      setMoving(true);
    },
    onMove: (dx) => {
      const m = motion.current;
      m.x = m.dragBase + dx;
      paintPager(m.x);
      paint();
    },
    onCommit: (dir, info) => {
      const target = PLACE_AT[(POS[stateRef.current.place] + dir) as -1 | 0 | 1];
      if (target !== "du") setDuSection(null);
      pagerTo(target, settleMs(baseX(target) - motion.current.x, info.v));
    },
    onCancel: () => {
      pagerTo(stateRef.current.place, CANCEL_MS);
    },
  });
  const pagerRef = pager.ref; // stable
  const spaceEl = useCallback(
    (el: HTMLDivElement | null) => {
      spaceRef.current = el;
      pagerRef(el);
    },
    [pagerRef],
  );

  // ---------- global behaviour ----------

  // a tour requested later (e.g. after onboarding while mounted)
  useEffect(() => {
    if (props.startTour && !tourSeen() && !initial.deepLink) setTourState((t) => t ?? 1);
  }, [props.startTour, initial.deepLink]);

  // html data attributes: the test contract and the CSS hooks (the class before the first scroll)
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add("space-on");
    return () => {
      root.classList.remove("space-on");
      for (const k of ["place", "level", "detail", "typing", "tour", "voiceActive", "typed"]) delete root.dataset[k];
      // A real unmount (Abmelden, a new sign-up): the next Space opens at Jetzt, so the
      // last place must not linger in the URL as a deep link. (Deferred: StrictMode's
      // test unmount mounts again at once.)
      setTimeout(() => {
        if (!root.classList.contains("space-on") && window.location.hash) history.replaceState(history.state, "", `${window.location.pathname}${window.location.search}`);
      }, 0);
    };
  }, []);
  useEffect(() => {
    const d = document.documentElement.dataset;
    d.place = place;
    d.level = String(level);
    if (detail) d.detail = detail.kind;
    else delete d.detail;
    if (typing) d.typing = typing === "detail" ? "detail" : "true";
    else delete d.typing;
    if (tour) d.tour = String(tour);
    else delete d.tour;
    if (voiceActive) d.voiceActive = "true";
    else delete d.voiceActive;
    if (typedOpen) d.typed = "true";
    else delete d.typed;
  }, [place, level, detail, typing, tour, voiceActive, typedOpen]);

  // hash (replaceState only) and the polite announcement after every settle. The first
  // write waits until after the first paint: a deep link may carry a query for another
  // module ("#du/verbindungen?whoop=…"), read at page load.
  const painted = useRef(false);
  useEffect(() => {
    const write = () => {
      painted.current = true;
      const hash = toHash({ place, level, anchor, duSection: duOpen });
      if (hash !== window.location.hash) history.replaceState(history.state, "", `${window.location.pathname}${window.location.search}${hash}`);
    };
    if (painted.current) return write();
    let r2 = 0;
    const r1 = requestAnimationFrame(() => (r2 = requestAnimationFrame(write)));
    return () => (cancelAnimationFrame(r1), cancelAnimationFrame(r2));
  }, [place, level, anchor, duOpen]);
  // Woche adds its summary ("…, 7 Stunden 45 für deine Ziele geplant") once that week's data is there
  const announceWeek = (base: string, monday: string, delay: number) => {
    let tries = 0;
    let t = 0;
    const withSummary = () => {
      const spoken = document.querySelector<HTMLElement>(`.space .lvl[data-level="2"] .wk-sum[data-week="${monday}"][data-spoken]`)?.dataset.spoken;
      if (spoken) setAnnounce(`${base}, ${spoken}`);
      else if (++tries < 8) t = window.setTimeout(withSummary, 150);
      else setAnnounce(base);
    };
    t = window.setTimeout(withSummary, delay);
    return () => clearTimeout(t);
  };
  useEffect(() => {
    const base = announcement({ place, level, anchor, today });
    if (place !== "jetzt" || level !== 2) {
      setAnnounce(base);
      return;
    }
    return announceWeek(base, weekStart(anchor), 0);
    // only on settle (place / level); paging through time has its own path below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place, level]);

  // Paging through time (chevrons, ← / →, "Zu heute", a swipe) is announced too, once
  // it rests for 300 ms, so fast paging speaks only the period it ends on.
  const periodKey = place !== "jetzt" ? "" : level === 1 ? anchor : level === 2 ? weekStart(anchor) : level === 3 ? anchor.slice(0, 4) : "";
  const lastPeriod = useRef({ place, level, key: periodKey });
  useEffect(() => {
    const was = lastPeriod.current;
    lastPeriod.current = { place, level, key: periodKey };
    if (!periodKey || was.place !== place || was.level !== level || was.key === periodKey) return; // a settle has its own announcement
    const base = announcement({ place, level, anchor, today });
    if (level !== 2) {
      const t = window.setTimeout(() => setAnnounce(base), 300);
      return () => clearTimeout(t);
    }
    return announceWeek(base, periodKey, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place, level, periodKey]);

  // after 1 s settled at Jetzt, the anchor returns to today and the year filter goes
  useEffect(() => {
    if (place !== "jetzt" || level !== 0 || detail) return;
    let t = 0;
    const reset = () => {
      // (not while a move to a level is under way, e.g. "Im Jahr ansehen"; look again later)
      if (navigating.current || motion.current.p > 0.02) return void (t = window.setTimeout(reset, 500));
      setAnchorState(today);
      setYearGoalState(null);
    };
    t = window.setTimeout(reset, 1000);
    return () => clearTimeout(t);
  }, [place, level, detail, today]);

  // resume (D13): back after ≥ 30 min → Jetzt (unless a detail is open); sooner keeps the place
  useEffect(() => {
    let hiddenAt = 0;
    const onVis = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      if (!hiddenAt) return;
      const away = Date.now() - hiddenAt;
      hiddenAt = 0;
      const s = stateRef.current;
      if (away < RESUME_KEEP_MS || s.detail || (s.place === "jetzt" && s.level === 0)) return;
      setDuSection(null);
      navigating.current++;
      animatePager(0, 0)
        .then(() => {
          setPlace("jetzt");
          return levels.scrollToLevel(0, "auto");
        })
        .finally(() => navigating.current--);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [animatePager, levels.scrollToLevel]);

  // typing: snap off while a text field has focus (the voice layer hides for fields in a
  // detail); on blur back to the level's top
  useEffect(() => {
    const update = () => {
      const el = document.activeElement;
      setTyping(isTextField(el) ? (el?.closest(".detail-root") ? "detail" : "field") : false);
    };
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
    const s = stateRef.current;
    if (wasTyping.current && !typing) {
      if (s.place === "jetzt") levels.scrollToLevel(s.level, "auto");
      else {
        const top = levels.section(s.level)?.offsetTop ?? 0;
        if (Math.abs(window.scrollY - top) > 0.5) window.scrollTo({ top, behavior: "auto" });
      }
    }
    wasTyping.current = !!typing;
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
      const side = s.place === "ziele" ? zieleRef.current : s.place === "du" ? duRef.current : null;
      switch (e.key) {
        case "Escape":
          handled();
          if (s.tour) setTour(null);
          else if (s.place !== "jetzt") go("jetzt");
          else if (s.level > 0) goLevel(0);
          break;
        case "ArrowDown":
        case "PageDown":
        case "ArrowUp":
        case "PageUp": {
          const down = e.key === "ArrowDown" || e.key === "PageDown";
          handled();
          // on a side the keys scroll the side, never the hidden time column
          if (side) side.scrollBy({ top: (down ? 1 : -1) * (e.key.startsWith("Page") ? side.clientHeight * 0.85 : 80), behavior: s.reduced ? "auto" : "smooth" });
          else goLevel(Math.max(0, Math.min(3, s.level + (down ? 1 : -1))) as Level);
          break;
        }
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

  // the coach sees where the person is
  const contextRef = useRef(props.context);
  contextRef.current = props.context;
  const context = useCallback((): CoachContext => {
    const goals = planData.get().goals;
    const view = describeView(stateRef.current, (id) => goals?.find((g) => g.id === id)?.title ?? null);
    return { ...contextRef.current(), view };
  }, []);

  // a coach change visible where the person is glows instead of toasting; "Ansehen" goes there
  const suppressToast = useCallback((t: Target) => showsTarget(t, stateRef.current), []);
  const openTarget = useCallback(
    (t: Target) => {
      if (t.kind === "event") goLevel(1, { day: t.day, highlight: t.id });
      else go("ziele", { highlight: t.id });
    },
    [go, goLevel],
  );
  // the coach asks which apps it may read (request_connections): "Verbindungen ansehen" opens Du › Verbindungen
  const connections = useMemo(
    () => ({
      shown: () => stateRef.current.place === "du" && stateRef.current.duSection === "connections",
      open: () => void go("du", { duSection: "connections" }),
    }),
    [go],
  );

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
  const away = place !== "jetzt" || level > 0;

  const onSkip = (p: Place, l?: Level) => {
    if (p !== "jetzt") go(p);
    // "Heute" is today's Tag, whatever day Tag showed last
    else go("jetzt").then(() => goLevel(l ?? 0, l === 1 ? { day: today } : undefined));
  };
  const backToCircle = useCallback(async () => {
    await go("jetzt");
    await goLevel(0);
  }, [go, goLevel]);

  return (
    <SpaceContext.Provider value={api}>
      <SkipNav onGo={onSkip} inert={!!detail} />
      <div ref={spaceEl} className="space" data-place={place} inert={!!detail}>
        <OrbLayer
          apiRef={orbApi}
          palette={palette}
          state={orbState}
          slot={slot}
          away={away}
          detailOpen={!!detail}
          reduced={reduced}
          tour={tour}
          atJetzt={atLevel(0)}
          onBack={backToCircle}
        />
        <main ref={timeRef} className="time" inert={sideShown} aria-hidden={sideShown || undefined}>
          <section ref={levels.sectionRef(0)} className="lvl" data-level={0} aria-current={atLevel(0) || undefined} aria-labelledby={NOW_TITLE_ID}>
            <div ref={innerRefs.current[0]} className="lvl-inner">
              <NowLevel profile={profile} palette={palette} weather={weather} focus={focus} onSlot={setSlot} />
            </div>
          </section>
          <section ref={levels.sectionRef(1)} className="lvl" data-level={1} aria-current={atLevel(1) || undefined} aria-labelledby={TITLE_IDS.tag}>
            <div ref={innerRefs.current[1]} className="lvl-inner">
              {levels.mounted.day && <DayLevel titleId={TITLE_IDS.tag} active={atLevel(1)} weather={weather} />}
            </div>
          </section>
          <section ref={levels.sectionRef(2)} className="lvl" data-level={2} aria-current={atLevel(2) || undefined} aria-labelledby={TITLE_IDS.woche}>
            <div ref={innerRefs.current[2]} className="lvl-inner">
              {levels.mounted.week && <WeekLevel titleId={TITLE_IDS.woche} active={atLevel(2)} />}
            </div>
          </section>
          <section ref={levels.sectionRef(3)} className="lvl" data-level={3} aria-current={atLevel(3) || undefined} aria-labelledby={TITLE_IDS.jahr}>
            <div ref={innerRefs.current[3]} className="lvl-inner">
              {levels.mounted.year && <YearLevel titleId={TITLE_IDS.jahr} active={atLevel(3)} />}
            </div>
          </section>
        </main>
        <section ref={duRef} id="du" className="side" role="region" aria-labelledby={TITLE_IDS.du} inert={place !== "du"} data-shown={place === "du" || undefined}>
          <div className="side-inner">
            <YouPlace titleId={TITLE_IDS.du} active={place === "du"} profile={profile} palette={palette} hasCoords={hasCoords} onProfile={onProfile} onCoords={onCoords} />
          </div>
        </section>
        <section ref={zieleRef} id="ziele" className="side" role="region" aria-labelledby={TITLE_IDS.ziele} inert={place !== "ziele"} data-shown={place === "ziele" || undefined}>
          <div className="side-inner">
            <GoalsPlace titleId={TITLE_IDS.ziele} active={place === "ziele"} />
          </div>
        </section>
      </div>
      <div className="detail-root">
        <DetailHost />
      </div>
      <div className="voice-layer">
        <VoiceConversation
          mode="checkin"
          thread={today}
          context={context}
          onEvent={onEvent}
          onOrbState={setOrbState}
          leftButton={<DockLeft detailOpen={!!detail} addKey={addKey} onAdd={onAdd} onDone={() => close("done")} />}
          variant="layer"
          compact={away}
          hold={tour !== null}
          idleHint="untilFirstMessage"
          suppressToast={suppressToast}
          onOpenTarget={openTarget}
          connections={connections}
          onActivity={setVoiceActive}
          onTyping={setTypedOpen}
        />
      </div>
      <TourCaption />
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
    </SpaceContext.Provider>
  );
}
