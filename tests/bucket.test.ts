// The Bucket List place and Jahr's "gently in the year" (Bucket List round, §2 and §3): the
// order of the place, its small texts, and what the year shows. Pure helpers only.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { bucketParts, daysLeftLine, dreamPlanLine, dreamWhen, fulfilledInYear, fulfilledLabel, fulfilledYearLine, monthYear, openInYear, tellText } from "../src/places/bucket";
import { markWashed, resetWashedForTests, wantsWash, WASH_RECENT } from "../src/places/fulfilled";
import { yearProgress } from "../src/lib/plan";
import type { Goal } from "../src/lib/types";

// local days (done_at → «erfüllt im …») as on the person's phone in Zurich; restored afterwards
const prevTZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "Europe/Zurich";
});
afterAll(() => {
  if (prevTZ === undefined) delete process.env.TZ;
  else process.env.TZ = prevTZ;
});

const TODAY = "2026-11-15";
let n = 0;
function goal(o: Partial<Goal> = {}): Goal {
  n++;
  return {
    id: `g${n}`,
    title: `Ziel ${n}`,
    kind: "goal",
    why: null,
    target_date: null,
    status: "active",
    source: "person",
    created_at: "2026-01-01T10:00:00.000Z",
    updated_at: "2026-01-01T10:00:00.000Z",
    effort_hours: null,
    weekly_hours: null,
    prior_hours: 0,
    milestones: [],
    time: { logged_minutes: 0, block_minutes: 0 },
    done_at: null,
    memory: null,
    ...o,
  };
}
const dream = (o: Partial<Goal> = {}) => goal({ kind: "dream", ...o });
const ids = (gs: Goal[]) => gs.map((g) => g.title);

describe("bucketParts", () => {
  const all = [
    goal({ title: "Halbmarathon" }),
    dream({ title: "Japan", status: "paused" }),
    dream({ title: "Polarlichter" }),
    dream({ title: "Gotthard", status: "done", done_at: "2026-06-21T14:10:00.000Z" }),
    dream({ title: "Hörnlihütte", status: "done", done_at: "2025-08-16T04:40:00.000Z", memory: "kalt und still" }),
    goal({ title: "Italienisch", status: "paused" }),
    goal({ title: "Prüfung", status: "done", done_at: "2026-03-01T10:00:00.000Z" }),
    goal({ title: "Klavier", status: "dropped" }),
    dream({ title: "Korsika", status: "dropped" }),
    // older data without a kind counts as a goal
    { ...goal({ title: "Alt" }), kind: undefined as unknown as Goal["kind"] },
  ];
  const p = bucketParts(all);

  it("open dreams: active first, then paused", () => {
    expect(ids(p.open)).toEqual(["Polarlichter", "Japan"]);
  });
  it("fulfilled dreams: newest first, and never in the fold", () => {
    expect(ids(p.fulfilled)).toEqual(["Gotthard", "Hörnlihütte"]);
    expect(ids(p.finished)).not.toContain("Gotthard");
  });
  it("goals: active, then paused; a goal without kind is a goal", () => {
    expect(ids(p.goals)).toEqual(["Halbmarathon", "Alt", "Italienisch"]);
  });
  it("Abgeschlossen: reached and dropped goals, dropped dreams", () => {
    expect(ids(p.finished)).toEqual(["Prüfung", "Klavier", "Korsika"]);
  });
  it("a fulfilled dream without done_at falls back to its last change", () => {
    const q = bucketParts([dream({ title: "A", status: "done", updated_at: "2026-01-02T10:00:00.000Z" }), dream({ title: "B", status: "done", done_at: "2026-05-01T10:00:00.000Z" })]);
    expect(ids(q.fulfilled)).toEqual(["B", "A"]);
  });
});

