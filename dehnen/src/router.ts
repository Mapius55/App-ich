// Hash routing without a library: #/, #/uebungen, #/uebung/<id>, #/routinen, #/routine/<id>, #/mix, #/session, #/verlauf, #/einstellungen.
// Plain links (<a href="#/uebungen">) work as they are; navigate() and back() are for code.
// The router also remembers the scroll position of every route (see useScrollMemory, used by <Screen>).
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { MouseEvent, RefObject } from "react";

export type RouteName = "home" | "library" | "exercise" | "routines" | "routine" | "mix" | "session" | "history" | "settings" | "notfound";

export type TabId = "heute" | "uebungen" | "routinen" | "verlauf";

/** How the current route was reached; the shell picks the screen transition from it. */
export type NavKind = "none" | "forward" | "back" | "fade";

export interface Route {
  name: RouteName;
  /** path without the query, always starting with "/", e.g. "/uebung/hf-ausfallschritt" */
  path: string;
  /** the <id> of #/uebung/<id> and #/routine/<id> (decoded), otherwise "" */
  id: string;
  /** #/uebungen?region=huefte_seitlich gives { region: "huefte_seitlich" } */
  query: Record<string, string>;
  /** the tab this route belongs to; null = no tab bar (the player) */
  tab: TabId | null;
  nav: NavKind;
}

export interface NavigateOptions {
  /** replace the current history entry instead of adding one */
  replace?: boolean;
  /** transition; default "forward" for a new entry and "fade" for a replace */
  nav?: NavKind;
  /** keep the remembered scroll position of the target (tabs do this); default: start at the top */
  keepScroll?: boolean;
}

/** The root path of every tab. */
export const TAB_PATH: Record<TabId, string> = {
  heute: "/",
  uebungen: "/uebungen",
  routinen: "/routinen",
  verlauf: "/verlauf",
};

const ROUTE_TAB: Record<RouteName, TabId | null> = {
  home: "heute",
  mix: "heute",
  settings: "heute",
  library: "uebungen",
  exercise: "uebungen",
  routines: "routinen",
  routine: "routinen",
  history: "verlauf",
  session: null,
  notfound: "heute",
};

const hasWindow = typeof window !== "undefined";

function clean(to: string): string {
  let p = to.trim();
  if (p.startsWith("#")) p = p.slice(1);
  if (!p.startsWith("/")) p = "/" + p;
  return p;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function matchName(path: string): { name: RouteName; id: string } {
  const parts = path.split("/").filter(Boolean);
  const [a, b] = parts;
  if (parts.length === 0) return { name: "home", id: "" };
  if (parts.length === 1) {
    switch (a) {
      case "uebungen":
        return { name: "library", id: "" };
      case "routinen":
        return { name: "routines", id: "" };
      case "mix":
        return { name: "mix", id: "" };
      case "session":
        return { name: "session", id: "" };
      case "verlauf":
        return { name: "history", id: "" };
      case "einstellungen":
        return { name: "settings", id: "" };
    }
  }
  if (parts.length === 2 && b) {
    if (a === "uebung") return { name: "exercise", id: safeDecode(b) };
    if (a === "routine") return { name: "routine", id: safeDecode(b) };
  }
  return { name: "notfound", id: "" };
}

/** Parses a path such as "/uebung/abc?x=1" (with or without the leading "#"). */
export function parseRoute(to: string, nav: NavKind = "none"): Route {
  const full = clean(to);
  const q = full.indexOf("?");
  const rawPath = q < 0 ? full : full.slice(0, q);
  const path = rawPath.length > 1 && rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
  const query: Record<string, string> = {};
  if (q >= 0) {
    for (const [k, v] of new URLSearchParams(full.slice(q + 1))) query[k] = v;
  }
  const { name, id } = matchName(path);
  return { name, path, id, query, tab: ROUTE_TAB[name], nav };
}

/** "#/uebung/abc" for <a href>. Optional query values are appended (empty ones are left out). */
export function href(path: string, query?: Record<string, string | number | boolean | null | undefined>): string {
  let out = "#" + clean(path);
  if (query) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === null || v === undefined || v === "" || v === false) continue;
      sp.set(k, String(v));
    }
    const s = sp.toString();
    if (s) out += (out.includes("?") ? "&" : "?") + s;
  }
  return out;
}

/** Path of an exercise or routine screen. */
export const exercisePath = (id: string): string => "/uebung/" + encodeURIComponent(id);
export const routinePath = (id: string): string => "/routine/" + encodeURIComponent(id);

