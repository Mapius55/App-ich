// Round 3, owner decision 1: «Ein Anstoss am Tag — nach einem Ja, sonst Begrüssung» (NEXT.md #1 with #5). The pure
// dailyNudge() and its priorities, the «once» marks per kind and the 14 quiet days after a «Nein», the moment (right
// after a yes, a tick or something done; after three days without one, in the greeting), the context section, the
// size of a proposal from what she really did, the coach's wiring, the migration, the demo, and three simulated weeks.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { DemoBackend } from "../src/lib/demoBackend";
import {
  addDays,
  chooseOpener,
  dayOf,
  dailyNudge,
  doneRange,
  experimentDue,
  goalSetback,
  hasPlanGoal,
  NUDGE_GREETING_DAYS,
  NUDGE_KINDS,
  NUDGE_NO_DAYS,
  NUDGE_STEPS_AHEAD_DAYS,
  nudgeResting,
  reviewNoteWeek,
  reviewWeek,
  wochenblickDue,
  type DailyNudge,
  type DailyNudgeGoal,
  type DailyNudgeInput,
  type OpenerKind,
  type ReviewState,
} from "../src/lib/plan";
import type { CoachEvent, CoachRequest } from "../src/lib/types";
import {
  contextBlock,
  doneText,
  MODE_CHECKIN,
  openerCandidates,
  openerLine,
  patternLine,
  PERSONA,
  todayNudge,
  type ContextEvent,
  type ContextGoal,
  type ContextInput,
} from "../supabase/functions/coach/prompt";
import { NUDGE_NO_NOTE, offerNudgeKind } from "../supabase/functions/coach/rules";

const source = readFileSync(new URL("../supabase/functions/coach/index.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261126000200_daily_nudge.sql", import.meta.url), "utf8");
const section = (out: string, heading: string) => {
  const at = out.indexOf(`## ${heading}`);
  if (at < 0) return "";
  const next = out.indexOf("\n## ", at + 3);
  return out.slice(at, next < 0 ? undefined : next);
};

// ---------- the pure choice ----------

// Tuesday, 17 November 2026
const TODAY = "2026-11-17";
const goal = (o: Partial<DailyNudgeGoal> = {}): DailyNudgeGoal => ({
  id: "g1",
  target_date: "2027-06-30",
  weekly_hours: 3,
  steps: 2,
  hours_asked_at: null,
  steps_asked_at: null,
  planB: false,
  setback: false,
  rhythm: false,
  ...o,
});
const input = (o: Partial<DailyNudgeInput> = {}): DailyNudgeInput => ({
  today: TODAY,
  heavy: false,
  pause: false,
  review: null,
  lastDay: "2026-11-16",
  startDay: "2026-10-01",
  no: {},
  entriesToday: 2,
  goals: [],
  dreams: [],
  experiment: false,
  ...o,
});
const kind = (o: Partial<DailyNudgeInput>) => dailyNudge(input(o))?.kind ?? null;

