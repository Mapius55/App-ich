// Ehrlich zählen: a past block nobody answered counts provisionally for 7 days, then no more; blocks from before
// the release keep counting as before; Ja · Teilweise · Nein; the pattern of a goal's blocks; the week line.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  blockAnswerState,
  blockPattern,
  dayMinutes,
  goalDayMinutes,
  goalEffort,
  localClock,
  partialMinutes,
  patternOffer,
  patternOfferDue,
  PROVISIONAL_DAYS,
  provisionalDays,
  unansweredCredit,
  weekGoalSummary,
} from "../src/lib/plan";
import { WEEK_ROW_MIN, weekGoalLine, weekGoalRoom } from "../src/time/layout";
import { contextBlock, effortLine, MODE_CHECKIN, patternLine, PERSONA, type ContextInput } from "../supabase/functions/coach/prompt";
import { BLOCK_NO_NEXT } from "../supabase/functions/coach/rules";
import { DemoBackend } from "../src/lib/demoBackend";

const H = 3600_000;
const D = 24 * H;
const NOW = Date.parse("2026-11-23T12:00:00Z");
const FROM = "2026-11-17T09:00:00Z"; // the release (public.honest_count_from())
const at = (ms: number) => new Date(ms).toISOString();

describe("unansweredCredit: how a past block nobody answered counts", () => {
  it("provisionally for 7 days after it ended, then no more (never a miss)", () => {
    expect(PROVISIONAL_DAYS).toBe(7);
    const ended = (daysAgo: number) => ({ ends_at: at(NOW - daysAgo * D), created_at: at(NOW - 3 * D) });
    expect(unansweredCredit(ended(0.1), NOW, FROM)).toBe("provisional");
    expect(unansweredCredit(ended(5.9), NOW, FROM)).toBe("provisional");
    // released earlier: a block ending 6.9 days ago still counts, one that ended 7 days ago no more
    expect(unansweredCredit(ended(6.9), NOW, "2026-11-10T00:00:00Z")).toBe("provisional");
    expect(unansweredCredit({ ends_at: at(NOW - 7 * D), created_at: at(NOW - 3 * D) }, NOW, "2026-11-10T00:00:00Z")).toBeNull();
    expect(unansweredCredit({ ends_at: at(NOW - 7 * D - 1), created_at: at(NOW - 3 * D) }, NOW, "2026-11-10T00:00:00Z")).toBeNull();
    // not ended yet, or no end
    expect(unansweredCredit({ ends_at: at(NOW + H) }, NOW, FROM)).toBeNull();
    expect(unansweredCredit({ ends_at: null }, NOW, FROM)).toBeNull();
  });

  it("keeps a block that ended and was entered before the release, as it always counted", () => {
    expect(unansweredCredit({ ends_at: "2026-10-01T18:00:00Z", created_at: "2026-09-30T08:00:00Z" }, NOW, FROM)).toBe("kept");
    // an older row without created_at: only the end decides
    expect(unansweredCredit({ ends_at: "2026-10-01T18:00:00Z" }, NOW, FROM)).toBe("kept");
    // ended just before the release, within the 7 days: still kept (full tone, not provisional)
    expect(unansweredCredit({ ends_at: "2026-11-17T08:00:00Z", created_at: "2026-11-10T08:00:00Z" }, NOW, FROM)).toBe("kept");
    // entered after the release for a time before it: the 7-day rule (here long over)
    expect(unansweredCredit({ ends_at: "2026-10-01T18:00:00Z", created_at: "2026-11-20T08:00:00Z" }, NOW, FROM)).toBeNull();
    // unknown start of honest counting (before the migration): as before
    expect(unansweredCredit({ ends_at: "2026-10-01T18:00:00Z", created_at: "2026-11-20T08:00:00Z" }, NOW, null)).toBe("kept");
  });
});

