// Round 2, owner decision 3 (Fester Wochenrhythmus): fixed weekly blocks the coach offers once per goal, materialised
// as normal calendar entries 8 weeks ahead (supabase/migrations/20261124000000_series.sql), with one-day exceptions,
// changes for every coming day, and the demo backend mirroring the database.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  irregularWeeks,
  LAPSE_DAYS,
  liveRhythms,
  parseClock,
  parseWeekdays,
  rhythmOfferDue,
  rhythmSuggestion,
  rhythmTally,
  seriesDays,
  seriesDayFollows,
  seriesEndDay,
  seriesKeepsDay,
  seriesLabel,
  seriesLapse,
  seriesPatchFromDay,
  seriesScopeNeeded,
  type SeriesRule,
} from "../src/lib/plan";
import { contextBlock, MODE_CHECKIN, PERSONA, type ContextGoal, type ContextInput, type ContextSeries } from "../supabase/functions/coach/prompt";
import { DemoBackend, parseDemoRhythm, syncDemoSeries } from "../src/lib/demoBackend";
import type { CalendarEvent, CoachEvent } from "../src/lib/types";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const DAY = 86400000;

const rule = (o: Partial<SeriesRule> = {}): SeriesRule => ({
  id: "s1",
  goal_id: null,
  title: "Laufen",
  weekdays: [2, 4],
  start_time: "18:00",
  duration_minutes: 60,
  location: null,
  reminder_minutes: 10,
  time_zone: "Europe/Zurich",
  start_date: "2026-11-16",
  until_date: null,
  active: true,
  skip_days: [],
  lapse_asked_at: null,
  ...o,
});

describe("the rhythm's words: weekdays and times", () => {
  it("reads the coach's weekday codes and words, once each, Monday first", () => {
    expect(parseWeekdays(["do", "di"])).toEqual([2, 4]);
    expect(parseWeekdays(["Dienstag", "Donnerstag", "di"])).toEqual([2, 4]);
    expect(parseWeekdays(["Mo.", "so"])).toEqual([1, 7]);
    expect(parseWeekdays([3, 5])).toEqual([3, 5]);
    for (const bad of [[], ["xx"], ["dimanche"], [0], [8], "di", null]) expect(parseWeekdays(bad)).toBeNull();
  });

  it("reads a time of day", () => {
    expect(parseClock("18:00")).toBe("18:00");
    expect(parseClock("7:30")).toBe("07:30");
    expect(parseClock("18")).toBe("18:00");
    expect(parseClock("18 Uhr")).toBe("18:00");
    expect(parseClock("18.30")).toBe("18:30");
    expect(parseClock("18:00:00")).toBe("18:00");
    for (const bad of ["24:00", "18:75", "abends", "", 18]) expect(parseClock(bad)).toBeNull();
  });

  it("names a rhythm shortly for the coach", () => {
    expect(seriesLabel(rule())).toBe("Di, Do 18:00–19:00");
    expect(seriesLabel(rule({ weekdays: [6], start_time: "23:30:00", duration_minutes: 90 }))).toBe("Sa 23:30–01:00");
  });
});

describe("its days: like series_fill, DST-correct", () => {
  // Tuesday 2026-11-17, 00:17 in Zurich (as the database check ran)
  const now = Date.parse("2026-11-16T23:17:00Z");

  it("every Tuesday and Thursday from today in her zone for 8 weeks, at 18:00 local, never a time that passed", () => {
    const days = seriesDays(rule(), { now });
    expect(days[0]).toEqual({ day: "2026-11-17", starts_at: "2026-11-17T17:00:00.000Z", ends_at: "2026-11-17T18:00:00.000Z" });
    expect(days.every((d) => ["2", "4"].includes(String(new Date(`${d.day}T12:00:00Z`).getUTCDay())))).toBe(true);
    expect(days.at(-1)!.day <= "2027-01-12").toBe(true);
    expect(days).toHaveLength(17);
    // later today, 18:00 has passed: the first day is Thursday
    expect(seriesDays(rule(), { now: Date.parse("2026-11-17T17:30:00Z") })[0].day).toBe("2026-11-19");
  });

  it("keeps the local time across the clock change (Zurich and New York, spring 2027), and the length in minutes", () => {
    const zurich = seriesDays(rule({ weekdays: [2], duration_minutes: 90, start_date: "2027-03-16", until_date: "2027-04-06" }), { now, horizonDays: 200 });
    expect(zurich.map((d) => `${d.day} ${d.starts_at.slice(11, 16)}-${d.ends_at.slice(11, 16)}`)).toEqual([
      "2027-03-16 17:00-18:30",
      "2027-03-23 17:00-18:30",
      "2027-03-30 16:00-17:30",
      "2027-04-06 16:00-17:30",
    ]);
    const ny = seriesDays(rule({ weekdays: [2], duration_minutes: 90, time_zone: "America/New_York", start_date: "2027-03-09", until_date: "2027-03-23" }), { now, horizonDays: 200 });
    expect(ny.map((d) => `${d.day} ${d.starts_at.slice(11, 16)}`)).toEqual(["2027-03-09 23:00", "2027-03-16 22:00", "2027-03-23 22:00"]);
  });

  it("ends the day before the goal's target date (without an end of its own), never fills a resting rhythm or one of a goal that rests", () => {
    const goal = { status: "active", target_date: "2026-12-03" };
    expect(seriesEndDay(rule(), goal.target_date)).toBe("2026-12-02");
    expect(seriesEndDay(rule({ until_date: "2026-11-30" }), goal.target_date)).toBe("2026-11-30");
    const days = seriesDays(rule({ goal_id: "g1" }), { now, goal });
    expect(days.map((d) => d.day)).toEqual(["2026-11-17", "2026-11-19", "2026-11-24", "2026-11-26", "2026-12-01"]);
    expect(seriesDays(rule({ goal_id: "g1" }), { now, goal: { ...goal, status: "paused" } })).toEqual([]);
    expect(seriesDays(rule({ goal_id: "g1" }), { now, goal: null })).toEqual([]);
    expect(seriesDays(rule({ active: false }), { now })).toEqual([]);
  });

  it("leaves out the days she let fall away and starts on its first day", () => {
    const days = seriesDays(rule({ skip_days: ["2026-11-19"], start_date: "2026-11-18" }), { now });
    expect(days.slice(0, 2).map((d) => d.day)).toEqual(["2026-11-24", "2026-11-26"]);
  });

  it("like series_sync: which coming days still belong (her exception keeps a day off its weekdays)", () => {
    const goal = { status: "active", target_date: "2027-03-01" };
    const s = rule({ goal_id: "g1", weekdays: [2], skip_days: ["2026-11-24"] });
    expect(seriesKeepsDay(s, "2026-12-01", false, goal)).toBe(true);
    expect(seriesKeepsDay(s, "2026-12-03", false, goal)).toBe(false); // Thursday: no longer a weekday of it
    expect(seriesKeepsDay(s, "2026-12-03", true, goal)).toBe(true); // her moved day stays
    expect(seriesKeepsDay(s, "2026-11-24", true, goal)).toBe(false); // let fall away
    expect(seriesKeepsDay(s, "2027-03-02", true, goal)).toBe(false); // after the end
    expect(seriesKeepsDay({ ...s, active: false }, "2026-12-01", true, goal)).toBe(false); // it rests: all go
  });
});