describe("dailyNudge: at most one item a day, by priority", () => {
  it("the order of NEXT #1: Wochenblick, weekly hours, Plan B after a setback, steps, rhythm, a dream, the experiment", () => {
    const all = [
      goal({ id: "hours", weekly_hours: null }),
      goal({ id: "planb", planB: true, setback: true }),
      goal({ id: "steps", steps: 0 }),
      goal({ id: "rhythm", rhythm: true }),
    ];
    const dreams = [{ id: "d1", flag: "lange" as const }];
    expect(dailyNudge(input({ review: "anbieten", goals: all, dreams, experiment: true }))).toEqual({ kind: "wochenblick", greeting: true });
    expect(dailyNudge(input({ goals: all, dreams }))).toEqual({ kind: "stunden", id: "hours", greeting: false });
    expect(dailyNudge(input({ goals: all.slice(1), dreams }))).toEqual({ kind: "plan_b", id: "planb", greeting: false });
    expect(dailyNudge(input({ goals: all.slice(2), dreams }))).toEqual({ kind: "etappen", id: "steps", greeting: false });
    expect(dailyNudge(input({ goals: all.slice(3), dreams }))).toEqual({ kind: "rhythmus", id: "rhythm", greeting: false });
    expect(dailyNudge(input({ goals: [], dreams, experiment: true }))).toEqual({ kind: "traum", id: "d1", flag: "lange", greeting: false });
    expect(dailyNudge(input({ experiment: true }))).toEqual({ kind: "experiment", greeting: false });
    expect(dailyNudge(input({ goals: [goal()] }))).toBeNull();
    expect(NUDGE_KINDS).toEqual(["wochenblick", "stunden", "plan_b", "etappen", "rhythmus", "traum", "experiment", "dienste"]);
  });

  it("weekly hours only for a goal with a target date ahead and without hours, the nearest date first, once", () => {
    const far = goal({ id: "far", weekly_hours: null, target_date: "2027-09-01" });
    const near = goal({ id: "near", weekly_hours: 0, target_date: "2027-01-20" });
    expect(dailyNudge(input({ goals: [far, near] }))?.id).toBe("near");
    expect(kind({ goals: [goal({ weekly_hours: null, target_date: null })] })).toBeNull();
    expect(kind({ goals: [goal({ weekly_hours: null, target_date: TODAY })] })).toBeNull();
    expect(kind({ goals: [goal({ weekly_hours: null, target_date: "2026-11-01" })] })).toBeNull();
    // asked once (whatever she said), or unknown (before the column): never again
    expect(kind({ goals: [goal({ weekly_hours: null, hours_asked_at: "2026-11-10T08:00:00Z" })] })).toBeNull();
    expect(kind({ goals: [goal({ weekly_hours: null, hours_asked_at: undefined })] })).toBeNull();
  });

  it("Plan B only after a setback; steps only more than six weeks ahead and without any; both once", () => {
    expect(kind({ goals: [goal({ planB: true })] })).toBeNull();
    expect(kind({ goals: [goal({ setback: true })] })).toBeNull();
    expect(kind({ goals: [goal({ planB: true, setback: true })] })).toBe("plan_b");
    const ahead = (d: number) => goal({ steps: 0, target_date: addDays(TODAY, d) });
    expect(kind({ goals: [ahead(NUDGE_STEPS_AHEAD_DAYS)] })).toBeNull();
    expect(kind({ goals: [ahead(NUDGE_STEPS_AHEAD_DAYS + 1)] })).toBe("etappen");
    expect(kind({ goals: [goal({ steps: 0, target_date: null })] })).toBeNull();
    expect(kind({ goals: [goal({ steps: 0, steps_asked_at: "2026-11-02T08:00:00Z" })] })).toBeNull();
    expect(kind({ goals: [goal({ steps: 0, steps_asked_at: undefined })] })).toBeNull();
  });

  it("a dream comes first on a day without entries and on Saturday and Sunday (after a due Wochenblick)", () => {
    const dreams = [{ id: "d1", flag: "neu" as const }];
    const busy = [goal({ weekly_hours: null })];
    expect(kind({ goals: busy, dreams })).toBe("stunden");
    expect(kind({ goals: busy, dreams, entriesToday: 0 })).toBe("traum");
    expect(kind({ today: "2026-11-21", lastDay: "2026-11-20", goals: busy, dreams })).toBe("traum");
    expect(kind({ today: "2026-11-22", lastDay: "2026-11-21", goals: busy, dreams })).toBe("traum");
    expect(kind({ today: "2026-11-22", lastDay: "2026-11-21", goals: busy, dreams, review: "anbieten" })).toBe("wochenblick");
  });

  it("people without an active goal get the experiment, even with dreams on the list (experimentDue)", () => {
    const zurich = (iso: string) => iso.slice(0, 10);
    const dream = { kind: "dream", status: "active" };
    expect(experimentDue([dream], null, TODAY, zurich)).toBe(true);
    expect(experimentDue([dream, { kind: "goal", status: "active" }], null, TODAY, zurich)).toBe(false);
    expect(kind({ dreams: [], experiment: true })).toBe("experiment");
  });

  it("one a day: none once one came today; none in a heavy time, after a pause or with an unknown state", () => {
    const o = { goals: [goal({ weekly_hours: null })] };
    expect(kind({ ...o, lastDay: TODAY })).toBeNull();
    expect(kind({ ...o, lastDay: "2026-11-18" })).toBeNull();
    expect(kind({ ...o, heavy: true })).toBeNull();
    expect(kind({ ...o, pause: true })).toBeNull();
    expect(kind({ ...o, lastDay: undefined })).toBeNull();
    expect(kind({ ...o, today: "2026-02-30" })).toBeNull();
    expect(kind({ ...o, lastDay: null })).toBe("stunden");
  });

  it("the moment: the greeting only after three days without one (or the Wochenblick), else right after her yes", () => {
    const o = { goals: [goal({ weekly_hours: null })] };
    expect(dailyNudge(input({ ...o, lastDay: addDays(TODAY, -(NUDGE_GREETING_DAYS - 1)) }))?.greeting).toBe(false);
    expect(dailyNudge(input({ ...o, lastDay: addDays(TODAY, -NUDGE_GREETING_DAYS) }))?.greeting).toBe(true);
    // none yet: counted from her start, and with no start known, the greeting may carry it
    expect(dailyNudge(input({ ...o, lastDay: null, startDay: "2026-11-16" }))?.greeting).toBe(false);
    expect(dailyNudge(input({ ...o, lastDay: null, startDay: "2026-11-14" }))?.greeting).toBe(true);
    expect(dailyNudge(input({ ...o, lastDay: null, startDay: null }))?.greeting).toBe(true);
    expect(dailyNudge(input({ ...o, review: "fragen" }))).toEqual({ kind: "wochenblick", greeting: true });
  });

  it("a «Nein» lets that kind rest 14 days (another kind may come); the Wochenblick keeps its own rule", () => {
    const o = { goals: [goal({ weekly_hours: null }), goal({ id: "g2", steps: 0 })] };
    expect(dailyNudge(input({ ...o, no: { stunden: "2026-11-10" } }))).toEqual({ kind: "etappen", id: "g2", greeting: false });
    expect(nudgeResting({ stunden: "2026-11-10" }, "stunden", TODAY)).toBe(true);
    expect(nudgeResting({ stunden: addDays(TODAY, -(NUDGE_NO_DAYS - 1)) }, "stunden", TODAY)).toBe(true);
    expect(nudgeResting({ stunden: addDays(TODAY, -NUDGE_NO_DAYS) }, "stunden", TODAY)).toBe(false);
    expect(kind({ ...o, no: { stunden: addDays(TODAY, -NUDGE_NO_DAYS) } })).toBe("stunden");
    expect(nudgeResting({ wochenblick: TODAY }, "wochenblick", TODAY)).toBe(false);
    expect(nudgeResting({ stunden: "morgen" }, "stunden", TODAY)).toBe(false);
    expect(nudgeResting(null, "stunden", TODAY)).toBe(false);
    expect(kind({ dreams: [{ id: "d1", flag: "lange" }], no: { traum: "2026-11-15" }, experiment: true })).toBe("experiment");
    expect(kind({ experiment: true, no: { experiment: "2026-11-15" } })).toBeNull();
  });

  it("a goal made today: its weekly hours and steps were asked when it was made, the Anstoss asks them from tomorrow", () => {
    const made = goal({ weekly_hours: null, steps: 0, createdDay: TODAY });
    expect(kind({ goals: [made] })).toBeNull();
    // another item for it may still come (a rhythm, a Plan B after a setback), and an older goal's hours do
    expect(kind({ goals: [{ ...made, planB: true, setback: true }] })).toBe("plan_b");
    expect(dailyNudge(input({ goals: [made, goal({ id: "old", weekly_hours: null, createdDay: "2026-10-01" })] }))?.id).toBe("old");
    expect(kind({ today: "2026-11-18", lastDay: "2026-11-17", goals: [made] })).toBe("stunden");
    expect(kind({ today: "2026-11-18", lastDay: "2026-11-17", goals: [{ ...made, hours_asked_at: "2026-11-18T07:00:00Z" }] })).toBe("etappen");
  });
});