// ---------- state ----------

interface HistoryState {
  kw?: number;
}

function readIndex(): number | null {
  if (!hasWindow) return null;
  try {
    const st = window.history.state as HistoryState | null;
    return st && typeof st.kw === "number" ? st.kw : null;
  } catch {
    return null;
  }
}

function currentHash(): string {
  return hasWindow ? clean(window.location.hash || "#/") : "/";
}

let index = 0;
let current: Route = parseRoute(currentHash());
let currentFull = currentHash();
const listeners = new Set<() => void>();
const scrollMemory = new Map<string, number>();
let scroller: HTMLElement | null = null;

function emit(): void {
  for (const l of listeners) l();
}

function setRoute(nav: NavKind): void {
  currentFull = currentHash();
  current = parseRoute(currentFull, nav);
  emit();
}

function writeState(replace: boolean, hash: string): void {
  try {
    if (replace) window.history.replaceState({ kw: index }, "", hash);
    else window.history.pushState({ kw: index }, "", hash);
  } catch {
    // history can be unavailable (sandboxed frames): fall back to the plain hash
    window.location.hash = hash;
  }
}

/** Reacts to the back and forward buttons and to plain hash links. */
function onExternalChange(): void {
  const full = currentHash();
  const i = readIndex();
  if (i === null) {
    // a new entry made by a plain link or by typing a hash: adopt it
    if (full === currentFull) {
      writeState(true, "#" + full);
      return;
    }
    index += 1;
    writeState(true, "#" + full);
    scrollMemory.delete(parseRoute(full).path);
    setRoute("forward");
    return;
  }
  if (i === index && full === currentFull) return;
  const nav: NavKind = i < index ? "back" : i > index ? "forward" : "fade";
  index = i;
  setRoute(nav);
}

if (hasWindow) {
  const i = readIndex();
  if (i === null) writeState(true, window.location.hash || "#/");
  else index = i;
  window.addEventListener("popstate", onExternalChange);
  window.addEventListener("hashchange", onExternalChange);
}

// ---------- api ----------

/** Go to a path, e.g. navigate("/uebung/abc") or navigate("/session", { replace: true }). */
export function navigate(to: string, opts: NavigateOptions = {}): void {
  if (!hasWindow) return;
  const full = clean(to);
  const target = parseRoute(full);
  if (full === currentFull) {
    if (!opts.keepScroll) scrollToTop();
    return;
  }
  if (!opts.keepScroll) scrollMemory.delete(target.path);
  if (opts.replace) {
    writeState(true, "#" + full);
    setRoute(opts.nav ?? "fade");
  } else {
    index += 1;
    writeState(false, "#" + full);
    setRoute(opts.nav ?? "forward");
  }
}

/** One step back in the app. Opened directly on a deep link (nothing to go back to): goes to the fallback instead. */
export function back(fallback = "/"): void {
  if (!hasWindow) return;
  if (index > 0) {
    window.history.back();
    return;
  }
  const full = clean(fallback);
  if (full === currentFull) return;
  writeState(true, "#" + full);
  setRoute("back");
}

/** True if back() would return to an earlier screen of this visit (false on a cold deep link). */
export function canGoBack(): boolean {
  return index > 0;
}

export function getRoute(): Route {
  return current;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** The current route; the component re-renders on every navigation. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getRoute, getRoute);
}

/**
 * Props for a link that goes through navigate(): <a {...link("/uebung/abc")}>.
 * A plain <a href={href(path)}> works too; use link() when you need options (replace, keepScroll).
 */
export function link(path: string, opts?: NavigateOptions): { href: string; onClick: (e: MouseEvent<HTMLElement>) => void } {
  return {
    href: href(path),
    onClick: (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigate(path, opts);
    },
  };
}

// ---------- scroll ----------

/** Scrolls the visible screen back to the top (the tab bar does this when the active tab is tapped again). */
export function scrollToTop(): void {
  if (!scroller) return;
  const reduce = hasWindow && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  scroller.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
}

/**
 * Remembers and restores the scroll position of a scroll container per route.
 * <Screen> uses it for its scroll area; a screen with its own scroller can pass a key of its own.
 */
export function useScrollMemory<T extends HTMLElement>(key?: string): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const k = key ?? current.path;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const saved = scrollMemory.get(k);
    if (saved) el.scrollTop = saved;
    scroller = el;
    const onScroll = () => {
      scrollMemory.set(k, el.scrollTop);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (scroller === el) scroller = null;
    };
  }, [k]);
  return ref;
}
