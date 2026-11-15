import { describe, expect, it } from "vitest";
import { lifeWeeks } from "../src/lib/plan";
import type { Goal } from "../src/lib/types";
import { describeView } from "../src/space/describeView";
import { fromHash, toHash, type SpaceState } from "../src/space/state";
import {
  LIFE_ASK,
  LIFE_ASK_HINT,
  LIFE_LINE,
  birthYearOptions,
  cellAt,
  flowRamp,
  flowStops,
  laterHint,
  lifeCount,
  lifeLayout,
  lifeLine,
  lifeMarkers,
  lifePosition,
  lifeSummary,
  markerAt,
  rowTarget,
} from "../src/time/lifeGrid";

// Saturday, 14 November 2026
const TODAY = "2026-11-14";

const dream = (over: Partial<Goal>): Goal =>
  ({
    id: "d1",
    title: "Polarlichter sehen",
    kind: "dream",
    status: "active",
    target_date: null,
    done_at: null,
    memory: null,
    updated_at: "2026-06-10T19:20:00.000Z",
    created_at: "2026-06-10T19:20:00.000Z",
    milestones: [],
    ...over,
  }) as unknown as Goal;

describe("Leben: navigation", () => {
  const at = (level: SpaceState["level"]) => ({ place: "jetzt" as const, level, anchor: TODAY, duSection: null });

  it("#leben is level 4, with no anchor in the hash, and reads back", () => {
    expect(toHash(at(4))).toBe("#leben");
    expect(toHash({ ...at(4), anchor: "2031-02-03" })).toBe("#leben");
    expect(fromHash("#leben", TODAY)).toEqual(at(4));
    expect(fromHash("#Leben", TODAY)).toEqual(at(4));
    expect(fromHash("#leben/2026", TODAY)).toBeNull();
  });

  it("describeView tells the coach «Leben in Wochen»", () => {
    const v = describeView({ place: "jetzt", level: 4, anchor: TODAY, yearGoal: null, detail: null }, () => null);
    expect(v).toBe("Leben in Wochen (90 Jahre, jede Woche ein Punkt)");
    expect(v).toMatch(/^Leben/); // the persona's „Leben“ (Ansicht in der App)
  });
});

describe("Leben: the grid's geometry", () => {
  it("is as wide as the container (375 and 390 with 16 px gutters), square cells, ~1 px gap", () => {
    for (const [w, dpr] of [
      [343, 2],
      [358, 3],
      [343, 1],
    ] as const) {
      const l = lifeLayout(w, dpr);
      expect(l.width).toBeLessThanOrEqual(w);
      expect(l.width).toBeGreaterThan(w - 1);
      expect(l.widthD).toBe(Math.floor(w * dpr));
      expect(l.cell).toBeCloseTo((w - 51) / 52, 0);
      expect(l.height).toBeCloseTo(90 * l.pitch - l.pitch + l.cell, 0);
      // the last cell ends at the right edge, every cell on whole device pixels, a whole-pixel gap
      const last = l.box(89, 51);
      expect(last.x + last.w).toBeLessThanOrEqual(l.widthD);
      expect(last.x + last.w).toBeGreaterThanOrEqual(l.widthD - 1);
      expect(last.y + last.h).toBeLessThanOrEqual(l.heightD);
      for (let c = 0; c < 51; c++) {
        const a = l.box(10, c);
        const b = l.box(10, c + 1);
        expect(Number.isInteger(a.x) && Number.isInteger(a.w)).toBe(true);
        expect(b.x - (a.x + a.w)).toBe(Math.max(1, Math.round(dpr)));
      }
    }
  });

  it("cellAt finds the week under a point, and nothing outside the grid", () => {
    const l = lifeLayout(358, 2);
    expect(cellAt(l, 0, 0)).toEqual({ row: 0, col: 0 });
    expect(cellAt(l, l.width - 0.1, l.height - 0.1)).toEqual({ row: 89, col: 51 });
    const b = l.cssBox(32, 45);
    expect(cellAt(l, b.x + b.w / 2, b.y + b.h / 2)).toEqual({ row: 32, col: 45 });
    expect(cellAt(l, -1, 10)).toBeNull();
    expect(cellAt(l, 10, l.height + 1)).toBeNull();
  });
});

