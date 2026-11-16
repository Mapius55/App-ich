// The Bucket List helpers (supabase/functions/_shared/plan.ts, SPEC §1) and the demo data layer for
// dreams: kind, done_at (like the trigger), memory, the birth year, the demo dreams and the demo coach.
import { beforeEach, describe, expect, it } from "vitest";
import {
  addDays,
  dayOf,
  dayOfYear,
  daysInYear,
  dreamNudge,
  isLeapYear,
  isoWeek,
  LIFE_WEEKS_PER_YEAR,
  LIFE_YEARS,
  lifeColumn,
  lifeWeeks,
  NUDGE_LONG_DAYS,
  NUDGE_LONG_QUIET_DAYS,
  NUDGE_SOON_DAYS,
  NUDGE_SOON_QUIET_DAYS,
  thousands,
  weekCell,
  yearProgress,
  type NudgeGoal,
} from "../src/lib/plan";
import { DEMO_BIRTH_YEAR, DEMO_DREAMS, DemoBackend, demoMemory, parseDemoDream, recogniseDemoFulfilled } from "../src/lib/demoBackend";
import type { CoachEvent, CoachRequest, Goal } from "../src/lib/types";

describe("calendar years", () => {
  it("knows leap years, including the century rules", () => {
    expect([1900, 2000, 2024, 2026, 2028, 2100].map(isLeapYear)).toEqual([false, true, true, false, true, false]);
    expect(daysInYear(2024)).toBe(366);
    expect(daysInYear(2026)).toBe(365);
  });

  it("counts the day of the year from 0 on 1 January", () => {
    expect(dayOfYear("2026-01-01")).toBe(0);
    expect(dayOfYear("2026-03-01")).toBe(59);
    expect(dayOfYear("2024-02-29")).toBe(59);
    expect(dayOfYear("2024-03-01")).toBe(60);
    expect(dayOfYear("2026-12-31")).toBe(364);
    expect(dayOfYear("2024-12-31")).toBe(365);
  });
});

describe("yearProgress", () => {
  it("counts today as passed: 46 days are left in 2026 on 15 November", () => {
    expect(yearProgress(2026, "2026-11-15")).toEqual({ passedDays: 319, totalDays: 365, leftDays: 46, fraction: 319 / 365 });
    expect(yearProgress(2026, "2026-11-14").leftDays).toBe(47);
  });

  it("starts with one day on 1 January and ends at 1 on 31 December, leap years too", () => {
    expect(yearProgress(2026, "2026-01-01")).toMatchObject({ passedDays: 1, leftDays: 364 });
    expect(yearProgress(2024, "2024-01-01")).toMatchObject({ passedDays: 1, totalDays: 366, leftDays: 365 });
    expect(yearProgress(2024, "2024-12-31")).toEqual({ passedDays: 366, totalDays: 366, leftDays: 0, fraction: 1 });
    expect(yearProgress(2024, "2024-02-29")).toMatchObject({ passedDays: 60, leftDays: 306 });
  });

  it("a past year is complete, a future one not begun", () => {
    expect(yearProgress(2025, "2026-11-14")).toEqual({ passedDays: 365, totalDays: 365, leftDays: 0, fraction: 1 });
    expect(yearProgress(2028, "2026-11-14")).toEqual({ passedDays: 0, totalDays: 366, leftDays: 366, fraction: 0 });
  });

  it("never goes backwards or skips over a year", () => {
    let prev = -1;
    for (let d = "2024-01-01"; d <= "2024-12-31"; d = addDays(d, 1)) {
      const p = yearProgress(2024, d);
      expect(p.passedDays).toBe(prev + (prev < 0 ? 2 : 1));
      expect(p.passedDays + p.leftDays).toBe(366);
      prev = p.passedDays;
    }
  });
});