describe("goal time per day: confirmed and provisional", () => {
  const day = (iso: string) => iso.slice(0, 10);
  const block = (id: string, start: string, end: string, o: Record<string, unknown> = {}) => ({
    id,
    starts_at: start,
    ends_at: end,
    all_day: false,
    kind: "block",
    goal_id: "g",
    source: "coach",
    created_at: "2026-11-18T08:00:00Z",
    ...o,
  });
  const blocks = [
    block("old", "2026-10-05T16:00:00Z", "2026-10-05T17:00:00Z", { created_at: "2026-10-01T08:00:00Z" }), // before the release: kept
    block("late", "2026-11-18T16:00:00Z", "2026-11-18T17:00:00Z"), // ended 4.8 days ago: provisional
    block("gone", "2026-11-15T16:00:00Z", "2026-11-15T17:00:00Z", { created_at: "2026-11-18T08:00:00Z" }), // entered after it, 8 days ago: no more
    block("ja", "2026-11-21T16:00:00Z", "2026-11-21T17:00:00Z"), // answered
    block("future", "2026-11-24T16:00:00Z", "2026-11-24T17:00:00Z"),
  ];
  const log = [
    { day: "2026-11-21", minutes: 60 },
    { day: "2026-11-18", minutes: 20 }, // logged on a day with a provisional block too
  ];

  it("counts provisional time with the rest and tells it apart", () => {
    const m = goalDayMinutes(log, blocks, new Set(["ja"]), new Date(NOW), day, FROM);
    expect(m.total).toEqual({ "2026-10-05": 60, "2026-11-18": 80, "2026-11-21": 60 });
    expect(m.provisional).toEqual({ "2026-11-18": 60 });
    // the day is mostly provisional: drawn lighter
    expect([...provisionalDays(m)]).toEqual(["2026-11-18"]);
    expect(dayMinutes(log, blocks, new Set(["ja"]), new Date(NOW), day, FROM)).toEqual(m.total);
    // without a known start of honest counting, as before: every unanswered past block counts
    expect(dayMinutes(log, blocks, new Set(["ja"]), new Date(NOW), day)).toEqual({ "2026-10-05": 60, "2026-11-15": 60, "2026-11-18": 80, "2026-11-21": 60 });
  });

  it("a day with more confirmed than provisional time is not lighter", () => {
    const m = goalDayMinutes([{ day: "2026-11-18", minutes: 90 }], blocks, new Set(["ja"]), new Date(NOW), day, FROM);
    expect(provisionalDays(m).size).toBe(0);
  });
});

describe("goalEffort with provisional hours", () => {
  const g = { effort_hours: 20, weekly_hours: 5, prior_hours: 0, target_date: "2026-12-21", time: { logged_minutes: 600, block_minutes: 240, provisional_minutes: 180 } };
  it("counts them for the feasibility and says how much is provisional", () => {
    const e = goalEffort(g, "2026-11-23");
    expect(e.done).toBe(14);
    expect(e.provisional).toBe(3);
    // 6 left over 4 weeks = 1.5/week of 5: machbar; with confirmed time only (11 h) 9 left = 2.25/week: still machbar
    expect([e.feasibility, e.confirmedFeasibility]).toEqual(["machbar", "machbar"]);
    // where the verdict hangs on the provisional hours: 6 left over 2 weeks = 3/week of 3.6 (machbar),
    // with confirmed time only 9 left = 4.5/week (kaum machbar)
    const hangs = goalEffort({ ...g, weekly_hours: 3.6, target_date: "2026-12-07" }, "2026-11-23");
    expect([hangs.feasibility, hangs.confirmedFeasibility]).toEqual(["machbar", "kaum machbar"]);
    expect(effortLine({ ...g, weekly_hours: 3.6, target_date: "2026-12-07" }, "2026-11-23")).toBe(
      "Aufwand ≈ 20 Std · geschafft 11 Std · vorläufig 3 Std (Blöcke ohne Rückmeldung) · bleiben 6 Std · 2 Wochen bis zum Ziel → nötig 3 Std/Woche (0.4 Std/Tag) · verfügbar 3.6 Std/Woche → machbar (ohne die vorläufigen Stunden kaum machbar)",
    );
    // reached only with them
    expect(effortLine({ ...g, effort_hours: 13 }, "2026-11-23")).toBe(
      "Aufwand ≈ 13 Std · geschafft 11 Std · vorläufig 3 Std (Blöcke ohne Rückmeldung) → geschätzter Aufwand erreicht (mit den vorläufigen Stunden)",
    );
    // no estimate yet: the provisional part apart too
    expect(effortLine({ ...g, effort_hours: null }, "2026-11-23")).toBe("Aufwand noch nicht geschätzt · geschafft 11 Std · vorläufig 3 Std (Blöcke ohne Rückmeldung) · verfügbar 5 Std/Woche");
  });
  it("without provisional time both verdicts agree; a missing field is none", () => {
    const e = goalEffort({ ...g, time: { logged_minutes: 600, block_minutes: 240 } }, "2026-11-23");
    expect(e.provisional).toBe(0);
    expect(e.confirmedFeasibility).toBe(e.feasibility);
  });
});

