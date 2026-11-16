// The pure helpers of the daily conversation (supabase/functions/_shared/plan.ts): the opener chosen in
// code, a pause, the Wochenblick, what happened today, the «once» rules.
import { describe, expect, it } from "vitest";
import {
  addDays,
  chooseOpener,
  daysSinceLast,
  dreamNudge,
  EVENING_QUESTIONS_PER_WEEK,
  experimentDue,
  focusGoal,
  followUpDue,
  hasPlanGoal,
  heavyLately,
  isPause,
  leansOnCoach,
  localClock,
  PAUSE_DAYS,
  reviewWeek,
  ROTATING_OPENERS,
  sensitiveTopic,
  smallStepMinutes,
  todayWins,
  weekGoalSummary,
  wochenblickDue,
  type NudgeGoal,
  type OpenerKind,
  type ReviewState,
} from "../src/lib/plan";

const zurich = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

describe("a pause: the last conversation", () => {
  it("counts whole days since the last conversation; none before today is null", () => {
    expect(daysSinceLast("2026-11-15", "2026-11-16")).toBe(1);
    expect(daysSinceLast("2026-11-07", "2026-11-16")).toBe(9);
    expect(daysSinceLast(null, "2026-11-16")).toBeNull();
    expect(daysSinceLast("2026-11-16", "2026-11-16")).toBeNull();
    expect(daysSinceLast("onboarding", "2026-11-16")).toBeNull();
  });

  it("is a pause from five days on (one constant)", () => {
    expect(PAUSE_DAYS).toBe(5);
    expect(isPause(addDays("2026-11-16", -4), "2026-11-16")).toBe(false);
    expect(isPause(addDays("2026-11-16", -5), "2026-11-16")).toBe(true);
    expect(isPause(null, "2026-11-16")).toBe(false);
  });
});

describe("her clock", () => {
  it("reads day, minutes and weekday in her time zone, also around midnight", () => {
    expect(localClock(new Date("2026-11-16T06:40:00Z"), "Europe/Zurich")).toEqual({ day: "2026-11-16", minutes: 7 * 60 + 40, weekday: 0 });
    expect(localClock(new Date("2026-11-15T23:30:00Z"), "Europe/Zurich")).toEqual({ day: "2026-11-16", minutes: 30, weekday: 0 });
    expect(localClock(new Date("2026-11-16T03:00:00Z"), "America/New_York")).toEqual({ day: "2026-11-15", minutes: 22 * 60, weekday: 6 });
  });
});

describe("heavy lately (only from what was stored)", () => {
  const today = "2026-11-16";
  it("today's mood, or two of the moods of the three days before", () => {
    expect(heavyLately({ valence: -0.5 }, [], today)).toBe(true);
    expect(heavyLately({ valence: 0.2 }, [], today)).toBe(false);
    const days = (vals: [number, number | undefined][]) => vals.map(([ago, valence]) => ({ day: addDays(today, -ago), mood: valence === undefined ? null : { valence } }));
    expect(heavyLately(null, days([[1, -0.6], [2, -0.4]]), today)).toBe(true);
    expect(heavyLately(null, days([[1, -0.6], [2, 0.3], [3, 0.1]]), today)).toBe(false);
    // older days don't count
    expect(heavyLately(null, days([[4, -0.6], [5, -0.9]]), today)).toBe(false);
  });
});