describe("life in weeks: columns and cells", () => {
  it("has 90 rows of 52 weeks", () => {
    expect([LIFE_YEARS, LIFE_WEEKS_PER_YEAR]).toEqual([90, 52]);
    expect(lifeWeeks(1994, "2026-11-14").total).toBe(4680);
  });

  it("starts a new column every seven days from 1 January", () => {
    expect(["2026-01-01", "2026-01-07", "2026-01-08", "2026-01-14", "2026-01-15"].map(lifeColumn)).toEqual([0, 0, 1, 1, 2]);
  });

  it("folds the days of week «52/53» into column 51 (8 days in a normal year, 9 in a leap year)", () => {
    const perColumn = (year: number) => {
      const counts = new Array(52).fill(0);
      for (let d = `${year}-01-01`; d.startsWith(String(year)); d = addDays(d, 1)) counts[lifeColumn(d)]++;
      return counts;
    };
    const normal = perColumn(2026);
    const leap = perColumn(2024);
    expect(normal.slice(0, 51).every((n) => n === 7)).toBe(true);
    expect(leap.slice(0, 51).every((n) => n === 7)).toBe(true);
    expect([normal[51], leap[51]]).toEqual([8, 9]);
    expect(["2026-12-24", "2026-12-30", "2026-12-31", "2024-12-23", "2024-12-31"].map(lifeColumn)).toEqual([51, 51, 51, 51, 51]);
    // the calendar's own week 53 is no column 52 here
    expect(isoWeek("2026-12-31")).toBe(53);
    expect(lifeColumn("2026-12-31")).toBe(51);
  });

  it("places a date in its row (the calendar year from the birth year on) and column", () => {
    expect(weekCell("1994-01-01", 1994)).toEqual({ row: 0, col: 0 });
    expect(weekCell("2025-08-16", 1994)).toEqual({ row: 31, col: 32 });
    // a timestamp (a goal's done_at) is read by its date
    expect(weekCell("2025-08-16T04:40:00.000Z", 1994)).toEqual({ row: 31, col: 32 });
    expect(weekCell("2083-12-31", 1994)).toEqual({ row: 89, col: 51 });
  });

  it("has no cell outside the 90 years, for non-dates or a broken birth year", () => {
    expect(weekCell("1993-12-31", 1994)).toBeNull();
    expect(weekCell("2084-01-01", 1994)).toBeNull();
    for (const v of ["2026-02-30", "2026-13-01", "gestern", "", null, undefined]) expect(weekCell(v, 1994)).toBeNull();
    expect(weekCell("2026-11-14", 1994.5)).toBeNull();
    expect(weekCell("2026-11-14", Number.NaN)).toBeNull();
  });
});

describe("life in weeks: lived weeks", () => {
  it("counts the weeks before the current one", () => {
    // row 32 (2026), 14 November = day 317 → column 45
    expect(lifeWeeks(1994, "2026-11-14")).toEqual({ total: 4680, lived: 32 * 52 + 45, currentRow: 32, currentCol: 45 });
    expect(lifeWeeks(1994, "1994-01-01")).toEqual({ total: 4680, lived: 0, currentRow: 0, currentCol: 0 });
  });

  it("goes on by one from the last week of a year to the first of the next, also after a leap year", () => {
    const end = lifeWeeks(1994, "2024-12-31");
    const next = lifeWeeks(1994, "2025-01-01");
    expect([end.currentRow, end.currentCol, next.currentRow, next.currentCol]).toEqual([30, 51, 31, 0]);
    expect(next.lived - end.lived).toBe(1);
  });

  it("never goes back and moves at most one week per day", () => {
    let prev = lifeWeeks(2000, "2023-12-01").lived;
    for (let d = "2023-12-02"; d <= "2025-01-31"; d = addDays(d, 1)) {
      const l = lifeWeeks(2000, d).lived;
      expect(l - prev === 0 || l - prev === 1).toBe(true);
      prev = l;
    }
  });

  it("a birth year in the future: nothing lived, no current week", () => {
    expect(lifeWeeks(2030, "2026-11-14")).toEqual({ total: 4680, lived: 0, currentRow: -1, currentCol: -1 });
    expect(lifeWeeks(2027, "2026-12-31")).toMatchObject({ lived: 0, currentRow: -1 });
  });

  it("89 years ago is the last row; longer ago everything is lived and there is no current week", () => {
    expect(lifeWeeks(1937, "2026-11-14")).toEqual({ total: 4680, lived: 89 * 52 + 45, currentRow: 89, currentCol: 45 });
    expect(lifeWeeks(1937, "2026-12-31").lived).toBe(4679);
    expect(lifeWeeks(1936, "2026-01-01")).toEqual({ total: 4680, lived: 4680, currentRow: -1, currentCol: -1 });
    expect(lifeWeeks(1900, "2026-11-14").lived).toBe(4680);
  });

  it("a broken birth year or day counts nothing", () => {
    expect(lifeWeeks(Number.NaN, "2026-11-14")).toMatchObject({ lived: 0, currentRow: -1 });
    expect(lifeWeeks(1994, "kein Tag")).toMatchObject({ lived: 0, currentRow: -1 });
  });

  it("writes thousands with the Swiss apostrophe", () => {
    expect([thousands(4680), thousands(1843), thousands(999), thousands(1_000_000), thousands(0)]).toEqual(["4’680", "1’843", "999", "1’000’000", "0"]);
  });
});

