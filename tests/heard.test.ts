// The greeting waits for her: what she heard is kept per day thread on this device, an unheard
// greeting stays offered («Hören»), and one from an earlier part of the day gives way to a fresh one
// on her tap (no coach call for a glance at the app).
import { describe, expect, it } from "vitest";
import { dayPart, freshOnHeldTap, greetingMissing, greetingOffer, greetingStale, markHeard, PART_MIN_MS, STALE_MS, textHash, wasHeard } from "../src/lib/heard";

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
    expect(greetingStale(at(9, 30), at(11, 15))).toBe(true); // morning → day, 1 h 45 old
    expect(greetingStale(at(12, 0), at(14, 30))).toBe(false);
    expect(greetingStale(at(15, 20), at(17, 5))).toBe(true); // day → evening, 1 h 45 old
    expect(greetingStale(0, at(20))).toBe(false); // unknown time: never stale
  });

  it("a greeting of a few minutes still fits when the part of the day changes (no second greeting)", () => {
    expect(greetingStale(at(10, 58), at(11, 1))).toBe(false);
    expect(greetingStale(at(16, 59), at(17, 0))).toBe(false);
    expect(greetingStale(at(10, 30), at(11, 15))).toBe(false);
    expect(greetingStale(at(10, 30), at(10, 30) + PART_MIN_MS - 1)).toBe(false);
    expect(greetingStale(at(10, 30), at(10, 30) + PART_MIN_MS)).toBe(true);
    expect(greetingOffer({ spoke: false, hasReply: true, heard: false, at: at(10, 58), now: at(11, 1) })).toBe("hear");
  });

  it("offers «Hören», a fresh greeting on her tap, or nothing", () => {
    const base = { spoke: false, hasReply: true, heard: false, at: at(7, 20) };
    expect(greetingOffer({ ...base, now: at(8, 30) })).toBe("hear");
    expect(greetingOffer({ ...base, now: at(13, 30) })).toBe("fresh");
    expect(greetingOffer({ ...base, heard: true, now: at(13, 30) })).toBe("none");
    expect(greetingOffer({ ...base, spoke: true, now: at(13, 30) })).toBe("none");
    expect(greetingOffer({ ...base, hasReply: false, now: at(8, 30) })).toBe("none");
  });

  it("her tap on a waiting greeting makes a fresh one only when it no longer fits and she is online", () => {
    const base = { held: true, waiting: true, online: true, at: at(7, 20) };
    expect(freshOnHeldTap({ ...base, now: at(13, 30) })).toBe(true);
    expect(freshOnHeldTap({ ...base, now: at(8, 30) })).toBe(false); // still fits: it plays
    expect(freshOnHeldTap({ ...base, online: false, now: at(13, 30) })).toBe(false); // offline: the waiting one plays
    expect(freshOnHeldTap({ ...base, held: false, now: at(13, 30) })).toBe(false);
    expect(freshOnHeldTap({ ...base, waiting: false, now: at(13, 30) })).toBe(false); // still being written
  });
});

describe("a greeting that never arrived", () => {
  it("starts again when the thread holds only its hidden opener", () => {
    expect(greetingMissing([])).toBe(true);
    expect(greetingMissing([{ hidden: true }])).toBe(true); // closed while it was being written
    expect(greetingMissing([{ hidden: true }, { hidden: true }])).toBe(true);
    expect(greetingMissing([{ hidden: true }, { hidden: false }])).toBe(false); // the greeting is there
    expect(greetingMissing([{}])).toBe(false); // a message without the flag is visible
  });
});