describe("the Wochenblick she asks for herself on the weekend counts for the coming week", () => {
  // Sunday 22 November 2026: «plan mir die Woche» at 10:00, before the window opens at 16:00
  const state = (week: string): ReviewState => ({ week, declines: 0, wanted: null });
  const due = (day: string, minutes: number, week: string) =>
    wochenblickDue({ day, minutes, lastTalk: { day: addDays(day, -1), minutes: 20 * 60 }, state: state(week), hasPlanGoal: true, heavy: false, pause: false });
  it("Saturday and Sunday note the coming Monday; on weekdays the week reviewWeek names", () => {
    expect(reviewNoteWeek("2026-11-22", 10 * 60)).toBe("2026-11-23");
    expect(reviewNoteWeek("2026-11-22", 18 * 60)).toBe("2026-11-23");
    expect(reviewNoteWeek("2026-11-21", 11 * 60)).toBe("2026-11-23");
    expect(reviewNoteWeek("2026-11-23", 8 * 60)).toBe("2026-11-23");
    expect(reviewNoteWeek("2026-11-25", 8 * 60)).toBe("2026-11-23");
    expect(reviewNoteWeek("2026-11-19", 8 * 60)).toBe(reviewWeek("2026-11-19", 8 * 60));
    // before: the ending week was noted, and the Wochenblick came again that evening and on Monday morning
    expect(due("2026-11-22", 18 * 60, reviewWeek("2026-11-22", 10 * 60))).toBe("anbieten");
    expect(due("2026-11-23", 8 * 60, reviewWeek("2026-11-22", 10 * 60))).toBe("anbieten");
    // now: planned on Sunday morning, nothing more this week
    const noted = reviewNoteWeek("2026-11-22", 10 * 60);
    expect(due("2026-11-22", 18 * 60, noted)).toBeNull();
    expect(due("2026-11-23", 8 * 60, noted)).toBeNull();
    expect(due("2026-11-25", 8 * 60, noted)).toBeNull();
    // and the week after, it is due again
    expect(due("2026-11-30", 8 * 60, noted)).toBe("anbieten");
    expect(source).toContain("const week = reviewNoteWeek(day, clock.day === day ? clock.minutes : 12 * 60);");
  });
});

describe("a setback for Plan B, and the size of a proposal", () => {
  const now = Date.parse("2026-11-17T07:00:00Z");
  const g = { id: "G1", title: "Lehrabschlussprüfung" };
  it("a «Nein» to one of its blocks in the last seven days, or a low day with the goal as its focus", () => {
    const no = { goal_id: "g1", ends_at: "2026-11-12T18:00:00Z", minutes: 0 };
    expect(goalSetback(g, [no], [], TODAY, now)).toBe(true);
    expect(goalSetback(g, [{ ...no, ends_at: "2026-11-09T18:00:00Z" }], [], TODAY, now)).toBe(false);
    expect(goalSetback(g, [{ ...no, minutes: 30 }], [], TODAY, now)).toBe(false);
    expect(goalSetback(g, [{ ...no, minutes: null }], [], TODAY, now)).toBe(false);
    expect(goalSetback(g, [{ ...no, goal_id: "g2" }], [], TODAY, now)).toBe(false);
    const low = { day: "2026-11-16", mood: { valence: -0.2 }, focus: "Lernen für die Prüfung" };
    expect(goalSetback(g, [], [low], TODAY, now)).toBe(true);
    expect(goalSetback(g, [], [{ ...low, mood: { valence: 0.3 } }], TODAY, now)).toBe(false);
    expect(goalSetback(g, [], [{ ...low, focus: "Wäsche machen" }], TODAY, now)).toBe(false);
    expect(goalSetback(g, [], [{ ...low, day: "2026-11-14" }], TODAY, now)).toBe(false);
  });

  it("zuletzt geschafft: the shortest and longest of her latest times, a proposal at most twice the longest", () => {
    expect(doneRange([])).toBeNull();
    expect(doneRange([0, -5])).toBeNull();
    expect(doneRange([27, 48, 31])).toEqual({ low: 25, high: 50, cap: 100 });
    // only the latest eight count (an old long session no longer sizes a proposal)
    expect(doneRange([180, 30, 30, 30, 30, 30, 30, 30, 45])).toEqual({ low: 30, high: 45, cap: 90 });
    expect(doneText({ low: 25, high: 50, cap: 100 })).toBe("zuletzt geschafft: 25 bis 50 Min, Vorschläge höchstens 1 Std 40 Min");
    expect(doneText({ low: 45, high: 90, cap: 180 })).toBe("zuletzt geschafft: 45 Min bis 1 Std 30 Min, Vorschläge höchstens 3 Std");
    expect(doneText({ low: 30, high: 30, cap: 60 })).toBe("zuletzt geschafft: 30 Min, Vorschläge höchstens 1 Std");
    const p = { planned: 4, confirmed: 2, partial: 1, missed: 1, open: 1, slot: null, adapt: false };
    expect(patternLine(p, null, { low: 25, high: 50, cap: 100 })).toBe(
      "Blöcke der letzten 4 Wochen: 4 geplant · 2 bestätigt (1 teilweise) · 1 nicht geklappt · 1 offen · zuletzt geschafft: 25 bis 50 Min, Vorschläge höchstens 1 Std 40 Min",
    );
    expect(PERSONA).toContain("Die Länge nimmst du aus „zuletzt geschafft“ beim Ziel, nie länger als dort steht.");
  });
});

// ---------- the coach's context ----------

// Tuesday, 17 November 2026, 07:40 in Zurich (UTC+1)
const base: ContextInput = {
  day: TODAY,
  localTime: "Dienstag, 17. November 2026, 07:40",
  timezone: "Europe/Zurich",
  season: "Herbst",
  phase: "Morgendämmerung",
  hasLocation: true,
  now: "2026-11-17T06:40:00Z",
  lastSeen: "2026-11-16",
  startedAt: "2026-10-01T09:00:00Z",
  profile: { display_name: "Jonas", location_name: "Zürich", summary: null, nature_palette: null },
  memories: [],
  recentDays: [],
  nudge: { day: "2026-11-16", kind: "traum", no: {} },
};
const exam: ContextGoal = {
  id: "g1",
  title: "Lehrabschlussprüfung",
  why: null,
  target_date: "2027-06-30",
  status: "active",
  weekly_hours: null,
  milestones: [],
  hours_asked_at: null,
  steps_asked_at: null,
  plan_b_asked_at: null,
  rhythm_asked_at: null,
};
const shop: ContextEvent = { id: "e1", title: "Laden", starts_at: "2026-11-17T08:00:00Z", ends_at: "2026-11-17T16:00:00Z", all_day: false, location: null, kind: "termin" };
const ctx = (c: Partial<ContextInput>) => contextBlock({ ...base, events: [shop], goals: [exam], series: [], ...c });

