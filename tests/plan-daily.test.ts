// The pure helpers of the daily conversation (supabase/functions/_shared/plan.ts): the opener chosen in
// code, a pause, the Wochenblick, what happened today, the «once» rules.
import { describe, expect, it } from "vitest";
import {
  addDays,
  chooseOpener,
  dailySituation,
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
  openWeekBlocks,
  PAUSE_DAYS,
  restingUntil,
  reviewWeek,
  ROTATING_OPENERS,
  sensitiveTopic,
  smallStepMinutes,
  talkClock,
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

  it("in summer time too: Sunday 16:00 on the day the clocks go forward (CEST, UTC+2)", () => {
    expect(localClock(new Date("2027-03-28T13:59:00Z"), "Europe/Zurich")).toEqual({ day: "2027-03-28", minutes: 959, weekday: 6 });
    expect(localClock(new Date("2027-03-28T14:00:00Z"), "Europe/Zurich")).toEqual({ day: "2027-03-28", minutes: 960, weekday: 6 });
    // the hour that doesn't exist: 01:59 CET is followed by 03:00 CEST
    expect(localClock(new Date("2027-03-28T00:59:00Z"), "Europe/Zurich").minutes).toBe(1 * 60 + 59);
    expect(localClock(new Date("2027-03-28T01:00:00Z"), "Europe/Zurich").minutes).toBe(3 * 60);
  });

  it("the clock of her last conversation: a Sunday evening that ran past midnight is still Sunday evening", () => {
    expect(talkClock("2026-11-15", "2026-11-15T17:30:00Z", "Europe/Zurich")).toEqual({ day: "2026-11-15", minutes: 18 * 60 + 30 });
    expect(talkClock("2026-11-15", "2026-11-15T23:10:00Z", "Europe/Zurich")).toEqual({ day: "2026-11-15", minutes: 24 * 60 - 1 });
    expect(talkClock("2027-03-28", "2027-03-28T14:00:00Z", "Europe/Zurich")).toEqual({ day: "2027-03-28", minutes: 960 });
    // the Kennenlernen has its own thread: no day
    expect(talkClock("onboarding", "2026-11-15T17:30:00Z", "Europe/Zurich")).toBeNull();
    expect(talkClock("2026-11-15", "kaputt", "Europe/Zurich")).toBeNull();
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

  it("after a pause: the three days up to her last conversation, which are all there is to go on", () => {
    const days = (vals: [string, number][]) => vals.map(([day, valence]) => ({ day, mood: { valence } }));
    // last talked on Friday 6 November, ten days before today
    const heavyBefore = days([["2026-11-06", -0.6], ["2026-11-05", -0.5], ["2026-11-04", 0.2]]);
    expect(heavyLately(null, heavyBefore, today, "2026-11-06")).toBe(true);
    // without knowing the pause (or with today's anchor), those days are too far back
    expect(heavyLately(null, heavyBefore, today)).toBe(false);
    // light days before the pause: not quiet
    expect(heavyLately(null, days([["2026-11-06", 0.4], ["2026-11-05", -0.5], ["2026-11-04", 0.3]]), today, "2026-11-06")).toBe(false);
    // only the three days up to the last one count
    expect(heavyLately(null, days([["2026-11-03", -0.6], ["2026-11-02", -0.8], ["2026-11-06", 0.3]]), today, "2026-11-06")).toBe(false);
    // no pause (four days): the window stays before today
    expect(heavyLately(null, days([["2026-11-12", -0.6], ["2026-11-11", -0.7]]), today, "2026-11-12")).toBe(false);
    expect(heavyLately(null, days([["2026-11-15", -0.6], ["2026-11-14", -0.7]]), today, "2026-11-15")).toBe(true);
    // today's own mood still counts on its own
    expect(heavyLately({ valence: -0.5 }, [], today, "2026-11-06")).toBe(true);
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

  it("never before her first own conversation on an earlier day: there is no week of hers to look back on", () => {
    expect(wochenblickDue({ ...base, lastTalk: null })).toBeNull();
    expect(wochenblickDue({ ...base, day: "2026-11-16", minutes: 8 * 60, lastTalk: null })).toBeNull();
  });

  it("from Sunday 16:00 in summer time as well", () => {
    const summer = { ...base, lastTalk: { day: "2027-03-25", minutes: 8 * 60 } };
    expect(wochenblickDue({ ...summer, day: "2027-03-28", minutes: 959 })).toBeNull();
    expect(wochenblickDue({ ...summer, day: "2027-03-28", minutes: 960 })).toBe("anbieten");
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

describe("the Wochenblick: last week's blocks nobody answered, one by one", () => {
  it("lists the open ones of that week with their id, in order: her own, timed, ended, for a goal in view", () => {
    const now = new Date("2026-11-23T11:10:00Z");
    const block = (id: string, goal_id: string | null, start: string, end: string | null, o: Record<string, unknown> = {}) => ({ id, goal_id, starts_at: start, ends_at: end, all_day: false, kind: "block", source: "coach", answered: false, ...o });
    const blocks = [
      block("thu", "g1", "2026-11-19T17:00:00Z", "2026-11-19T18:00:00Z"),
      block("tue", "g1", "2026-11-17T17:00:00Z", "2026-11-17T18:00:00Z"),
      block("answered", "g1", "2026-11-18T17:00:00Z", "2026-11-18T18:00:00Z", { answered: true }),
      block("nolio", "g1", "2026-11-20T17:00:00Z", "2026-11-20T18:00:00Z", { source: "nolio" }),
      block("allday", "g1", "2026-11-21T00:00:00Z", "2026-11-22T00:00:00Z", { all_day: true }),
      block("noend", "g1", "2026-11-21T08:00:00Z", null),
      block("other", "g9", "2026-11-21T08:00:00Z", "2026-11-21T09:00:00Z"),
      block("free", null, "2026-11-21T08:00:00Z", "2026-11-21T09:00:00Z"),
      block("termin", "g1", "2026-11-21T08:00:00Z", "2026-11-21T09:00:00Z", { kind: "termin" }),
      block("before", "g1", "2026-11-15T17:00:00Z", "2026-11-15T18:00:00Z"), // the Sunday before
      block("today", "g1", "2026-11-23T06:00:00Z", "2026-11-23T07:00:00Z"), // the new week
      block("sun-late", "g1", "2026-11-22T22:30:00Z", "2026-11-22T22:50:00Z"), // Sunday 23:30 in Zurich: still the week
    ];
    expect(openWeekBlocks(blocks, ["g1"], "2026-11-16", now, zurich).map((b) => b.id)).toEqual(["tue", "thu", "sun-late"]);
    // what weekGoalSummary counts as open is exactly these
    expect(weekGoalSummary(["g1"], blocks, [], "2026-11-16", now, zurich)[0].open_minutes).toBe(60 + 60 + 20);
    // not ended yet: not open
    expect(openWeekBlocks(blocks, ["g1"], "2026-11-16", new Date("2026-11-19T17:30:00Z"), zurich).map((b) => b.id)).toEqual(["tue"]);
  });
});

describe("the Wochenblick over the day the clocks go back (25 October 2026)", () => {
  it("counts the week Monday to Sunday by her days, and a block across the change by its real length", () => {
    const now = new Date("2026-10-26T08:00:00Z");
    const block = (id: string, start: string, end: string) => ({ id, goal_id: "g1", starts_at: start, ends_at: end, all_day: false, kind: "block", source: "coach", answered: false });
    const out = weekGoalSummary(
      ["g1"],
      [
        block("b1", "2026-10-18T22:30:00Z", "2026-10-18T23:30:00Z"), // Monday 19 Oct, 00:30 CEST: in the week
        block("b2", "2026-10-24T23:30:00Z", "2026-10-25T02:30:00Z"), // Sunday 01:30 CEST to 03:30 CET: three real hours
        block("b3", "2026-10-25T21:30:00Z", "2026-10-25T22:30:00Z"), // Sunday 22:30 CET: in the week
        block("b4", "2026-10-25T23:30:00Z", "2026-10-26T00:30:00Z"), // Monday 26 Oct, 00:30 CET: the next week
        block("b5", "2026-10-18T21:30:00Z", "2026-10-18T22:00:00Z"), // Sunday 18 Oct, 23:30 CEST: the week before
      ],
      [
        { goal_id: "g1", day: "2026-10-25", minutes: 45 },
        { goal_id: "g1", day: "2026-10-26", minutes: 30 },
      ],
      "2026-10-19",
      now,
      zurich,
    );
    expect(out).toEqual([{ goal_id: "g1", planned_minutes: 60 + 180 + 60, blocks: 3, done_minutes: 45, open_minutes: 300 }]);
  });
});

describe("the daily situation, from what was stored", () => {
  const state: ReviewState = { week: null, declines: 0, wanted: null };
  // Monday 16 November, 07:40 in Zurich; she talked on Friday
  const base = {
    day: "2026-11-16",
    now: new Date("2026-11-16T06:40:00Z"),
    tz: "Europe/Zurich",
    lastSeenDay: "2026-11-13",
    lastSpoke: { thread: "2026-11-13", created_at: "2026-11-13T07:00:00Z" },
    todayMood: null,
    recentDays: [],
    review: state,
    hasPlanGoal: true,
  };

  it("reads her clock, a pause, a heavy time and whether the Wochenblick is due", () => {
    expect(dailySituation(base)).toEqual({ minutes: 7 * 60 + 40, pause: false, heavy: false, review: "anbieten" });
    // her clock and the thread disagree around midnight: midday
    expect(dailySituation({ ...base, now: new Date("2026-11-15T22:30:00Z") }).minutes).toBe(12 * 60);
  });

  it("a new person's first daily conversation (only the Kennenlernen before): no Wochenblick", () => {
    expect(dailySituation({ ...base, lastSeenDay: null, lastSpoke: null })).toEqual({ minutes: 7 * 60 + 40, pause: false, heavy: false, review: null });
  });

  it("a greeting on Sunday evening she never answered doesn't use up the Wochenblick", () => {
    // the app opened on Sunday at 18:00 (a hidden opener and the greeting), her own last words on Friday
    expect(dailySituation({ ...base, lastSeenDay: "2026-11-15" }).review).toBe("anbieten");
    // she did talk on Sunday evening: that was the first conversation of the new week
    expect(dailySituation({ ...base, lastSeenDay: "2026-11-15", lastSpoke: { thread: "2026-11-15", created_at: "2026-11-15T17:05:00Z" } }).review).toBeNull();
    // a Sunday conversation that ran past midnight counts as Sunday evening
    expect(dailySituation({ ...base, lastSeenDay: "2026-11-15", lastSpoke: { thread: "2026-11-15", created_at: "2026-11-15T23:10:00Z" } }).review).toBeNull();
    // Sunday morning is not the new week yet
    expect(dailySituation({ ...base, lastSeenDay: "2026-11-15", lastSpoke: { thread: "2026-11-15", created_at: "2026-11-15T09:00:00Z" } }).review).toBe("anbieten");
  });

  it("after a pause a restart, not a Wochenblick; in a heavy time neither; an unknown state never offers it", () => {
    expect(dailySituation({ ...base, lastSeenDay: "2026-11-09", lastSpoke: { thread: "2026-11-09", created_at: "2026-11-09T07:00:00Z" } })).toMatchObject({ pause: true, review: null });
    expect(dailySituation({ ...base, todayMood: { valence: -0.6 } })).toMatchObject({ heavy: true, review: null });
    // heavy days before a pause: heavy at the first greeting after it; light ones: not
    const paused = { ...base, lastSeenDay: "2026-11-09", lastSpoke: { thread: "2026-11-09", created_at: "2026-11-09T07:00:00Z" } };
    const moods = (a: number, b: number) => [{ day: "2026-11-09", mood: { valence: a } }, { day: "2026-11-08", mood: { valence: b } }];
    expect(dailySituation({ ...paused, recentDays: moods(-0.6, -0.4) })).toMatchObject({ pause: true, heavy: true, review: null });
    expect(dailySituation({ ...paused, recentDays: moods(0.4, -0.4) })).toMatchObject({ pause: true, heavy: false });
    expect(dailySituation({ ...base, review: null }).review).toBeNull();
    expect(dailySituation({ ...base, hasPlanGoal: false }).review).toBeNull();
  });

  it("Sunday 16:00 in summer time: due from that minute on", () => {
    const sunday = { ...base, day: "2027-03-28", lastSeenDay: "2027-03-26", lastSpoke: { thread: "2027-03-26", created_at: "2027-03-26T07:00:00Z" } };
    expect(dailySituation({ ...sunday, now: new Date("2027-03-28T13:59:00Z") })).toMatchObject({ minutes: 959, review: null });
    expect(dailySituation({ ...sunday, now: new Date("2027-03-28T14:00:00Z") })).toMatchObject({ minutes: 960, review: "anbieten" });
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
    for (const t of [
      "Zahnarzt am Freitag",
      "Termin bei der Ärztin",
      "Therapie um 16 Uhr",
      "Gespräch mit der Bank",
      "Treffen mit dem Anwalt",
      "Trennung besprechen",
      "Physio wegen dem Knie",
      "Termin beim Doktor",
      "Dr. Meier um 9",
      "MRI am Knie",
      "MRT vom Rücken",
      "Röntgen Schulter",
      "Chemo-Termin",
      "Mammografie",
      "Ultraschall",
      "Reha in Valens",
      "Hebamme kommt",
      "Gehaltsgespräch mit dem Chef",
      "Stundenlohn verhandeln",
      "Miete zu hoch",
      "Geld von Papa zurückzahlen",
      "Budget für den Monat",
      "Klage einreichen",
      // a bank, a hospital, a court … as the place of an appointment, without a job
      "Termin bei der Bank wegen der Hypothek",
      "Termin beim Notar",
      "Muss ins Spital",
      "Kontrolle in der Klinik",
      "Verhandlung am Gericht",
      "Anzeige bei der Polizei",
      "Versicherung anrufen wegen dem Unfall",
      "Beim Arzt wegen dem Knie",
      // a job word doesn't make money or health harmless
      "Vorstellungsgespräch, danach zum Arzt",
      "Gehaltsgespräch bei der Bank",
      "Termin beim Arbeitsgericht",
      "Termin bei der Arbeitslosenversicherung wegen der Jobsuche",
      "Beratung beim RAV für die Stellensuche",
    ])
      expect(sensitiveTopic(t), t).toBe(true);
    for (const t of [
      "Läuft am Samstag den Greifenseelauf.",
      "Lauf mit dem Trainingspartner",
      "Prüfung in Statistik",
      "Belohnt sich mit einem Konzert",
      "Reist nach Norwegen",
      "Ferien in Klagenfurt",
      "Bankett der Firma",
      "Bankdrücken mit 60 kg",
      "Das lohnt sich",
      "Velo mieten in Amsterdam",
      "Beim langen Lauf durchgehalten",
      // workplaces: a job, an application or a training there is no private matter
      "Vorstellungsgespräch bei der Bank",
      "Hat am Dienstag ein Vorstellungsgespräch bei der Versicherung.",
      "Bewerbung bei der Polizei abschicken",
      "Bewirbt sich bei der Klinik Hirslanden.",
      "Probetag im Spital",
      "Interview am Bezirksgericht",
      "Schnuppertag beim Notar",
      "Praktikum in einer Anwaltskanzlei",
      "Neue Stelle bei der Bank ab Januar",
      "Erster Arbeitstag bei der Versicherung",
      "Nachtschicht im Spital",
      "Job-Interview bei der Bank",
    ])
      expect(sensitiveTopic(t), t).toBe(false);
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
    // the job interview at a bank is asked about; the appointment at the bank is not
    expect(followUpDue(m("2026-11-15", { content: "Vorstellungsgespräch bei der Bank" }), "2026-11-16")).toBe(true);
    expect(followUpDue(m("2026-11-15", { content: "Termin bei der Bank wegen der Hypothek" }), "2026-11-16")).toBe(false);
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

  // she started ten days ago, the dream is from her first day
  const start = { startDay: addDays(today, -10) };
  it("«neu» in her second week with the app (7 to 20 days), for a dream of her first week, never brought up and not planned", () => {
    expect(dreamNudge(dream(), today, start)).toBe("neu");
    for (const since of [6, 21]) expect(dreamNudge(dream({ created_at: `${addDays(today, -since)}T10:00:00.000Z` }), today, { startDay: addDays(today, -since) })).toBeNull();
    expect(dreamNudge(dream({ created_at: `${addDays(today, -7)}T10:00:00.000Z` }), today, { startDay: addDays(today, -7) })).toBe("neu");
    expect(dreamNudge(dream({ created_at: `${addDays(today, -20)}T10:00:00.000Z` }), today, { startDay: addDays(today, -20) })).toBe("neu");
    expect(dreamNudge(dream({ reminded_at: `${addDays(today, -2)}T10:00:00.000Z` }), today, start)).toBeNull();
    expect(dreamNudge(dream({ target_date: "2028-06-30" }), today, start)).toBeNull();
    expect(dreamNudge(dream(), today, { ...start, lastStepDay: addDays(today, -3) })).toBeNull();
    expect(dreamNudge(dream({ status: "paused" }), today, start)).toBeNull();
  });

  it("never «neu» for a dream added later than her first week, or without knowing when she started", () => {
    // added on her 8th day: a later dream waits on the list like any other
    expect(dreamNudge(dream({ created_at: `${addDays(today, -3)}T10:00:00.000Z` }), today, { startDay: addDays(today, -11) })).toBeNull();
    expect(dreamNudge(dream({ created_at: `${addDays(today, -4)}T10:00:00.000Z` }), today, { startDay: addDays(today, -10) })).toBe("neu");
    // a dream added in her third month, in its own second week: nothing
    expect(dreamNudge(dream(), today, { startDay: addDays(today, -90) })).toBeNull();
    expect(dreamNudge(dream(), today)).toBeNull();
    expect(dreamNudge(dream(), today, { startDay: "irgendwann" })).toBeNull();
  });

  it("rests until nudge_after, then the usual reminders come back", () => {
    const old = dream({ created_at: `${addDays(today, -200)}T10:00:00.000Z`, updated_at: `${addDays(today, -200)}T10:00:00.000Z` });
    expect(dreamNudge(old, today)).toBe("lange");
    expect(dreamNudge({ ...old, nudge_after: addDays(today, 1) }, today)).toBeNull();
    expect(dreamNudge({ ...old, nudge_after: today }, today)).toBe("lange");
    expect(dreamNudge({ ...dream(), nudge_after: addDays(today, 80) }, today)).toBeNull();
    expect(dreamNudge({ ...old, target_date: addDays(today, 20), nudge_after: addDays(today, 30) }, today)).toBeNull();
    expect(restingUntil(addDays(today, 1), today)).toBe(addDays(today, 1));
    expect(restingUntil(today, today)).toBeNull();
    expect(restingUntil(null, today)).toBeNull();
    expect(restingUntil("bald", today)).toBeNull();
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