describe("the one offer, and what keeps it away", () => {
  const goal = { kind: "goal", status: "active", target_date: "2027-03-01", weekly_hours: 3, rhythm_asked_at: null };
  const o = { hasRhythm: false, activeRhythms: 0, irregular: false, today: "2026-11-16" };

  it("for an active goal with hours per week, more than three weeks before its date, never offered", () => {
    expect(rhythmOfferDue(goal, o)).toBe(true);
    expect(rhythmOfferDue({ ...goal, rhythm_asked_at: "2026-11-01T08:00:00Z" }, o)).toBe(false);
    expect(rhythmOfferDue({ ...goal, rhythm_asked_at: undefined }, o)).toBe(false); // unknown: never
    expect(rhythmOfferDue({ ...goal, weekly_hours: null }, o)).toBe(false);
    expect(rhythmOfferDue({ ...goal, target_date: "2026-12-07" }, o)).toBe(false); // exactly three weeks
    // a goal without a date (e.g. «Japanisch lernen», 2 Std pro Woche) is the classic case: offered too
    expect(rhythmOfferDue({ ...goal, target_date: null }, o)).toBe(true);
    expect(rhythmOfferDue({ ...goal, target_date: null, weekly_hours: 0 }, o)).toBe(false);
    expect(rhythmOfferDue({ ...goal, kind: "dream" }, o)).toBe(false);
    expect(rhythmOfferDue({ ...goal, status: "paused" }, o)).toBe(false);
    expect(rhythmOfferDue(goal, { ...o, hasRhythm: true })).toBe(false);
    expect(rhythmOfferDue(goal, { ...o, activeRhythms: 2 })).toBe(false);
    expect(rhythmOfferDue(goal, { ...o, irregular: true })).toBe(false);
  });

  it("counts only rhythms that still run: not a resting or ended one, and one split «ab Januar» once", () => {
    const today = "2026-11-16";
    const old = rule({ id: "a", goal_id: "g1", start_date: "2026-10-01", until_date: "2026-12-31" });
    const split = rule({ id: "b", goal_id: "g1", start_date: "2027-01-01" });
    expect(liveRhythms([old, split], today).map((x) => x.id)).toEqual(["b"]);
    expect(liveRhythms([old], today).map((x) => x.id)).toEqual(["a"]); // ends later, nothing after it: still runs
    expect(liveRhythms([rule({ id: "c", until_date: "2026-11-15" }), rule({ id: "d", active: false })], today)).toEqual([]);
    expect(liveRhythms([rule({ id: "e", until_date: today })], today)).toHaveLength(1); // its last day is today
    // two rhythms of one goal side by side (Tuesday runs, Saturday long run) are two
    expect(liveRhythms([rule({ id: "f", goal_id: "g1" }), rule({ id: "g", goal_id: "g1", weekdays: [6] })], today)).toHaveLength(2);
  });

  it("never to someone whose weeks are irregular (shift work), from her notes or the shifts in her calendar", () => {
    expect(irregularWeeks([{ content: "Arbeitet in der Pflege im Schichtdienst." }], [])).toBe(true);
    expect(irregularWeeks([{ content: "Hat einen Dienstplan, der jede Woche anders ist." }], [])).toBe(true);
    expect(irregularWeeks([{ content: "Hat wechselnde Arbeitszeiten." }], [])).toBe(true);
    expect(irregularWeeks([], [{ title: "Frühschicht", kind: "termin" }, { title: "Nachtdienst", kind: "termin" }])).toBe(true);
    // not «Geschichte», not one shift, not a Gottesdienst
    expect(irregularWeeks([{ content: "Liebt Geschichte und alte Karten." }], [{ title: "Spätschicht", kind: "termin" }, { title: "Gottesdienst", kind: "termin" }])).toBe(false);
  });

  it("sized to at most 70 % of her hours per week, in one to three blocks", () => {
    expect(rhythmSuggestion(1)).toEqual({ count: 1, minutes: 45 });
    expect(rhythmSuggestion(2)).toEqual({ count: 2, minutes: 45 });
    expect(rhythmSuggestion(3)).toEqual({ count: 2, minutes: 60 });
    expect(rhythmSuggestion(5)).toEqual({ count: 3, minutes: 75 });
    expect(rhythmSuggestion(12)).toEqual({ count: 3, minutes: 120 });
    for (const h of [1, 2, 3, 5, 8]) {
      const r = rhythmSuggestion(h);
      expect(r.count * r.minutes).toBeLessThanOrEqual(h * 60 * 0.75);
    }
  });
});

