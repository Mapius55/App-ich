import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../dehnen/src/types.ts";
import type { ExerciseText, RoutineItem, SessionStep, Settings } from "../../dehnen/src/types.ts";
import {
  buildPlan,
  exerciseSeconds,
  formatClock,
  formatDuration,
  formatMinutes,
  planSeconds,
  readySeconds,
  stepSeconds,
} from "../../dehnen/src/logic/plan.ts";

function ex(id: string, over: Partial<ExerciseText> = {}): ExerciseText {
  return {
    id,
    name: id,
    family: id,
    variant: null,
    kind: "statisch",
    position: "stehend",
    regions: ["huefte_seitlich"],
    equipment: [],
    unilateral: false,
    level: 1,
    seconds: 30,
    tags: [],
    intro: "",
    steps: [],
    cues: [],
    avoid: "",
    feel: "",
    slalom: "",
    motion: "",
    ...over,
  };
}

const LIST: ExerciseText[] = [
  ex("seitbeuge", { seconds: 40 }),
  ex("taube", { unilateral: true, seconds: 60, position: "sitzend", regions: ["gesaess_rotatoren"] }),
  ex("beinpendel", { kind: "dynamisch", unilateral: true, seconds: 25, tempo: 2 }),
  ex("hueftkreisen", { kind: "aktiv", seconds: 50, position: "vierfuessler" }),
];
const lookup = (id: string): ExerciseText | undefined => LIST.find((e) => e.id === id);
const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });
const items = (...ids: string[]): RoutineItem[] => ids.map((exercise) => ({ exercise }));
const sum = (steps: SessionStep[]): number => steps.reduce((n, s) => n + s.seconds, 0);

describe("stepSeconds", () => {
  it("gleichmässig on: every hold the same, every mobilisation the same, whatever the exercise or routine says", () => {
    const s = settings({ uniform: true, holdSeconds: 45, moveSeconds: 30 });
    expect(stepSeconds(lookup("seitbeuge")!, { exercise: "seitbeuge" }, s)).toBe(45);
    expect(stepSeconds(lookup("taube")!, { exercise: "taube", seconds: 90 }, s)).toBe(45);
    expect(stepSeconds(lookup("beinpendel")!, { exercise: "beinpendel" }, s)).toBe(30);
    expect(stepSeconds(lookup("hueftkreisen")!, { exercise: "hueftkreisen", seconds: 10 }, s)).toBe(30);
  });

  it("gleichmässig off: the routine's seconds, else the exercise's own", () => {
    const s = settings({ uniform: false });
    expect(stepSeconds(lookup("seitbeuge")!, { exercise: "seitbeuge" }, s)).toBe(40);
    expect(stepSeconds(lookup("seitbeuge")!, { exercise: "seitbeuge", seconds: 75 }, s)).toBe(75);
    expect(stepSeconds(lookup("beinpendel")!, { exercise: "beinpendel" }, s)).toBe(25);
    // a broken override falls back to the exercise
    expect(stepSeconds(lookup("seitbeuge")!, { exercise: "seitbeuge", seconds: 0 }, s)).toBe(40);
    expect(stepSeconds(lookup("seitbeuge")!, { exercise: "seitbeuge", seconds: Number.NaN }, s)).toBe(40);
  });

  it("an exercise as a whole: both sides and the switch", () => {
    const s = settings({ holdSeconds: 45, switchSeconds: 5 });
    expect(exerciseSeconds(lookup("seitbeuge")!, { exercise: "seitbeuge" }, s)).toBe(45);
    expect(exerciseSeconds(lookup("taube")!, { exercise: "taube" }, s)).toBe(95);
  });
});