describe("Ja · Teilweise · Nein", () => {
  it("reads the answer from the minutes", () => {
    expect(blockAnswerState(undefined, 60)).toBeNull();
    expect(blockAnswerState(null, 60)).toBeNull();
    expect(blockAnswerState(0, 60)).toBe("nein");
    expect(blockAnswerState(30, 60)).toBe("teilweise");
    expect(blockAnswerState(60, 60)).toBe("ja");
    expect(blockAnswerState(75, 60)).toBe("ja");
  });
  it("«Teilweise» without a number is half of it, in steps of five", () => {
    expect(partialMinutes(60)).toBe(30);
    expect(partialMinutes(90)).toBe(45);
    expect(partialMinutes(45)).toBe(25);
    expect(partialMinutes(20)).toBe(10);
    expect(partialMinutes(10)).toBe(5);
    expect(blockAnswerState(partialMinutes(5), 5)).toBe("teilweise");
  });
});

describe("the pattern of a goal's blocks (28 days)", () => {
  const zurich = (iso: string) => localClock(new Date(iso), "Europe/Zurich");
  // 07:00 in Zurich is 06:00 UTC in November
  const b = (day: string, utc: string, minutes: number | null, o: Record<string, unknown> = {}) => ({
    starts_at: `${day}T${utc}:00Z`,
    ends_at: new Date(Date.parse(`${day}T${utc}:00Z`) + H).toISOString(),
    all_day: false,
    kind: "block",
    source: "coach",
    minutes,
    ...o,
  });
  const blocks = [
    b("2026-11-02", "06:00", 0), // Monday 07:00
    b("2026-11-09", "06:00", 0),
    b("2026-11-16", "06:00", 0),
    b("2026-11-04", "17:00", 60),
    b("2026-11-11", "17:00", 30), // Teilweise
    b("2026-11-18", "17:00", 60),
    b("2026-11-20", "17:00", 0),
    b("2026-11-21", "09:00", null), // open
    b("2026-10-20", "06:00", 0), // older than 28 days
    b("2026-11-24", "06:00", null), // ahead
    b("2026-11-19", "06:00", 0, { source: "nolio" }), // the trainer's plan
  ];
  it("counts planned, confirmed (partly), «Nein» with their slot, open", () => {
    const p = blockPattern(blocks, NOW, zurich)!;
    expect(p).toEqual({ planned: 8, confirmed: 3, partial: 1, missed: 4, open: 1, slot: { hour: 7, count: 3 }, adapt: true });
    expect(patternLine(p, null)).toBe("Blöcke der letzten 4 Wochen: 8 geplant · 3 bestätigt (1 teilweise) · 4 nicht geklappt (3× um 7 Uhr) · 1 offen");
    expect(patternLine(p, "anbieten")).toBe("Blöcke der letzten 4 Wochen: 8 geplant · 3 bestätigt (1 teilweise) · 4 nicht geklappt (3× um 7 Uhr) · 1 offen → anpassen anbieten (einmal)");
    expect(patternLine(p, "angeboten")).toContain("→ anpassen diese Woche schon angeboten");
  });
  it("a slot only where more didn't work than worked; else the weekday; else most of them missed", () => {
    // two «Nein» at 7 (a Monday, a Tuesday) but three that worked there: no slot, and mostly fine
    const fine = [b("2026-11-02", "06:00", 0), b("2026-11-10", "06:00", 0), b("2026-11-04", "06:00", 60), b("2026-11-12", "06:00", 60), b("2026-11-20", "06:00", 60)];
    expect(blockPattern(fine, NOW, zurich)).toMatchObject({ missed: 2, confirmed: 3, slot: null, adapt: false });
    // Fridays at different hours
    const fridays = [b("2026-11-06", "06:00", 0), b("2026-11-13", "17:00", 0), b("2026-11-10", "17:00", 60)];
    expect(blockPattern(fridays, NOW, zurich)).toMatchObject({ slot: { weekday: 4, count: 2 }, adapt: true });
    expect(patternLine(blockPattern(fridays, NOW, zurich)!, null)).toContain("2 nicht geklappt (2× am Freitag)");
    // three «Nein» at different times, one confirmed: adapt without a slot
    const scattered = [b("2026-11-02", "06:00", 0), b("2026-11-04", "17:00", 0), b("2026-11-13", "09:00", 0), b("2026-11-18", "12:00", 60)];
    expect(blockPattern(scattered, NOW, zurich)).toMatchObject({ slot: null, adapt: true });
    // nothing in the window
    expect(blockPattern([b("2026-10-01", "06:00", 0)], NOW, zurich)).toBeNull();
  });
  it("is offered at most once a week; unknown: never", () => {
    const day = (iso: string) => iso.slice(0, 10);
    expect(patternOfferDue(null, "2026-11-23", day)).toBe(true);
    expect(patternOfferDue(undefined, "2026-11-23", day)).toBe(false);
    expect(patternOfferDue("2026-11-17T18:00:00Z", "2026-11-23", day)).toBe(false);
    expect(patternOfferDue("2026-11-16T18:00:00Z", "2026-11-23", day)).toBe(true);
  });
  it("offers again only from blocks since the last offer: the same old «Nein» never bring it back", () => {
    const day = (iso: string) => iso.slice(0, 10);
    const p = blockPattern(blocks, NOW, zurich)!;
    const offer = (askedAt: string | null | undefined, list = blocks, pattern = p) => patternOffer(pattern, list, askedAt, NOW, "2026-11-23", zurich, day);
    expect(offer(null)).toBe("anbieten");
    expect(offer(undefined)).toBeNull(); // unknown (before the column): never
    expect(offer("2026-11-20T18:00:00Z")).toBe("angeboten"); // this week already
    // offered 10 days ago; since then two «Nein» at different times (Monday 7:00, Friday 18:00): not again
    expect(offer("2026-11-13T18:00:00Z")).toBeNull();
    // two more «Nein» at 7 since the offer: worth asking again
    const more = [...blocks, b("2026-11-17", "06:00", 0), b("2026-11-19", "06:00", 0)];
    expect(offer("2026-11-13T18:00:00Z", more, blockPattern(more, NOW, zurich)!)).toBe("anbieten");
    // nothing worth adapting: no offer at all
    const fine = blockPattern([b("2026-11-04", "17:00", 60), b("2026-11-18", "17:00", 60)], NOW, zurich)!;
    expect(offer(null, blocks, fine)).toBeNull();
  });
});