describe("a rhythm that rarely works: offered once after three weeks", () => {
  const now = Date.parse("2026-12-10T12:00:00Z");
  const day = (daysAgo: number, minutes: number | null) => {
    const start = now - daysAgo * DAY;
    return { starts_at: new Date(start).toISOString(), ends_at: new Date(start + 3600000).toISOString(), minutes };
  };
  const s = { active: true, start_date: "2026-11-12", lapse_asked_at: null };

  it("three weeks of mostly «Nein» or no answer", () => {
    const days = [day(19, 0), day(16, null), day(12, 60), day(9, 0), day(5, null), day(2, null)];
    expect(rhythmTally(days, now)).toEqual({ ended: 6, confirmed: 1 });
    expect(seriesLapse(days, s, now, "2026-12-10")).toBe(true);
    // mostly done: no offer
    expect(seriesLapse([day(19, 60), day(16, 45), day(12, 0), day(9, 60)], s, now, "2026-12-10")).toBe(false);
    // fewer than three days, or not three weeks old yet, or resting: no offer
    expect(seriesLapse([day(5, 0), day(2, null)], s, now, "2026-12-10")).toBe(false);
    expect(seriesLapse(days, { ...s, start_date: "2026-11-25" }, now, "2026-12-10")).toBe(false);
    expect(seriesLapse(days, { ...s, active: false }, now, "2026-12-10")).toBe(false);
  });

  it("once: after the offer only another three weeks like this bring it again", () => {
    const days = [day(19, 0), day(16, null), day(12, 0), day(9, 0), day(5, null), day(2, null)];
    expect(seriesLapse(days, { ...s, lapse_asked_at: new Date(now - 10 * DAY).toISOString() }, now, "2026-12-10")).toBe(false);
    const later = now + (LAPSE_DAYS + 1) * DAY;
    const fresh = [1, 4, 8, 15].map((d) => ({ ...day(0, null), starts_at: new Date(later - d * DAY).toISOString(), ends_at: new Date(later - d * DAY + 3600000).toISOString() }));
    expect(seriesLapse(fresh, { ...s, lapse_asked_at: new Date(now - 10 * DAY).toISOString() }, later, "2027-01-01")).toBe(true);
  });
});

