// Fixes after the Bucket List review: the coach's «Erfüllt» (its done_at may lie days back), the
// wash it asks for, and «Gehört zu» telling dreams from goals.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/backend", () => ({ backend: {} }));
vi.mock("../src/lib/voice", () => ({}));

import { goalToast } from "../src/components/VoiceConversation";
import { goalLinkOptions, goalLinkView, goalLinkWords } from "../src/components/plan/GoalLinkField";
import { markWashed, requestWash, resetWashedForTests, wantsWash } from "../src/places/fulfilled";
import type { Goal } from "../src/lib/types";

const NOW = Date.parse("2026-11-15T16:12:00+01:00");
const goal = (o: Partial<Goal> = {}): Goal =>
  ({
    id: "g1",
    title: "Polarlichter sehen",
    kind: "dream",
    status: "done",
    target_date: null,
    why: null,
    done_at: "2026-11-08T11:00:00.000Z", // done_date last Sunday: noon of that day
    memory: null,
    milestones: [],
    created_at: "2026-01-10T10:00:00.000Z",
    updated_at: "2026-11-15T15:12:00.000Z",
    time: { logged_minutes: 0, block_minutes: 0 },
    ...o,
  }) as Goal;

describe("the coach fulfils a dream", () => {
  afterEach(() => resetWashedForTests());

  it("says «Erfüllt» when the server flags it, however old done_at is", () => {
    expect(goalToast({ goal: goal(), fulfilled: true }, new Map(), NOW)?.label).toBe("Erfüllt");
    expect(goalToast({ goal: goal({ done_at: "2026-11-15T11:00:00.000Z" }), fulfilled: true }, new Map(), NOW)?.label).toBe("Erfüllt");
  });

  it("without the flag only a done_at of a moment ago counts (an older server)", () => {
    expect(goalToast({ goal: goal() }, new Map(), NOW)?.label).toBe("Plan aktualisiert");
    expect(goalToast({ goal: goal({ done_at: new Date(NOW - 30_000).toISOString() }) }, new Map(), NOW)?.label).toBe("Erfüllt");
  });

  it("says it once per dream, and never for a goal", () => {
    const seen = new Map<string, number>();
    expect(goalToast({ goal: goal(), fulfilled: true }, seen, NOW)?.label).toBe("Erfüllt");
    expect(goalToast({ goal: goal(), fulfilled: true }, seen, NOW + 1000)).toBeNull();
    expect(goalToast({ goal: goal({ id: "g2", kind: "goal" }), fulfilled: true }, new Map(), NOW)?.label).not.toBe("Erfüllt");
  });

  it("washes it once when the server flags it, whatever done_at says", () => {
    const g = goal();
    expect(wantsWash(g, NOW)).toBe(false); // a week old
    requestWash(g.id);
    expect(wantsWash(g, NOW)).toBe(true);
    markWashed(g.id);
    expect(wantsWash(g, NOW)).toBe(false);
    // reopened and fulfilled again by the coach: once more
    requestWash(g.id);
    expect(wantsWash(g, NOW)).toBe(true);
    // only a dream that is done
    expect(wantsWash(goal({ status: "active" }), NOW)).toBe(false);
  });
});

describe("«Gehört zu»", () => {
  const all = [
    goal({ id: "d1", status: "active" }),
    goal({ id: "d2", title: "Hörnlihütte", status: "done" }),
    goal({ id: "d3", title: "Losgelassen", status: "dropped" }),
    goal({ id: "z1", title: "Halbmarathon", kind: "goal", status: "active" }),
    goal({ id: "z2", title: "Alt", kind: "goal", status: "done" }),
  ];

  it("offers open dreams and goals apart, without fulfilled or dropped ones", () => {
    const o = goalLinkOptions(all, null);
    expect(o.dreams.map((g) => g.id)).toEqual(["d1"]);
    expect(o.goals.map((g) => g.id)).toEqual(["z1", "z2"]);
    expect(goalLinkWords(o)).toEqual({ label: "Gehört zu", none: "Kein Ziel oder Traum" });
  });

  it("keeps the one it belongs to, fulfilled or dropped, so it can be seen and unlinked", () => {
    expect(goalLinkOptions(all, "d2").dreams.map((g) => g.id)).toEqual(["d1", "d2"]);
    expect(goalLinkOptions(all, "d3").dreams.map((g) => g.id)).toEqual(["d1", "d3"]);
  });

  it("names the field and the link after what there is", () => {
    expect(goalLinkWords({ dreams: [], goals: [all[3]] })).toEqual({ label: "Gehört zu Ziel", none: "Kein Ziel" });
    expect(goalLinkWords({ dreams: [all[0]], goals: [] })).toEqual({ label: "Gehört zu Traum", none: "Kein Traum" });
    expect(goalLinkView(all[0])).toBe("Traum ansehen");
    expect(goalLinkView(all[3])).toBe("Ziel ansehen");
  });
});
