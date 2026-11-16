import { describe, expect, it } from "vitest";
import { doorLine } from "../src/space/doorLine";
import type { CalendarEvent } from "../src/lib/types";

// local times, so the test holds in any time zone
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);
function ev(id: string, title: string, start: Date, allDay = false): CalendarEvent {
  return { id, title, starts_at: start.toISOString(), ends_at: null, all_day: allDay, location: null, notes: null, reminder_minutes: null, source: "person", kind: "termin", goal_id: null };
}
const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

describe("doorLine", () => {
  const now = at(2026, 11, 14, 16, 12);
  const lauf = ev("e1", "Lauftraining", at(2026, 11, 14, 17, 0));
  const vorlesung = ev("e0", "Vorlesung Statistik", at(2026, 11, 14, 8, 0));

  it("shows the next timed entry today", () => {
    const d = doorLine([vorlesung, lauf], now);
    expect(d.label).toBe("Heute");
    expect(d.text).toBe(`${hm(at(2026, 11, 14, 17))} Lauftraining`);
    expect(d.aria).toBe(`Als Nächstes: Lauftraining heute um ${hm(at(2026, 11, 14, 17))}. Deinen Tag ansehen`);
    expect(d.day).toBe("2026-11-14");
    expect(d.id).toBe("e1");
  });

  it("keeps an entry until 30 min after its start", () => {
    const started = ev("e2", "Lauf locker", at(2026, 11, 14, 15, 50));
    expect(doorLine([started, lauf], now).id).toBe("e2");
    const over = ev("e3", "Lauf locker", at(2026, 11, 14, 15, 40));
    expect(doorLine([over, lauf], now).id).toBe("e1");
  });

  it("falls back to an all-day entry today", () => {
    const d = doorLine([vorlesung, ev("a", "Rennen", at(2026, 11, 14), true)], now);
    expect(d.text).toBe("Ganztags: Rennen");
    expect(d.aria).toBe("Als Nächstes: Rennen heute, ganztags. Deinen Tag ansehen");
  });

  it("after 20:00 shows tomorrow's first entry", () => {
    const late = at(2026, 11, 14, 20, 30);
    const schule = ev("s", "Schule", at(2026, 11, 15, 7, 30));
    const d = doorLine([lauf, schule], late);
    expect(d.label).toBe("Morgen");
    expect(d.text).toBe(`${hm(at(2026, 11, 15, 7, 30))} Schule`);
    expect(d.day).toBe("2026-11-15");
    // before 20:00 tomorrow does not count yet
    expect(doorLine([schule], at(2026, 11, 14, 19, 0)).text).toBe("Nichts mehr geplant");
  });

  it("Nichts mehr geplant / Dein Tag", () => {
    expect(doorLine([vorlesung, ev("x", "Physio", at(2026, 11, 18, 9))], now)).toMatchObject({ label: "Heute", text: "Nichts mehr geplant", aria: "Heute ist nichts mehr geplant. Deinen Tag ansehen" });
    expect(doorLine([vorlesung, ev("y", "Später", at(2026, 11, 30, 9))], now)).toMatchObject({ label: "", text: "Dein Tag", aria: "Deinen Tag ansehen", day: "2026-11-14" });
    expect(doorLine([], now).text).toBe("Dein Tag");
  });
});