describe("one day in the app: «Nur diesen Termin» or «Alle kommenden», only if needed", () => {
  const dayOfIso = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(iso));
  const now = Date.parse("2026-11-16T12:00:00Z");
  const e = { series_id: "s1", starts_at: "2026-11-19T17:00:00+00:00", ends_at: "2026-11-19T18:00:00+00:00", all_day: false, title: "Laufen", location: null, reminder_minutes: 10 };
  const same = { ...e, starts_at: "2026-11-19T17:00:00.000Z", ends_at: "2026-11-19T18:00:00.000Z" };

  it("asks when the time, length, title, place or reminder changed on the same day", () => {
    expect(seriesScopeNeeded(e, same, now, dayOfIso)).toBe(false); // the same moment, written differently
    expect(seriesScopeNeeded(e, { ...same, starts_at: "2026-11-19T18:00:00.000Z", ends_at: "2026-11-19T19:00:00.000Z" }, now, dayOfIso)).toBe(true);
    expect(seriesScopeNeeded(e, { ...same, title: "Intervalle" }, now, dayOfIso)).toBe(true);
    expect(seriesScopeNeeded(e, { ...same, location: "Allmend" }, now, dayOfIso)).toBe(true);
    expect(seriesScopeNeeded(e, { ...same, reminder_minutes: null }, now, dayOfIso)).toBe(true);
  });

  it("never for another day, an all-day entry, a past day or an entry outside a rhythm", () => {
    expect(seriesScopeNeeded(e, { ...same, starts_at: "2026-11-20T17:00:00.000Z", ends_at: "2026-11-20T18:00:00.000Z" }, now, dayOfIso)).toBe(false);
    expect(seriesScopeNeeded(e, { ...same, all_day: true }, now, dayOfIso)).toBe(false);
    expect(seriesScopeNeeded(e, { ...same, title: "x" }, Date.parse("2026-11-20T00:00:00Z"), dayOfIso)).toBe(false);
    expect(seriesScopeNeeded({ ...e, series_id: null }, { ...same, title: "x" }, now, dayOfIso)).toBe(false);
  });

  it("«Alle kommenden» gives the rhythm what she changed: the day's local time and length, title, place", () => {
    expect(seriesPatchFromDay(same, { ...same, starts_at: "2026-11-19T18:30:00.000Z", ends_at: "2026-11-19T19:45:00.000Z", title: "Intervalle", location: "Allmend" }, "Europe/Zurich")).toEqual({
      title: "Intervalle",
      start_time: "19:30",
      duration_minutes: 75,
      location: "Allmend",
    });
    // the same moment written differently is no change; a goal only when it is given and differs
    expect(seriesPatchFromDay(e, same, "Europe/Zurich")).toEqual({});
    expect(seriesPatchFromDay({ ...same, goal_id: "g1" }, { ...same, goal_id: undefined }, "Europe/Zurich")).toEqual({});
    expect(seriesPatchFromDay({ ...same, goal_id: "g1" }, { ...same, goal_id: "g2" }, "Europe/Zurich")).toEqual({ goal_id: "g2" });
  });

  it("her one-day exception (moved to 19:00) renamed for «Alle kommenden»: the rhythm takes the title, never her 19:00", () => {
    const moved = { ...same, starts_at: "2026-11-19T18:00:00.000Z", ends_at: "2026-11-19T19:00:00.000Z" };
    const patch = seriesPatchFromDay(moved, { ...moved, title: "Intervalle" }, "Europe/Zurich");
    expect(patch).toEqual({ title: "Intervalle" });
    expect(seriesDayFollows(true, patch)).toBe(false); // keeps its own 19:00, takes the title directly
    expect(seriesDayFollows(false, patch)).toBe(true);
    // a new start for every week: the day follows the rhythm again
    expect(seriesDayFollows(true, seriesPatchFromDay(moved, { ...moved, starts_at: "2026-11-19T19:00:00.000Z", ends_at: "2026-11-19T20:00:00.000Z" }, "Europe/Zurich"))).toBe(true);
  });

  it("the detail asks, the delete offers both, the day shows «jede Woche»", () => {
    const form = read("../src/components/plan/EventSheet.tsx");
    expect(form).toContain("if (event && rhythmDay && !scope && seriesScopeNeeded(event, b.input, Date.now(), (iso) => dayOf(new Date(iso)))) {");
    expect(form).toContain("<span>Gilt das jede Woche?</span>");
    expect(form).toContain("Nur diesen Termin");
    expect(form).toContain("Alle kommenden");
    expect(form).toContain('also={rhythmDay ? { label: "Alle kommenden", onConfirm: () => remove("following") } : undefined}');
    expect(form).toContain('<p className="sheet-hint">Jede Woche{event.source === "coach" ? " · vom Coach eingetragen" : ""}.</p>');
    expect(read("../src/time/DayLevel.tsx")).toContain('const weekly = e.series_id ? "jede\\u00a0Woche" : null;');
    const week = read("../src/time/WeekLevel.tsx");
    expect(week).toContain('...(weekly ? [{ text: "jede\\u00a0Woche", kind: "weekly" as const, at: weeklyAt }] : []),');
    // the markers before the minutes, in the order of their entries (a trainer's earlier run keeps «vom Trainer» first)
    expect(week).toContain("].sort((a, b) => a.at - b.at);");
    expect(week).toContain("const micro = events ? [...marks.map(({ text, kind }) => ({ text, kind })), ...microLine(r.day, today, r.done, r.planned)] : [];");
    expect(read("../src/components/VoiceConversation.tsx")).toContain('e.event.series_id ? "Jede Woche im Kalender" : "Im Kalender „Bucket List“"');
  });
});