describe("buildPlan", () => {
  it("ready, exercises, sides and pauses in the right order", () => {
    const plan = buildPlan({ source: "r1", title: "Test", items: items("seitbeuge", "taube", "gibt-es-nicht", "hueftkreisen") }, settings(), lookup);
    expect(plan.source).toBe("r1");
    expect(plan.title).toBe("Test");
    expect(plan.steps).toEqual<SessionStep[]>([
      { type: "ready", seconds: 8, next: { exercise: "seitbeuge", side: null } },
      { type: "exercise", exercise: "seitbeuge", side: null, seconds: 45, index: 1, of: 3 },
      { type: "transition", reason: "next", seconds: 8, next: { exercise: "taube", side: "L" } },
      { type: "exercise", exercise: "taube", side: "L", seconds: 45, index: 2, of: 3 },
      { type: "transition", reason: "switch", seconds: 5, next: { exercise: "taube", side: "R" } },
      { type: "exercise", exercise: "taube", side: "R", seconds: 45, index: 2, of: 3 },
      { type: "transition", reason: "next", seconds: 8, next: { exercise: "hueftkreisen", side: null } },
      { type: "exercise", exercise: "hueftkreisen", side: null, seconds: 45, index: 3, of: 3 },
    ]);
    expect(plan.seconds).toBe(8 + 45 + 8 + 45 + 5 + 45 + 8 + 45);
    expect(plan.seconds).toBe(sum(plan.steps));
  });

  it("left and right are always equal, with gleichmässig on and off", () => {
    for (const uniform of [true, false]) {
      const plan = buildPlan({ source: "x", title: "x", items: [{ exercise: "taube", seconds: 70 }, { exercise: "beinpendel" }] }, settings({ uniform }), lookup);
      for (const id of ["taube", "beinpendel"]) {
        const sides = plan.steps.filter((s) => s.type === "exercise" && s.exercise === id);
        expect(sides).toHaveLength(2);
        expect(sides[0].seconds).toBe(sides[1].seconds);
      }
    }
    const own = buildPlan({ source: "x", title: "x", items: [{ exercise: "taube", seconds: 70 }] }, settings({ uniform: false }), lookup);
    expect(own.steps.filter((s) => s.type === "exercise").map((s) => s.seconds)).toEqual([70, 70]);
  });

  it("starts with the chosen side", () => {
    const plan = buildPlan({ source: "x", title: "x", items: items("taube") }, settings({ firstSide: "R" }), lookup);
    expect(plan.steps[0]).toEqual({ type: "ready", seconds: 8, next: { exercise: "taube", side: "R" } });
    const sides = plan.steps.flatMap((s) => (s.type === "exercise" ? [s.side] : []));
    expect(sides).toEqual(["R", "L"]);
    const swap = plan.steps.find((s) => s.type === "transition");
    expect(swap).toEqual({ type: "transition", reason: "switch", seconds: 5, next: { exercise: "taube", side: "L" } });
  });

  it("gleichmässig: every hold, every switch and every change of position lasts the same", () => {
    const plan = buildPlan({ source: "x", title: "x", items: items("seitbeuge", "taube", "seitbeuge", "taube") }, settings({ holdSeconds: 40, transitionSeconds: 10, switchSeconds: 6 }), lookup);
    const holds = new Set(plan.steps.filter((s) => s.type === "exercise").map((s) => s.seconds));
    const changes = new Set(plan.steps.filter((s) => s.type === "transition" && s.reason === "next").map((s) => s.seconds));
    const swaps = new Set(plan.steps.filter((s) => s.type === "transition" && s.reason === "switch").map((s) => s.seconds));
    expect([...holds]).toEqual([40]);
    expect([...changes]).toEqual([10]);
    expect([...swaps]).toEqual([6]);
  });

  it("the first countdown is never shorter than 5 seconds", () => {
    const short = settings({ transitionSeconds: 3 });
    expect(readySeconds(short)).toBe(5);
    const plan = buildPlan({ source: "x", title: "x", items: items("seitbeuge", "hueftkreisen") }, short, lookup);
    expect(plan.steps[0].seconds).toBe(5);
    expect(plan.steps[2]).toMatchObject({ type: "transition", reason: "next", seconds: 3 });
    expect(readySeconds(settings({ transitionSeconds: 12 }))).toBe(12);
  });

  it("a pause of 0 seconds is left out", () => {
    const plan = buildPlan({ source: "x", title: "x", items: items("taube", "seitbeuge") }, settings({ transitionSeconds: 0, switchSeconds: 0 }), lookup);
    expect(plan.steps.map((s) => s.type)).toEqual(["ready", "exercise", "exercise", "exercise"]);
    expect(plan.seconds).toBe(5 + 45 * 3);
    expect(planSeconds(items("taube", "seitbeuge"), settings({ transitionSeconds: 0, switchSeconds: 0 }), lookup)).toBe(plan.seconds);
  });

  it("nothing known gives an empty plan", () => {
    const plan = buildPlan({ source: "x", title: "x", items: items("a", "b") }, settings(), lookup);
    expect(plan.steps).toEqual([]);
    expect(plan.seconds).toBe(0);
    expect(planSeconds(items("a", "b"), settings(), lookup)).toBe(0);
    expect(planSeconds([], settings(), lookup)).toBe(0);
  });

  it("the same exercise twice counts as two exercises", () => {
    const plan = buildPlan({ source: "x", title: "x", items: items("seitbeuge", "seitbeuge") }, settings(), lookup);
    const idx = plan.steps.flatMap((s) => (s.type === "exercise" ? [`${s.index}/${s.of}`] : []));
    expect(idx).toEqual(["1/2", "2/2"]);
  });
});

describe("planSeconds", () => {
  it("equals the plan's total for all kinds of settings", () => {
    const routines: RoutineItem[][] = [
      items("seitbeuge"),
      items("taube"),
      items("seitbeuge", "taube", "beinpendel", "hueftkreisen"),
      [{ exercise: "taube", seconds: 33 }, { exercise: "unbekannt" }, { exercise: "hueftkreisen", seconds: 12 }, { exercise: "beinpendel" }],
    ];
    const variants: Settings[] = [
      settings(),
      settings({ uniform: false }),
      settings({ holdSeconds: 60, moveSeconds: 20, transitionSeconds: 15, switchSeconds: 3, firstSide: "R" }),
      settings({ uniform: false, transitionSeconds: 2, switchSeconds: 10 }),
    ];
    for (const list of routines) {
      for (const s of variants) {
        const plan = buildPlan({ source: "x", title: "x", items: list }, s, lookup);
        expect(planSeconds(list, s, lookup)).toBe(plan.seconds);
        expect(plan.seconds).toBe(sum(plan.steps));
      }
    }
  });
});

describe("formatting", () => {
  it("minutes, and seconds under a minute", () => {
    expect(formatMinutes(720)).toBe("12 Min");
    expect(formatMinutes(45)).toBe("45 Sek");
    expect(formatMinutes(0)).toBe("0 Sek");
    expect(formatMinutes(59.6)).toBe("1 Min");
    expect(formatMinutes(60)).toBe("1 Min");
    expect(formatMinutes(605)).toBe("10 Min");
    expect(formatMinutes(-5)).toBe("0 Sek");
  });

  it("hours for the big totals, a clock for the time left", () => {
    expect(formatDuration(45)).toBe("45 Sek");
    expect(formatDuration(1500)).toBe("25 Min");
    expect(formatDuration(3600)).toBe("1 Std");
    expect(formatDuration(3 * 3600 + 20 * 60)).toBe("3 Std 20 Min");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(600)).toBe("10:00");
    expect(formatClock(59.2)).toBe("1:00");
  });
});