describe("Woche: one quiet line per goal, «geplant / gemacht»", () => {
  const zurich = (iso: string) => localClock(new Date(iso), "Europe/Zurich").day;
  const block = (id: string, start: string, end: string, o: Record<string, unknown> = {}) => ({
    id,
    goal_id: "g1",
    starts_at: start,
    ends_at: end,
    all_day: false,
    kind: "block",
    source: "coach",
    created_at: "2026-11-01T08:00:00Z",
    answered: false,
    ...o,
  });
  it("«gemacht» counts as the bar: confirmed, plus open blocks while they still count", () => {
    const now = new Date("2026-11-27T12:00:00Z"); // Friday
    const out = weekGoalSummary(
      ["g1"],
      [
        block("mon", "2026-11-23T17:00:00Z", "2026-11-23T18:00:00Z", { answered: true }),
        block("tue", "2026-11-24T17:00:00Z", "2026-11-24T18:00:00Z"), // open, provisional
        block("sat", "2026-11-28T09:00:00Z", "2026-11-28T10:00:00Z"), // ahead
      ],
      [{ goal_id: "g1", day: "2026-11-23", minutes: 45 }],
      "2026-11-23",
      now,
      zurich,
      "2026-11-17T09:00:00Z",
    );
    expect(out).toEqual([{ goal_id: "g1", planned_minutes: 180, blocks: 3, done_minutes: 45, open_minutes: 60, counted_minutes: 105 }]);
    expect(weekGoalLine(180, 105, "current")).toBe("geplant 3 Std · gemacht 1 Std 45");
  });
  it("an open block after its week of grace counts no more", () => {
    const out = weekGoalSummary(["g1"], [block("tue", "2026-11-24T17:00:00Z", "2026-11-24T18:00:00Z", { created_at: "2026-11-20T08:00:00Z" })], [], "2026-11-23", new Date("2026-12-02T12:00:00Z"), zurich, "2026-11-17T09:00:00Z");
    expect(out[0]).toMatchObject({ open_minutes: 60, counted_minutes: 0 });
  });
  it("never «0»: a number only when there is one; a future week has nothing done", () => {
    expect(weekGoalLine(180, 0, "current")).toBe("geplant 3 Std");
    expect(weekGoalLine(0, 60, "past")).toBe("gemacht 1 Std");
    expect(weekGoalLine(120, 60, "future")).toBe("geplant 2 Std");
    expect(weekGoalLine(0, 0, "past")).toBeNull();
  });
  it("the goal lines take only the room the seven rows can spare: none on 320 × 568", () => {
    // measured in the demo build (Woche, 23–29 Nov): rows' height with one 18 px line shown, and without it
    expect(weekGoalRoom(226, 18, 18)).toBe(0); // 320 × 568: the rows are pressed already (32 px each)
    expect(weekGoalRoom(244, 0, 18)).toBe(0); // …and stay so once the line gave way: no flicker
    expect(weekGoalRoom(343, 18, 18)).toBe(1); // 375 × 667: one line, rows keep 49 px
    expect(weekGoalRoom(448, 36, 18)).toBe(8); // 390 × 844: every line of a few goals
    expect(7 * WEEK_ROW_MIN).toBe(329);
    expect(weekGoalRoom(500, 0, 0)).toBe(0); // nothing measured yet
  });
});