describe("the opener, chosen in code", () => {
  const today = "2026-11-16";
  const morning = { minutes: 7 * 60 + 30, pause: false, wochenblick: false, available: ROTATING_OPENERS };

  it("a situation comes first: a restart after a pause, then a due Wochenblick, then the evening", () => {
    expect(chooseOpener({ ...morning, pause: true, wochenblick: true }, [], today)).toBe("neustart");
    expect(chooseOpener({ ...morning, wochenblick: true }, [], today)).toBe("wochenblick");
    expect(chooseOpener({ ...morning, minutes: 18 * 60 }, [], today)).toBe("abend_frage");
  });

  it("rotates: never yesterday's while another fits, the one used longest ago first", () => {
    expect(chooseOpener(morning, [], today)).toBe("termin");
    expect(chooseOpener(morning, [{ day: "2026-11-15", kind: "termin" }], today)).toBe("gestern");
    const recent = [
      { day: "2026-11-15", kind: "gestern" },
      { day: "2026-11-14", kind: "ziel" },
      { day: "2026-11-13", kind: "schlaf" },
      { day: "2026-11-12", kind: "termin" },
      { day: "2026-11-11", kind: "jahreszeit" },
    ];
    expect(chooseOpener(morning, recent, today)).toBe("jahreszeit");
    // only yesterday's kind fits: then it may come again
    expect(chooseOpener({ ...morning, available: ["termin"] }, [{ day: "2026-11-15", kind: "termin" }], today)).toBe("termin");
  });

  it("in a heavy time only the gentle kinds: sleep or the season, never a goal or yesterday", () => {
    expect(chooseOpener({ ...morning, quiet: true }, [], today)).toBe("schlaf");
    expect(chooseOpener({ ...morning, quiet: true }, [{ day: "2026-11-15", kind: "schlaf" }], today)).toBe("jahreszeit");
    expect(chooseOpener({ ...morning, minutes: 14 * 60, quiet: true }, [], today)).toBe("jahreszeit");
    // the restart and the evening say «leise» themselves
    expect(chooseOpener({ ...morning, quiet: true, pause: true }, [], today)).toBe("neustart");
  });

  it("asks about sleep only in the morning, and falls back to the season", () => {
    expect(chooseOpener({ ...morning, minutes: 13 * 60, available: ["schlaf"] }, [], today)).toBe("jahreszeit");
    expect(chooseOpener({ ...morning, available: [] }, [], today)).toBe("jahreszeit");
  });

  it("a week of mornings uses at least four kinds, and never the same twice in a row", () => {
    const recent: { day: string; kind: OpenerKind }[] = [];
    // termin and gestern are not there every day
    for (let i = 0; i < 7; i++) {
      const day = addDays("2026-11-16", i);
      const available: OpenerKind[] = ["ziel", "schlaf", "jahreszeit", ...(i % 2 ? (["termin"] as const) : []), ...(i % 3 === 0 ? (["gestern"] as const) : [])];
      recent.unshift({ day, kind: chooseOpener({ ...morning, available }, recent, day) });
    }
    expect(new Set(recent.map((r) => r.kind)).size).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < recent.length; i++) expect(recent[i].kind).not.toBe(recent[i - 1].kind);
  });

  it("the evening question: at most three evenings in seven, never two in a row", () => {
    const recent: { day: string; kind: OpenerKind }[] = [];
    for (let i = 0; i < 14; i++) {
      const day = addDays("2026-11-16", i);
      recent.unshift({ day, kind: chooseOpener({ ...morning, minutes: 19 * 60 }, recent, day) });
    }
    const asked = recent.map((r) => r.kind === "abend_frage");
    for (let i = 0; i + 7 <= asked.length; i++) expect(asked.slice(i, i + 7).filter(Boolean).length).toBeLessThanOrEqual(EVENING_QUESTIONS_PER_WEEK);
    for (let i = 1; i < asked.length; i++) expect(asked[i] && asked[i - 1]).toBe(false);
    expect(asked.filter(Boolean).length).toBeGreaterThan(0);
  });
});