describe("the coach's context", () => {
  const base: ContextInput = {
    day: "2026-11-16",
    localTime: "Montag, 16. November 2026, 18:10",
    timezone: "Europe/Zurich",
    season: "Herbst",
    phase: "Abend",
    hasLocation: true,
    now: "2026-11-16T17:10:00Z",
    lastSeen: "2026-11-15",
    profile: { display_name: "Mia", location_name: "Bern", summary: null, nature_palette: null },
    memories: [],
    recentDays: [],
  };
  const race: ContextGoal = { id: "g1", title: "Halbmarathon", why: null, target_date: "2027-03-01", status: "active", weekly_hours: 3, milestones: [], rhythm_asked_at: null, plan_b_asked_at: "2026-11-01T08:00:00Z" };
  const exam: ContextGoal = { id: "g2", title: "Prüfung", why: null, target_date: "2027-02-01", status: "active", weekly_hours: 2, milestones: [], rhythm_asked_at: null, plan_b_asked_at: "2026-11-01T08:00:00Z" };
  const series: ContextSeries = { ...rule({ id: "s1", goal_id: "g1", start_date: "2026-10-20" }) };
  const goalsOf = (out: string) => out.slice(out.indexOf("## Ziele"), out.indexOf("## Gewohnheiten"));
  const OFFER = "Wochenrhythmus: noch keiner → einmal anbieten";

  it("offers once, for one goal at a time (the nearest first), with its size; unknown rhythms: nothing", () => {
    const out = goalsOf(contextBlock({ ...base, goals: [exam, race], series: [] }));
    expect(out.match(/einmal anbieten/g)).toHaveLength(1);
    expect(out.slice(out.indexOf("[g2]"), out.indexOf("[g1]"))).toContain(`${OFFER}, etwa 2 × 45 Min pro Woche`);
    expect(goalsOf(contextBlock({ ...base, goals: [exam, race] }))).not.toContain("Wochenrhythmus");
  });

  it("no offer after a pause, in a heavy time, on a day one was offered, for irregular weeks, or once asked", () => {
    const ctx = (c: Partial<ContextInput>) => goalsOf(contextBlock({ ...base, goals: [race], series: [], ...c }));
    expect(ctx({})).toContain(OFFER);
    expect(ctx({ lastSeen: "2026-11-01" })).not.toContain(OFFER);
    expect(ctx({ today: { mood: { valence: -0.6, energy: 0.2, word: "schwer" }, focus: null } })).not.toContain(OFFER);
    expect(ctx({ goals: [{ ...race, rhythm_asked_at: "2026-11-02T08:00:00Z" }] })).not.toContain(OFFER);
    expect(ctx({ goals: [race, { ...exam, rhythm_asked_at: "2026-11-16T07:00:00Z" }] })).not.toContain(OFFER);
    expect(ctx({ memories: [{ id: "m1", category: "arbeit", event_date: null, content: "Arbeitet im Schichtdienst im Spital." }] })).not.toContain(OFFER);
  });

  it("shows her rhythm with its id, how long it runs and what was confirmed, and its days with «jede Woche» for three weeks", () => {
    const at = (iso: string, minutes: number | null, id: string) => ({ id, title: "Laufen", starts_at: iso, ends_at: new Date(Date.parse(iso) + 3600000).toISOString(), all_day: false, location: null, kind: "block", goal_id: "g1", series_id: "s1", minutes });
    const coming = (iso: string, id: string) => ({ id, title: "Laufen", starts_at: iso, ends_at: new Date(Date.parse(iso) + 3600000).toISOString(), all_day: false, location: null, kind: "block", goal_id: "g1", series_id: "s1" });
    const out = contextBlock({
      ...base,
      goals: [race],
      series: [series],
      recentBlocks: [at("2026-11-10T17:00:00Z", 60, "p1"), at("2026-11-12T17:00:00Z", 0, "p2")],
      events: [coming("2026-11-17T17:00:00Z", "c1"), coming("2026-12-01T17:00:00Z", "c2"), coming("2026-12-15T17:00:00Z", "c3")],
    });
    expect(goalsOf(out)).toContain("\n  Wochenrhythmus [s1]: Di, Do 18:00–19:00 · seit 3 Wochen · 1 von 2 bestätigt");
    expect(goalsOf(out)).not.toContain(OFFER);
    expect(out).toContain("- [c1] Di., 17. Nov. (morgen), 18:00–19:00: Laufen · Block · jede Woche · für das Ziel „Halbmarathon“");
    expect(out).toContain("[c2]");
    // more than three weeks ahead: in the rhythm's line, not in the list
    expect(out).not.toContain("[c3]");
    expect(goalsOf(contextBlock({ ...base, goals: [race], series: [{ ...series, active: false }] }))).toContain("· pausiert");
    expect(goalsOf(contextBlock({ ...base, goals: [race], series: [{ ...series, start_date: "2026-11-14" }] }))).toContain("Di, Do 18:00–19:00 · neu");
    // ended: no line (and no new offer: she had one for this goal)
    const ended = goalsOf(contextBlock({ ...base, goals: [{ ...race, rhythm_asked_at: "2026-10-20T08:00:00Z" }], series: [{ ...series, until_date: "2026-11-10" }] }));
    expect(ended).not.toContain("Wochenrhythmus");
  });

  it("after three weeks that mostly didn't happen: the offer to change or pause it, instead of the pattern offer", () => {
    const now = Date.parse(base.now!);
    const at = (daysAgo: number, minutes: number | null) => {
      const t = now - daysAgo * DAY;
      return { id: `p${daysAgo}`, title: "Laufen", starts_at: new Date(t).toISOString(), ends_at: new Date(t + 3600000).toISOString(), all_day: false, location: null, kind: "block", goal_id: "g1", series_id: "s1", minutes };
    };
    const out = goalsOf(
      contextBlock({ ...base, goals: [{ ...race, pattern_asked_at: null }], series: [series], recentBlocks: [at(19, 0), at(16, 0), at(12, null), at(9, 0), at(5, 0), at(2, null)] }),
    );
    expect(out).toContain("→ klappt selten: einmal anbieten, ihn zu ändern oder zu pausieren");
    expect(out).toContain("Blöcke der letzten 4 Wochen");
    expect(out).not.toContain("anpassen anbieten");
    expect(goalsOf(contextBlock({ ...base, goals: [race], series: [{ ...series, lapse_asked_at: "2026-11-10T08:00:00Z" }], recentBlocks: [at(19, 0), at(16, 0), at(12, null), at(9, 0), at(5, 0)] }))).not.toContain("klappt selten");
  });

  it("an ended rhythm, or the old part of a split one, never keeps the offer for another goal away", () => {
    const other = { ...race, id: "g3", title: "Velo", rhythm_asked_at: "2026-10-01T08:00:00Z" };
    const ended = rule({ id: "s0", goal_id: "g3", start_date: "2026-09-01", until_date: "2026-11-01" });
    const old = rule({ id: "s1", goal_id: "g1", start_date: "2026-10-01", until_date: "2026-12-31" });
    const split = rule({ id: "s2", goal_id: "g1", start_date: "2027-01-01", weekdays: [2] });
    const out = goalsOf(contextBlock({ ...base, goals: [{ ...race, rhythm_asked_at: "2026-10-01T08:00:00Z" }, exam, other], series: [ended, old, split] }));
    expect(out.slice(out.indexOf("[g2]"))).toContain(OFFER);
    // two that run: no offer
    const busy = rule({ id: "s3", goal_id: "g3", start_date: "2026-10-01" });
    expect(goalsOf(contextBlock({ ...base, goals: [{ ...race, rhythm_asked_at: "2026-10-01T08:00:00Z" }, exam, other], series: [busy, old, split] }))).not.toContain(OFFER);
  });

  it("a goal without a target date but with hours per week gets the one offer", () => {
    const open: ContextGoal = { ...exam, id: "g4", title: "Japanisch", target_date: null };
    expect(goalsOf(contextBlock({ ...base, goals: [open], series: [] }))).toContain(`${OFFER}, etwa 2 × 45 Min pro Woche`);
  });

  it("the Wochenblick plans around a rhythm that stands already", () => {
    const out = contextBlock({ ...base, goals: [race], series: [series], review: { due: "anbieten", monday: "2026-11-09", goals: [] } });
    expect(out).toContain("sein Wochenrhythmus steht schon im Kalender: nur ergänzen, was fehlt");
  });

  it("the prompt: one bullet for the rhythm (replacing «ab und zu»), the exception in one sentence, the guards", () => {
    expect(PERSONA).toContain("für ein Ziel mit Zeit pro Woche einmal als Wochenrhythmus");
    expect(PERSONA).toContain("- create_series, update_series: Ein Wochenrhythmus sind Blöcke, die jede Woche zur selben Zeit wiederkehren");
    expect(PERSONA).toContain("legst ihn erst nach ihrem klaren Ja an; bei unregelmässigen Wochen, etwa mit Schichtarbeit, nur, wenn sie danach fragt");
    expect(PERSONA).toContain("„Diesen Donnerstag fällt aus“ löscht nur diesen Eintrag, „am Donnerstag lieber um 19 Uhr“ verschiebt nur ihn");
    expect(PERSONA).toContain("rufst note_offer mit flaute auf");
    expect(PERSONA.slice(PERSONA.indexOf("- create_series"), PERSONA.indexOf("- create_goal"))).not.toContain("ß");
    expect(PERSONA.match(/Wochenrhythmus/g)!.length).toBeLessThanOrEqual(4);
  });
});

