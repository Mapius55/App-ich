// The motion store (quiet while the time column moves): what arrives during a touch or a fling waits
// and goes out in order once it is still; at rest everything runs at once.
import { afterEach, describe, expect, it, vi } from "vitest";
import { motion, resetMotionForTests, whenStill } from "../src/space/motion";

afterEach(() => resetMotionForTests());

describe("motion store", () => {
  it("runs at once when still", () => {
    const ran: number[] = [];
    whenStill(() => ran.push(1));
    expect(ran).toEqual([1]);
    expect(motion.busy()).toBe(false);
  });

  it("queues while busy and flushes in order when still", () => {
    const ran: string[] = [];
    motion.set(true);
    whenStill(() => ran.push("door"));
    whenStill(() => ran.push("goals"));
    whenStill(() => ran.push("tag"));
    expect(ran).toEqual([]);
    motion.set(false);
    expect(ran).toEqual(["door", "goals", "tag"]);
    whenStill(() => ran.push("tap"));
    expect(ran).toEqual(["door", "goals", "tag", "tap"]);
  });

  it("set() is idempotent and notifies subscribers on each flip only", () => {
    const seen: boolean[] = [];
    const off = motion.subscribe(() => seen.push(motion.busy()));
    motion.set(true);
    motion.set(true);
    motion.set(false);
    motion.set(false);
    motion.set(true);
    expect(seen).toEqual([true, false, true]);
    off();
    motion.set(false);
    expect(seen).toEqual([true, false, true]);
  });

  it("a second still does not run a callback twice", () => {
    const fn = vi.fn();
    motion.set(true);
    whenStill(fn);
    motion.set(false);
    motion.set(true);
    motion.set(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("the queue is flushed before the subscribers hear it is still", () => {
    const order: string[] = [];
    motion.subscribe(() => !motion.busy() && order.push("subscriber"));
    motion.set(true);
    whenStill(() => order.push("queued"));
    motion.set(false);
    expect(order).toEqual(["queued", "subscriber"]);
  });

  it("a throwing callback does not block the rest", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const ran: number[] = [];
    motion.set(true);
    whenStill(() => ran.push(1));
    whenStill(() => {
      throw new Error("kaputt");
    });
    whenStill(() => ran.push(3));
    motion.set(false);
    expect(ran).toEqual([1, 3]);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("a callback that starts a new move leaves the rest waiting", () => {
    const ran: number[] = [];
    motion.set(true);
    whenStill(() => {
      ran.push(1);
      motion.set(true);
    });
    whenStill(() => ran.push(2));
    motion.set(false);
    expect(ran).toEqual([1]);
    expect(motion.busy()).toBe(true);
    motion.set(false);
    expect(ran).toEqual([1, 2]);
  });
});
