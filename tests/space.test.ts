import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anchorIsCurrent, fromHash, showsTarget, stepAnchor, targetOf, toHash, type Detail, type DuSection, type SpaceState } from "../src/space/state";
import { describeView } from "../src/space/describeView";
import { FRESH_TTL, isFresh, markFresh, markSeen, resetFreshForTests } from "../src/space/fresh";
import { atSnapPoint, pagerEnabled, timeSwipeEnabled } from "../src/space/gestures";
import { ask, onAsk } from "../src/space/coachBus";
import { spaceChoice, spaceEnabled } from "../src/space/flags";
import { authChange } from "../src/lib/screenTransition";
import type { CalendarEvent, CoachEvent, Goal, Habit } from "../src/lib/types";

// Saturday, 14 November 2026
const TODAY = "2026-11-14";

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "e1",
  title: "Lauftraining",
  // built in local time, so the test reads the same in every time zone
  starts_at: new Date(2026, 10, 14, 17, 0).toISOString(),
  ends_at: new Date(2026, 10, 14, 18, 0).toISOString(),
  all_day: false,
  location: "Letzigrund",
  notes: null,
  reminder_minutes: null,
  source: "person",
  kind: "block",
  goal_id: "g1",
  ...over,
});
const goal = { id: "g1", title: "Halbmarathon Zürich" } as Goal;
const habit = { id: "h1", title: "Laufen" } as Habit;
const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

describe("hash routing", () => {
  const at = (place: SpaceState["place"], level: SpaceState["level"], anchor = TODAY, duSection: DuSection | null = null) => ({ place, level, anchor, duSection });

  it("Jetzt is the empty hash, and both forms read back as Jetzt", () => {
    expect(toHash(at("jetzt", 0))).toBe("");
    expect(fromHash("", TODAY)).toEqual(at("jetzt", 0));
    expect(fromHash("#jetzt", TODAY)).toEqual(at("jetzt", 0));
  });

  it("Tag round-trips", () => {
    expect(toHash(at("jetzt", 1, "2026-11-15"))).toBe("#tag/2026-11-15");
    expect(fromHash("#tag/2026-11-15", TODAY)).toEqual(at("jetzt", 1, "2026-11-15"));
  });

  it("Woche is written as its Monday; reading resolves to today when today is in it", () => {
    expect(toHash(at("jetzt", 2, "2026-11-18"))).toBe("#woche/2026-11-16");
    expect(fromHash("#woche/2026-11-16", TODAY)).toEqual(at("jetzt", 2, "2026-11-16"));
    expect(fromHash("#woche/2026-11-11", TODAY)).toEqual(at("jetzt", 2, TODAY));
    // a week across the year end
    expect(toHash(at("jetzt", 2, "2027-01-02"))).toBe("#woche/2026-12-28");
    const back = fromHash("#woche/2026-12-28", TODAY)!;
    expect(toHash(back)).toBe("#woche/2026-12-28");
  });

  it("Jahr keeps today's date, clamped in another year", () => {
    expect(toHash(at("jetzt", 3, "2026-03-01"))).toBe("#jahr/2026");
    expect(fromHash("#jahr/2026", TODAY)).toEqual(at("jetzt", 3, TODAY));
    expect(fromHash("#jahr/2027", TODAY)).toEqual(at("jetzt", 3, "2027-11-14"));
    expect(fromHash("#jahr/2027", "2028-02-29")).toEqual(at("jetzt", 3, "2027-02-28"));
  });

  it("sides ignore the level; Du sections have German slugs", () => {
    expect(toHash(at("ziele", 2))).toBe("#ziele");
    expect(toHash(at("du", 1))).toBe("#du");
    expect(toHash(at("du", 0, TODAY, "connections"))).toBe("#du/verbindungen");
    expect(fromHash("#du/verbindungen", TODAY)).toEqual(at("du", 0, TODAY, "connections"));
    for (const s of ["memories", "body", "connections", "notifications", "settings"] as DuSection[]) {
      expect(fromHash(toHash(at("du", 0, TODAY, s)), TODAY)).toEqual(at("du", 0, TODAY, s));
    }
    expect(fromHash("#Ziele", TODAY)).toEqual(at("ziele", 0));
    // the Bucket List keeps "#ziele"; "#bucket" is an alias
    expect(fromHash("#bucket", TODAY)).toEqual(at("ziele", 0));
    expect(fromHash("#Bucket?x=1", TODAY)).toEqual(at("ziele", 0));
  });

  it("a query after the place is ignored (it belongs to another module, e.g. the WHOOP return)", () => {
    expect(fromHash("#du/verbindungen?whoop=confirm&code=abc", TODAY)).toEqual(at("du", 0, TODAY, "connections"));
    expect(fromHash("#du?whoop=error", TODAY)).toEqual(at("du", 0));
    expect(fromHash("#tag/2026-11-15?x=1", TODAY)).toEqual(at("jetzt", 1, "2026-11-15"));
    expect(fromHash("#?x=1", TODAY)).toEqual(at("jetzt", 0));
    expect(fromHash("#du/xyz?whoop=confirm", TODAY)).toBeNull();
  });

  it("unknown or invalid hashes give null", () => {
    for (const h of ["#foo", "#tag/2026-02-30", "#tag/morgen", "#tag/2026-11-15/x", "#jahr/26", "#du/xyz", "#woche/", "#tag", "#%E0%A4%A", "#du/%zz"]) {
      expect(fromHash(h, TODAY), h).toBeNull();
    }
  });
});