describe("the context: «## Anstoss heute (höchstens einer)»", () => {
  it("names the one item, what to ask, the tool that notes it, and its moment", () => {
    const out = section(ctx({}), "Anstoss heute");
    expect(out).toBe(
      "## Anstoss heute (höchstens einer)\n" +
        "- Zeit pro Woche für [g1] „Lehrabschlussprüfung“ (Zieldatum 2027-06-30): frag, wie viele Stunden pro Woche sie realistisch dafür hat · note_offer stunden\n" +
        "Moment: gleich nach ihrem nächsten Ja, Haken oder Erledigten in diesem Gespräch; kommt keins, heute nicht",
    );
    // in the greeting that opens with it: its one question
    expect(section(ctx({ opener: "anstoss" }), "Anstoss heute")).toContain("Moment: diese Begrüssung, als ihre eine Frage");
  });

  it("once one came today: only that, no second; unknown state, a heavy time or a pause: no section", () => {
    expect(section(ctx({ nudge: { day: TODAY, kind: "stunden", no: {} } }), "Anstoss heute")).toBe(
      "## Anstoss heute (höchstens einer)\nHeute kam schon einer (die Zeit pro Woche): kein weiterer von dir aus.",
    );
    expect(ctx({ nudge: undefined })).not.toContain("## Anstoss heute");
    expect(ctx({ today: { mood: { word: "erschöpft", valence: -0.6, energy: 0.2 }, focus: null } })).not.toContain("## Anstoss heute");
    expect(ctx({ lastSeen: "2026-11-05" })).not.toContain("## Anstoss heute");
  });

  it("a goal she made today (her day, in Zurich): its hours were asked then, so not again as today's Anstoss", () => {
    // 23:30 UTC on 16 November is 00:30 on 17 November in Zurich: today
    expect(todayNudge({ ...base, goals: [{ ...exam, created_at: "2026-11-16T23:30:00Z" }], events: [shop], series: [] })).toBeNull();
    expect(todayNudge({ ...base, goals: [{ ...exam, created_at: "2026-11-16T22:30:00Z" }], events: [shop], series: [] })?.kind).toBe("stunden");
  });

  it("zuletzt geschafft from her answered blocks (newest first in the context): the latest eight, not the oldest", () => {
    // nine answered blocks, the oldest 3 hours long; without sessions the size comes from these blocks
    const blocks = Array.from({ length: 9 }, (_, i) => ({
      id: `b${i}`,
      title: "Lernen",
      starts_at: `2026-11-${String(16 - i).padStart(2, "0")}T17:00:00Z`,
      ends_at: `2026-11-${String(16 - i).padStart(2, "0")}T18:00:00Z`,
      all_day: false,
      location: null,
      kind: "block",
      goal_id: "g1",
      minutes: i === 8 ? 180 : i === 0 ? 50 : 25,
    }));
    const goals = [{ ...exam, weekly_hours: 2, hours_asked_at: "2026-11-02T08:00:00Z" }];
    expect(section(ctx({ goals, recentBlocks: blocks }), "Ziele")).toContain("zuletzt geschafft: 25 bis 50 Min, Vorschläge höchstens 1 Std 40 Min");
  });

  it("each kind in her words: steps, Plan B after a «Nein», rhythm (sized from what she did), a dream, the experiment", () => {
    const asked = { ...exam, hours_asked_at: "2026-11-02T08:00:00Z", weekly_hours: 2 };
    expect(section(ctx({ goals: [asked] }), "Anstoss heute")).toContain(
      "- Etappen für [g1] „Lehrabschlussprüfung“ (Zieldatum 2027-06-30): zwei bis vier mit Monat vorschlagen, gespeichert nach ihrem Ja · note_offer etappen",
    );
    const no = { id: "b1", title: "Lernen", starts_at: "2026-11-16T17:00:00Z", ends_at: "2026-11-16T18:00:00Z", all_day: false, location: null, kind: "block", goal_id: "g1", minutes: 0 };
    expect(section(ctx({ goals: [asked], recentBlocks: [no] }), "Anstoss heute")).toContain(
      "- Plan B für [g1] „Lehrabschlussprüfung“ (nach einem Nein zu einem Block oder einem schweren Tag damit; das sprichst du nicht an): frag, was ihr dazwischenkommen könnte · note_offer plan_b",
    );
    const stepped = { ...asked, steps_asked_at: "2026-11-03T08:00:00Z", weekly_hours: 4 };
    // 4 hours a week would make 2 × 1 Std 15 Min; she did 25 to 50 minutes: at most 1 Std 40 Min → 1 Std 30 Min
    expect(section(ctx({ goals: [{ ...stepped, sessions: [25, 40, 50] }] }), "Anstoss heute")).toContain(
      "- Wochenrhythmus für [g1] „Lehrabschlussprüfung“: feste Zeiten anbieten, etwa 2 × 1 Std 30 Min pro Woche, angelegt nach ihrem Ja · note_offer rhythmus",
    );
    expect(section(ctx({ goals: [{ ...stepped, sessions: [25, 40, 50] }] }), "Ziele")).toContain(
      "\n  Wochenrhythmus: noch keiner → einmal anbieten, etwa 2 × 1 Std 30 Min pro Woche\n  Zuletzt geschafft: 25 bis 50 Min, Vorschläge höchstens 1 Std 40 Min",
    );
    const dream: ContextGoal = { id: "d1", title: "Velotour an den Bodensee", kind: "dream", why: null, target_date: null, status: "active", milestones: [], created_at: "2026-11-05T10:00:00Z", reminded_at: null };
    const fresh = { ...base, startedAt: "2026-11-04T09:00:00Z" };
    expect(section(contextBlock({ ...fresh, goals: [dream], events: [] }), "Anstoss heute")).toContain(
      "- Traum [d1] „Velotour an den Bodensee“ (neu, Vorfreude): zuerst nur die Vorfreude; nach ihrer Antwort eine kleine Version, die schon jetzt geht, oder ein erster Schritt, gespeichert nach ihrem Ja · update_goal reminded",
    );
    expect(section(contextBlock({ ...base, goals: [], hints: { experiment: true } }), "Anstoss heute")).toContain("- Ein kleines Experiment aus ihren Werten oder der Jahreszeit");
  });

  it("the Wochenblick is the Anstoss when due; once another came today it waits (unless she plans the week)", () => {
    const review = { due: "anbieten" as const, monday: "2026-11-09", goals: [] };
    expect(section(ctx({ review }), "Anstoss heute")).toContain("- Wochenblick (siehe „Wochenblick“)");
    expect(section(ctx({ review, opener: "wochenblick" }), "Anstoss heute")).toContain("Moment: diese Begrüssung, als ihre eine Frage");
    expect(section(ctx({ review }), "Wochenblick")).toContain("anbieten: einmal");
    const spent = ctx({ review, nudge: { day: TODAY, kind: "stunden", no: {} } });
    expect(section(spent, "Wochenblick")).toContain("heute nicht von dir aus (heute kam schon ein Anstoss); will sie selbst die Woche planen, nimm diese Zahlen");
    // the Wochenblick itself was today's Anstoss: it goes on
    expect(section(ctx({ review, nudge: { day: TODAY, kind: "wochenblick", no: {} } }), "Wochenblick")).toContain("anbieten: einmal");
  });

  it("every active goal gets the Wochenblick, and she can always ask for it", () => {
    expect(hasPlanGoal([{ status: "active" }])).toBe(true);
    const state: ReviewState = { week: null, declines: 0, wanted: null };
    expect(wochenblickDue({ day: "2026-11-16", minutes: 8 * 60, lastTalk: { day: "2026-11-15", minutes: 20 * 60 }, state, hasPlanGoal: hasPlanGoal([exam]), heavy: false, pause: false })).toBe("anbieten");
    expect(MODE_CHECKIN).toContain("Will sie selbst die Woche planen („plan mir die Woche“), machst du ihn auch, wenn er nicht fällig ist.");
  });
});

