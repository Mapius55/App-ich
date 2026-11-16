import { describe, expect, it } from "vitest";
import { spokenMinutes } from "../src/lib/dates";
import {
  dayPlanText,
  dayRows,
  hm,
  hoursShort,
  largestGap,
  microLine,
  minutesIn,
  monthSummary,
  nowTick,
  plannedMinutes,
  sumDays,
  trackRange,
  weekKind,
  weekPlanText,
  weekSummary,
  weekTrack,
  yearSummary,
  type EventLike,
} from "../src/time/layout";

// Local times, so the tests pass in any time zone.
const at = (day: string, h: number, m = 0) => {
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(y, mo - 1, d, h, m).toISOString();
};
let n = 0;
const ev = (day: string, from: [number, number], to: [number, number] | null, o: Partial<EventLike> = {}): EventLike => ({
  id: `e${++n}`,
  starts_at: at(day, ...from),
  ends_at: to ? at(day, ...to) : null,
  all_day: false,
  kind: "termin",
  goal_id: null,
  ...o,
});
const allDay = (day: string, o: Partial<EventLike> = {}): EventLike => ({ ...ev(day, [0, 0], null), all_day: true, ...o });

const TODAY = "2026-11-14"; // Saturday
const NOW = new Date(2026, 10, 14, 16, 12);

describe("dayRows: order and the JETZT line", () => {
  const vorlesung = ev(TODAY, [8, 0], [9, 45]);
  const lauf = ev(TODAY, [12, 30], [13, 10], { kind: "block", goal_id: "g" });
  const training = ev(TODAY, [17, 0], [18, 0], { kind: "block", goal_id: "g" });
  const znacht = ev(TODAY, [19, 30], [21, 30]);
  const birthday = allDay(TODAY);

  it("lists all-day first, then past, JETZT, upcoming (today)", () => {
    const rows = dayRows([znacht, training, lauf, birthday, vorlesung], TODAY, TODAY, NOW);
    expect(rows.map((r) => (r.type === "now" ? "JETZT" : r.e.id))).toEqual([birthday.id, vorlesung.id, lauf.id, "JETZT", training.id, znacht.id]);
    expect(rows.filter((r) => r.type === "event" && r.past).map((r) => r.type === "event" && r.e.id)).toEqual([vorlesung.id, lauf.id]);
  });

  it("keeps a running entry after the line, and an entry without end is past 30 min after its start", () => {
    const running = ev(TODAY, [15, 30], [17, 0]);
    const short = ev(TODAY, [15, 30], null);
    const rows = dayRows([running, short], TODAY, TODAY, NOW);
    expect(rows.map((r) => (r.type === "now" ? "JETZT" : r.e.id))).toEqual([short.id, "JETZT", running.id]);
  });

  it("puts the line first when nothing is past, last when everything is", () => {
    expect(dayRows([training], TODAY, TODAY, NOW)[0].type).toBe("now");
    const rows = dayRows([vorlesung], TODAY, TODAY, NOW);
    expect(rows[rows.length - 1].type).toBe("now");
  });

  it("has no line on other days or without entries; past days are all past", () => {
    const y = "2026-11-13";
    const rows = dayRows([ev(y, [9, 0], [10, 0]), allDay(y)], y, TODAY, NOW);
    expect(rows.some((r) => r.type === "now")).toBe(false);
    expect(rows.every((r) => r.type === "event" && r.past)).toBe(true);
    const t = "2026-11-15";
    expect(dayRows([ev(t, [9, 0], [10, 0])], t, TODAY, NOW).every((r) => r.type === "event" && !r.past)).toBe(true);
    expect(dayRows([], TODAY, TODAY, NOW)).toEqual([]);
  });
});