describe("dreamNudge: the coach's reminder candidates", () => {
  const today = "2026-11-14";
  const ago = (n: number) => addDays(today, -n);
  const dream = (o: Partial<NudgeGoal> = {}): NudgeGoal => ({
    kind: "dream",
    status: "active",
    target_date: null,
    created_at: `${ago(200)}T10:00:00.000Z`,
    updated_at: `${ago(200)}T10:00:00.000Z`,
    reminded_at: null,
    ...o,
  });

  it("has the thresholds of the spec", () => {
    expect([NUDGE_SOON_DAYS, NUDGE_SOON_QUIET_DAYS, NUDGE_LONG_DAYS, NUDGE_LONG_QUIET_DAYS]).toEqual([56, 14, 60, 30]);
  });

  it("only for active dreams", () => {
    expect(dreamNudge(dream(), today)).toBe("lange");
    expect(dreamNudge(dream({ kind: "goal" }), today)).toBeNull();
    expect(dreamNudge(dream({ kind: undefined }), today)).toBeNull();
    for (const status of ["paused", "done", "dropped"]) expect(dreamNudge(dream({ status }), today)).toBeNull();
  });

  it("«guter Zeitpunkt»: a target date from today up to 8 weeks ahead", () => {
    const fresh = { created_at: `${ago(3)}T10:00:00.000Z`, updated_at: `${ago(3)}T10:00:00.000Z` };
    expect(dreamNudge(dream({ ...fresh, target_date: today }), today)).toBe("zeitpunkt");
    expect(dreamNudge(dream({ ...fresh, target_date: addDays(today, 56) }), today)).toBe("zeitpunkt");
    expect(dreamNudge(dream({ ...fresh, target_date: addDays(today, 57) }), today)).toBeNull();
    expect(dreamNudge(dream({ ...fresh, target_date: addDays(today, -1) }), today)).toBeNull(); // passed: no good moment ahead
    // an old dream with a date far ahead still lies around for long
    expect(dreamNudge(dream({ target_date: addDays(today, 120) }), today)).toBe("lange");
    // a near date comes first when both hold
    expect(dreamNudge(dream({ target_date: addDays(today, 30) }), today)).toBe("zeitpunkt");
  });

  it("«guter Zeitpunkt» waits 14 days after a reminder", () => {
    const soon = { target_date: addDays(today, 30), created_at: `${ago(3)}T10:00:00.000Z`, updated_at: `${ago(3)}T10:00:00.000Z` };
    expect(dreamNudge(dream({ ...soon, reminded_at: `${ago(13)}T09:00:00.000Z` }), today)).toBeNull();
    expect(dreamNudge(dream({ ...soon, reminded_at: `${ago(14)}T09:00:00.000Z` }), today)).toBe("zeitpunkt");
    expect(dreamNudge(dream({ ...soon, reminded_at: `${today}T07:00:00.000Z` }), today)).toBeNull();
  });

  it("«liegt lange»: nothing for 60 days or more", () => {
    const at = (n: number) => ({ created_at: `${ago(n)}T10:00:00.000Z`, updated_at: `${ago(n)}T10:00:00.000Z` });
    expect(dreamNudge(dream(at(59)), today)).toBeNull();
    expect(dreamNudge(dream(at(60)), today)).toBe("lange");
    // the newest of created and updated counts
    expect(dreamNudge(dream({ created_at: `${ago(400)}T10:00:00.000Z`, updated_at: `${ago(20)}T10:00:00.000Z` }), today)).toBeNull();
  });

  it("«liegt lange» waits 30 days after a reminder", () => {
    expect(dreamNudge(dream({ reminded_at: `${ago(29)}T12:00:00.000Z` }), today)).toBeNull();
    expect(dreamNudge(dream({ reminded_at: `${ago(30)}T12:00:00.000Z` }), today)).toBe("lange");
    // a reminder "in the future" (another clock) holds it back too
    expect(dreamNudge(dream({ reminded_at: `${addDays(today, 2)}T12:00:00.000Z` }), today)).toBeNull();
  });

  it("logged time, a block (also a planned one) or a step done lately keep it from lying around", () => {
    expect(dreamNudge(dream(), today, { lastTimeDay: ago(10) })).toBeNull();
    expect(dreamNudge(dream(), today, { lastTimeDay: ago(60) })).toBe("lange");
    expect(dreamNudge(dream(), today, { lastBlockDay: addDays(today, 20) })).toBeNull();
    expect(dreamNudge(dream(), today, { lastBlockDay: ago(61) })).toBe("lange");
    expect(dreamNudge(dream(), today, { lastStepDay: ago(5) })).toBeNull();
    expect(dreamNudge(dream(), today, { lastTimeDay: null, lastBlockDay: null, lastStepDay: null })).toBe("lange");
  });

  it("reads timestamps in the person's time zone when given", () => {
    // 31 October 23:30 UTC is already 1 November in Zurich: 13 days before 14 November
    const r = { target_date: addDays(today, 10), created_at: `${ago(3)}T10:00:00.000Z`, reminded_at: "2026-10-31T23:30:00.000Z" };
    const zurich = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(iso));
    expect(dreamNudge(dream(r), today)).toBe("zeitpunkt");
    expect(dreamNudge(dream(r), today, { dayOfIso: zurich })).toBeNull();
  });

  it("says nothing without any date to go by or for a broken day", () => {
    expect(dreamNudge(dream({ created_at: null, updated_at: null }), today)).toBeNull();
    expect(dreamNudge(dream(), "irgendwann")).toBeNull();
  });
});