describe("the greeting with the Anstoss (opener «anstoss»)", () => {
  const situation = { minutes: 8 * 60, pause: false, wochenblick: false, available: ["termin", "schlaf", "jahreszeit"] as OpenerKind[] };
  it("after a restart, her «zurückkommen» and the Wochenblick; before the evening and the rotating openers", () => {
    expect(chooseOpener({ ...situation, anstoss: true }, [], TODAY)).toBe("anstoss");
    expect(chooseOpener({ ...situation, anstoss: true, minutes: 19 * 60 }, [], TODAY)).toBe("anstoss");
    expect(chooseOpener({ ...situation, anstoss: true, pause: true }, [], TODAY)).toBe("neustart");
    expect(chooseOpener({ ...situation, anstoss: true, comeBack: true }, [], TODAY)).toBe("zurueck");
    expect(chooseOpener({ ...situation, anstoss: true, wochenblick: true }, [], TODAY)).toBe("wochenblick");
    expect(chooseOpener(situation, [], TODAY)).not.toBe("anstoss");
  });

  it("one half sentence about the day (in the evening: about her day), then the Anstoss as the one question", () => {
    expect(openerLine("anstoss", { ...base, goals: [exam] })).toBe(
      "Anstoss: ein Halbsatz zum Tag (das Licht, das Wetter oder was ansteht), dann als einzige Frage der Anstoss (siehe „Anstoss heute“), mit Ausweg",
    );
    const evening = { ...base, now: "2026-11-17T18:30:00Z", events: [{ ...shop, title: "Malen mit Lina", starts_at: "2026-11-17T14:30:00Z", ends_at: "2026-11-17T16:00:00Z" }] };
    expect(openerLine("anstoss", evening)).toBe(
      "Anstoss: ein warmer Halbsatz zu Eintrag „Malen mit Lina“ um 15:30, dann als einzige Frage der Anstoss (siehe „Anstoss heute“), mit Ausweg",
    );
    expect(openerLine("anstoss", { ...base, now: "2026-11-17T18:30:00Z" })).toContain("ein ruhiger Halbsatz zum Abend");
  });
});

describe("the rules: one Anstoss, its moment, one sentence with a way out", () => {
  it("replaces the «ruhige Stelle» (prompt.ts:142, :148 before) with the moment, and never piles up", () => {
    expect(MODE_CHECKIN).toContain(
      "Ja, Haken oder Erledigtes heisst: Sie sagt in diesem Gespräch zu etwas Ja, hakt etwas ab oder erzählt, dass sie etwas erledigt hat; dann kommt der Anstoss gleich nach deinem kurzen Wort dazu.",
    );
    // the day's block proposal of the morning is no Anstoss; beyond it, one thing of its own a day
    expect(MODE_CHECKIN).toContain("Über den Vorschlag für heute hinaus bringst du von dir aus am Tag höchstens eine Sache ein");
    expect(MODE_CHECKIN).toContain("Ein Satz, eine Frage und ein Ausweg („sonst schauen wir ein andermal“).");
    expect(MODE_CHECKIN).toContain("sagt sie Nein, rufst du es nochmals mit nein: true auf (beim Traum nicht_jetzt) und lässt es.");
    for (const p of [PERSONA, MODE_CHECKIN]) {
      expect(p).not.toMatch(/ruhigen Stelle (?:eines vorschlagen|einmal vorschlagen)|nimmst du höchstens einen davon|Einrichtungsfrage|Biete ab und zu an/);
      expect(p.replace("„ss“ statt „ß“", "")).not.toContain("ß");
    }
    // the far horizon keeps its year only when it comes up, and asks once for a small version that works now
    expect(PERSONA).toContain("fragst einmal nach einer kleinen Version, die schon jetzt geht, etwa mit den Enkeln, und schliesst nie mit einem Datum");
  });
});