describe("texts", () => {
  it("«erfüllt im März 2026», in local time", () => {
    expect(fulfilledLabel({ done_at: "2026-03-14T10:00:00.000Z", updated_at: "x" })).toBe("erfüllt im März 2026");
    // 31 December 23:30 UTC is already 1 January in Zurich
    expect(fulfilledLabel({ done_at: "2025-12-31T23:30:00.000Z", updated_at: "x" }, true)).toBe("Erfüllt im Januar 2026");
  });
  it("a dream's time: month and year, the last day of a year means the year", () => {
    expect(dreamWhen("2027-02-28")).toBe("Februar 2027");
    expect(dreamWhen("2028-12-31")).toBe("2028");
    expect(dreamWhen(null)).toBeNull();
    expect(monthYear("2026-06-21")).toBe("Juni 2026");
  });
  it("a dream's plan line only with a plan", () => {
    expect(dreamPlanLine(dream(), TODAY)).toBeNull();
    const ms = (title: string, done: boolean, position: number) => ({ id: `m${position}`, goal_id: "x", title, due_date: null, done_at: done ? "2026-11-01T10:00:00.000Z" : null, position });
    expect(dreamPlanLine(dream({ milestones: [ms("Flug buchen", true, 0), ms("Unterkunft", false, 1), ms("Kamera", false, 2)] }), TODAY)).toBe("1 von 3 Etappen · als Nächstes: Unterkunft");
    expect(dreamPlanLine(dream({ effort_hours: 40, prior_hours: 6 }), TODAY)).toBe("6 von ≈ 40 Std");
  });
  it("what the coach hears from «Wie war es? Erzähl es mir.»", () => {
    expect(tellText(" Polarlichter sehen ")).toBe("Mein Traum „Polarlichter sehen“ ist wahr geworden. Ich erzähle dir, wie es war.");
  });
  it("no ß anywhere, no exclamation marks", () => {
    const texts = [tellText("X"), daysLeftLine(46, 2026), daysLeftLine(1, 2026), daysLeftLine(0, 2026), fulfilledYearLine(2, 2025)!, fulfilledYearLine(1, 2025)!];
    for (const t of texts) {
      expect(t).not.toMatch(/ß|!/);
    }
  });
});

describe("Jahr", () => {
  it("«Noch 46 Tage in 2026» on 15 November (yearProgress)", () => {
    const pr = yearProgress(2026, TODAY);
    expect(daysLeftLine(pr.leftDays, 2026)).toBe("Noch 46 Tage in 2026");
    expect(daysLeftLine(yearProgress(2026, "2026-12-30").leftDays, 2026)).toBe("Noch 1 Tag in 2026");
    expect(daysLeftLine(yearProgress(2026, "2026-12-31").leftDays, 2026)).toBe("Der letzte Tag in 2026");
  });
  it("a past year: «Erfüllt in 2025: 2 Träume», nothing without", () => {
    expect(fulfilledYearLine(2, 2025)).toBe("Erfüllt in 2025: 2 Träume");
    expect(fulfilledYearLine(1, 2025)).toBe("Erfüllt in 2025: 1 Traum");
    expect(fulfilledYearLine(0, 2025)).toBeNull();
  });
  const all = [
    goal({ title: "Halbmarathon", target_date: "2026-12-06" }),
    dream({ title: "Polarlichter", target_date: "2027-02-28" }),
    dream({ title: "Japan", target_date: "2026-04-01" }),
    goal({ title: "Pausiert", target_date: "2026-05-01", status: "paused" }),
    goal({ title: "Erreicht", target_date: "2026-05-01", status: "done", done_at: "2026-05-01T10:00:00.000Z" }),
    dream({ title: "Gotthard", status: "done", done_at: "2026-06-21T14:10:00.000Z" }),
    dream({ title: "Silvester", status: "done", done_at: "2025-12-31T23:30:00.000Z" }),
    dream({ title: "Hörnlihütte", status: "done", done_at: "2025-08-16T04:40:00.000Z" }),
  ];
  it("«Noch offen in <Jahr>»: active dreams and goals with a target date in that year, by date", () => {
    expect(ids(openInYear(all, 2026))).toEqual(["Japan", "Halbmarathon"]);
    expect(ids(openInYear(all, 2027))).toEqual(["Polarlichter"]);
    expect(openInYear(all, 2028)).toEqual([]);
  });
  it("«Erfüllt in <Jahr>»: dreams that came true that year (local day), in order", () => {
    expect(ids(fulfilledInYear(all, 2026))).toEqual(["Silvester", "Gotthard"]);
    expect(ids(fulfilledInYear(all, 2025))).toEqual(["Hörnlihütte"]);
  });
});

describe("the wash", () => {
  afterEach(() => resetWashedForTests());
  const now = Date.parse("2026-11-15T15:00:00.000Z");
  const d = (o: Partial<Goal>) => dream({ status: "done", done_at: new Date(now - 30_000).toISOString(), ...o });
  it("once, for a dream that came true a moment ago", () => {
    const g = d({});
    expect(wantsWash(g, now)).toBe(true);
    markWashed(g.id);
    expect(wantsWash(g, now)).toBe(false);
  });
  it("not for older ones, open ones or goals", () => {
    expect(wantsWash(d({ done_at: new Date(now - WASH_RECENT - 1).toISOString() }), now)).toBe(false);
    expect(wantsWash(d({ status: "active", done_at: null }), now)).toBe(false);
    expect(wantsWash(goal({ status: "done", done_at: new Date(now).toISOString() }), now)).toBe(false);
  });
});
