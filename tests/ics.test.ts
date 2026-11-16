import { describe, expect, it } from "vitest";
import { buildIcs, zonedToUtc } from "../supabase/functions/_shared/ics";

describe("zonedToUtc", () => {
  it("converts Swiss winter and summer time", () => {
    expect(zonedToUtc("2026-03-28T09:00", "Europe/Zurich")).toBe("2026-03-28T08:00:00.000Z");
    expect(zonedToUtc("2026-07-14T09:00", "Europe/Zurich")).toBe("2026-07-14T07:00:00.000Z");
  });
  it("handles the day the clocks change", () => {
    expect(zonedToUtc("2026-03-29T03:30", "Europe/Zurich")).toBe("2026-03-29T01:30:00.000Z");
    expect(zonedToUtc("2026-10-25T12:00", "Europe/Zurich")).toBe("2026-10-25T11:00:00.000Z");
  });
  it("treats a date without time as local midnight", () => {
    expect(zonedToUtc("2026-03-29", "Europe/Zurich")).toBe("2026-03-28T23:00:00.000Z");
  });
  it("rejects garbage", () => {
    expect(() => zonedToUtc("Samstag", "Europe/Zurich")).toThrow();
  });
});

describe("buildIcs", () => {
  const ics = buildIcs(
    [
      { id: "a", title: "Rennen, Zürich", starts_at: "2026-03-29T07:00:00.000Z", ends_at: null, all_day: false, location: "See; Ufer", notes: "Zeile 1\nZeile 2", reminder_minutes: 30 },
      { id: "b", title: "Ruhetag", starts_at: "2026-03-29T22:00:00.000Z", ends_at: null, all_day: true, location: null, notes: null, reminder_minutes: -480 },
    ],
    { timezone: "Europe/Zurich" },
  );
  it("names the calendar and uses CRLF", () => {
    expect(ics).toContain("X-WR-CALNAME:Bucket List\r\n");
    expect(ics).toContain("PRODID:-//Bucket List//Coach//DE\r\n");
    expect(ics).not.toContain("I am");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  });
  it("keeps the event UIDs and their domain (renaming them would duplicate subscribed events)", () => {
    expect(ics).toContain("UID:a@i-am\r\n");
    expect(ics).toContain("UID:b@i-am\r\n");
  });
  it("escapes text values", () => {
    expect(ics).toContain("SUMMARY:Rennen\\, Zürich");
    expect(ics).toContain("LOCATION:See\\; Ufer");
    expect(ics).toContain("DESCRIPTION:Zeile 1\\nZeile 2");
  });
  it("writes timed events in UTC with a default one-hour end and a reminder", () => {
    expect(ics).toContain("DTSTART:20260329T070000Z");
    expect(ics).toContain("DTEND:20260329T080000Z");
    expect(ics).toContain("TRIGGER:-PT30M");
  });
  it("writes all-day events as local dates", () => {
    expect(ics).toContain("DTSTART;VALUE=DATE:20260330");
    expect(ics).toContain("DTEND;VALUE=DATE:20260331");
    expect(ics).toContain("TRIGGER:PT480M");
  });
  it("folds long lines at 75 octets", () => {
    const long = buildIcs([{ id: "c", title: "ä".repeat(80), starts_at: "2026-01-01T10:00:00Z", ends_at: null, all_day: false, location: null, notes: null, reminder_minutes: null }]);
    for (const line of long.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});