describe("the coach notes the day's Anstoss (index.ts, rules.ts)", () => {
  it("note_offer: stunden and etappen once per goal, her «Nein», and the day noted for every Anstoss kind", () => {
    expect(offerNudgeKind("stunden")).toBe("stunden");
    expect(offerNudgeKind("etappen")).toBe("etappen");
    expect(offerNudgeKind("plan_b")).toBe("plan_b");
    expect(offerNudgeKind("rhythmus")).toBe("rhythmus");
    expect(offerNudgeKind("experiment")).toBe("experiment");
    expect(offerNudgeKind("blockmuster")).toBeNull();
    expect(offerNudgeKind("begleitung")).toBeNull();
    expect(offerNudgeKind("flaute")).toBeNull();
    expect(source).toContain('nein: { type: "boolean", description: "true, wenn sie zu diesem Anstoss Nein gesagt hat: Dann ruht diese Art zwei Wochen." },');
    expect(source).toContain('.update(what === "stunden" ? { hours_asked_at: new Date().toISOString() } : { steps_asked_at: new Date().toISOString() })');
    expect(source).toContain("if (kind) await noteNudge(sb, day, kind, no);");
    expect(source).toContain('return JSON.stringify({ ok: true, notiert: no ? NUDGE_NO_NOTE : note });');
    expect(NUDGE_NO_NOTE).toContain("ruht jetzt zwei Wochen");
    // a dream brought up (its «nicht jetzt»: the dreams rest two weeks), the Wochenblick, the greeting that carries it
    expect(source).toContain('if (patch.reminded_at && goal.kind === "dream" && ctx.mode === "checkin") await noteNudge(sb, day, "traum", notNow);');
    expect(source).toContain('await noteNudge(sb, day, "wochenblick");');
    expect(source).toContain('anstoss: !!nudge?.greeting && nudge.kind !== "wochenblick",');
    expect(source).toContain('if (kind !== stored && nudge && (kind === "anstoss" || (kind === "wochenblick" && nudge.kind === "wochenblick"))) await noteNudge(sb, context.day, nudge.kind);');
    expect(source).toContain('sb.rpc("note_nudge", { p_day: day, p_kind: kind, p_no: no })');
    // the state, unknown before the migration (then no Anstoss), and the Wochenblick for every active goal
    expect(source).toContain('sb.from("profiles").select("nudge_day, nudge_kind, nudge_no").eq("id", userId).maybeSingle(),');
    expect(source).toContain("nudge: dailyCtx?.nudge,");
    expect(source).toContain("hasPlanGoal: hasPlanGoal(goals),");
  });

  it("the migration: the asked marks, the day and her «Nein» per kind, note_nudge, the opener «anstoss»", () => {
    expect(migration).toContain("add column if not exists hours_asked_at timestamptz");
    expect(migration).toContain("add column if not exists steps_asked_at timestamptz;");
    expect(migration).toContain("'rhythm_asked_at', 'hours_asked_at', 'steps_asked_at', 'updated_at'");
    expect(migration).toContain("add column if not exists nudge_no jsonb not null default '{}'::jsonb;");
    expect(migration).toContain("select k in ('wochenblick', 'stunden', 'plan_b', 'etappen', 'rhythmus', 'traum', 'experiment')");
    expect(migration).toContain("language plpgsql security invoker set search_path = '' as $$");
    expect(migration).toContain("where id = auth.uid();");
    expect(migration).toContain("'abend_frage', 'zurueck', 'anstoss'");
    expect(migration).not.toMatch(/security definer/i);
    expect(migration).not.toContain("ß");
  });
});

// ---------- three simulated weeks ----------

