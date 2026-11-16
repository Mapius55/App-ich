// The greeting waits for her: what she heard is kept per day thread on this device, an unheard
// greeting stays offered («Hören»), and one from an earlier part of the day gives way to a fresh one
// on her tap (no coach call for a glance at the app).
import { describe, expect, it } from "vitest";
import { dayPart, greetingOffer, greetingStale, markHeard, STALE_MS, textHash, wasHeard } from "../src/lib/heard";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
const at = (h: number, m = 0) => new Date(2026, 10, 16, h, m).getTime();

describe("heard on this device", () => {
  it("hashes stably and tells texts apart", () => {
    expect(textHash("Guten Morgen, Marius.")).toBe(textHash("Guten Morgen, Marius."));
    expect(textHash("Guten Morgen, Marius.")).not.toBe(textHash("Guten Abend, Marius."));
  });

  it("remembers the last heard text of a thread (one entry, trimmed)", () => {
    const s = memory();
    expect(wasHeard("2026-11-16", "Guten Morgen.", s)).toBe(false);
    markHeard("2026-11-16", "Guten Morgen. ", s);
    expect(wasHeard("2026-11-16", "Guten Morgen.", s)).toBe(true);
    expect(wasHeard("2026-11-17", "Guten Morgen.", s)).toBe(false); // another day
    markHeard("2026-11-16", "Wie geht es dir?", s);
    expect(wasHeard("2026-11-16", "Guten Morgen.", s)).toBe(false); // only the last one counts
    expect(s.m.size).toBe(1); // never grows
  });

  it("without storage nothing breaks and the replay is offered", () => {
    expect(() => markHeard("2026-11-16", "Hoi.", broken)).not.toThrow();
    expect(wasHeard("2026-11-16", "Hoi.", broken)).toBe(false);
    expect(wasHeard("2026-11-16", "Hoi.", null)).toBe(false);
  });
});

describe("a greeting that no longer fits", () => {
  it("knows the parts of the day", () => {
    expect([dayPart(new Date(at(7))), dayPart(new Date(at(10, 59))), dayPart(new Date(at(11))), dayPart(new Date(at(16, 59))), dayPart(new Date(at(17))), dayPart(new Date(at(23)))]).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it("is stale after about 3 hours or in a later part of the day", () => {
    expect(greetingStale(at(7, 20), at(8, 30))).toBe(false);
    expect(greetingStale(at(7, 20), at(10, 19))).toBe(false);
    expect(greetingStale(at(7, 20), at(7, 20) + STALE_MS)).toBe(true);
    expect(greetingStale(at(10, 30), at(11, 15))).toBe(true); // morning → day
    expect(greetingStale(at(12, 0), at(14, 30))).toBe(false);
    expect(greetingStale(at(16, 30), at(17, 5))).toBe(true); // day → evening
    expect(greetingStale(0, at(20))).toBe(false); // unknown time: never stale
  });

  it("offers «Hören», a fresh greeting on her tap, or nothing", () => {
    const base = { spoke: false, hasReply: true, heard: false, at: at(7, 20) };
    expect(greetingOffer({ ...base, now: at(8, 30) })).toBe("hear");
    expect(greetingOffer({ ...base, now: at(13, 30) })).toBe("fresh");
    expect(greetingOffer({ ...base, heard: true, now: at(13, 30) })).toBe("none");
    expect(greetingOffer({ ...base, spoke: true, now: at(13, 30) })).toBe("none");
    expect(greetingOffer({ ...base, hasReply: false, now: at(8, 30) })).toBe("none");
  });
});