describe("glow instead of toast", () => {
  const base = { place: "jetzt" as const, level: 1 as const, anchor: TODAY, detail: null };
  const ev = { kind: "event" as const, id: "e1", day: TODAY };

  it("an event shows on its day (Tag) or in its week (Woche) at Jetzt", () => {
    expect(showsTarget(ev, base)).toBe(true);
    expect(showsTarget({ ...ev, day: "2026-11-15" }, base)).toBe(false);
    expect(showsTarget({ ...ev, day: "2026-11-09" }, { ...base, level: 2 })).toBe(true);
    expect(showsTarget({ ...ev, day: "2026-11-15" }, { ...base, level: 2 })).toBe(true);
    expect(showsTarget({ ...ev, day: "2026-11-16" }, { ...base, level: 2 })).toBe(false);
    expect(showsTarget(ev, { ...base, level: 0 })).toBe(false);
    expect(showsTarget(ev, { ...base, level: 3 })).toBe(false);
    expect(showsTarget(ev, { ...base, place: "ziele" })).toBe(false);
  });

  it("goals and habits show on Ziele", () => {
    expect(showsTarget({ kind: "goal", id: "g1" }, { ...base, place: "ziele" })).toBe(true);
    expect(showsTarget({ kind: "habit", id: "h1" }, { ...base, place: "ziele" })).toBe(true);
    expect(showsTarget({ kind: "goal", id: "g1" }, base)).toBe(false);
    expect(showsTarget({ kind: "habit", id: "h1" }, { ...base, place: "du" })).toBe(false);
  });

  it("with a detail open only the open item itself counts", () => {
    const open: Detail = { kind: "event", event: event(), day: TODAY };
    expect(showsTarget(ev, { ...base, detail: open })).toBe(true);
    expect(showsTarget({ ...ev, id: "e2" }, { ...base, detail: open })).toBe(false);
    expect(showsTarget({ kind: "goal", id: "g1" }, { ...base, place: "ziele", detail: { kind: "goal", goal } })).toBe(true);
    expect(showsTarget({ kind: "goal", id: "g1" }, { ...base, place: "ziele", detail: { kind: "habit", habit } })).toBe(false);
  });

  it("targetOf maps coach events to what they touched", () => {
    const e = event();
    const dayOfIso = (iso: string) => (iso === e.starts_at ? "2026-11-14" : "x");
    expect(targetOf({ type: "event_created", event: e }, dayOfIso)).toEqual({ kind: "event", id: "e1", day: "2026-11-14" });
    expect(targetOf({ type: "event_updated", event: e }, dayOfIso)).toEqual({ kind: "event", id: "e1", day: "2026-11-14" });
    expect(targetOf({ type: "goal_saved", goal } as CoachEvent, dayOfIso)).toEqual({ kind: "goal", id: "g1" });
    expect(targetOf({ type: "time_logged", goal_id: "g1", title: "x", minutes: 30 }, dayOfIso)).toEqual({ kind: "goal", id: "g1" });
    expect(targetOf({ type: "habit_saved", habit }, dayOfIso)).toEqual({ kind: "habit", id: "h1" });
    expect(targetOf({ type: "habit_logged", habit_id: "h1", title: "Laufen", day: TODAY, done: true }, dayOfIso)).toEqual({ kind: "habit", id: "h1" });
    expect(targetOf({ type: "event_deleted", id: "e1", title: "x" }, dayOfIso)).toBeNull();
    expect(targetOf({ type: "goal_deleted", id: "g1", title: "x" }, dayOfIso)).toBeNull();
    expect(targetOf({ type: "text", text: "Hoi" }, dayOfIso)).toBeNull();
  });
});