describe("the coach: one batched question, a «Nein» protocol, the pattern at most once a week", () => {
  const goal = {
    id: "g1",
    title: "Schreiben",
    why: null,
    target_date: null,
    status: "active",
    milestones: [],
    effort_hours: null,
    weekly_hours: 3,
    prior_hours: 0,
    time: { logged_minutes: 60, block_minutes: 60, provisional_minutes: 60 },
  };
  const rb = (id: string, day: string, utc: string, minutes: number | null) => ({
    id,
    title: "Schreiben",
    starts_at: `${day}T${utc}:00Z`,
    ends_at: new Date(Date.parse(`${day}T${utc}:00Z`) + H).toISOString(),
    all_day: false,
    location: null,
    kind: "block",
    goal_id: "g1",
    source: "coach",
    minutes,
  });
  const base: ContextInput = {
    day: "2026-11-23",
    localTime: "Montag, 23. November 2026, 13:00",
    timezone: "Europe/Zurich",
    season: "Spätherbst",
    phase: "Tag",
    hasLocation: false,
    now: "2026-11-23T12:00:00Z",
    lastSeen: "2026-11-22",
    profile: { display_name: "Lea", location_name: null, summary: null, nature_palette: null },
    memories: [],
    recentDays: [],
    goals: [{ ...goal, pattern_asked_at: null }],
    recentBlocks: [rb("a", "2026-11-02", "06:00", 0), rb("b", "2026-11-09", "06:00", 0), rb("c", "2026-11-16", "06:00", 0), rb("d", "2026-11-18", "17:00", 60)],
  };
  const goalSection = (out: string) => out.slice(out.indexOf("## Ziele"), out.indexOf("## Gewohnheiten"));

  it("shows the pattern under the goal, with the offer only when it may come", () => {
    const out = goalSection(contextBlock(base));
    expect(out).toContain("geschafft 1 Std · vorläufig 1 Std (Blöcke ohne Rückmeldung)");
    expect(out).toContain(
      "\n  Blöcke der letzten 4 Wochen: 4 geplant · 1 bestätigt · 3 nicht geklappt (3× um 7 Uhr) · zuletzt geschafft: 1 Std, Vorschläge höchstens 2 Std → anpassen anbieten (einmal)",
    );
    // offered this week already
    expect(goalSection(contextBlock({ ...base, goals: [{ ...goal, pattern_asked_at: "2026-11-20T18:00:00Z" }] }))).toContain("→ anpassen diese Woche schon angeboten");
    // offered 11 days ago, since then one «Nein» only: the numbers, no new offer from the old ones
    const later = goalSection(contextBlock({ ...base, goals: [{ ...goal, pattern_asked_at: "2026-11-12T18:00:00Z" }] }));
    expect(later).toContain("Blöcke der letzten 4 Wochen: 4 geplant · 1 bestätigt · 3 nicht geklappt (3× um 7 Uhr)");
    expect(later).not.toContain("→ anpassen");
    // unknown (column before its migration), after a pause, or in a heavy time: the numbers, no offer
    for (const c of [
      { ...base, goals: [{ ...goal, pattern_asked_at: undefined }] },
      { ...base, lastSeen: "2026-11-10" },
      { ...base, today: { mood: { word: "schwer", valence: -0.6 }, focus: null } },
    ]) {
      const o = goalSection(contextBlock(c));
      expect(o).toContain("Blöcke der letzten 4 Wochen: 4 geplant");
      expect(o).not.toContain("→ anpassen");
    }
    // without blocks no line
    expect(goalSection(contextBlock({ ...base, recentBlocks: [] }))).not.toContain("Blöcke der letzten 4 Wochen");
  });

  it("asks once and in one question, thanks for a «Nein», offers one smaller block after, never lists misses", () => {
    expect(MODE_CHECKIN).toContain("bei mehreren in einer einzigen Frage, z.B. „Hat das Schreiben gestern geklappt?“");
    expect(MODE_CHECKIN).toContain("Bei einem Nein dankst du ihr, dass sie es sagt, fragst höchstens einmal, was dazwischenkam, und bietest erst danach einmal einen kleineren oder verschobenen Block an; was sonst nicht geklappt hat, zählst du nie auf.");
    expect(MODE_CHECKIN).toContain("Ohne Antwort zählen die Blöcke eine Woche lang vorläufig, danach nicht mehr.");
    expect(MODE_CHECKIN).not.toContain("Die Blöcke zählen dann von selbst");
    expect(MODE_CHECKIN).toContain("rufst im selben Zug note_offer mit blockmuster und der goal_id auf");
    expect(PERSONA).toContain("Vergangene Blöcke ohne Rückmeldung zählen eine Woche lang vorläufig mit, nie als geschafft.");
    expect(PERSONA).not.toContain("zählen von selbst als geschafft");
    expect(PERSONA).toContain("Hängt das Urteil an vorläufigen Stunden, sagst du auch das.");
    expect(BLOCK_NO_NEXT).toContain("Danke ihr, dass sie es sagt.");
    // never «verpasst» in what the coach is told about blocks
    const rules = MODE_CHECKIN.slice(MODE_CHECKIN.indexOf("- Stehen unter „Vergangene Blöcke"), MODE_CHECKIN.indexOf("- Wochenblick:"));
    for (const t of [rules, BLOCK_NO_NEXT]) expect(t).not.toMatch(/verpasst/i);
  });

  it("log_time answers a «Nein» with the protocol, gives confirmed hours as done; note_offer notes the pattern per goal", () => {
    const source = readFileSync(new URL("../supabase/functions/coach/index.ts", import.meta.url), "utf8");
    expect(source).toContain('...(eventId && minutes === 0 ? { naechster_schritt: blockNoNext(goal.kind === "dream" ? null : goal.plan_b) } : {}),');
    // when reading the goal failed after the save: the protocol without a Plan B
    expect(source).toContain("...(eventId && minutes === 0 ? { naechster_schritt: BLOCK_NO_NEXT } : {})");
    expect(source).toContain("done_hours: Math.round((e.done - e.provisional) * 10) / 10,");
    expect(source).toContain("...(e.provisional > 0 ? { vorlaeufig_hours: e.provisional } : {}),");
    expect(source).toContain('.update({ pattern_asked_at: new Date().toISOString() }).eq("id", goalId).select("id")');
    // the four weeks of blocks with their answers, the open ones of the last week to ask about
    expect(source).toContain('.select(`${eventCols}, goal_time(minutes)`)');
    expect(source).toContain(".gte(\"starts_at\", iso(now - PATTERN_DAYS * DAY_MS))".replace(/\\"/g, '"'));
    expect(source).toContain("b.minutes === null && Date.parse(b.starts_at) >= now - 7 * DAY_MS");
    // goal_minutes read with "*": provisional_minutes only exists after its migration
    expect(source).not.toContain('select("goal_id, logged_minutes, block_minutes")');
  });
});

describe("the migration", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261122000000_honest_count.sql", import.meta.url), "utf8");
  it("writes the release moment once and counts like unansweredCredit", () => {
    expect(sql).toContain("if to_regprocedure('public.honest_count_from()') is null then");
    expect(sql).toContain("immutable parallel safe set search_path = ''");
    expect(sql).toContain("(e.ends_at < public.honest_count_from() and e.created_at < public.honest_count_from())");
    expect(sql.match(/e\.ends_at > now\(\) - interval '7 days'/g)).toHaveLength(2);
    // the old columns first, in their order (create or replace view only appends)
    expect(sql).toMatch(/as logged_minutes,[\s\S]*as block_minutes,[\s\S]*as provisional_minutes\s+from public\.goals g;/);
    expect(sql).toContain("with (security_invoker = true)");
    // noting the offer is no change of the goal (updated_at stays: «liegt lange»)
    expect(sql).toContain("array['reminded_at', 'nudge_after', 'pattern_asked_at', 'updated_at']");
  });
});

describe("demo backend: honest counting like the view", () => {
  class MemoryStorage {
    private m = new Map<string, string>();
    getItem(k: string) {
      return this.m.get(k) ?? null;
    }
    setItem(k: string, v: string) {
      this.m.set(k, v);
    }
    removeItem(k: string) {
      this.m.delete(k);
    }
  }
  let b: DemoBackend;
  beforeEach(async () => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
    b = new DemoBackend();
    await b.signUp("demo.ehrlich", "geheim1234");
  });
  const users = () => JSON.parse(localStorage.getItem("ich.demo.users")!);
  const save = (u: unknown) => localStorage.setItem("ich.demo.users", JSON.stringify(u));
  const entry = (from: number, to: number, goal_id: string) => ({
    title: "Schreiben",
    starts_at: new Date(Date.now() + from).toISOString(),
    ends_at: new Date(Date.now() + to).toISOString(),
    all_day: false,
    location: null,
    notes: null,
    reminder_minutes: null,
    kind: "block" as const,
    goal_id,
  });

  it("a new account counts honestly from its start; a block past its week counts no more", async () => {
    const from = await b.countingFrom();
    expect(from && Date.now() - Date.parse(from) < 60_000).toBe(true);
    const g = await b.addGoal({ title: "Schreiben" });
    await b.addEvent(entry(-3 * H, -2 * H, g.id));
    const old = await b.addEvent(entry(-9 * D, -9 * D + H, g.id));
    expect((await b.listGoals())[0].time).toEqual({ logged_minutes: 0, block_minutes: 60, provisional_minutes: 60 });
    // a late «Ja» brings the old one back as confirmed time
    await b.setBlockDone(old.id, true);
    expect((await b.listGoals())[0].time).toEqual({ logged_minutes: 60, block_minutes: 60, provisional_minutes: 60 });
    // «Teilweise» is fewer minutes
    await b.setBlockDone(old.id, true, 30);
    expect((await b.blockAnswers([old.id]))[old.id]).toBe(30);
  });

  it("an account stored before keeps its old blocks counting (stamped once, like the migration)", async () => {
    const g = await b.addGoal({ title: "Schreiben" });
    await b.addEvent(entry(-20 * D, -20 * D + H, g.id));
    const u = users();
    delete u["demo.ehrlich"].honest_from; // stored before honest counting
    for (const e of u["demo.ehrlich"].events) delete e.created_at;
    save(u);
    expect((await b.listGoals())[0].time).toEqual({ logged_minutes: 0, block_minutes: 60, provisional_minutes: 0 });
    const stamped = users()["demo.ehrlich"].honest_from;
    expect(typeof stamped).toBe("string");
    // read again: the same moment
    await b.listGoals();
    expect(users()["demo.ehrlich"].honest_from).toBe(stamped);
    expect(await b.countingFrom()).toBe(stamped);
  });
});