// ---------- the demo data layer ----------

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

const stored = () => JSON.parse(localStorage.getItem("ich.demo.users")!);
const store = (users: unknown) => localStorage.setItem("ich.demo.users", JSON.stringify(users));

describe("demo backend: dreams and goals", () => {
  let b: DemoBackend;
  beforeEach(async () => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
    b = new DemoBackend({ bucket: true });
    await b.signUp("demo.traum", "geheim1234");
  });

  it("a new account starts with an empty Bucket List and no birth year", async () => {
    expect(await b.listGoals(true)).toEqual([]);
    expect((await b.getProfile()).birth_year).toBeUndefined();
  });

  it("stores the kind; a goal by default", async () => {
    const g = await b.addGoal({ title: "Halbmarathon" });
    const d = await b.addGoal({ title: "Polarlichter sehen", kind: "dream" });
    expect([g.kind, g.done_at, g.memory, d.kind]).toEqual(["goal", null, null, "dream"]);
    expect((await b.updateGoal(d.id, { kind: "goal" })).kind).toBe("goal");
    await expect(b.addGoal({ title: "x", kind: "wunsch" as Goal["kind"] })).rejects.toThrow("Traum oder ein Ziel");
  });

  it("done_at follows the status like the trigger: set, kept while done, cleared, given", async () => {
    const d = await b.addGoal({ title: "Polarlichter sehen", kind: "dream" });
    const done = await b.updateGoal(d.id, { status: "done" });
    expect(done.done_at).not.toBeNull();
    // still done (another field changes): the date stays
    const again = await b.updateGoal(d.id, { status: "done", memory: "Grün über dem Fjord." });
    expect([again.done_at, again.memory]).toEqual([done.done_at, "Grün über dem Fjord."]);
    // «Wieder offen»: no date, the memory stays
    const open = await b.updateGoal(d.id, { status: "active" });
    expect([open.done_at, open.memory]).toEqual([null, "Grün über dem Fjord."]);
    // a date given with done is kept; on a goal that isn't done it is dropped
    expect((await b.updateGoal(d.id, { status: "done", done_at: "2025-08-16T04:40:00.000Z" })).done_at).toBe("2025-08-16T04:40:00.000Z");
    expect((await b.updateGoal(d.id, { status: "paused", done_at: "2025-08-16T04:40:00.000Z" })).done_at).toBeNull();
    const lived = await b.addGoal({ title: "Velo über den Gotthard", kind: "dream", status: "done" });
    expect(lived.done_at).not.toBeNull();
  });

  it("checks the memory like the database: at most 1000 characters, empty is none", async () => {
    const d = await b.addGoal({ title: "Japan", kind: "dream", status: "done" });
    expect((await b.updateGoal(d.id, { memory: "   " })).memory).toBeNull();
    expect((await b.updateGoal(d.id, { memory: "x".repeat(1000) })).memory).toHaveLength(1000);
    await expect(b.updateGoal(d.id, { memory: "x".repeat(1001) })).rejects.toThrow("1000");
    expect((await b.updateGoal(d.id, { memory: null })).memory).toBeNull();
  });

  it("lists open dreams with the goals, fulfilled ones only with all", async () => {
    await b.addGoal({ title: "Polarlichter sehen", kind: "dream" });
    await b.addGoal({ title: "Gotthard", kind: "dream", status: "done" });
    expect((await b.listGoals()).map((g) => g.title)).toEqual(["Polarlichter sehen"]);
    expect((await b.listGoals(true)).length).toBe(2);
    // the export has the new columns
    expect((await b.exportData()).goals).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Gotthard", kind: "dream", memory: null, done_at: expect.any(String) })]));
  });

  it("keeps the birth year like the check on profiles", async () => {
    await b.updateProfile({ birth_year: 1994 });
    expect((await b.getProfile()).birth_year).toBe(1994);
    await b.updateProfile({ birth_year: null });
    expect((await b.getProfile()).birth_year).toBeNull();
    for (const bad of [1899, 2101, 1994.5]) await expect(b.updateProfile({ birth_year: bad })).rejects.toThrow("Geburtsjahr");
    expect((await b.exportData()).profile).toMatchObject({ birth_year: null });
  });
});

