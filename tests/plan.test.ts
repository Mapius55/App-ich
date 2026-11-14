import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  daysBetween,
  daysLeftLabel,
  goalProgress,
  habitStreak,
  habitWeek,
  monthGrid,
  perWeekLabel,
  streakLabel,
  weekDays,
  weekStart,
} from "../src/lib/plan";
import type { Goal } from "../src/lib/types";

describe("days and weeks", () => {
  it("adds days across months, years and the change to winter time", () => {
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-11-14", "2026-12-24")).toBe(40);
  });
  it("weeks start on Monday", () => {
    expect(weekStart("2026-11-14")).toBe("2026-11-09"); // Saturday → Monday
    expect(weekStart("2026-11-16")).toBe("2026-11-16"); // Monday
    expect(weekDays("2026-11-15")).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
  });
  it("month grid covers whole weeks of the month", () => {
    const g = monthGrid("2026-11-14");
    expect(g.length % 7).toBe(0);
    expect(g[0].day).toBe("2026-10-26");
    expect(g.filter((d) => d.inMonth).length).toBe(30);
    expect(g.at(-1)!.day).toBe("2026-12-06");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-31", -1)).toBe("2025-12-01");
  });
});

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: "g",
  title: "Halbmarathon",
  why: null,
  target_date: "2026-12-06",
  status: "active",
  source: "person",
  created_at: "",
  updated_at: "",
  milestones: [
    { id: "a", goal_id: "g", title: "10 km am Stück", due_date: null, done_at: "2026-11-01T10:00:00Z", position: 0 },
    { id: "b", goal_id: "g", title: "15 km am Stück", due_date: null, done_at: null, position: 1 },
    { id: "c", goal_id: "g", title: "Tempo-Training", due_date: null, done_at: null, position: 2 },
  ],
  ...over,
});

describe("goals", () => {
  it("progress, days left and the next step", () => {
    const p = goalProgress(goal(), "2026-11-14");
    expect(p).toMatchObject({ done: 1, total: 3, daysLeft: 22 });
    expect(p.ratio).toBeCloseTo(1 / 3);
    expect(p.next?.id).toBe("b");
    expect(goalProgress(goal({ milestones: [], target_date: null }), "2026-11-14")).toMatchObject({ ratio: 0, daysLeft: null, next: null });
  });
  it("labels", () => {
    expect(daysLeftLabel(22)).toBe("noch 22 Tage");
    expect(daysLeftLabel(1)).toBe("morgen");
    expect(daysLeftLabel(0)).toBe("heute");
    expect(daysLeftLabel(-3)).toBe("vor 3 Tagen");
    expect(daysLeftLabel(null)).toBeNull();
  });
});

describe("habits", () => {
  it("daily streak: today still open does not break it", () => {
    const h = { per_week: 7, done_days: ["2026-11-11", "2026-11-12", "2026-11-13"] };
    expect(habitStreak(h, "2026-11-14")).toEqual({ count: 3, unit: "Tag" });
    expect(habitStreak({ ...h, done_days: [...h.done_days, "2026-11-14"] }, "2026-11-14").count).toBe(4);
    expect(habitStreak({ ...h, done_days: ["2026-11-10"] }, "2026-11-14").count).toBe(0);
  });
  it("weekly streak counts weeks that reached the target", () => {
    // 3x per week: last two weeks reached, this week (Mon 9 … Sat 14) has 2 so far
    const h = {
      per_week: 3,
      done_days: ["2026-10-27", "2026-10-29", "2026-10-31", "2026-11-02", "2026-11-04", "2026-11-06", "2026-11-10", "2026-11-12"],
    };
    expect(habitStreak(h, "2026-11-14")).toEqual({ count: 2, unit: "Woche" });
    expect(habitStreak({ ...h, done_days: [...h.done_days, "2026-11-14"] }, "2026-11-14").count).toBe(3);
    const w = habitWeek(h, "2026-11-14");
    expect(w.doneThisWeek).toBe(2);
    expect(w.target).toBe(3);
    expect(w.days.map((d) => d.done)).toEqual([false, true, false, true, false, false, false]);
    expect(w.days.at(-1)!.future).toBe(true);
  });
  it("labels", () => {
    expect(streakLabel({ count: 1, unit: "Woche" })).toBe("1 Woche in Folge");
    expect(streakLabel({ count: 5, unit: "Tag" })).toBe("5 Tage in Folge");
    expect(streakLabel({ count: 0, unit: "Tag" })).toBeNull();
    expect(perWeekLabel(7)).toBe("jeden Tag");
    expect(perWeekLabel(3)).toBe("3× pro Woche");
  });
});