describe("the Wochenblick", () => {
  const state: ReviewState = { week: null, declines: 0, wanted: null };
  const base = { day: "2026-11-15", minutes: 17 * 60, lastTalk: { day: "2026-11-13", minutes: 8 * 60 }, state, hasPlanGoal: true, heavy: false, pause: false };

  it("looks ahead to the coming week from Sunday 16:00, else to the current one", () => {
    expect(reviewWeek("2026-11-15", 15 * 60 + 59)).toBe("2026-11-09");
    expect(reviewWeek("2026-11-15", 16 * 60)).toBe("2026-11-16");
    expect(reviewWeek("2026-11-16", 7 * 60)).toBe("2026-11-16");
    expect(reviewWeek("2026-11-18", 7 * 60)).toBe("2026-11-16");
  });

  it("is due in the first conversation from Sunday 16:00, else in the first one of the new week", () => {
    expect(wochenblickDue(base)).toBe("anbieten");
    expect(wochenblickDue({ ...base, minutes: 15 * 60 })).toBeNull();
    // Monday: nothing since Sunday 16:00 yet
    expect(wochenblickDue({ ...base, day: "2026-11-16", minutes: 7 * 60, lastTalk: { day: "2026-11-15", minutes: 10 * 60 } })).toBe("anbieten");
    // Monday after a conversation on Sunday evening: that one was the first
    expect(wochenblickDue({ ...base, day: "2026-11-16", minutes: 7 * 60, lastTalk: { day: "2026-11-15", minutes: 18 * 60 } })).toBeNull();
    // up to Wednesday; on Thursday the week has gone on
    expect(wochenblickDue({ ...base, day: "2026-11-18", minutes: 9 * 60 })).toBe("anbieten");
    expect(wochenblickDue({ ...base, day: "2026-11-19", minutes: 9 * 60 })).toBeNull();
    // Tuesday after a conversation on Monday
    expect(wochenblickDue({ ...base, day: "2026-11-17", minutes: 9 * 60, lastTalk: { day: "2026-11-16", minutes: 8 * 60 } })).toBeNull();
  });

  it("not after it was done or declined for that week (Sunday evening covers Monday)", () => {
    expect(wochenblickDue({ ...base, state: { ...state, week: "2026-11-16" } })).toBeNull();
    expect(wochenblickDue({ ...base, day: "2026-11-16", minutes: 8 * 60, state: { ...state, week: "2026-11-16" } })).toBeNull();
    expect(wochenblickDue({ ...base, state: { ...state, week: "2026-11-09" } })).toBe("anbieten");
  });

  it("after two declines in a row it asks once whether she wants it; her answer is kept", () => {
    expect(wochenblickDue({ ...base, state: { week: "2026-11-09", declines: 2, wanted: null } })).toBe("fragen");
    expect(wochenblickDue({ ...base, state: { week: "2026-11-09", declines: 2, wanted: false } })).toBeNull();
    expect(wochenblickDue({ ...base, state: { week: "2026-11-09", declines: 3, wanted: true } })).toBe("anbieten");
    expect(wochenblickDue({ ...base, state: { week: "2026-11-09", declines: 1, wanted: null } })).toBe("anbieten");
  });

  it("needs a goal with a plan, and never comes in a heavy time or after a pause", () => {
    expect(wochenblickDue({ ...base, hasPlanGoal: false })).toBeNull();
    expect(wochenblickDue({ ...base, heavy: true })).toBeNull();
    expect(wochenblickDue({ ...base, pause: true })).toBeNull();
  });

  it("a goal with a plan: active, not a dream, with weekly hours or a block", () => {
    expect(hasPlanGoal([{ id: "g1", status: "active", weekly_hours: 4 }], [])).toBe(true);
    expect(hasPlanGoal([{ id: "g1", status: "active", weekly_hours: null }], ["g1"])).toBe(true);
    expect(hasPlanGoal([{ id: "g1", status: "active", weekly_hours: null }], ["g2"])).toBe(false);
    expect(hasPlanGoal([{ id: "d1", kind: "dream", status: "active", weekly_hours: 3 }], ["d1"])).toBe(false);
    expect(hasPlanGoal([{ id: "g1", status: "paused", weekly_hours: 4 }], [])).toBe(false);
  });

  it("plans for one goal: the nearest date ahead, then one with weekly hours, then the first", () => {
    const g = (id: string, o: Partial<{ kind: string; status: string; target_date: string | null; weekly_hours: number | null }> = {}) => ({ id, status: "active", target_date: null, ...o });
    expect(focusGoal([g("a", { target_date: "2027-05-01" }), g("b", { target_date: "2026-12-24" }), g("c", { target_date: "2026-10-01" })], "2026-11-16")?.id).toBe("b");
    expect(focusGoal([g("a"), g("b", { weekly_hours: 3 })], "2026-11-16")?.id).toBe("b");
    expect(focusGoal([g("a"), g("b")], "2026-11-16")?.id).toBe("a");
    expect(focusGoal([g("d", { kind: "dream", target_date: "2026-12-01" }), g("p", { status: "paused" })], "2026-11-16")).toBeNull();
  });

  it("sums planned against done per goal for the week; an unanswered block is open, never a miss", () => {
    const now = new Date("2026-11-16T07:00:00Z");
    const block = (id: string, goal_id: string, start: string, end: string, o: Record<string, unknown> = {}) => ({ id, goal_id, starts_at: start, ends_at: end, all_day: false, kind: "block", source: "coach", answered: false, ...o });
    const out = weekGoalSummary(
      ["g1", "g2", "g3"],
      [
        block("b1", "g1", "2026-11-10T17:00:00Z", "2026-11-10T18:30:00Z", { answered: true }),
        block("b2", "g1", "2026-11-12T17:00:00Z", "2026-11-12T18:00:00Z"),
        block("b3", "g1", "2026-11-14T08:00:00Z", "2026-11-14T09:00:00Z", { source: "nolio" }),
        block("b4", "g1", "2026-11-08T08:00:00Z", "2026-11-08T09:00:00Z"), // the Sunday before
        block("b5", "g1", "2026-11-13T00:00:00Z", "2026-11-14T00:00:00Z", { all_day: true }),
        block("b6", "g2", "2026-11-15T23:30:00Z", "2026-11-16T00:30:00Z"), // Monday 00:30 in Zurich: next week
      ],
      [
        { goal_id: "g1", day: "2026-11-10", minutes: 80 },
        { goal_id: "g1", day: "2026-11-14", minutes: 60 },
        { goal_id: "g1", day: "2026-11-12", minutes: 0 },
        { goal_id: "g3", day: "2026-11-11", minutes: 30 },
        { goal_id: "g3", day: "2026-11-16", minutes: 30 },
      ],
      "2026-11-09",
      now,
      zurich,
    );
    expect(out).toEqual([
      { goal_id: "g1", planned_minutes: 210, blocks: 3, done_minutes: 140, open_minutes: 60 },
      { goal_id: "g3", planned_minutes: 0, blocks: 0, done_minutes: 30, open_minutes: 0 },
    ]);
  });
});