describe("describeView", () => {
  const titles = (id: string) => (id === "g1" ? "Halbmarathon Zürich" : null);
  const v = (s: Partial<Parameters<typeof describeView>[0]>) => describeView({ place: "jetzt", level: 0, anchor: TODAY, yearGoal: null, detail: null, ...s }, titles);

  it("names every place and level", () => {
    expect(v({})).toBe("Jetzt (Startseite mit dem Kreis)");
    expect(v({ level: 1, anchor: "2026-11-16" })).toBe("Tag: Montag, 16. November 2026");
    expect(v({ level: 2, anchor: "2026-11-18" })).toBe("Woche: 16.–22. November 2026 (KW 47)");
    expect(v({ level: 2, anchor: "2026-12-30" })).toBe("Woche: 28. Dezember 2026 – 3. Januar 2027 (KW 53)");
    expect(v({ level: 2, anchor: "2026-11-30" })).toBe("Woche: 30. November – 6. Dezember 2026 (KW 49)");
    expect(v({ level: 3 })).toBe("Jahr 2026");
    expect(v({ level: 3, yearGoal: "g1" })).toBe("Jahr 2026, nur Ziel „Halbmarathon Zürich“");
    expect(v({ level: 3, yearGoal: "gone" })).toBe("Jahr 2026");
    expect(v({ place: "ziele", level: 2 })).toBe("Bucket List (rechts vom Kreis: Träume, Ziele, Gewohnheiten)");
    expect(v({ place: "du" })).toBe("Du (was ich über dich weiss, Verbindungen, Einstellungen)");
  });

  it("appends the open detail", () => {
    expect(v({ level: 1, detail: { kind: "event", event: event(), day: TODAY } })).toBe(
      "Tag: Samstag, 14. November 2026 · offen: Eintrag „Lauftraining“ [e1] am Samstag, 14. November, 17:00",
    );
    const allDay = event({ all_day: true, starts_at: new Date(2026, 10, 15).toISOString(), ends_at: null, title: "Rennen" });
    expect(v({ level: 1, detail: { kind: "event", event: allDay, day: "2026-11-15" } })).toBe(
      "Tag: Samstag, 14. November 2026 · offen: Eintrag „Rennen“ [e1] am Sonntag, 15. November, ganztags",
    );
    expect(v({ level: 1, detail: { kind: "event", event: null, day: "2026-11-16", time: "14:00" } })).toBe(
      "Tag: Samstag, 14. November 2026 · offen: neuer Eintrag am Montag, 16. November, 14:00",
    );
    expect(v({ level: 1, detail: { kind: "event", event: null, day: "2027-01-04" } })).toBe("Tag: Samstag, 14. November 2026 · offen: neuer Eintrag am Montag, 4. Januar 2027");
    expect(v({ place: "ziele", detail: { kind: "goal", goal } })).toBe("Bucket List (rechts vom Kreis: Träume, Ziele, Gewohnheiten) · offen: Ziel „Halbmarathon Zürich“ [g1]");
    expect(v({ place: "ziele", detail: { kind: "goal", goal: null } })).toBe("Bucket List (rechts vom Kreis: Träume, Ziele, Gewohnheiten) · offen: neues Ziel");
    expect(v({ place: "ziele", detail: { kind: "habit", habit } })).toBe("Bucket List (rechts vom Kreis: Träume, Ziele, Gewohnheiten) · offen: Gewohnheit „Laufen“ [h1]");
    expect(v({ place: "ziele", detail: { kind: "habit", habit: null } })).toBe("Bucket List (rechts vom Kreis: Träume, Ziele, Gewohnheiten) · offen: neue Gewohnheit");
    // dreams (Bucket List round): a new one, an open one, a fulfilled one
    const dream = { id: "d1", title: "Polarlichter sehen", kind: "dream", status: "active" } as Goal;
    expect(v({ place: "ziele", detail: { kind: "goal", goal: null, dream: true } })).toBe("Bucket List (rechts vom Kreis: Träume, Ziele, Gewohnheiten) · offen: neuer Traum");
    expect(v({ place: "ziele", detail: { kind: "goal", goal: dream } })).toBe("Bucket List (rechts vom Kreis: Träume, Ziele, Gewohnheiten) · offen: Traum „Polarlichter sehen“ [d1]");
    expect(v({ place: "ziele", detail: { kind: "goal", goal: { ...dream, status: "done" } } })).toBe("Bucket List (rechts vom Kreis: Träume, Ziele, Gewohnheiten) · offen: Traum „Polarlichter sehen“ [d1] (erfüllt)");
    expect(localDay(event().starts_at)).toBe(TODAY);
  });
});

