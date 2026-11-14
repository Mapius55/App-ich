import { describe, expect, it } from "vitest";
import { contextBlock, MODE_CHECKIN, MODE_ONBOARDING, MODE_TIDY, PERSONA, type ContextInput } from "../supabase/functions/coach/prompt";

// Saturday, 14 November 2026, in Zurich (winter time, UTC+1).
const base: ContextInput = {
  day: "2026-11-14",
  localTime: "Samstag, 14. November 2026, 07:40",
  timezone: "Europe/Zurich",
  season: "Herbst",
  phase: "Morgendämmerung",
  hasLocation: true,
  profile: { display_name: "Mia", location_name: "Bern", summary: null, nature_palette: null },
  memories: [],
  recentDays: [],
};

const race = {
  id: "g1",
  title: "Halbmarathon Zürich",
  why: "Will sich selbst etwas beweisen.",
  target_date: "2026-12-24",
  status: "active",
  // deliberately out of order: the context sorts by position
  milestones: [
    { id: "m3", title: "18 km laufen", due_date: null, done_at: null, position: 2 },
    { id: "m1", title: "10 km am Stück", due_date: "2026-11-01", done_at: "2026-10-30T17:00:00Z", position: 0 },
    { id: "m2", title: "15 km laufen", due_date: "2026-12-01", done_at: null, position: 1 },
  ],
};

const lines = (c: Partial<ContextInput>) => contextBlock({ ...base, ...c }).split("\n");

