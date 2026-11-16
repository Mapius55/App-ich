// Sound only when she wants it: only a real tap on the circle lets the coach speak, never a swipe
// across it, a tap beside it, or a tap while the time column moves.
import { describe, expect, it } from "vitest";
import { AXIS_SLOP, circleTap } from "../src/space/gestures";

// the orb slot on an iPhone 13: 358 × 420, the circle is its largest square (max 300) in the middle
const slot = { left: 16, top: 200, width: 358, height: 420 };
const c = { x: 16 + 179, y: 200 + 210 };

describe("circleTap", () => {
  it("takes a tap on the circle", () => {
    expect(circleTap(c, c, slot)).toBe(true);
    expect(circleTap(c, { x: c.x + 3, y: c.y - 4 }, slot)).toBe(true);
    expect(circleTap({ x: c.x + 140, y: c.y }, { x: c.x + 145, y: c.y }, slot)).toBe(true); // near the edge
  });

  it("never a swipe or a drag across it", () => {
    expect(circleTap(c, { x: c.x + AXIS_SLOP, y: c.y }, slot)).toBe(false);
    expect(circleTap({ x: c.x - 60, y: c.y }, { x: c.x + 20, y: c.y }, slot)).toBe(false);
    expect(circleTap(c, { x: c.x, y: c.y - 40 }, slot)).toBe(false);
  });

  it("not beside the circle, without a pointerdown, or while moving", () => {
    expect(circleTap({ x: 20, y: 210 }, { x: 20, y: 210 }, slot)).toBe(false); // the slot's corner
    expect(circleTap(null, c, slot)).toBe(false);
    expect(circleTap(c, c, slot, true)).toBe(false);
    expect(circleTap(c, c, { ...slot, width: 0 })).toBe(false);
  });

  it("the old screens pass the drawn circle itself (no 300 px cap)", () => {
    const big = { left: 0, top: 100, width: 400, height: 400 };
    const edge = { x: 200 + 190, y: 300 };
    expect(circleTap(edge, edge, big)).toBe(false); // capped at 300: outside
    expect(circleTap(edge, edge, big, false, Infinity)).toBe(true);
  });
});
