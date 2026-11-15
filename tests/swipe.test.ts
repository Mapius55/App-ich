import { describe, expect, it } from "vitest";
import {
  cubicBezier,
  decideAxis,
  decideCommit,
  dirOf,
  discreteFollow,
  dockEase,
  easeOut,
  pagerFollow,
  rubber,
  settleMs,
  velocity,
} from "../src/space/swipeMath";
import { DISCRETE_CAP, RUBBER, SETTLE_MAX, SETTLE_MIN } from "../src/space/gestures";

describe("decideAxis", () => {
  it("waits for the slop", () => {
    expect(decideAxis(0, 0)).toBeNull();
    expect(decideAxis(9, 3)).toBeNull();
    expect(decideAxis(-6, 7)).toBeNull();
  });
  it("picks x only when clearly horizontal", () => {
    expect(decideAxis(12, 2)).toBe("x");
    expect(decideAxis(-12, 9)).toBe("x"); // 12 > 1.2·9 = 10.8
    expect(decideAxis(12, 10)).toBe("y"); // 12 = 1.2·10, not more
    expect(decideAxis(3, 14)).toBe("y");
    expect(decideAxis(0, -10)).toBe("y");
  });
  it("diagonal drags pick one axis", () => {
    expect(decideAxis(10, 10)).toBe("y");
    expect(decideAxis(11, -9)).toBe("x");
  });
});

describe("decideCommit (pager)", () => {
  const W = 390; // 28 % ≈ 109 px
  it("commits past 28 % of the width, cancels below", () => {
    expect(decideCommit("pager", -110, 0, W)).toBe(1);
    expect(decideCommit("pager", 110, 0, W)).toBe(-1);
    expect(decideCommit("pager", -100, 0, W)).toBe(0);
    expect(decideCommit("pager", 0, 0, W)).toBe(0);
  });
  it("commits a flick with enough travel", () => {
    expect(decideCommit("pager", -30, -0.6, W)).toBe(1);
    expect(decideCommit("pager", 30, 0.6, W)).toBe(-1);
    expect(decideCommit("pager", -20, -0.9, W)).toBe(0); // travel < 24
    expect(decideCommit("pager", -30, -0.4, W)).toBe(0); // too slow, too short
  });
  it("a flick back against the drag cancels even when far", () => {
    expect(decideCommit("pager", -200, 0.8, W)).toBe(0);
    expect(decideCommit("pager", -200, 0.3, W)).toBe(1); // slow drift back: distance wins
  });
});

describe("decideCommit (discrete)", () => {
  it("commits at 60 px or 0.4 px/ms", () => {
    expect(decideCommit("discrete", -60, 0, 390)).toBe(1);
    expect(decideCommit("discrete", 59, 0, 390)).toBe(0);
    expect(decideCommit("discrete", 40, 0.5, 390)).toBe(-1);
    expect(decideCommit("discrete", -40, 0.5, 390)).toBe(0); // flick against
    expect(decideCommit("discrete", -220, -1.1, 390)).toBe(1); // the acceptance swipe 300 → 80
  });
});

describe("settle and follow", () => {
  it("clamps the settle time", () => {
    expect(settleMs(300, 0)).toBe(SETTLE_MAX);
    expect(settleMs(300, 3)).toBe(SETTLE_MIN);
    expect(settleMs(300, 1)).toBe(300);
    expect(settleMs(-300, -1)).toBe(300);
    expect(settleMs(1000, 0.5)).toBe(SETTLE_MAX);
  });
  it("rubber-bands", () => {
    expect(rubber(100)).toBeCloseTo(100 * RUBBER);
    expect(pagerFollow(-50, 390, true)).toBe(-50);
    expect(pagerFollow(-50, 390, false)).toBeCloseTo(-50 * RUBBER);
    expect(pagerFollow(-490, 390, true)).toBeCloseTo(-(390 + 100 * RUBBER));
    expect(pagerFollow(490, 390, true)).toBeCloseTo(390 + 100 * RUBBER);
  });
  it("discrete content follows ×0.5 up to 80 px", () => {
    expect(discreteFollow(40)).toBe(20);
    expect(discreteFollow(-100)).toBe(-50);
    expect(discreteFollow(400)).toBe(DISCRETE_CAP);
    expect(discreteFollow(-400)).toBe(-DISCRETE_CAP);
    expect(discreteFollow(100, false)).toBeCloseTo(50 * RUBBER);
  });
  it("direction: finger to the left = next", () => {
    expect(dirOf(-5)).toBe(1);
    expect(dirOf(5)).toBe(-1);
  });
});

describe("velocity", () => {
  it("measures the last 100 ms", () => {
    const s = [
      { t: 0, x: 300 },
      { t: 50, x: 290 },
      { t: 100, x: 250 },
      { t: 150, x: 200 },
    ];
    expect(velocity(s, 150)).toBeCloseTo((200 - 290) / 100);
  });
  it("is 0 when the finger rested before release", () => {
    expect(velocity([{ t: 0, x: 0 }, { t: 10, x: 20 }], 200)).toBe(0);
    expect(velocity([{ t: 0, x: 0 }], 0)).toBe(0);
  });
});

describe("curves", () => {
  it("cubic-bezier matches its ends and is monotonic", () => {
    const f = cubicBezier(0.6, 0, 0.2, 1);
    expect(f(0)).toBe(0);
    expect(f(1)).toBe(1);
    let prev = 0;
    for (let i = 1; i <= 20; i++) {
      const y = f(i / 20);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
    expect(cubicBezier(0, 0, 1, 1)(0.3)).toBeCloseTo(0.3, 3); // linear
  });
  it("ease-out is ahead of linear", () => {
    expect(easeOut(0.25)).toBeGreaterThan(0.5);
    expect(easeOut(0.5)).toBeGreaterThan(0.8);
  });
  it("dock ease: 1 − (1 − d)², clamped", () => {
    expect(dockEase(0)).toBe(0);
    expect(dockEase(0.5)).toBeCloseTo(0.75);
    expect(dockEase(1)).toBe(1);
    expect(dockEase(2)).toBe(1);
    expect(dockEase(-1)).toBe(0);
  });
});
