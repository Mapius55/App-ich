import { describe, expect, it } from "vitest";
import { REGIONS } from "../../dehnen/src/types.ts";
import type { HistoryEntry, Region } from "../../dehnen/src/types.ts";
import { addDays, dayKey, daysBetween, heat, regionBalance, streak, totals, weekStart, weekSummary, weekdayIndex } from "../../dehnen/src/logic/stats.ts";

let n = 0;
function entry(day: string, seconds = 600, over: Partial<HistoryEntry> = {}): HistoryEntry {
  n += 1;
  return {
    id: `h${n}`,
    at: `${day}T18:00:00.000Z`,
    day,
    source: "mix",
    title: "Test",
    seconds,
    completed: true,
    exercises: [{ id: "seitbeuge", seconds }],
    regions: { huefte_seitlich: seconds },
    ...over,
  };
}

// 2026-11-26 is a Thursday; 2026-11-29 a Sunday; 2026-11-30 a Monday; 2027-01-01 a Friday.

describe("days", () => {
  it("dayKey is the local calendar day", () => {
    expect(dayKey(new Date(2026, 10, 26, 0, 0, 0))).toBe("2026-11-26");
    expect(dayKey(new Date(2026, 10, 26, 23, 59, 59))).toBe("2026-11-26");
    expect(dayKey(new Date(2027, 0, 1, 0, 0, 1))).toBe("2027-01-01");
    expect(dayKey(new Date(2026, 11, 31, 23, 59, 59))).toBe("2026-12-31");
    expect(dayKey(new Date(2026, 2, 5, 12))).toBe("2026-03-05");
  });

  it("adds days across months, years and the change of summer time", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(daysBetween("2026-12-25", "2027-01-04")).toBe(10);
  });

  it("weeks start on Monday", () => {
    expect(weekdayIndex("2026-11-30")).toBe(0);
    expect(weekdayIndex("2026-11-29")).toBe(6);
    expect(weekStart("2026-11-26")).toBe("2026-11-23");
    expect(weekStart("2026-11-29")).toBe("2026-11-23");
    expect(weekStart("2026-11-30")).toBe("2026-11-30");
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
  });
});

describe("weekSummary", () => {
  const history = [
    entry("2026-11-22", 300), // Sunday of the week before
    entry("2026-11-23", 600), // Monday
    entry("2026-11-26", 400),
    entry("2026-11-26", 200),
    entry("2026-11-29", 900), // Sunday
    entry("2026-11-30", 1000), // Monday of the week after
  ];

  it("Monday to Sunday of today's week", () => {
    const w = weekSummary(history, "2026-11-26");
    expect(w.start).toBe("2026-11-23");
    expect(w.end).toBe("2026-11-29");
    expect(w.days.map((d) => d.day)).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
    expect(w.days.map((d) => d.seconds)).toEqual([600, 0, 0, 600, 0, 0, 900]);
    expect(w.days.map((d) => d.sessions)).toEqual([1, 0, 0, 2, 0, 0, 1]);
    expect(w.days.map((d) => d.isToday)).toEqual([false, false, false, true, false, false, false]);
    expect(w.days.map((d) => d.isFuture)).toEqual([false, false, false, false, true, true, true]);
    expect(w.seconds).toBe(2100);
    expect(w.sessions).toBe(4);
    expect(w.activeDays).toBe(3);
  });

  it("Sunday still belongs to the old week, Monday opens a new one", () => {
    const sunday = weekSummary(history, "2026-11-29");
    expect(sunday.start).toBe("2026-11-23");
    expect(sunday.seconds).toBe(2100);
    expect(sunday.days[6].isToday).toBe(true);
    const monday = weekSummary(history, "2026-11-30");
    expect(monday.start).toBe("2026-11-30");
    expect(monday.end).toBe("2026-12-06");
    expect(monday.seconds).toBe(1000);
    expect(monday.days[0].isToday).toBe(true);
  });

  it("a week across the change of year", () => {
    const h = [entry("2026-12-27", 100), entry("2026-12-28", 200), entry("2026-12-31", 300), entry("2027-01-01", 400), entry("2027-01-03", 500), entry("2027-01-04", 600)];
    const w = weekSummary(h, "2027-01-01");
    expect(w.start).toBe("2026-12-28");
    expect(w.end).toBe("2027-01-03");
    expect(w.seconds).toBe(200 + 300 + 400 + 500);
    expect(w.days[4]).toMatchObject({ day: "2027-01-01", seconds: 400, isToday: true });
    expect(weekSummary(h, "2026-12-31").seconds).toBe(w.seconds);
  });

  it("takes a Date as well", () => {
    const w = weekSummary(history, new Date(2026, 10, 26, 21, 30));
    expect(w.start).toBe("2026-11-23");
    expect(w.days[3].isToday).toBe(true);
  });

  it("an empty history is an empty week", () => {
    const w = weekSummary([], "2026-11-26");
    expect(w.days).toHaveLength(7);
    expect(w.seconds).toBe(0);
    expect(w.activeDays).toBe(0);
  });
});