describe("largestGap: free time worth planning", () => {
  const tomorrow = "2026-11-15";

  it("finds the largest future gap inside 07–22", () => {
    expect(largestGap([ev(tomorrow, [9, 0], [10, 30])], tomorrow, TODAY, NOW)).toEqual({ start: 630, end: 1320 });
    expect(hm(630)).toBe("10:30");
    // an empty day is free from 07 to 22
    expect(largestGap([], tomorrow, TODAY, NOW)).toEqual({ start: 420, end: 1320 });
  });

  it("starts today at now, rounded up to the quarter hour, and needs at least 2 h", () => {
    const today = [ev(TODAY, [17, 0], [18, 0]), ev(TODAY, [19, 30], [21, 30])];
    expect(largestGap(today, TODAY, TODAY, NOW)).toBeNull(); // 16:15–17:00, 18:00–19:30, 21:30–22:00
    expect(largestGap([ev(TODAY, [20, 0], [21, 0])], TODAY, TODAY, NOW)).toEqual({ start: 975, end: 1200 }); // 16:15–20:00
  });

  it("ignores past days, busy days and all-day entries, and merges overlaps", () => {
    expect(largestGap([], "2026-11-13", TODAY, NOW)).toBeNull();
    const busy = [8, 10, 12, 14, 16].map((h) => ev(tomorrow, [h, 0], [h, 30]));
    expect(largestGap(busy, tomorrow, TODAY, NOW)).toBeNull(); // 5 timed entries
    const four = busy.slice(0, 4);
    expect(largestGap([...four, allDay(tomorrow)], tomorrow, TODAY, NOW)).toEqual({ start: 870, end: 1320 }); // 14:30–22:00
    const overlap = [ev(tomorrow, [7, 0], [12, 0]), ev(tomorrow, [9, 0], [20, 30])];
    expect(largestGap(overlap, tomorrow, TODAY, NOW)).toBeNull(); // only 20:30–22:00 left
  });

  it("prefers the earliest of equal gaps; entries without end block an hour", () => {
    expect(largestGap([ev(tomorrow, [14, 0], [15, 0])], tomorrow, TODAY, NOW)).toEqual({ start: 420, end: 840 }); // 07–14 = 15–22
    expect(largestGap([ev(tomorrow, [8, 0], null), ev(tomorrow, [12, 0], [22, 0])], tomorrow, TODAY, NOW)).toEqual({ start: 540, end: 720 });
    const equal = [ev(tomorrow, [11, 0], [12, 0]), ev(tomorrow, [16, 0], [18, 0])]; // 07–11 (4 h), 12–16 (4 h), 18–22 (4 h)
    expect(largestGap(equal, tomorrow, TODAY, NOW)).toEqual({ start: 420, end: 660 });
  });
});

describe("week track", () => {
  const mon = "2026-11-09";

  it("defaults to 06–22 and widens to whole hours around the week's entries", () => {
    expect(trackRange([])).toEqual({ from: 360, to: 1320 });
    expect(trackRange([ev(mon, [5, 30], [6, 30]), ev("2026-11-12", [21, 0], [23, 10]), allDay(mon)])).toEqual({ from: 300, to: 1440 });
  });

  it("clips segments to the range and marks goal blocks", () => {
    const range = { from: 360, to: 1320 };
    const segs = weekTrack(
      [ev(mon, [5, 0], [7, 0]), ev(mon, [12, 0], [14, 0], { kind: "block", goal_id: "g" }), ev(mon, [21, 0], [23, 0]), ev(mon, [4, 0], [5, 0]), allDay(mon)],
      mon,
      range,
    );
    expect(segs.map((s) => [s.left, s.width, s.goal])).toEqual([
      [0, 60 / 960, false],
      [360 / 960, 120 / 960, true],
      [900 / 960, 60 / 960, false],
    ]);
  });

  it("clips an entry past midnight at the day's end, and places the now tick", () => {
    const segs = weekTrack([ev(mon, [22, 0], null), { ...ev(mon, [23, 0], null), ends_at: at("2026-11-10", 2, 0) }], mon, { from: 360, to: 1440 });
    expect(segs.map((s) => [Math.round(s.left * 1080), Math.round(s.width * 1080)])).toEqual([
      [960, 30],
      [1020, 60],
    ]);
    expect(minutesIn(mon, at("2026-11-10", 2, 0))).toBe(1440 + 120);
    expect(nowTick(NOW, { from: 360, to: 1320 })).toBeCloseTo((972 - 360) / 960);
    expect(nowTick(new Date(2026, 10, 14, 23, 0), { from: 360, to: 1320 })).toBeNull();
  });
});

