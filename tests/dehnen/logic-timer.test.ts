import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../dehnen/src/types.ts";
import type { ExerciseText, SessionPlan } from "../../dehnen/src/types.ts";
import { buildPlan } from "../../dehnen/src/logic/plan.ts";
import { addTime, next, pause, prev, resume, start, summary, tick, toggle, view } from "../../dehnen/src/logic/timer.ts";
import type { PlayerState } from "../../dehnen/src/logic/timer.ts";

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
  ex("seitbeuge", { regions: ["lws_ql", "huefte_seitlich"] }),
  ex("taube", { unilateral: true, regions: ["gesaess_rotatoren"] }),
  ex("katze", { kind: "dynamisch", regions: ["bws_rotation"] }),
];
const lookup = (id: string): ExerciseText | undefined => LIST.find((e) => e.id === id);

// ready 8 | seitbeuge 45 | next 8 | taube L 45 | switch 5 | taube R 45 | next 8 | katze 45  = 209 s
//  index 0 |      1      |    2   |     3      |    4     |     5      |    6   |    7
const PLAN: SessionPlan = buildPlan({ source: "r1", title: "Abend", items: [{ exercise: "seitbeuge" }, { exercise: "taube" }, { exercise: "katze" }] }, DEFAULT_SETTINGS, lookup);
const T0 = 1_000_000;
const at = (seconds: number): number => T0 + seconds * 1000;
/** run from the start to this second, ticking like the player does */
const runTo = (seconds: number): PlayerState => tick(start(PLAN, T0), at(seconds));

describe("the plan under test", () => {
  it("has the expected shape", () => {
    expect(PLAN.steps.map((s) => s.type)).toEqual(["ready", "exercise", "transition", "exercise", "transition", "exercise", "transition", "exercise"]);
    expect(PLAN.seconds).toBe(209);
  });
});

describe("start and view", () => {
  it("begins with the countdown to the first exercise", () => {
    const s = start(PLAN, T0);
    const v = view(s, T0);
    expect(s).toEqual({ plan: PLAN, index: 0, startedAt: T0, pausedAt: null, done: false, spent: {} });
    expect(v.step).toEqual(PLAN.steps[0]);
    expect(v.remaining).toBe(8);
    expect(v.fraction).toBe(0);
    expect(v.elapsed).toBe(0);
    expect(v.total).toBe(209);
    expect(v.paused).toBe(false);
    expect(v.done).toBe(false);
    expect(v.exerciseIndex).toBe(1);
    expect(v.exerciseCount).toBe(3);
    expect(v.upcoming).toEqual(PLAN.steps[1]);
  });

  it("counts down in whole seconds, rounded up", () => {
    const s = runTo(8);
    expect(s.index).toBe(1);
    expect(view(s, at(8)).remaining).toBe(45);
    expect(view(s, at(8.4)).remaining).toBe(45);
    expect(view(s, at(9)).remaining).toBe(44);
    expect(view(s, at(52.9)).remaining).toBe(1);
    expect(view(s, at(30.5)).fraction).toBeCloseTo(0.5, 5);
    expect(view(s, at(30.5)).elapsed).toBeCloseTo(30.5, 5);
  });

  it("names the exercise that runs or comes next, and the one after", () => {
    const first = view(runTo(10), at(10));
    expect(first.exerciseIndex).toBe(1);
    expect(first.upcoming).toEqual(PLAN.steps[3]); // taube L
    const change = view(runTo(55), at(55)); // pause before taube
    expect(change.step).toMatchObject({ type: "transition", reason: "next" });
    expect(change.exerciseIndex).toBe(2);
    expect(change.upcoming).toEqual(PLAN.steps[3]);
    const left = view(runTo(70), at(70)); // taube L
    expect(left.step).toMatchObject({ type: "exercise", exercise: "taube", side: "L" });
    expect(left.exerciseIndex).toBe(2);
    expect(left.upcoming).toEqual(PLAN.steps[5]); // taube R
    const swap = view(runTo(108), at(108));
    expect(swap.step).toMatchObject({ type: "transition", reason: "switch" });
    expect(swap.exerciseIndex).toBe(2);
    const last = view(runTo(170), at(170)); // katze
    expect(last.exerciseIndex).toBe(3);
    expect(last.upcoming).toBeNull();
  });

  it("view never changes the state", () => {
    const s = start(PLAN, T0);
    const copy = structuredClone(s);
    const v = view(s, at(500));
    expect(s).toEqual(copy);
    expect(v.remaining).toBe(0);
    expect(v.fraction).toBe(1);
    expect(v.done).toBe(false);
  });
});

