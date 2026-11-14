import { describe, expect, it } from "vitest";
import { computePalette } from "../src/lib/palette";
import { WORLDS, ROLES } from "../src/lib/worlds";
import { lch } from "../src/lib/color";

const zurich = { lat: 47.37, lon: 8.54 };
const at = (iso: string) => new Date(iso);
const W = (kind: "clear" | "rain" | "fog" | "snow", cloudCover: number) => ({ kind, cloudCover, temperature: 5, description: "", fetchedAt: 0 });

// "Muddy" = what turns into brown/olive/grey on a glowing dark ground
const muddy = (hex: string) => {
  const [L, C, h] = lch(hex);
  return (h >= 40 && h <= 110 && C < 0.1 && L > 0.25 && L < 0.7) || (C < 0.03 && L > 0.3 && L < 0.8);
};

describe("colour worlds", () => {
  it("are complete and unique", () => {
    expect(new Set(WORLDS.map((w) => w.id)).size).toBe(WORLDS.length);
    for (const w of WORLDS) for (const r of ROLES) expect(w[r]).toMatch(/^#[0-9a-f]{6}$/);
  });
  it("contain no muddy colours", () => {
    for (const w of WORLDS) for (const r of ["light", "main", "accent", "accent2"] as const) expect(muddy(w[r]), `${w.name} ${r} ${w[r]}`).toBe(false);
  });
  it("keep light > main > deep in lightness", () => {
    for (const w of WORLDS) {
      expect(lch(w.light)[0], w.name).toBeGreaterThan(lch(w.main)[0]);
      expect(lch(w.main)[0], w.name).toBeGreaterThan(lch(w.deep)[0]);
    }
  });
});

describe("computePalette", () => {
  it("returns five sky and five portal colours", () => {
    const p = computePalette({ date: at("2026-11-14T13:00:00+01:00"), ...zurich });
    expect(p.colors).toHaveLength(5);
    expect(p.orb).toHaveLength(5);
    expect(p.names.length).toBeGreaterThan(0);
  });
  it("labels the light phases", () => {
    expect(computePalette({ date: at("2026-11-14T23:00:00+01:00"), ...zurich }).phase).toBe("Nacht");
    expect(computePalette({ date: at("2026-11-14T13:00:00+01:00"), ...zurich }).phase).toBe("Tag");
    expect(computePalette({ date: at("2026-11-14T16:50:00+01:00"), ...zurich }).phase).toBe("Sonnenuntergang");
  });
  it("keeps the night in greens and blues", () => {
    const p = computePalette({ date: at("2026-11-14T23:30:00+01:00"), ...zurich });
    for (const c of [p.orb[0], p.orb[2]]) {
      const h = lch(c)[2];
      expect(h > 140 && h < 280, c).toBe(true);
    }
  });
  it("uses rain, fog and snow worlds in that weather", () => {
    const noon = at("2026-11-14T13:00:00+01:00");
    expect(computePalette({ date: noon, ...zurich, weather: W("rain", 100) }).names[0]).toBe("Regenblau");
    expect(computePalette({ date: noon, ...zurich, weather: W("fog", 100) }).names[0]).toBe("Morgennebel");
    expect(computePalette({ date: noon, ...zurich, weather: W("snow", 100) }).names[0]).toBe("Pulverschnee");
  });
  it("chooses the glacier world in the mountains", () => {
    const p = computePalette({ date: at("2026-07-14T12:30:00+02:00"), ...zurich, elevation: 1800 });
    expect(p.names).toContain("Gletscher");
  });
  it("is stable within the minute and keeps the ground almost black", () => {
    const a = computePalette({ date: at("2026-11-14T13:00:00+01:00"), ...zurich });
    const b = computePalette({ date: at("2026-11-14T13:00:20+01:00"), ...zurich });
    expect(b.colors).toEqual(a.colors);
    expect(lch(a.ground)[0]).toBeLessThan(0.15);
  });
});