describe("fresh (neu vom Coach)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-14T16:12:00+01:00"));
    resetFreshForTests();
  });
  afterEach(() => vi.useRealTimers());

  it("stays fresh for 10 minutes", () => {
    markFresh("e1");
    expect(isFresh("e1")).toBe(true);
    expect(isFresh("e2")).toBe(false);
    vi.advanceTimersByTime(FRESH_TTL - 1000);
    expect(isFresh("e1")).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(isFresh("e1")).toBe(false);
  });

  it("marking again restarts the time; seen ends it", () => {
    markFresh("g1");
    vi.advanceTimersByTime(8 * 60 * 1000);
    markFresh("g1");
    vi.advanceTimersByTime(8 * 60 * 1000);
    expect(isFresh("g1")).toBe(true);
    markSeen("g1");
    expect(isFresh("g1")).toBe(false);
    markSeen("unknown"); // no-op
  });
});

describe("gesture gating (D1, cross)", () => {
  const s = { place: "jetzt" as const, level: 0 as const, detail: null, typing: false };
  it("the pager is live at Jetzt near the top and on a side, never with a detail or while typing", () => {
    expect(pagerEnabled(s, 0)).toBe(true);
    expect(pagerEnabled(s, 7)).toBe(true);
    expect(pagerEnabled(s, 8)).toBe(false);
    expect(pagerEnabled({ ...s, level: 1 }, 0)).toBe(false);
    expect(pagerEnabled({ ...s, place: "ziele", level: 2 }, 900)).toBe(true);
    expect(pagerEnabled({ ...s, detail: { kind: "goal", goal: null } }, 0)).toBe(false);
    expect(pagerEnabled({ ...s, typing: true }, 0)).toBe(false);
  });
  it("time paging is live only on the settled level", () => {
    expect(timeSwipeEnabled({ ...s, level: 1 }, 1)).toBe(true);
    expect(timeSwipeEnabled({ ...s, level: 1 }, 2)).toBe(false);
    expect(timeSwipeEnabled(s, 0)).toBe(false);
    expect(timeSwipeEnabled({ ...s, level: 2, place: "ziele" }, 2)).toBe(false);
    expect(timeSwipeEnabled({ ...s, level: 3, typing: true }, 3)).toBe(false);
  });
});