describe("Leben: the colour flow", () => {
  const orb = ["#ff9f81", "#ffeadc", "#faa39b", "#5a2a3a", "#91d4a1"]; // [main, light, accent, deep, accent2]

  it("comes from the circle's palette, never its deep tone", () => {
    const stops = flowStops(orb);
    expect(stops).toHaveLength(4);
    expect(stops.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
    expect(stops).not.toContain(orb[3]);
    // a palette with fewer colours still gives four stops
    expect(flowStops(["#6f86d6", "#b9c8ff"])).toHaveLength(4);
  });

  it("a ramp runs from the first stop to the last", () => {
    const stops = flowStops(orb);
    const ramp = flowRamp(stops, 256);
    expect(ramp).toHaveLength(256);
    expect(ramp[0]).toBe(stops[0]);
    expect(ramp[255]).toBe(stops[3]);
  });

  it("a week's place in life runs from 0 (the first) to 1 (the last)", () => {
    expect(lifePosition(0, 0)).toBe(0);
    expect(lifePosition(89, 51)).toBe(1);
    expect(lifePosition(45, 0)).toBeGreaterThan(lifePosition(44, 51));
  });
});

describe("Leben: dreams on the grid", () => {
  const goals = [
    dream({ id: "a", title: "Polarlichter sehen", target_date: "2027-02-28" }),
    dream({ id: "b", title: "Kirschblüte in Japan erleben" }), // no date: not on the grid
    dream({ id: "c", title: "Hörnlihütte", status: "done", done_at: "2025-08-16T04:40:00.000Z" }),
    dream({ id: "d", title: "Gotthard", status: "done", done_at: "2026-06-21T14:10:00.000Z" }),
    dream({ id: "e", title: "Pausiert", status: "paused", target_date: "2027-05-01" }),
    dream({ id: "f", title: "Fallengelassen", status: "dropped", target_date: "2027-05-01" }),
    dream({ id: "g", title: "Viel später", target_date: "2099-01-01" }), // beyond 90 years of 1994
    { ...dream({ id: "h", title: "Halbmarathon", target_date: "2027-04-01" }), kind: "goal" } as Goal,
  ];

  it("fulfilled dreams at the week they came true, planned dreams at their target week", () => {
    const m = lifeMarkers(goals, 1994);
    expect(m.map((x) => [x.id, x.kind, x.row, x.col])).toEqual([
      ["c", "done", 31, 32],
      ["d", "done", 32, 24],
      ["a", "planned", 33, 8],
    ]);
    expect(m.find((x) => x.id === "c")?.when).toBe("erfüllt im August 2025");
    expect(m.find((x) => x.id === "a")?.when).toBe("geplant für Februar 2027");
  });

  it("a tap finds the nearest point within the radius", () => {
    const l = lifeLayout(358, 2);
    const m = lifeMarkers(goals, 1994);
    const b = l.cssBox(32, 24);
    expect(markerAt(m, l, b.x + 3, b.y + 5, 14)?.id).toBe("d");
    expect(markerAt(m, l, b.x + 40, b.y + 40, 14)).toBeNull();
  });
});

describe("Leben: a tap on a row", () => {
  it("opens that calendar year in Jahr up to next year, later years answer quietly", () => {
    expect(rowTarget(32, 1994, TODAY)).toEqual({ year: 2026, day: TODAY });
    expect(rowTarget(0, 1994, TODAY)).toEqual({ year: 1994, day: "1994-11-14" });
    expect(rowTarget(33, 1994, TODAY)).toEqual({ year: 2027, day: "2027-11-14" });
    expect(rowTarget(34, 1994, TODAY)).toEqual({ year: 2028, later: true });
    expect(rowTarget(2, 1994, "2028-02-29")).toEqual({ year: 1996, day: "1996-02-29" });
    expect(rowTarget(1, 1994, "2028-02-29")).toEqual({ year: 1995, day: "1995-02-28" });
    expect(laterHint(2040)).toBe("2040 liegt noch vor dir.");
  });
});

describe("Leben: the words", () => {
  it("counts the week with the Swiss thousands separator", () => {
    expect(lifeCount(lifeWeeks(1994, TODAY))).toBe("Woche 1’710 von 4’680");
    expect(lifeCount(lifeWeeks(2026, "2026-01-01"))).toBe("Woche 1 von 4’680");
    // outside the grid (more than 90 years): no current week
    expect(lifeCount(lifeWeeks(1930, TODAY))).toBeNull();
  });

  it("the line under the title: «Diese hier leuchtet» only when this week is in the grid", () => {
    expect(lifeLine(lifeWeeks(1994, TODAY))).toBe("Jede Woche ein Punkt. Diese hier leuchtet.");
    expect(lifeLine(lifeWeeks(1930, TODAY))).toBe("Jede Woche ein Punkt.");
  });

  it("the summary for screen readers names what the picture shows", () => {
    const w = lifeWeeks(1994, TODAY);
    expect(lifeSummary(w, [])).toBe("Leben in Wochen: 90 Jahre zu je 52 Wochen, 4680 Punkte, diese Woche ist Woche 1710, sie leuchtet.");
    const m = lifeMarkers([dream({ id: "a", target_date: "2027-02-28" }), dream({ id: "c", status: "done", done_at: "2025-08-16T04:40:00.000Z" })], 1994);
    expect(lifeSummary(w, m)).toContain("1 erfüllter Traum als heller Punkt, 1 geplanter Traum als Ring.");
  });

  it("is calm: Swiss spelling, no countdown, nothing about time running out", () => {
    const all = [LIFE_LINE, LIFE_ASK, LIFE_ASK_HINT, laterHint(2040), lifeCount(lifeWeeks(1994, TODAY))!, lifeSummary(lifeWeeks(1994, TODAY), [])].join(" ");
    expect(all).not.toMatch(/ß/);
    expect(all).not.toMatch(/verbleibend|nur noch|übrig|bleib|Tod|sterb|Countdown|!/i);
    expect(LIFE_LINE).toBe("Jede Woche ein Punkt. Diese hier leuchtet.");
    expect(LIFE_ASK).toBe("Wann bist du geboren? Dann zeige ich dir dein Leben in Wochen.");
    expect(LIFE_ASK_HINT).toBe("Nur das Jahr, nichts weiter.");
  });
});

describe("Leben: the birth-year picker", () => {
  it("offers this year down to 1920, plus a stored year outside that", () => {
    const y = birthYearOptions(2026);
    expect(y[0]).toBe(2026);
    expect(y[y.length - 1]).toBe(1920);
    expect(y).toHaveLength(107);
    expect(birthYearOptions(2026, 1994)).toHaveLength(107);
    const old = birthYearOptions(2026, 1910);
    expect(old[old.length - 1]).toBe(1910);
    expect(old).toHaveLength(108);
  });
});