describe("the coach's tools", () => {
  const source = read("../supabase/functions/coach/index.ts");
  const tools = source.slice(source.indexOf("const TOOLS"), source.indexOf("class ToolInputError"));
  const tool = (name: string) => {
    const at = tools.indexOf(`name: "${name}"`);
    const next = tools.indexOf("\n  {\n    name:", at + 1);
    return tools.slice(at, next < 0 ? undefined : next);
  };

  it("create_series: after her yes, weekdays as codes, until the day before the target date by default", () => {
    expect(tool("create_series")).toContain("Nur nach ihrem klaren Ja.");
    expect(tool("create_series")).toContain('weekdays: { type: "array", items: { type: "string", enum: [...WEEKDAY_CODES] }');
    expect(tool("create_series")).toContain('required: ["title", "weekdays", "time"]');
    expect(tool("create_series")).toContain("ohne until bis zum Tag vor dem Zieldatum");
    expect(source).toContain("time_zone: ctx.tz,");
    expect(source).toContain("if (active.length >= SERIES_MAX_ACTIVE) throw new ToolInputError(");
    // an ended rhythm, or the old part of one split «ab Januar», never counts towards the limit or as a double
    expect(source).toContain("const active = liveRhythms((others.data ?? []) as Running[], day);");
    expect(source).toContain('throw new ToolInputError("Diesen Rhythmus gibt es schon (siehe „Wochenrhythmus“): ändere ihn mit update_series");');
  });

  it("update_series: changes the coming days, «ab» splits, pause, end, one day falls away", () => {
    for (const k of ["ab:", "pausiert:", "ende:", "ausfall:", "until:"]) expect(tool("update_series")).toContain(k);
    expect(source).toContain('const split = await sb.rpc("split_series", { p_id: id, p_from: ab });');
    expect(source).toContain("if (ausfall) patch.skip_days = [...((s.skip_days as string[] | null) ?? []), ausfall];");
    expect(source).toContain('await sb.from("series").delete().eq("id", id);');
  });

  it("one day of a rhythm on its own: the result says only that day; note_offer notes the offer and the lapse", () => {
    expect(source).toContain('const SERIES_DAY_NOTE = "Nur dieser Tag; der Wochenrhythmus bleibt, wie er ist.";');
    expect(source.match(/series_id \? \{ ok: true, notiert: SERIES_DAY_NOTE \} : \{ ok: true \}/g)).toHaveLength(2);
    expect(tool("note_offer")).toContain("rhythmus (du hast für ein Ziel einen Wochenrhythmus angeboten; mit goal_id, einmal pro Ziel)");
    expect(source).toContain('await sb.from("goals").update({ rhythm_asked_at: new Date().toISOString() }).eq("id", goalId).select("id");');
    expect(source).toContain('await sb.from("series").update({ lapse_asked_at: new Date().toISOString() }).eq("goal_id", goalId).select("id");');
  });

  it("the goal reached or paused: its rhythm rests and the coach says so; every conversation fills the rhythms", () => {
    expect(source).toContain('const resting = patch.status !== undefined && patch.status !== "active" ? await goalRhythms(sb, id, day) : [];');
    // only rhythms that still run (not one that ended) rest with the goal or count as its rhythm
    expect(source).toContain('.eq("active", true).or(`until_date.is.null,until_date.gte.${day}`)');
    expect(source).toContain("...(resting.length && data.status !== \"active\" ? { rhythmus: RHYTHM_RESTS } : {}),");
    expect(source).toContain('soft<number>(sb.rpc("extend_series"), 0, "extend series"),');
  });
});