describe("a small restart", () => {
  it("is half her usual block, in steps of 5, from 15 up to 45 minutes", () => {
    expect(smallStepMinutes([60, 90, 60], null)).toBe(30);
    expect(smallStepMinutes([], 6)).toBe(45); // a third of 6 hours is 2 hours: half of it, at most 45
    expect(smallStepMinutes([], 3)).toBe(30);
    expect(smallStepMinutes([], null)).toBe(20);
    expect(smallStepMinutes([20], null)).toBe(15);
    expect(smallStepMinutes([180], null)).toBe(45);
  });
});

describe("what really happened today", () => {
  it("time per goal, steps done today (her day), habits ticked today; nothing only planned", () => {
    const goals = [
      { id: "g1", title: "Halbmarathon Zürich", milestones: [{ title: "15 km am Stück", done_at: "2026-11-16T17:00:00Z" }, { title: "10 km", done_at: "2026-11-01T10:00:00Z" }] },
      { id: "g2", title: "Statistik bestehen", milestones: [{ title: "Kapitel 3", done_at: "2026-11-15T23:30:00Z" }] }, // 16 Nov in Zurich
      { id: "g3", title: "Italienisch", milestones: [{ title: "A1", done_at: null }] },
    ];
    const habits = [
      { title: "Laufen", done_days: ["2026-11-14", "2026-11-16"] },
      { title: "Lesen", done_days: ["2026-11-15"] },
    ];
    expect(todayWins(goals, habits, [{ goal_id: "g1", minutes: 30 }, { goal_id: "g1", minutes: 45 }, { goal_id: "g3", minutes: 0 }], "2026-11-16", zurich)).toEqual([
      { kind: "zeit", title: "Halbmarathon Zürich", minutes: 75 },
      { kind: "etappe", title: "15 km am Stück", goal: "Halbmarathon Zürich" },
      { kind: "etappe", title: "Kapitel 3", goal: "Statistik bestehen" },
      { kind: "gewohnheit", title: "Laufen" },
    ]);
    expect(todayWins(goals, [], [], "2026-11-20", zurich)).toEqual([]);
  });
});

describe("leaning on the coach", () => {
  const today = "2026-11-16";
  const talk = (days: number, n: number) => Object.fromEntries(Array.from({ length: days }, (_, i) => [addDays(today, -(i + 1)), n]));
  const moods = (low: number, ok: number) => [
    ...Array.from({ length: low }, (_, i) => ({ day: addDays(today, -(i + 1)), mood: { valence: -0.6 } })),
    ...Array.from({ length: ok }, (_, i) => ({ day: addDays(today, -(low + i + 1)), mood: { valence: 0.4 } })),
  ];
  it("many messages on most days of two weeks together with mostly heavy moods", () => {
    expect(leansOnCoach(talk(12, 15), moods(8, 2), today)).toBe(true);
    expect(leansOnCoach(talk(12, 5), moods(8, 2), today)).toBe(false); // talks, but little
    expect(leansOnCoach(talk(6, 20), moods(8, 2), today)).toBe(false); // not most days
    expect(leansOnCoach(talk(12, 15), moods(5, 5), today)).toBe(false); // the mood is mixed
  });
});