describe("tick", () => {
  it("does nothing while the step is still running", () => {
    const s = start(PLAN, T0);
    expect(tick(s, at(7.9))).toBe(s);
  });

  it("moves on exactly when a step has run out and carries the overflow", () => {
    const s = tick(start(PLAN, T0), at(8.3));
    expect(s.index).toBe(1);
    expect(s.startedAt).toBe(at(8));
    expect(view(s, at(8.3)).remaining).toBe(45);
    expect(view(s, at(8.3)).elapsed).toBeCloseTo(8.3, 5);
  });

  it("catches up several steps at once after a long sleep", () => {
    // 8 + 45 + 8 + 10: ten seconds into taube L
    const s = runTo(71);
    expect(s.index).toBe(3);
    expect(view(s, at(71)).remaining).toBe(35);
    expect(s.spent).toEqual({ 1: 45 });
    // ticking in small steps ends in the same place
    let small = start(PLAN, T0);
    for (let t = 0; t <= 71; t += 0.25) small = tick(small, at(t));
    expect(small).toEqual(s);
  });

  it("a sleep past the end finishes the session", () => {
    const s = runTo(3600);
    expect(s.done).toBe(true);
    expect(s.spent).toEqual({ 1: 45, 3: 45, 5: 45, 7: 45 });
    const v = view(s, at(3600));
    expect(v.step).toBeNull();
    expect(v.done).toBe(true);
    expect(v.remaining).toBe(0);
    expect(v.fraction).toBe(1);
    expect(v.elapsed).toBe(209);
    expect(v.exerciseIndex).toBe(3);
    expect(v.upcoming).toBeNull();
    expect(v.paused).toBe(false);
  });

  it("ends exactly at the last second", () => {
    expect(runTo(208.9).done).toBe(false);
    expect(runTo(209).done).toBe(true);
  });

  it("a finished session stays finished", () => {
    const s = runTo(209);
    expect(tick(s, at(999))).toBe(s);
    expect(next(s, at(999))).toBe(s);
    expect(prev(s, at(999))).toBe(s);
    expect(pause(s, at(999))).toBe(s);
    expect(resume(s, at(999))).toBe(s);
    expect(addTime(s, 10, at(999))).toBe(s);
  });

  it("an empty plan is done at once", () => {
    const s = start({ source: "x", title: "x", steps: [], seconds: 0 }, T0);
    expect(s.done).toBe(true);
    expect(view(s, T0)).toMatchObject({ step: null, done: true, exerciseIndex: 0, exerciseCount: 0, total: 0 });
    expect(summary(s, T0, lookup)).toEqual({ source: "x", title: "x", seconds: 0, completed: true, exercises: [], regions: {} });
  });
});

describe("pause and resume", () => {
  it("time stands still while paused, however long", () => {
    const running = runTo(20); // 12 s into seitbeuge
    const paused = pause(running, at(20));
    expect(paused.pausedAt).toBe(at(20));
    expect(view(paused, at(20)).paused).toBe(true);
    expect(view(paused, at(20)).remaining).toBe(33);
    expect(tick(paused, at(2000))).toBe(paused);
    expect(view(paused, at(2000)).remaining).toBe(33);
    const again = resume(paused, at(2000));
    expect(again.pausedAt).toBeNull();
    expect(view(again, at(2000)).remaining).toBe(33);
    expect(view(again, at(2010)).remaining).toBe(23);
    // the step ends 33 seconds after resuming, not earlier
    expect(tick(again, at(2032.9)).index).toBe(1);
    expect(tick(again, at(2033)).index).toBe(2);
  });

  it("pausing twice and resuming a running player change nothing", () => {
    const paused = pause(runTo(20), at(20));
    expect(pause(paused, at(25))).toBe(paused);
    const running = runTo(20);
    expect(resume(running, at(25))).toBe(running);
  });

  it("toggle switches between the two", () => {
    const a = toggle(runTo(20), at(20));
    expect(a.pausedAt).toBe(at(20));
    const b = toggle(a, at(50));
    expect(b.pausedAt).toBeNull();
    expect(view(b, at(50)).remaining).toBe(33);
  });

  it("pause first catches up what has run out", () => {
    const s = pause(start(PLAN, T0), at(10));
    expect(s.index).toBe(1);
    expect(view(s, at(10)).remaining).toBe(43);
  });
});