describe("the migration", () => {
  const sql = read("../supabase/migrations/20261124000000_series.sql");

  it("a rhythm table with Row Level Security, its days as entries (one per day), skip markers, exceptions", () => {
    expect(sql).toContain("create table if not exists public.series (");
    expect(sql).toContain("alter table public.series enable row level security;");
    expect(sql).toContain('create policy "own series" on public.series for all using (auth.uid() = user_id) with check (auth.uid() = user_id);');
    expect(sql).toContain("add column if not exists series_id uuid references public.series (id) on delete set null,");
    expect(sql).toContain("create unique index if not exists events_series_day_idx on public.events (series_id, series_day);");
    expect(sql).toContain("skip_days date[] not null default '{}'");
    expect(sql).toContain("on conflict (series_id, series_day) do nothing;");
    expect(sql).toContain("if pg_trigger_depth() = 1 and old.series_day is not null and old.starts_at > now() then");
    expect(sql).toContain("new.series_exception := true;");
  });

  it("DST-correct local times, never a past day, never one she answered", () => {
    expect(sql).toContain("((d::date + s.start_time) at time zone s.time_zone) as starts_at");
    expect(sql).toContain("x.starts_at + make_interval(mins => s.duration_minutes)");
    expect(sql.match(/not exists \(select 1 from public\.goal_time t where t\.event_id = e\.id\)/g)!.length).toBeGreaterThanOrEqual(3);
    expect(sql).toContain("where e.series_id = s.id and e.starts_at > now()");
  });

  it("the rhythm rests with its goal; filled daily by pg_cron only for people who were here lately", () => {
    expect(sql).toContain("update public.series set active = false where goal_id = new.id and active;");
    expect(sql).toContain("select cron.schedule('i-am-series', '23 3 * * *', 'select public.extend_series(14)')");
    expect(sql).toContain("m.thread between to_char(current_date - p_quiet_days, 'YYYY-MM-DD') and '9999-12-31'");
    // time a connection brings by itself (Nolio, WHOOP) is no sign she was here: it never keeps a calendar filling
    expect(sql).toContain("t.source in ('person', 'coach', 'block')");
    expect(sql).toContain("and (x.until_date is null or x.until_date >= current_date - 1)");
  });

  it("every function pins its search_path and runs as the caller; the export reads the rhythms", () => {
    const fns = sql.match(/create or replace function [^\n]+(?:\n[^\n]+)?/g)!;
    expect(fns.length).toBeGreaterThanOrEqual(11);
    for (const f of fns) expect(f).toContain("set search_path = ''");
    expect(sql).not.toContain("security definer");
    expect(read("../supabase/functions/account/index.ts")).toContain('["series", "*", ["id"]],');
    expect(read("../src/lib/supabaseBackend.ts")).toContain('["series", ["id"]],');
    expect(read("../public/datenschutz.html")).toContain("dazu deine festen Wochenrhythmen (Tage, Uhrzeit, Dauer und welche einzelnen Tage ausfallen)");
  });
});