describe("follow-ups: once, and never on sensitive topics", () => {
  it("knows health, relationships, money and legal matters, and leaves sport and friends alone", () => {
    for (const t of ["Zahnarzt am Freitag", "Termin bei der Ärztin", "Therapie um 16 Uhr", "Gespräch mit der Bank", "Treffen mit dem Anwalt", "Trennung besprechen", "Physio wegen dem Knie"])
      expect(sensitiveTopic(t)).toBe(true);
    for (const t of ["Läuft am Samstag den Greifenseelauf.", "Lauf mit dem Trainingspartner", "Prüfung in Statistik", "Belohnt sich mit einem Konzert", "Reist nach Norwegen"]) expect(sensitiveTopic(t)).toBe(false);
  });

  it("a dated note one to three days back, not asked yet", () => {
    const m = (event_date: string | null, o: Record<string, unknown> = {}) => ({ event_date, content: "Prüfung in Statistik", ...o });
    expect(followUpDue(m("2026-11-15"), "2026-11-16")).toBe(true);
    expect(followUpDue(m("2026-11-13"), "2026-11-16")).toBe(true);
    expect(followUpDue(m("2026-11-12"), "2026-11-16")).toBe(false);
    expect(followUpDue(m("2026-11-16"), "2026-11-16")).toBe(false);
    expect(followUpDue(m(null), "2026-11-16")).toBe(false);
    expect(followUpDue(m("2026-11-15", { followed_up_at: "2026-11-16T07:00:00Z" }), "2026-11-16")).toBe(false);
    expect(followUpDue(m("2026-11-15", { content: "Zahnarzt" }), "2026-11-16")).toBe(false);
  });
});

describe("dreams: the early invitation and the rest after «nicht jetzt»", () => {
  const today = "2026-11-16";
  const dream = (o: Partial<NudgeGoal> = {}): NudgeGoal => ({
    kind: "dream",
    status: "active",
    target_date: null,
    created_at: `${addDays(today, -10)}T10:00:00.000Z`,
    updated_at: `${addDays(today, -10)}T10:00:00.000Z`,
    reminded_at: null,
    ...o,
  });

  it("«neu» in its second week on the list (7 to 20 days), never brought up and not planned", () => {
    expect(dreamNudge(dream(), today)).toBe("neu");
    for (const age of [6, 21]) expect(dreamNudge(dream({ created_at: `${addDays(today, -age)}T10:00:00.000Z` }), today)).toBeNull();
    expect(dreamNudge(dream({ created_at: `${addDays(today, -7)}T10:00:00.000Z` }), today)).toBe("neu");
    expect(dreamNudge(dream({ reminded_at: `${addDays(today, -2)}T10:00:00.000Z` }), today)).toBeNull();
    expect(dreamNudge(dream({ target_date: "2028-06-30" }), today)).toBeNull();
    expect(dreamNudge(dream(), today, { lastStepDay: addDays(today, -3) })).toBeNull();
    expect(dreamNudge(dream({ status: "paused" }), today)).toBeNull();
  });

  it("rests until nudge_after, then the usual reminders come back", () => {
    const old = dream({ created_at: `${addDays(today, -200)}T10:00:00.000Z`, updated_at: `${addDays(today, -200)}T10:00:00.000Z` });
    expect(dreamNudge(old, today)).toBe("lange");
    expect(dreamNudge({ ...old, nudge_after: addDays(today, 1) }, today)).toBeNull();
    expect(dreamNudge({ ...old, nudge_after: today }, today)).toBe("lange");
    expect(dreamNudge({ ...dream(), nudge_after: addDays(today, 80) }, today)).toBeNull();
    expect(dreamNudge({ ...old, target_date: addDays(today, 20), nudge_after: addDays(today, 30) }, today)).toBeNull();
  });
});

describe("a small experiment for people without goals or dreams", () => {
  it("only without anything open, at most once a week", () => {
    expect(experimentDue([], null, "2026-11-16", zurich)).toBe(true);
    expect(experimentDue([{ status: "done" }], null, "2026-11-16", zurich)).toBe(true);
    expect(experimentDue([{ status: "active" }], null, "2026-11-16", zurich)).toBe(false);
    expect(experimentDue([{ status: "paused" }], null, "2026-11-16", zurich)).toBe(false);
    expect(experimentDue([], "2026-11-10T18:00:00Z", "2026-11-16", zurich)).toBe(false);
    expect(experimentDue([], "2026-11-09T18:00:00Z", "2026-11-16", zurich)).toBe(true);
  });
});