import { durationLabel, goalEffort, hoursLabel } from "../src/lib/plan";

describe("goal effort", () => {
  const base = { effort_hours: 120, weekly_hours: 6, prior_hours: 4, target_date: "2026-12-06", time: { logged_minutes: 600, block_minutes: 120 } };
  it("adds prior hours, logged time and past blocks", () => {
    const e = goalEffort(base, "2026-11-14");
    expect(e.done).toBe(16);
    expect(e.remaining).toBe(104);
    expect(e.weeksLeft).toBeCloseTo(23 / 7, 1);
    expect(e.neededPerWeek).toBeCloseTo(104 / (23 / 7), 0);
    expect(e.feasibility).toBe("kaum machbar"); // ~32 h/week needed, 6 available
  });
  it("machbar, knapp, erreicht", () => {
    expect(goalEffort({ ...base, effort_hours: 30 }, "2026-11-14").feasibility).toBe("machbar"); // 14 left over 3.3 weeks ≈ 4.3/week
    expect(goalEffort({ ...base, effort_hours: 40 }, "2026-11-14").feasibility).toBe("knapp"); // ≈ 7.3/week vs 6
    expect(goalEffort({ ...base, effort_hours: 10 }, "2026-11-14")).toMatchObject({ remaining: 0, feasibility: "erreicht" });
  });
  it("long goals without a date: how long it takes with her weekly time", () => {
    const olympia = goalEffort({ effort_hours: 10000, weekly_hours: 20, prior_hours: 2500, target_date: null, time: { logged_minutes: 0, block_minutes: 0 } }, "2026-11-14");
    expect(olympia.weeksToFinish).toBe(375);
    expect(durationLabel(olympia.weeksToFinish!)).toBe("7 Jahre");
    expect(olympia.feasibility).toBeNull();
    expect(goalEffort({ ...base, effort_hours: null }, "2026-11-14")).toMatchObject({ effort: null, remaining: null, feasibility: null });
  });
  it("labels", () => {
    expect(hoursLabel(10000)).toBe("10'000");
    expect(hoursLabel(12.34)).toBe("12.3");
    expect(hoursLabel(4)).toBe("4");
    expect(durationLabel(3)).toBe("3 Wochen");
    expect(durationLabel(20)).toBe("5 Monate");
  });
});

import { dayMinutes, heatLevel, heatThresholds, yearWeeks } from "../src/lib/plan";

describe("year view", () => {
  const day = (iso: string) => iso.slice(0, 10); // tests run in UTC-like local days
  it("sums logged time and unanswered past blocks per day", () => {
    const log = [
      { day: "2026-11-10", minutes: 60 },
      { day: "2026-11-10", minutes: 30 },
      { day: "2026-11-11", minutes: 0 }, // a block that didn't happen
    ];
    const blocks = [
      { id: "b1", starts_at: "2026-11-12T16:00:00Z", ends_at: "2026-11-12T17:30:00Z", all_day: false, kind: "block", goal_id: "g" },
      { id: "b2", starts_at: "2026-11-11T16:00:00Z", ends_at: "2026-11-11T17:00:00Z", all_day: false, kind: "block", goal_id: "g" }, // answered
      { id: "b3", starts_at: "2026-11-20T16:00:00Z", ends_at: "2026-11-20T17:00:00Z", all_day: false, kind: "block", goal_id: "g" }, // future
      { id: "t1", starts_at: "2026-11-13T09:00:00Z", ends_at: "2026-11-13T10:00:00Z", all_day: false, kind: "termin", goal_id: null },
    ];
    const m = dayMinutes(log, blocks, new Set(["b2"]), new Date("2026-11-14T12:00:00Z"), day);
    expect(m).toEqual({ "2026-11-10": 90, "2026-11-12": 90 });
  });
  it("four steps fitted to her own days", () => {
    const t = heatThresholds([10, 20, 30, 60, 90, 120, 180, 240]);
    expect(t).toEqual([30, 90, 180]);
    expect(heatLevel(0, t)).toBe(0);
    expect(heatLevel(20, t)).toBe(1);
    expect(heatLevel(60, t)).toBe(2);
    expect(heatLevel(150, t)).toBe(3);
    expect(heatLevel(300, t)).toBe(4);
    expect(heatThresholds([])).toEqual([15, 45, 90]);
  });
  it("53 whole weeks ending with this week", () => {
    const w = yearWeeks("2026-11-14");
    expect(w.length).toBe(53);
    expect(w.at(-1)![0]).toBe("2026-11-09");
    expect(w[0][0]).toBe("2025-11-10"); // 52 weeks before this Monday
    expect(w.every((x) => x.length === 7)).toBe(true);
  });
});