describe("the demo backend mirrors the database", () => {
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
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
  const add = (d: number) => new Date(Date.parse(`${today}T12:00:00Z`) + d * DAY).toISOString().slice(0, 10);
  beforeEach(async () => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
    b = new DemoBackend();
    await b.signUp("demo.rhythm", "geheim1234");
  });
  const days = async (id: string) => (await b.listEvents(new Date(Date.now() - 40 * DAY).toISOString(), new Date(Date.now() + 70 * DAY).toISOString())).filter((e) => e.series_id === id);
  const make = async (goalId: string | null, o: Partial<SeriesRule> = {}) =>
    b.addSeries({ goal_id: goalId, title: "Laufen", weekdays: [1, 2, 3, 4, 5, 6, 7], start_time: "23:59", duration_minutes: 1, location: null, reminder_minutes: 10, time_zone: "Europe/Zurich", start_date: add(1), until_date: null, ...o });

  it("fills 8 weeks, once, and marks the goal as offered", async () => {
    const g = await b.addGoal({ title: "Halbmarathon", target_date: add(90), weekly_hours: 3 });
    const { series, first } = await make(g.id, { weekdays: [2, 4], start_time: "18:00", duration_minutes: 60 });
    const list = await days(series.id);
    expect(first?.series_id).toBe(series.id);
    expect(list.length).toBeGreaterThanOrEqual(15);
    expect(list.length).toBeLessThanOrEqual(17);
    expect(list.every((e) => e.kind === "block" && e.goal_id === g.id && e.reminder_minutes === 10 && e.source === "coach")).toBe(true);
    expect(new Set(list.map((e) => e.series_day)).size).toBe(list.length);
    expect((await days(series.id)).length).toBe(list.length); // listing again fills nothing new
    expect((await b.listGoals()).find((x) => x.id === g.id)?.rhythm_asked_at).toBeTruthy();
  });

  it("one day falls away for good; a day moved on its own stays her exception when the rhythm changes", async () => {
    const { series } = await make(null);
    const [a, c] = await days(series.id);
    await b.deleteEvent(a.id);
    expect((await days(series.id)).some((e) => e.series_day === a.series_day)).toBe(false);
    const moved = await b.updateEvent(c.id, { starts_at: new Date(Date.parse(c.starts_at) - 3600000).toISOString(), ends_at: new Date(Date.parse(c.ends_at!) - 3600000).toISOString() });
    expect(moved.series_exception).toBe(true);
    // «Alle kommenden» from another day: the title changes for every coming day, not on her exception
    const other = (await days(series.id)).find((e) => !e.series_exception)!;
    await b.updateEvent(other.id, { title: "Intervalle" }, "following");
    const after = await days(series.id);
    expect(after.filter((e) => !e.series_exception).every((e) => e.title === "Intervalle")).toBe(true);
    expect(after.find((e) => e.id === c.id)?.title).toBe("Laufen");
    expect(after.some((e) => e.series_day === a.series_day)).toBe(false);
  });

  it("«Alle kommenden» on her one-day exception: the rhythm takes the new title, never her moved time", async () => {
    const { series } = await make(null, { start_time: "18:00", duration_minutes: 60 });
    const zurich = (iso: string) => new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
    const d = (await days(series.id))[2];
    await b.updateEvent(d.id, { starts_at: new Date(Date.parse(d.starts_at) + 3600000).toISOString(), ends_at: new Date(Date.parse(d.ends_at!) + 3600000).toISOString() });
    const renamed = await b.updateEvent(d.id, { title: "Intervalle" }, "following");
    expect(renamed.series_exception).toBe(true);
    expect(zurich(renamed.starts_at)).toBe("19:00");
    const after = await days(series.id);
    expect(after.every((e) => e.title === "Intervalle")).toBe(true);
    expect(after.filter((e) => e.id !== d.id).every((e) => zurich(e.starts_at) === "18:00")).toBe(true);
    // a new start for all coming: the day follows the rhythm again
    const moved = await b.updateEvent(d.id, { starts_at: new Date(Date.parse(d.starts_at) + 2 * 3600000).toISOString(), ends_at: new Date(Date.parse(d.ends_at!) + 2 * 3600000).toISOString() }, "following");
    expect(moved.series_exception).toBe(false);
    expect((await days(series.id)).every((e) => zurich(e.starts_at) === "20:00")).toBe(true);
  });

  it("«Alle kommenden» deleted: the rhythm ends the day before; the goal paused: its days go; the goal deleted: the rhythm goes", async () => {
    const g = await b.addGoal({ title: "Halbmarathon", target_date: add(90), weekly_hours: 3 });
    const { series } = await make(g.id);
    const list = await days(series.id);
    await b.deleteEvent(list[3].id, "following");
    const kept = await days(series.id);
    expect(kept.map((e) => e.id)).toEqual(list.slice(0, 3).map((e) => e.id));
    await b.updateGoal(g.id, { status: "paused" });
    expect(await days(series.id)).toEqual([]);
    await b.updateGoal(g.id, { status: "active" });
    expect(await days(series.id)).toEqual([]); // it stays paused until the coach resumes it
    const second = await make(g.id, { start_time: "06:00" });
    expect((await days(second.series.id)).length).toBeGreaterThan(0);
    await b.deleteGoal(g.id);
    expect(await days(second.series.id)).toEqual([]);
  });

  it("syncDemoSeries: past and answered days are never touched; honest counting applies to them", () => {
    const now = Date.parse("2026-11-16T12:00:00Z");
    const past: CalendarEvent = {
      id: "p1",
      title: "Laufen",
      starts_at: "2026-11-12T17:00:00.000Z",
      ends_at: "2026-11-12T18:00:00.000Z",
      all_day: false,
      location: null,
      notes: null,
      reminder_minutes: 10,
      source: "coach",
      kind: "block",
      goal_id: null,
      series_id: "s1",
      series_day: "2026-11-12",
      created_at: "2026-11-01T08:00:00.000Z",
    };
    const u = { events: [past], goals: [], goal_time: [], series: [rule({ start_time: "19:00", location: "Allmend" })] };
    expect(syncDemoSeries(u, now)).toBe(true);
    expect(u.events.find((e) => e.id === "p1")).toEqual(past);
    expect(u.events.filter((e) => e.series_id === "s1" && e.id !== "p1").every((e) => e.location === "Allmend")).toBe(true);
    expect(syncDemoSeries(u, now)).toBe(false); // idempotent
  });

  it("the demo coach: «jeden Dienstag und Donnerstag um 18 Uhr laufen» becomes a rhythm for her goal", async () => {
    expect(parseDemoRhythm("Ich möchte jeden Dienstag und Donnerstag um 18 Uhr laufen")).toEqual({ weekdays: [2, 4], time: "18:00", title: "Laufen" });
    expect(parseDemoRhythm("Am Dienstag um 18 Uhr laufen")).toBeNull();
    const g = await b.addGoal({ title: "Halbmarathon", target_date: add(90), weekly_hours: 3 });
    const events: CoachEvent[] = [];
    const ctx = { day: today, localTime: "", timezone: "Europe/Zurich", season: "Herbst", phase: "Abend", hasLocation: false };
    await b.coach({ mode: "checkin", thread: today, message: "Trag mir jeden Dienstag und Donnerstag um 18 Uhr laufen ein", context: ctx }, (e) => events.push(e));
    const created = events.find((e) => e.type === "event_created") as Extract<CoachEvent, { type: "event_created" }> | undefined;
    expect(created?.event.series_id).toBeTruthy();
    expect(created?.event.goal_id).toBe(g.id);
    expect(events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("")).toContain("steht jetzt jede Woche im Kalender");
  });
});