describe("next", () => {
  it("skips the countdown straight into its exercise", () => {
    const s = next(start(PLAN, T0), at(2));
    expect(s.index).toBe(1);
    expect(view(s, at(2)).remaining).toBe(45);
  });

  it("from an exercise into the pause after it, from the pause into its exercise", () => {
    const inFirst = runTo(20);
    const pauseAfter = next(inFirst, at(20));
    expect(view(pauseAfter, at(20)).step).toMatchObject({ type: "transition", reason: "next", next: { exercise: "taube", side: "L" } });
    expect(view(pauseAfter, at(20)).remaining).toBe(8);
    const left = next(pauseAfter, at(21));
    expect(view(left, at(21)).step).toMatchObject({ type: "exercise", exercise: "taube", side: "L" });
    expect(view(left, at(21)).remaining).toBe(45);
    const swap = next(left, at(30));
    expect(view(swap, at(30)).step).toMatchObject({ type: "transition", reason: "switch" });
    const right = next(swap, at(31));
    expect(view(right, at(31)).step).toMatchObject({ type: "exercise", exercise: "taube", side: "R" });
  });

  it("only the time really spent is counted", () => {
    const s = next(runTo(20), at(20)); // left seitbeuge after 12 s
    expect(s.spent).toEqual({ 1: 12 });
    expect(view(s, at(20)).elapsed).toBe(8 + 45); // the position in the plan jumps ahead
  });

  it("skipping the last step ends the session", () => {
    const s = next(runTo(170), at(170));
    expect(s.done).toBe(true);
    expect(view(s, at(170)).step).toBeNull();
    expect(s.spent[7]).toBe(6);
  });

  it("a paused player stays paused on the new step", () => {
    const paused = pause(runTo(20), at(20));
    const skipped = next(paused, at(300));
    expect(skipped.index).toBe(2);
    expect(skipped.pausedAt).toBe(at(300));
    expect(skipped.spent).toEqual({ 1: 12 });
    expect(view(skipped, at(400)).remaining).toBe(8);
    const running = resume(skipped, at(400));
    expect(view(running, at(403)).remaining).toBe(5);
  });
});

describe("prev", () => {
  it("restarts the exercise that is running", () => {
    const s = prev(runTo(70), at(70)); // 9 s into taube L
    expect(s.index).toBe(3);
    expect(view(s, at(70)).remaining).toBe(45);
    expect(s.spent[3]).toBe(9);
  });

  it("within the first three seconds it goes to the exercise step before", () => {
    const early = runTo(63); // 2 s into taube L
    const back = prev(early, at(63));
    expect(back.index).toBe(1);
    expect(view(back, at(63)).step).toMatchObject({ type: "exercise", exercise: "seitbeuge" });
    expect(view(back, at(63)).remaining).toBe(45);
    // the right side goes back to the left side
    const right = runTo(112); // 1 s into taube R
    expect(right.index).toBe(5);
    expect(prev(right, at(112)).index).toBe(3);
    // exactly three seconds in counts as running
    expect(prev(runTo(64), at(64)).index).toBe(3);
  });

  it("from a pause it goes back to the exercise before", () => {
    const inSwap = runTo(108);
    expect(inSwap.index).toBe(4);
    expect(prev(inSwap, at(108)).index).toBe(3);
    const inChange = runTo(55);
    expect(inChange.index).toBe(2);
    expect(prev(inChange, at(55)).index).toBe(1);
  });

  it("at the very beginning it restarts what is there", () => {
    const ready = prev(tick(start(PLAN, T0), at(6)), at(6));
    expect(ready.index).toBe(0);
    expect(view(ready, at(6)).remaining).toBe(8);
    const first = prev(runTo(9), at(9)); // 1 s into the first exercise: nothing before it
    expect(first.index).toBe(1);
    expect(view(first, at(9)).remaining).toBe(45);
  });

  it("a paused player stays paused", () => {
    const paused = pause(runTo(70), at(70));
    const back = prev(paused, at(90));
    expect(back.pausedAt).toBe(at(90));
    expect(view(back, at(500)).remaining).toBe(45);
  });
});