describe("three weeks with Jonas: at most one Anstoss a day, kinds run out, quiet after a «Nein»", () => {
  // He started on 2 November; his exam is far ahead, without weekly hours or steps; a dream from his first week.
  type Day = { yes: boolean; answer?: "ja" | "nein" };
  const script: Record<string, Day> = {
    "2026-11-16": { yes: true, answer: "ja" }, // Monday: the Wochenblick (greeting), done
    "2026-11-17": { yes: true, answer: "ja" }, // a tick → weekly hours: 2
    "2026-11-18": { yes: false },
    "2026-11-19": { yes: true, answer: "nein" }, // steps: «Nein» → steps rest 14 days
    "2026-11-20": { yes: false },
    "2026-11-21": { yes: false }, // Saturday: a dream would come first, but no moment and not yet three days
    "2026-11-22": { yes: false, answer: "ja" }, // Sunday: three days without one → the greeting, the dream
    "2026-11-23": { yes: true, answer: "nein" }, // Monday: the Wochenblick (greeting), declined
    "2026-11-24": { yes: true, answer: "ja" }, // after Monday's «Nein» to a block: Plan B
    "2026-11-25": { yes: true, answer: "nein" }, // rhythm: «Nein» → rhythms rest 14 days
    "2026-11-26": { yes: true }, // a second goal comes; its steps and rhythm rest
    "2026-11-27": { yes: true },
    "2026-11-28": { yes: false },
    "2026-11-29": { yes: false },
    "2026-11-30": { yes: true, answer: "ja" }, // Monday: the Wochenblick (greeting), done
    "2026-12-01": { yes: true },
    "2026-12-02": { yes: true },
    "2026-12-03": { yes: true, answer: "ja" }, // 14 days after the «Nein», three after the last one: steps (greeting)
    "2026-12-04": { yes: true },
    "2026-12-05": { yes: true },
    "2026-12-06": { yes: false },
  };
  const days = Object.keys(script);

  const exam2: ContextGoal = { ...exam, created_at: "2026-11-02T10:00:00Z", updated_at: "2026-11-02T10:00:00Z" };
  const dream: ContextGoal = {
    id: "d1",
    title: "Velotour an den Bodensee",
    kind: "dream",
    why: null,
    target_date: null,
    status: "active",
    milestones: [],
    created_at: "2026-11-03T10:00:00Z",
    updated_at: "2026-11-03T10:00:00Z",
    reminded_at: null,
  };
  const course: ContextGoal = {
    id: "g2",
    title: "Velo-Service-Kurs",
    why: null,
    target_date: "2027-03-31",
    status: "active",
    weekly_hours: 1,
    milestones: [],
    hours_asked_at: null,
    steps_asked_at: null,
    plan_b_asked_at: null,
    rhythm_asked_at: null,
    created_at: "2026-11-26T10:00:00Z",
  };

  it("runs the moment rule day by day", () => {
    let goals: ContextGoal[] = [structuredClone(exam2), structuredClone(dream)];
    const nudge: { day: string | null; kind: string | null; no: Record<string, string> } = { day: "2026-11-15", kind: null, no: {} };
    const review: ReviewState = { week: null, declines: 0, wanted: null };
    const openers: { day: string; kind: string }[] = [];
    const recentBlocks: (ContextEvent & { minutes: number | null })[] = [];
    const seen: { day: string; kind: string; at: "begruessung" | "nach_ja" }[] = [];
    const g = (id: string) => goals.find((x) => x.id === id)!;

    for (const day of days) {
      const s = script[day];
      if (day === "2026-11-24")
        recentBlocks.push({ id: "b1", title: "Lernen", starts_at: "2026-11-23T17:00:00Z", ends_at: "2026-11-23T18:00:00Z", all_day: false, location: null, kind: "block", goal_id: "g1", minutes: 0 });
      if (day === "2026-11-26") goals = [...goals, structuredClone(course)];
      const weekend = ["2026-11-21", "2026-11-22", "2026-11-28", "2026-11-29", "2026-12-05", "2026-12-06"].includes(day);
      const events: ContextEvent[] = weekend ? [] : [{ ...shop, starts_at: `${day}T08:00:00Z`, ends_at: `${day}T16:00:00Z` }];
      const prev = addDays(day, -1);
      const due = wochenblickDue({ day, minutes: 8 * 60, lastTalk: { day: prev, minutes: 20 * 60 }, state: review, hasPlanGoal: hasPlanGoal(goals), heavy: false, pause: false });
      const c = (): ContextInput => ({
        ...base,
        day,
        localTime: `${day}, 08:00`,
        now: `${day}T07:00:00Z`,
        lastSeen: prev,
        startedAt: "2026-11-02T09:00:00Z",
        goals: structuredClone(goals),
        events,
        recentBlocks,
        series: [],
        review: due ? { due, monday: addDays(reviewWeek(day, 8 * 60), -7), goals: [] } : undefined,
        hints: { experiment: experimentDue(goals, null, day, (iso) => iso.slice(0, 10)) },
        nudge: structuredClone(nudge),
      });

      // the first greeting of the day
      const first = c();
      const n0 = todayNudge(first);
      const opener = chooseOpener(
        { minutes: 8 * 60, pause: false, wochenblick: !!first.review, available: openerCandidates(first), quiet: false, anstoss: !!n0?.greeting && n0.kind !== "wochenblick" },
        openers,
        day,
      );
      openers.push({ day, kind: opener });
      let made: DailyNudge | null = null;
      if (n0 && (opener === "anstoss" || (opener === "wochenblick" && n0.kind === "wochenblick"))) {
        expect(section(contextBlock({ ...first, opener }), "Anstoss heute")).toContain("Moment: diese Begrüssung, als ihre eine Frage");
        made = n0;
        seen.push({ day, kind: n0.kind, at: "begruessung" });
      } else if (s.yes) {
        // later, right after her yes, a tick or something done
        const later = c();
        const n1 = todayNudge(later);
        if (n1) {
          expect(section(contextBlock(later), "Anstoss heute")).toContain("Moment: gleich nach ihrem nächsten Ja, Haken oder Erledigten");
          made = n1;
          seen.push({ day, kind: n1.kind, at: "nach_ja" });
        }
      }
      if (!made) continue;

      // the coach's tools note it: the day (note_nudge) and the item's «once» mark
      nudge.day = day;
      nudge.kind = made.kind;
      const at = `${day}T07:30:00Z`;
      if (made.kind === "stunden") g(made.id!).hours_asked_at = at;
      if (made.kind === "etappen") g(made.id!).steps_asked_at = at;
      if (made.kind === "plan_b") g(made.id!).plan_b_asked_at = at;
      if (made.kind === "rhythmus") g(made.id!).rhythm_asked_at = at;
      if (made.kind === "traum") g(made.id!).reminded_at = at;
      // her answer
      if (s.answer === "nein" && made.kind !== "wochenblick") nudge.no[made.kind] = day;
      if (made.kind === "wochenblick") {
        const week = reviewWeek(day, 8 * 60);
        if (s.answer === "nein") Object.assign(review, { week, declines: review.declines + 1 });
        else Object.assign(review, { week, declines: 0 });
      }
      if (s.answer === "ja" && made.kind === "stunden") g(made.id!).weekly_hours = 2;
      if (s.answer === "ja" && made.kind === "etappen")
        g(made.id!).milestones = [1, 2, 3].map((i) => ({ id: `m${i}`, title: `Etappe ${i}`, due_date: "2027-01-31", done_at: null, position: i }));
      if (s.answer === "ja" && made.kind === "plan_b") g(made.id!).plan_b = "Wenn der Laden lange geht, lerne ich am Morgen.";

      // the rest of the day: nothing more of its own, and the context says so
      const after = c();
      expect(todayNudge(after)).toBeNull();
      expect(section(contextBlock(after), "Anstoss heute")).toContain("Heute kam schon einer");
    }

    expect(seen).toEqual([
      { day: "2026-11-16", kind: "wochenblick", at: "begruessung" },
      { day: "2026-11-17", kind: "stunden", at: "nach_ja" },
      { day: "2026-11-19", kind: "etappen", at: "nach_ja" },
      { day: "2026-11-22", kind: "traum", at: "begruessung" },
      { day: "2026-11-23", kind: "wochenblick", at: "begruessung" },
      { day: "2026-11-24", kind: "plan_b", at: "nach_ja" },
      { day: "2026-11-25", kind: "rhythmus", at: "nach_ja" },
      { day: "2026-11-30", kind: "wochenblick", at: "begruessung" },
      // three days after the last one (30 November) the greeting carries it: steps for the second goal, 14 days after
      // his «Nein» to steps
      { day: "2026-12-03", kind: "etappen", at: "begruessung" },
    ]);
    // at most one a day
    expect(new Set(seen.map((x) => x.day)).size).toBe(seen.length);
    // the items for a goal come once: weekly hours, Plan B and the rhythm for his exam ran out
    for (const k of ["stunden", "plan_b", "rhythmus"]) expect(seen.filter((x) => x.kind === k)).toHaveLength(1);
    // after his «Nein» to steps (19 November) no steps for 14 days, though the second goal had none from 26 November
    const steps = seen.filter((x) => x.kind === "etappen").map((x) => x.day);
    expect(steps).toEqual(["2026-11-19", "2026-12-03"]);
    // after his «Nein» to the rhythm (25 November) no rhythm for the second goal within the 14 days
    expect(seen.some((x) => x.kind === "rhythmus" && x.day > "2026-11-25")).toBe(false);
    // the greeting carried one only for the Wochenblick, or after three days without one
    expect(openers.filter((o) => o.kind === "anstoss").map((o) => o.day)).toEqual(["2026-11-22", "2026-12-03"]);
  });

  it("Sara without an active goal: the experiment once a week (even with a dream), the dream first on the weekend", () => {
    const island: ContextGoal = { id: "d9", title: "Island", kind: "dream", why: null, target_date: "2026-12-20", status: "active", milestones: [], created_at: "2026-09-01T10:00:00Z", reminded_at: null };
    const c = (day: string, o: Partial<ContextInput> = {}): ContextInput => ({
      ...base,
      day,
      now: `${day}T07:00:00Z`,
      lastSeen: addDays(day, -1),
      goals: [island],
      events: [{ ...shop, starts_at: `${day}T08:00:00Z`, ends_at: `${day}T16:00:00Z` }],
      hints: { experiment: true },
      nudge: { day: addDays(day, -1), kind: null, no: {} },
      ...o,
    });
    // a weekday with entries: the dream («guter Zeitpunkt») still comes before the experiment
    expect(todayNudge(c("2026-11-17"))?.kind).toBe("traum");
    // brought up lately: the experiment (the dream has its quiet days)
    expect(todayNudge(c("2026-11-18", { goals: [{ ...island, reminded_at: "2026-11-17T08:00:00Z" }] }))?.kind).toBe("experiment");
    // the experiment noted this week (experimentDue false): nothing left today
    expect(todayNudge(c("2026-11-19", { goals: [{ ...island, reminded_at: "2026-11-17T08:00:00Z" }], hints: { experiment: false } }))).toBeNull();
  });
});