describe("streak", () => {
  it("counts consecutive days up to today", () => {
    const h = [entry("2026-11-24"), entry("2026-11-25"), entry("2026-11-26")];
    expect(streak(h, "2026-11-26")).toBe(3);
  });

  it("holds until the end of today while today has nothing yet", () => {
    const h = [entry("2026-11-24"), entry("2026-11-25")];
    expect(streak(h, "2026-11-26")).toBe(2);
    expect(streak(h, "2026-11-27")).toBe(0);
  });

  it("a gap ends it, two sessions on a day count once", () => {
    const h = [entry("2026-11-21"), entry("2026-11-22"), entry("2026-11-24"), entry("2026-11-25"), entry("2026-11-25"), entry("2026-11-26")];
    expect(streak(h, "2026-11-26")).toBe(3);
    expect(streak([], "2026-11-26")).toBe(0);
  });

  it("runs across Sunday and Monday and across the change of year", () => {
    const week = [entry("2026-11-28"), entry("2026-11-29"), entry("2026-11-30")];
    expect(streak(week, "2026-11-30")).toBe(3);
    const year = [entry("2026-12-30"), entry("2026-12-31"), entry("2027-01-01"), entry("2027-01-02")];
    expect(streak(year, "2027-01-02")).toBe(4);
    expect(streak(year, "2027-01-03")).toBe(4);
    expect(streak(year, "2027-01-01")).toBe(3);
  });

  it("a session without a second of exercise does not count", () => {
    const h = [entry("2026-11-25"), entry("2026-11-26", 0)];
    expect(streak(h, "2026-11-26")).toBe(1);
    expect(streak([entry("2026-11-26", 0)], "2026-11-26")).toBe(0);
  });

  it("takes a Date as well", () => {
    expect(streak([entry("2026-11-25"), entry("2026-11-26")], new Date(2026, 10, 26, 6, 0))).toBe(2);
  });
});

describe("heat", () => {
  it("columns are weeks, Monday first, the last one is today's week", () => {
    const h = [entry("2026-11-02", 100), entry("2026-11-08", 200), entry("2026-11-26", 300), entry("2026-11-26", 50), entry("2026-10-30", 999)];
    const grid = heat(h, "2026-11-26", 4);
    expect(grid).toHaveLength(4);
    for (const column of grid) {
      expect(column).toHaveLength(7);
      expect(weekdayIndex(column[0].day)).toBe(0);
    }
    expect(grid[0][0]).toEqual({ day: "2026-11-02", seconds: 100 });
    expect(grid[0][6]).toEqual({ day: "2026-11-08", seconds: 200 });
    expect(grid[3][0].day).toBe("2026-11-23");
    expect(grid[3][3]).toEqual({ day: "2026-11-26", seconds: 350 });
    expect(grid[3][6]).toEqual({ day: "2026-11-29", seconds: 0 });
    const all = grid.flat().reduce((sum, d) => sum + d.seconds, 0);
    expect(all).toBe(650);
  });

  it("works across the change of year and with no weeks at all", () => {
    const grid = heat([entry("2026-12-31", 120)], "2027-01-02", 2);
    expect(grid.map((c) => c[0].day)).toEqual(["2026-12-21", "2026-12-28"]);
    expect(grid[1][3]).toEqual({ day: "2026-12-31", seconds: 120 });
    expect(heat([], "2027-01-02", 0)).toEqual([]);
  });
});

describe("regionBalance", () => {
  it("lists all regions, also those with nothing, over the last days including today", () => {
    const regions = (r: Partial<Record<Region, number>>): Partial<HistoryEntry> => ({ regions: r });
    const h = [
      entry("2026-11-26", 300, regions({ huefte_seitlich: 200, lws_ql: 100 })),
      entry("2026-11-20", 300, regions({ huefte_seitlich: 150, nacken: 150 })),
      entry("2026-11-19", 300, regions({ brust: 300 })), // one day too old for 7 days
      entry("2026-11-27", 300, regions({ brust: 300 })), // after today
    ];
    const week = regionBalance(h, "2026-11-26", 7);
    expect(week.map((r) => r.region)).toEqual([...REGIONS]);
    const get = (list: { region: Region; seconds: number }[], region: Region): number => list.find((r) => r.region === region)!.seconds;
    expect(get(week, "huefte_seitlich")).toBe(350);
    expect(get(week, "lws_ql")).toBe(100);
    expect(get(week, "nacken")).toBe(150);
    expect(get(week, "brust")).toBe(0);
    expect(get(week, "hamstrings")).toBe(0);
    expect(get(regionBalance(h, "2026-11-26", 8), "brust")).toBe(300);
    expect(get(regionBalance(h, "2026-11-26", 1), "huefte_seitlich")).toBe(200);
    expect(regionBalance([], "2026-11-26", 14).every((r) => r.seconds === 0)).toBe(true);
  });
});

describe("totals", () => {
  it("adds up sessions, time, days, exercises and the longest run", () => {
    const h = [
      entry("2026-11-01", 600),
      entry("2026-11-02", 300, { completed: false, exercises: [{ id: "taube", seconds: 300 }] }),
      entry("2026-11-02", 200),
      entry("2026-11-03", 100),
      entry("2026-11-10", 0, { exercises: [] }),
      entry("2026-12-31", 400, { exercises: [{ id: "katze", seconds: 400 }, { id: "nie", seconds: 0 }] }),
      entry("2027-01-01", 400),
    ];
    expect(totals(h)).toEqual({ sessions: 6, completed: 5, seconds: 2000, days: 5, exercises: 3, longestStreak: 3 });
    expect(totals([])).toEqual({ sessions: 0, completed: 0, seconds: 0, days: 0, exercises: 0, longestStreak: 0 });
  });
});