describe("demo backend: the demo data for accounts stored before the Bucket List", () => {
  beforeEach(async () => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
    // an account as the UI tests store it: goals without kind, a reached one, no marker, no birth year
    const old = new DemoBackend();
    await old.signUp("plan.test", "geheim1234");
    const race = await old.addGoal({ title: "Halbmarathon Zürich", target_date: "2026-12-06" });
    const reached = await old.addGoal({ title: "10 km am Stück", status: "done" });
    const users = stored();
    const u = users["plan.test"];
    delete u.bucket;
    delete u.profile.birth_year;
    for (const g of u.goals) {
      delete g.kind;
      delete g.done_at;
      delete g.memory;
      delete g.reminded_at;
    }
    u.goals.find((g: Goal) => g.id === reached.id).updated_at = "2026-10-01T08:00:00.000Z";
    store(users);
    expect(race.kind).toBe("goal");
  });

  it("adds the four dreams of SPEC §8 and the birth year 1994, once", async () => {
    const b = new DemoBackend({ bucket: true });
    await b.signIn("plan.test", "geheim1234");
    const all = await b.listGoals(true);
    const dreams = all.filter((g) => g.kind === "dream");
    expect(dreams.map((d) => d.title).sort()).toEqual(
      ["Einmal in der Hörnlihütte am Matterhorn übernachten", "Kirschblüte in Japan erleben", "Mit dem Velo über den Gotthard", "Polarlichter sehen"].sort(),
    );
    const by = (t: string) => dreams.find((d) => d.title === t)!;
    expect(by("Polarlichter sehen")).toMatchObject({ status: "active", target_date: "2027-02-28", done_at: null });
    expect(by("Kirschblüte in Japan erleben")).toMatchObject({ status: "active", target_date: null });
    expect(by("Einmal in der Hörnlihütte am Matterhorn übernachten")).toMatchObject({ status: "done", memory: "Sonnenaufgang über den Wolken, kalt und still." });
    expect(by("Einmal in der Hörnlihütte am Matterhorn übernachten").done_at!.slice(0, 10)).toBe("2025-08-16");
    expect(by("Mit dem Velo über den Gotthard")).toMatchObject({ status: "done", memory: null });
    expect(by("Mit dem Velo über den Gotthard").done_at!.slice(0, 10)).toBe("2026-06-21");
    expect((await b.getProfile()).birth_year).toBe(DEMO_BIRTH_YEAR);
    expect(DEMO_BIRTH_YEAR).toBe(1994);
    // the training goals stay goals; the one reached before gets its last change as date (like the migration)
    expect(all.filter((g) => g.kind === "goal").map((g) => [g.title, g.done_at])).toEqual([
      ["Halbmarathon Zürich", null],
      ["10 km am Stück", "2026-10-01T08:00:00.000Z"],
    ]);
    // the same ids on every read, also before anything was saved
    expect((await b.listGoals(true)).map((g) => g.id).sort()).toEqual(all.map((g) => g.id).sort());
    expect(DEMO_DREAMS.every((d) => /^[0-9a-f-]{36}$/.test(d.id))).toBe(true);
  });

  it("a dream deleted (or a birth year removed) does not come back", async () => {
    const b = new DemoBackend({ bucket: true });
    await b.signIn("plan.test", "geheim1234");
    const japan = (await b.listGoals(true)).find((g) => g.title === "Kirschblüte in Japan erleben")!;
    await b.deleteGoal(japan.id);
    await b.updateProfile({ birth_year: null });
    const again = new DemoBackend({ bucket: true });
    expect((await again.listGoals(true)).some((g) => g.id === japan.id)).toBe(false);
    expect((await again.getProfile()).birth_year).toBeNull();
    expect(stored()["plan.test"].bucket).toBe(true);
  });

  it("without the option (or with ich.demo.bucket = 0) the account stays as it was", async () => {
    const b = new DemoBackend();
    await b.signIn("plan.test", "geheim1234");
    expect((await b.listGoals(true)).map((g) => [g.title, g.kind])).toEqual([
      ["Halbmarathon Zürich", "goal"],
      ["10 km am Stück", "goal"],
    ]);
    expect((await b.getProfile()).birth_year).toBeUndefined();
  });
});