describe("week summary and micro lines", () => {
  it("knows past, current and future weeks", () => {
    expect(weekKind("2026-11-09", TODAY)).toBe("current");
    expect(weekKind("2026-11-15", TODAY)).toBe("current");
    expect(weekKind("2026-11-08", TODAY)).toBe("past");
    expect(weekKind("2026-11-16", TODAY)).toBe("future");
  });

  it("says the right sentence per kind", () => {
    expect(weekSummary("current", 300, 165)).toBe("7 Std 45 für deine Ziele geplant, 5 Std davon geschafft");
    expect(weekSummary("current", 0, 120)).toBe("2 Std für deine Ziele geplant");
    expect(weekSummary("past", 300, 0)).toBe("5 Std für deine Ziele");
    expect(weekSummary("future", 0, 180)).toBe("3 Std für deine Ziele geplant");
    for (const k of ["past", "current", "future"] as const) expect(weekSummary(k, 0, 0)).toBe("Noch keine Zeit für Ziele geplant");
  });

  it("has a spoken form for the Woche announcement", () => {
    expect(weekSummary("current", 300, 165, spokenMinutes)).toBe("7 Stunden 45 für deine Ziele geplant, 5 Stunden davon geschafft");
    expect(weekSummary("future", 0, 45, spokenMinutes)).toBe("45 Minuten für deine Ziele geplant");
  });

  it("counts planned goal blocks that have not ended", () => {
    const blocks = [
      ev(TODAY, [12, 30], [13, 10], { kind: "block", goal_id: "g" }), // over
      ev(TODAY, [17, 0], [18, 30], { kind: "block", goal_id: "g" }),
      ev(TODAY, [19, 0], [20, 0], { kind: "block" }), // no goal
      ev(TODAY, [20, 0], [21, 0]), // termin
    ];
    expect(plannedMinutes(blocks, NOW)).toBe(90);
  });

  it("writes micro lines for past, today and future days", () => {
    expect(microLine("2026-11-13", TODAY, 105, 0)).toEqual([{ text: "1 Std 45 für Ziele", kind: "done" }]);
    expect(microLine("2026-11-15", TODAY, 0, 150)).toEqual([{ text: "2 Std 30 geplant", kind: "planned" }]);
    expect(microLine(TODAY, TODAY, 60, 90).map((p) => p.text).join(" · ")).toBe("1 Std für Ziele · 1 Std 30 geplant");
    expect(microLine("2026-11-13", TODAY, 0, 0)).toEqual([]);
  });
});

describe("planning texts", () => {
  it("match the copy and the demo coach", () => {
    expect(dayPlanText(TODAY, TODAY)).toBe("Lass uns meinen Tag planen.");
    expect(dayPlanText("2026-11-15", TODAY)).toBe("Lass uns den Tag morgen planen.");
    expect(dayPlanText("2026-11-17", TODAY)).toBe("Lass uns den Tag am Dienstag, 17. November planen.");
    expect(dayPlanText("2027-01-05", TODAY)).toBe("Lass uns den Tag am Dienstag, 5. Januar 2027 planen.");
    expect(weekPlanText("2026-11-12", TODAY)).toBe("Lass uns meine Woche planen.");
    expect(weekPlanText("2026-11-25", TODAY)).toBe("Lass uns die Woche vom 23. November planen.");
    for (const t of [dayPlanText("2026-11-17", TODAY), weekPlanText("2026-11-25", TODAY)]) expect(t).toMatch(/\b(tag|woche)\b.*\bplanen\b/i);
  });
});

describe("year sums", () => {
  const perDay = { "2026-11-01": 90, "2026-11-11": 30, "2026-10-03": 600, "2025-11-02": 50, "2026-11-12": 0 };
  it("sums months and years", () => {
    expect(sumDays(perDay, "2026-11")).toEqual({ minutes: 120, days: 2 });
    expect(sumDays(perDay, "2026")).toEqual({ minutes: 720, days: 3 });
    expect(hoursShort(45)).toBe("45 Min");
    expect(hoursShort(450)).toBe("8 Std");
    expect(hoursShort(0)).toBe("");
    expect(yearSummary(12720, 143)).toBe("212 Std für deine Ziele an 143 Tagen");
    expect(yearSummary(0, 0)).toBe("Hier wächst dein Jahr: Jeder Tag mit Zeit für deine Ziele leuchtet.");
    expect(monthSummary(1440, 18)).toBe("18 Tage · 24 Std für Ziele");
    expect(monthSummary(60, 1)).toBe("1 Tag · 1 Std für Ziele");
  });
});
