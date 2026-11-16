// Habits without pressure: the week's count shows from the first one done, never «0 von N».
import { describe, expect, it } from "vitest";
import { habitMetaParts, weekCount } from "../src/places/habitMeta";

describe("habit meta line", () => {
  it("shows the week's count only from 1 upward", () => {
    expect(weekCount(0, 7)).toBeNull();
    expect(weekCount(1, 7)).toBe("1 von 7 diese Woche");
    expect(weekCount(3, 3)).toBe("3 von 3 diese Woche");
  });

  it("keeps the streak and the goal, in order, without a leading separator", () => {
    expect(habitMetaParts({ done: 0, target: 3, streak: null, goal: "Halbmarathon Zürich" })).toEqual([{ key: "goal", text: "Halbmarathon Zürich" }]);
    expect(habitMetaParts({ done: 2, target: 3, streak: "seit 2 Wochen", goal: "Halbmarathon Zürich" }).map((p) => p.text)).toEqual(["2 von 3 diese Woche", "seit 2 Wochen", "Halbmarathon Zürich"]);
    expect(habitMetaParts({ done: 0, target: 7, streak: null })).toEqual([]);
  });
});