describe("demo coach: dreams", () => {
  const now = new Date(2026, 10, 15, 10, 0);

  it("puts a life wish on the Bucket List, with a month as target", () => {
    expect(parseDemoDream("Ich möchte einmal Polarlichter sehen.", now)).toEqual({ title: "Polarlichter sehen", target_date: null });
    expect(parseDemoDream("Mein Traum ist es, einmal Polarlichter zu sehen", now)).toEqual({ title: "Polarlichter sehen", target_date: null });
    expect(parseDemoDream("Ich will irgendwann nach Japan", now)).toEqual({ title: "Nach Japan", target_date: null });
    expect(parseDemoDream("Ich möchte mit 40 einen Marathon laufen", now)).toEqual({ title: "Mit 40 einen Marathon laufen", target_date: null });
    expect(parseDemoDream("Ich würde so gerne einmal im Februar Polarlichter sehen", now)).toEqual({ title: "Polarlichter sehen", target_date: "2027-02-28" });
    expect(parseDemoDream("Auf meine Bucket List kommt: Island umrunden", now)).toEqual({ title: "Island umrunden", target_date: null });
  });

  it("leaves everyday wishes, questions and appointments alone", () => {
    expect(parseDemoDream("Ich möchte heute einmal früh schlafen", now)).toBeNull();
    expect(parseDemoDream("Ich möchte Polarlichter sehen", now)).toBeNull(); // no «einmal»: could be tonight
    expect(parseDemoDream("Ich möchte einmal Polarlichter sehen?", now)).toBeNull();
    expect(parseDemoDream("Ich will bis März 10 kg abnehmen", now)).toBeNull();
    expect(parseDemoDream("Ich möchte nie einmal so werden", now)).toBeNull();
    expect(parseDemoDream("Ich will einmal am 3.12. um 18:30 ins Training", now)).toBeNull();
  });

  it("knows which dream came true, by its names, never by a habit", () => {
    const dreams = [
      { title: "Polarlichter sehen", status: "active", kind: "dream" },
      { title: "Mit 40 einen Marathon laufen", status: "active", kind: "dream" },
      { title: "Mit dem Velo über den Gotthard", status: "active", kind: "dream" },
    ] as Pick<Goal, "title" | "status" | "kind">[];
    expect(recogniseDemoFulfilled("Ich habe die Polarlichter gesehen!", dreams)?.title).toBe("Polarlichter sehen");
    expect(recogniseDemoFulfilled("Ich bin mit dem Velo über den Gotthard gefahren", dreams)?.title).toBe("Mit dem Velo über den Gotthard");
    expect(recogniseDemoFulfilled("Ich war heute laufen", dreams)).toBeNull();
    expect(recogniseDemoFulfilled("Ich möchte die Polarlichter sehen", dreams)).toBeNull();
    expect(recogniseDemoFulfilled("Hast du die Polarlichter gesehen?", dreams)).toBeNull();
    expect(recogniseDemoFulfilled("Mein Traum hat sich erfüllt", dreams.slice(0, 1))?.title).toBe("Polarlichter sehen");
    expect(recogniseDemoFulfilled("Mein Traum hat sich erfüllt", dreams)).toBeNull(); // which one?
  });

  it("keeps a memory short and in her words", () => {
    expect(demoMemory("  Es war kalt\nund still. ")).toBe("Es war kalt und still.");
    const long = `${"Der Himmel war grün und violett. ".repeat(12)}Ende`;
    expect(demoMemory(long).length).toBeLessThanOrEqual(300);
    expect(demoMemory(long).endsWith(".")).toBe(true);
  });

  const ctx: CoachRequest["context"] = { day: dayOf(), localTime: "", timezone: "Europe/Zurich", season: "Herbst", phase: "Tag", hasLocation: false };
  const talk = async (b: DemoBackend, message: string, view?: string) => {
    const events: CoachEvent[] = [];
    await b.coach({ mode: "checkin", thread: ctx.day, message, context: { ...ctx, view } }, (e) => events.push(e));
    return { events, text: events.flatMap((e) => (e.type === "text" ? [e.text] : [])).join("") };
  };

  it("a wish, then it came true, then how it was", async () => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
    const b = new DemoBackend();
    await b.signUp("demo.polar", "geheim1234");
    await b.addHabit({ title: "Laufen", per_week: 3 });

    const wish = await talk(b, "Ich möchte einmal Polarlichter sehen");
    const saved = wish.events.find((e) => e.type === "goal_saved");
    expect(saved && saved.type === "goal_saved" && [saved.goal.title, saved.goal.kind, saved.created]).toEqual(["Polarlichter sehen", "dream", true]);
    expect(wish.text).toContain("„Polarlichter sehen“ steht jetzt auf deiner Bucket List.");
    expect(wish.events.some((e) => e.type === "mood" || e.type === "focus" || e.type === "event_created")).toBe(false);
    // said twice: not on the list twice
    expect((await talk(b, "Ich möchte einmal Polarlichter sehen")).text).toContain("steht schon auf deiner Bucket List");
    expect((await b.listGoals()).length).toBe(1);

    const came = await talk(b, "Ich habe endlich die Polarlichter gesehen!");
    const done = came.events.find((e) => e.type === "goal_saved");
    expect(done && done.type === "goal_saved" && [done.goal.status, !!done.goal.done_at]).toEqual(["done", true]);
    expect(came.text).toBe("Wie schön, „Polarlichter sehen“ hat sich erfüllt. Wie war es?");

    const how = await talk(b, "Es war kalt und still, und der Himmel hat getanzt.");
    const kept = how.events.find((e) => e.type === "goal_saved");
    expect(kept && kept.type === "goal_saved" && kept.goal.memory).toBe("Es war kalt und still, und der Himmel hat getanzt.");
    expect(how.text).toContain("bewahre ich bei „Polarlichter sehen“ auf");
    expect(how.events.some((e) => e.type === "habit_logged" || e.type === "time_logged" || e.type === "mood")).toBe(false);
  }, 20000);

  it("when the app says «Erfüllt» first, the next words become the memory (the dream in view)", async () => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
    const b = new DemoBackend();
    await b.signUp("demo.velo", "geheim1234");
    const d = await b.addGoal({ title: "Mit dem Velo über den Gotthard", kind: "dream" });
    await b.updateGoal(d.id, { status: "done" });
    const told = await talk(b, "Oben lag noch Schnee, und die Abfahrt war ein Fest.", "Bucket List: Mit dem Velo über den Gotthard, erfüllt");
    expect((await b.listGoals(true))[0].memory).toBe("Oben lag noch Schnee, und die Abfahrt war ein Fest.");
    expect(told.text).toContain("bewahre ich");
  }, 20000);
});