describe("addTime", () => {
  it("extends the current step and the total, and leaves the original plan alone", () => {
    const s = runTo(20);
    const longer = addTime(s, 15, at(20));
    expect(view(longer, at(20)).remaining).toBe(33 + 15);
    expect(view(longer, at(20)).total).toBe(209 + 15);
    expect(longer.plan.steps[1].seconds).toBe(60);
    expect(PLAN.steps[1].seconds).toBe(45);
    expect(PLAN.seconds).toBe(209);
    // the step now ends later
    expect(tick(longer, at(8 + 59.9)).index).toBe(1);
    const after = tick(longer, at(8 + 60));
    expect(after.index).toBe(2);
    expect(after.spent).toEqual({ 1: 60 });
  });

  it("works on a pause and while paused", () => {
    const inChange = addTime(runTo(55), 10, at(55));
    expect(view(inChange, at(55)).remaining).toBe(6 + 10);
    const paused = addTime(pause(runTo(20), at(20)), 30, at(99));
    expect(view(paused, at(99)).remaining).toBe(33 + 30);
  });

  it("can shorten, but never below what has already passed", () => {
    const shorter = addTime(runTo(20), -10, at(20)); // 12 s in, 45 → 35
    expect(view(shorter, at(20)).remaining).toBe(23);
    expect(view(shorter, at(20)).total).toBe(199);
    const cut = addTime(runTo(20), -100, at(20));
    expect(cut.plan.steps[1].seconds).toBe(12);
    // the step ends now and the pause after it starts fresh, nothing further is skipped
    const after = tick(cut, at(20));
    expect(after.index).toBe(2);
    expect(view(after, at(20)).remaining).toBe(8);
    expect(after.spent).toEqual({ 1: 12 });
  });
});

describe("summary", () => {
  it("a session through to the end: every second of exercise, per exercise and per main region", () => {
    const s = runTo(209);
    expect(summary(s, at(209), lookup)).toEqual({
      source: "r1",
      title: "Abend",
      seconds: 180,
      completed: true,
      exercises: [
        { id: "seitbeuge", seconds: 45 },
        { id: "taube", seconds: 90 },
        { id: "katze", seconds: 45 },
      ],
      regions: { lws_ql: 45, gesaess_rotatoren: 90, bws_rotation: 45 },
    });
  });

  it("stopped in the middle: what was done so far, not completed, pauses left out", () => {
    let s = runTo(20); // 12 s seitbeuge
    s = pause(s, at(20));
    s = resume(s, at(620)); // ten minutes of pause do not count
    s = next(s, at(620)); // skip the rest of seitbeuge
    s = next(s, at(621)); // skip the pause
    s = tick(s, at(641)); // 20 s into taube L
    const sum = summary(s, at(641), lookup);
    expect(sum.completed).toBe(false);
    expect(sum.exercises).toEqual([
      { id: "seitbeuge", seconds: 12 },
      { id: "taube", seconds: 20 },
    ]);
    expect(sum.seconds).toBe(32);
    expect(sum.regions).toEqual({ lws_ql: 12, gesaess_rotatoren: 20 });
  });

  it("is the same whether the player is paused or not at that moment", () => {
    const running = runTo(30);
    const paused = pause(running, at(30));
    expect(summary(paused, at(900), lookup)).toEqual(summary(running, at(30), lookup));
  });

  it("nothing done yet gives an empty entry", () => {
    const sum = summary(start(PLAN, T0), at(3), lookup);
    expect(sum).toEqual({ source: "r1", title: "Abend", seconds: 0, completed: false, exercises: [], regions: {} });
  });

  it("skipping everything reaches the end without time", () => {
    let s = start(PLAN, T0);
    for (let i = 0; i < PLAN.steps.length; i++) s = next(s, T0);
    expect(s.done).toBe(true);
    expect(summary(s, T0, lookup)).toMatchObject({ seconds: 0, completed: true, exercises: [] });
  });

  it("a restarted exercise counts both attempts, an unknown exercise has no region", () => {
    let s = runTo(20);
    s = prev(s, at(20)); // 12 s done, start again
    s = tick(s, at(20 + 45)); // full 45 s
    const sum = summary(s, at(65), () => undefined);
    expect(sum.exercises).toEqual([{ id: "seitbeuge", seconds: 57 }]);
    expect(sum.regions).toEqual({});
  });
});