// ---------- the demo mirrors it ----------

describe("the demo coach: the Anstoss right after a tick, its «Nein», once a day", () => {
  class MemoryStorage {
    private m = new Map<string, string>();
    getItem(k: string) {
      return this.m.has(k) ? this.m.get(k)! : null;
    }
    setItem(k: string, v: string) {
      this.m.set(k, String(v));
    }
    removeItem(k: string) {
      this.m.delete(k);
    }
  }
  let b: DemoBackend;
  beforeEach(async () => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
    b = new DemoBackend();
    await b.signUp("demo.anstoss", "geheim1234");
  });
  const today = dayOf();
  const say = async (message?: string) => {
    let text = "";
    const req: CoachRequest = {
      mode: "checkin",
      thread: today,
      message,
      context: { day: today, localTime: "", timezone: "Europe/Zurich", season: "Herbst", phase: "Tag", hasLocation: false },
    };
    await b.coach(req, (e: CoachEvent) => {
      if (e.type === "text") text += e.text;
    });
    return text;
  };

  // the demo's stored data, changed like days going by
  const stored = (change: (u: { goals: { created_at: string }[]; nudge?: { since: string }; messages: Record<string, unknown> }) => void) => {
    const users = JSON.parse(localStorage.getItem("ich.demo.users")!);
    change(users["demo.anstoss"]);
    localStorage.setItem("ich.demo.users", JSON.stringify(users));
  };
  const madeDaysAgo = (n: number) => stored((u) => u.goals.forEach((g) => (g.created_at = `${addDays(today, -n)}T09:00:00.000Z`)));

  it("asks once for the weekly hours of a dated goal after a tick, and a «Nein» lets that kind rest", async () => {
    // only her goal (none of the demo's dreams): the demo's own data
    for (const d of await b.listGoals()) await b.deleteGoal(d.id);
    await b.addGoal({ title: "Lehrabschlussprüfung", target_date: addDays(today, 200) });
    await b.addHabit({ title: "Lernen", per_week: 5 });
    madeDaysAgo(5);
    const reply = await say("Lernen erledigt");
    expect(reply).toContain("Wie viele Stunden pro Woche hast du für „Lehrabschlussprüfung“ realistisch? Sonst schauen wir ein andermal.");
    expect(await say("Nein, lieber nicht")).toBe("Gut, dann lassen wir das.");
    // the same day: no second Anstoss after the next tick
    expect(await say("Lernen erledigt")).not.toContain("Sonst schauen wir ein andermal.");
  });

  it("«Nö.» is a «Nein» too; a goal made today gets no question for its hours (asked when it was made)", async () => {
    for (const d of await b.listGoals()) await b.deleteGoal(d.id);
    await b.addGoal({ title: "Lehrabschlussprüfung", target_date: addDays(today, 200) });
    await b.addHabit({ title: "Lernen", per_week: 5 });
    expect(await say("Lernen erledigt")).not.toContain("Sonst schauen wir ein andermal.");
    madeDaysAgo(2);
    expect(await say("Lernen erledigt")).toContain("Sonst schauen wir ein andermal.");
    expect(await say("Nö.")).toBe("Gut, dann lassen wir das.");
  });

  it("the greeting carries it only after three days without one", async () => {
    for (const d of await b.listGoals()) await b.deleteGoal(d.id);
    await b.addGoal({ title: "Lehrabschlussprüfung", target_date: addDays(today, 200) });
    // the first greeting: the demo starts counting today
    expect(await say()).not.toContain("Sonst schauen wir ein andermal.");
    stored((u) => {
      u.nudge!.since = addDays(today, -3);
      u.messages = {};
      u.goals.forEach((g) => (g.created_at = `${addDays(today, -3)}T09:00:00.000Z`));
    });
    expect(await say()).toContain("Wie viele Stunden pro Woche hast du für „Lehrabschlussprüfung“ realistisch? Sonst schauen wir ein andermal.");
  });
});
