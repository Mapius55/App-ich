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