describe("contextBlock: goals", () => {
  it("shows goals with target date, progress and the milestones in order", () => {
    const out = lines({ goals: [race] });
    const i = out.indexOf("- [g1] Halbmarathon Zürich · Zieldatum 2026-12-24 (noch 40 Tage) · 1 von 3 Etappen erledigt");
    expect(i).toBeGreaterThan(-1);
    expect(out.slice(i + 1, i + 5)).toEqual([
      "  Warum: Will sich selbst etwas beweisen.",
      "  - [m1] erledigt: 10 km am Stück · bis 2026-11-01",
      "  - [m2] offen, als Nächstes: 15 km laufen · bis 2026-12-01",
      "  - [m3] offen: 18 km laufen",
    ]);
  });

  it("marks paused goals and goals without date or milestones", () => {
    const out = lines({ goals: [{ id: "g2", title: "Italienisch lernen", why: null, target_date: null, status: "paused", milestones: [] }] });
    expect(out).toContain("- [g2] Italienisch lernen · ohne Datum · noch keine Etappen · pausiert");
  });

  it("says when there is nothing", () => {
    const out = contextBlock(base);
    expect(out).toContain("## Ziele ([id] Titel · Zieldatum · Etappen, darunter die Etappen)\n(keine)");
    expect(out).toContain("## Gewohnheiten ([id] Titel · wie oft · diese Woche · heute · Serie)\n(keine)");
    expect(out).toMatch(/## Kalender „I am“ .*\n\(keine\)$/);
  });
});

describe("contextBlock: habits", () => {
  it("shows how often this week, today and the streak of a weekly habit", () => {
    const out = lines({
      goals: [race],
      habits: [
        {
          id: "h1",
          title: "Laufen",
          per_week: 3,
          goal_id: "g1",
          // two full weeks before this one, and two of three so far this week
          done_days: ["2026-10-26", "2026-10-28", "2026-10-30", "2026-11-02", "2026-11-04", "2026-11-07", "2026-11-10", "2026-11-12"],
        },
      ],
    });
    expect(out).toContain("- [h1] Laufen · 3× pro Woche · diese Woche 2 von 3 · heute noch nicht · 2 Wochen in Folge · für das Ziel „Halbmarathon Zürich“");
  });

  it("counts a daily habit in days and leaves out a missing streak", () => {
    const out = lines({
      habits: [
        { id: "h2", title: "Meditieren", per_week: 7, goal_id: null, done_days: ["2026-11-12", "2026-11-13", "2026-11-14"] },
        { id: "h3", title: "Lesen", per_week: 2, goal_id: "unknown", done_days: [] },
      ],
    });
    expect(out).toContain("- [h2] Meditieren · jeden Tag · diese Woche 3 von 7 · heute erledigt · 3 Tage in Folge");
    expect(out).toContain("- [h3] Lesen · 2× pro Woche · diese Woche 0 von 2 · heute noch nicht");
  });
});

describe("contextBlock: calendar", () => {
  it("shows start and end in local time, all-day entries, blocks and the goal they serve", () => {
    const out = lines({
      goals: [race],
      events: [
        { id: "e1", title: "Lauftraining", starts_at: "2026-11-14T08:00:00Z", ends_at: "2026-11-14T09:30:00Z", all_day: false, location: null, kind: "block", goal_id: "g1" },
        { id: "e2", title: "Familienbrunch", starts_at: "2026-11-14T23:00:00Z", ends_at: null, all_day: true, location: null, kind: "termin", goal_id: null },
        { id: "e3", title: "Zahnarzt", starts_at: "2026-11-16T17:00:00Z", ends_at: null, all_day: false, location: "Bern", kind: "termin", goal_id: null },
        { id: "e4", title: "Weihnachten in Chur", starts_at: "2026-12-23T23:00:00Z", ends_at: "2026-12-25T23:00:00Z", all_day: true, location: null, kind: "termin", goal_id: null },
        { id: "e5", title: "Nachtzug", starts_at: "2026-11-20T21:30:00Z", ends_at: "2026-11-21T06:15:00Z", all_day: false, location: null },
      ],
    });
    expect(out).toContain("- [e1] Sa., 14. Nov. (heute), 09:00–10:30: Lauftraining · Block · für das Ziel „Halbmarathon Zürich“");
    expect(out).toContain("- [e2] So., 15. Nov. (morgen), ganztägig: Familienbrunch");
    expect(out).toContain("- [e3] Mo., 16. Nov., 18:00: Zahnarzt (Bern)");
    expect(out).toContain("- [e4] Do., 24. Dez. bis Sa., 26. Dez., ganztägig: Weihnachten in Chur");
    expect(out).toContain("- [e5] Fr., 20. Nov., 22:30 bis Sa., 21. Nov., 07:15: Nachtzug");
  });

  it("uses the person's time zone", () => {
    const out = lines({
      timezone: "America/New_York",
      day: "2026-11-13",
      events: [{ id: "e1", title: "Call", starts_at: "2026-11-14T03:00:00Z", ends_at: "2026-11-14T04:00:00Z", all_day: false, location: null }],
    });
    expect(out).toContain("- [e1] Fr., 13. Nov. (heute), 22:00–23:00: Call");
  });

  it("puts today's date next to the local time", () => {
    expect(contextBlock(base)).toContain("Samstag, 14. November 2026, 07:40 (2026-11-14, Zeitzone Europe/Zurich).");
  });
});

describe("prompt texts", () => {
  const stable = [PERSONA, MODE_ONBOARDING, MODE_CHECKIN, MODE_TIDY];

  it("write Swiss High German: no ß (except where the rule names it)", () => {
    for (const t of stable) expect(t.replace("statt „ß“", "")).not.toContain("ß");
    expect(contextBlock({ ...base, goals: [race] })).not.toContain("ß");
  });

  it("stay byte-stable for the prompt cache: no dates", () => {
    for (const t of stable) expect(t).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("explain the plan tools", () => {
    for (const name of ["create_goal", "update_goal", "add_milestone", "update_milestone", "create_habit", "log_habit", "kind block", "goal_id"]) {
      expect(PERSONA).toContain(name);
    }
    expect(MODE_CHECKIN).toContain("kind block");
    expect(MODE_CHECKIN).toContain("reminder_minutes 10");
  });
});