describe("settle by timer only on a snap point", () => {
  const H = 844;
  it("exactly on a section top, or within 1 px", () => {
    expect(atSnapPoint(0, H)).toBe(true);
    expect(atSnapPoint(H, H)).toBe(true);
    expect(atSnapPoint(H + 1, H)).toBe(true);
    expect(atSnapPoint(H - 1, H)).toBe(true);
    expect(atSnapPoint(H + 1.5, H)).toBe(false);
  });
  it("in between (mid-fling) is no rest", () => {
    expect(atSnapPoint(420, H)).toBe(false);
    expect(atSnapPoint(H + 300, H)).toBe(false);
  });
  it("the measured section tops win, clamped to the last level", () => {
    const tops = [0, 844, 1688, 2532, 3376];
    expect(atSnapPoint(3376, H, tops)).toBe(true); // Leben
    expect(atSnapPoint(3375.5, H, tops)).toBe(true);
    expect(atSnapPoint(3500, H, tops)).toBe(false);
    expect(atSnapPoint(845, 843.6, [0, 845, 1690])).toBe(true); // rounded heights: the offset, not k·h
    expect(atSnapPoint(0, 0)).toBe(true); // nothing laid out yet
  });
  it("a top past the end of the scroll counts as the end (Safari tab, toolbar collapsed: viewport taller than 100svh)", () => {
    // sections 664 px (svh), viewport 750 px (lvh): max scroll 5·664 − 750 = 2570, Leben's top 2656 is out of reach
    const svh = 664;
    const tops = [0, 664, 1328, 1992, 2656];
    const max = 5 * svh - 750;
    expect(atSnapPoint(max, svh, tops)).toBe(false); // unclamped: never a rest at Leben
    expect(atSnapPoint(max, svh, tops, max)).toBe(true);
    expect(atSnapPoint(max - 0.5, svh, tops, max)).toBe(true);
    expect(atSnapPoint(max - 60, svh, tops, max)).toBe(false); // still on its way
    expect(atSnapPoint(1992, svh, tops, max)).toBe(true); // Jahr is reachable as before
    expect(atSnapPoint(max, svh, undefined, max)).toBe(true); // without measured tops: k·h, clamped
    expect(atSnapPoint(844, 844, [0, 844], -10)).toBe(true); // nothing to scroll yet: no clamp
  });
});

describe("anchor steps", () => {
  it("day, week, year (same date, clamped)", () => {
    expect(stepAnchor(TODAY, 1, 1)).toBe("2026-11-15");
    expect(stepAnchor(TODAY, 2, -1)).toBe("2026-11-07");
    expect(stepAnchor("2028-02-29", 3, 1)).toBe("2029-02-28");
    expect(stepAnchor(TODAY, 0, 1)).toBe(TODAY);
    expect(anchorIsCurrent("2026-11-09", TODAY, 2)).toBe(true);
    expect(anchorIsCurrent("2026-11-16", TODAY, 2)).toBe(false);
    expect(anchorIsCurrent("2026-01-01", TODAY, 3)).toBe(true);
    expect(anchorIsCurrent("2026-11-15", TODAY, 1)).toBe(false);
  });
});

describe("coachBus", () => {
  it("holds asks until someone listens, then delivers at once", () => {
    ask("Lass uns meinen Tag planen.");
    ask("   ");
    const got: string[] = [];
    const off = onAsk((t) => got.push(t));
    expect(got).toEqual(["Lass uns meinen Tag planen."]);
    ask(" Lass uns meine Woche planen. ");
    expect(got).toEqual(["Lass uns meinen Tag planen.", "Lass uns meine Woche planen."]);
    off();
    ask("später");
    const later: string[] = [];
    onAsk((t) => later.push(t))();
    expect(later).toEqual(["später"]);
  });
});

describe("flag", () => {
  it("is on by default (no window, no storage)", () => {
    expect(spaceEnabled()).toBe(true);
  });
  it("only an explicit 0 keeps the old view; only a valid parameter is stored", () => {
    expect(spaceChoice(null, null)).toEqual({ on: true, persist: null });
    expect(spaceChoice(null, "1")).toEqual({ on: true, persist: null });
    expect(spaceChoice(null, "0")).toEqual({ on: false, persist: null });
    expect(spaceChoice("0", null)).toEqual({ on: false, persist: "0" });
    expect(spaceChoice("0", "1")).toEqual({ on: false, persist: "0" });
    expect(spaceChoice("1", "0")).toEqual({ on: true, persist: "1" });
    expect(spaceChoice("yes", "0")).toEqual({ on: false, persist: null });
    expect(spaceChoice(null, "true")).toEqual({ on: true, persist: null });
  });
});

describe("auth events and the screen", () => {
  it("the same person again changes nothing (start, return to the app, token refresh)", () => {
    expect(authChange("a", "a")).toBe("none");
    expect(authChange(null, null)).toBe("none");
  });
  it("the first answer (the restored session) just shows", () => {
    expect(authChange(undefined, "a")).toBe("plain");
    expect(authChange(undefined, null)).toBe("plain");
  });
  it("a real sign-in or sign-out zooms", () => {
    expect(authChange("a", null)).toBe("transition");
    expect(authChange(null, "a")).toBe("transition");
    expect(authChange("a", "b")).toBe("transition");
  });
});
