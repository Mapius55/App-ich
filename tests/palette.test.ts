import { describe, expect, it } from "vitest";
import { computePalette } from "../src/lib/palette";
import { COLORS } from "../src/lib/colors100";
import { rgbToOklab, hexToRgb } from "../src/lib/color";

const zurich = { lat: 47.37, lon: 8.54 };
const at = (iso: string) => new Date(iso);
const hue = (hex: string) => {
  const [, a, b] = rgbToOklab(hexToRgb(hex));
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
};

describe("colour library", () => {
  it("has 100 unique colours", () => {
    expect(COLORS).toHaveLength(100);
    expect(new Set(COLORS.map((c) => c.hex)).size).toBe(100);
  });
});

describe("computePalette", () => {
  it("returns 10 sky colours and 5 portal colours", () => {
    const p = computePalette({ date: at("2026-11-14T13:00:00+01:00"), ...zurich });
    expect(p.colors).toHaveLength(10);
    expect(p.orb).toHaveLength(5);
    expect(p.names).toHaveLength(10);
  });
  it("labels the light phases", () => {
    expect(computePalette({ date: at("2026-11-14T23:00:00+01:00"), ...zurich }).phase).toBe("Nacht");
    expect(computePalette({ date: at("2026-11-14T13:00:00+01:00"), ...zurich }).phase).toBe("Tag");
    expect(computePalette({ date: at("2026-11-14T16:50:00+01:00"), ...zurich }).phase).toBe("Sonnenuntergang");
  });
  it("keeps the night in greens and blues (no violet)", () => {
    const p = computePalette({ date: at("2026-11-14T23:30:00+01:00"), ...zurich });
    const coolish = p.orb.filter((c) => {
      const h = hue(c);
      return h > 120 && h < 280; // green … blue
    });
    expect(coolish.length).toBeGreaterThanOrEqual(3);
  });
  it("is stable within a day and varies between days", () => {
    const a = computePalette({ date: at("2026-11-14T13:00:00+01:00"), ...zurich });
    const b = computePalette({ date: at("2026-11-14T13:00:30+01:00"), ...zurich });
    const c = computePalette({ date: at("2026-11-17T13:00:00+01:00"), ...zurich });
    expect(b.colors).toEqual(a.colors);
    expect(c.colors).not.toEqual(a.colors);
  });
  it("picks rain colours when it rains", () => {
    const p = computePalette({
      date: at("2026-11-14T13:00:00+01:00"),
      ...zurich,
      weather: { kind: "rain", cloudCover: 100, temperature: 6, description: "", fetchedAt: 0 },
    });
    expect(p.names.some((n) => /Regen|Schiefer|Sturm|Wolken/.test(n))).toBe(true);
  });
  it("keeps the ground almost black", () => {
    const p = computePalette({ date: at("2026-11-14T13:00:00+01:00"), ...zurich });
    const [L] = rgbToOklab(hexToRgb(p.ground));
    expect(L).toBeLessThan(0.15);
  });
});
