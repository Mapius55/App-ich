import { beforeEach, describe, expect, it } from "vitest";
import {
  blockTimeEntry,
  DemoBackend,
  minutesLabel,
  parseDemoDate,
  parseDemoEvent,
  parseDemoGoal,
  parseDemoMinutes,
  recogniseDemoHabits,
  recogniseDemoTime,
} from "../src/lib/demoBackend";
import { addDays, dayOf, weekStart } from "../src/lib/plan";
import type { CoachEvent, CoachRequest, EventInput } from "../src/lib/types";

const now = new Date(2026, 10, 15, 10, 0); // Sunday 15 Nov 2026, 10:00

describe("demo date parser", () => {
  it("understands day + month name, with and without year", () => {
    expect(dayOf(parseDemoDate("am 6. Dezember", now)!.date)).toBe("2026-12-06");
    expect(dayOf(parseDemoDate("am 6 Dezember 2027", now)!.date)).toBe("2027-12-06");
    expect(dayOf(parseDemoDate("am 2. März", now)!.date)).toBe("2027-03-02"); // passed this year
  });
  it("takes a month alone as its last day, unless Anfang/Mitte", () => {
    expect(parseDemoDate("bis März", now)).toMatchObject({ kind: "month" });
    expect(dayOf(parseDemoDate("bis März", now)!.date)).toBe("2027-03-31");
    expect(dayOf(parseDemoDate("bis Ende Februar", now)!.date)).toBe("2027-02-28");
    expect(dayOf(parseDemoDate("bis Anfang April", now)!.date)).toBe("2027-04-01");
    expect(dayOf(parseDemoDate("im Dezember", now)!.date)).toBe("2026-12-31");
  });
  it("skips impossible dates such as a time 18.30", () => {
    expect(parseDemoDate("um 18.30", now, ["day"])).toBeNull();
    expect(parseDemoDate("am 31.2.", now, ["day"])).toBeNull();
  });
  it("lets appointments ignore a bare month and keep 'morgen'", () => {
    const e = parseDemoEvent("Morgen ist Training für den Marathon im Dezember", now)!;
    expect(e.start.getDate()).toBe(16);
    expect(parseDemoEvent("Im Dezember habe ich ein Rennen", now)).toBeNull();
    expect(dayOf(parseDemoEvent("Am 6. Dezember habe ich ein Rennen", now)!.start)).toBe("2026-12-06");
  });
});

describe("demo goal recognition", () => {
  it("understands 'Mein Ziel ist …' with a date", () => {
    expect(parseDemoGoal("Mein Ziel ist der Halbmarathon am 6. Dezember", now)).toEqual({ title: "Halbmarathon", target_date: "2026-12-06" });
    expect(parseDemoGoal("Mein Ziel ist der Halbmarathon am 6.12. Ich freue mich schon.", now)).toEqual({
      title: "Halbmarathon",
      target_date: "2026-12-06",
    });
  });
  it("understands 'Ich will bis … ' and cuts the date words", () => {
    expect(parseDemoGoal("Ich will bis März 10 kg abnehmen", now)).toEqual({ title: "10 kg abnehmen", target_date: "2027-03-31" });
    expect(parseDemoGoal("Ich möchte am 3.12. den Marathon laufen.", now)).toEqual({ title: "Marathon laufen", target_date: "2026-12-03" });
  });
  it("takes 'Mein Ziel' also without a date", () => {
    expect(parseDemoGoal("Mein Ziel: gesünder leben", now)).toEqual({ title: "Gesünder leben", target_date: null });
    expect(parseDemoGoal("Mein Ziel ist es, mehr zu lesen!", now)).toEqual({ title: "Mehr zu lesen", target_date: null });
  });
  it("leaves everyday speech and questions alone", () => {
    expect(parseDemoGoal("Ich will heute früh schlafen", now)).toBeNull();
    expect(parseDemoGoal("Ich möchte morgen laufen gehen", now)).toBeNull();
    expect(parseDemoGoal("Ich will bis März 10 kg abnehmen, geht das?", now)).toBeNull();
    expect(parseDemoGoal("Ich will nicht bis März warten", now)).toBeNull();
    expect(parseDemoGoal("Mir geht es gut, danke", now)).toBeNull();
    expect(parseDemoGoal("Mein Ziel ist das", now)).toBeNull();
  });
  it("leaves 'ich will' appointments to the calendar, but keeps races and exams", () => {
    expect(parseDemoGoal("Ich will am 3.12. um 18:30 ins Training", now)).toBeNull();
    expect(parseDemoGoal("Ich will am 5.12. zum Zahnarzt", now)).toBeNull();
    expect(parseDemoGoal("Ich möchte am Montag um 9 ins Meeting", now)).toBeNull();
    expect(parseDemoGoal("Ich möchte am 4.12. zum Termin beim Coiffeur", now)).toBeNull();
    expect(parseDemoGoal("Ich will am 6.12. den Halbmarathon laufen", now)).toEqual({ title: "Halbmarathon laufen", target_date: "2026-12-06" });
    expect(parseDemoGoal("Ich will am 20.1. die Prüfung bestehen", now)).toEqual({ title: "Prüfung bestehen", target_date: "2027-01-20" });
    // "um 10 kg" is an amount, not a time
    expect(parseDemoGoal("Ich will bis März um 10 kg abnehmen", now)).toEqual({ title: "Um 10 kg abnehmen", target_date: "2027-03-31" });
  });
  it("drops a leading clock time from titles", () => {
    expect(parseDemoGoal("Mein Ziel ist am 6.12. um 9:30 der Halbmarathon", now)).toEqual({ title: "Halbmarathon", target_date: "2026-12-06" });
    expect(parseDemoGoal("Mein Ziel ist am 6.12. um 9 Uhr der Halbmarathon", now)).toEqual({ title: "Halbmarathon", target_date: "2026-12-06" });
  });
});

describe("demo time recognition", () => {
  it("reads amounts in hours and minutes, with a past-tense hint", () => {
    expect(parseDemoMinutes("heute 1,5 Stunden trainiert")).toEqual({ minutes: 90, daysAgo: 0 });
    expect(parseDemoMinutes("45 Minuten gelaufen")).toEqual({ minutes: 45, daysAgo: 0 });
    expect(parseDemoMinutes("2 Std gelernt")).toEqual({ minutes: 120, daysAgo: 0 });
    expect(parseDemoMinutes("Ich war 2h schwimmen")).toEqual({ minutes: 120, daysAgo: 0 });
    expect(parseDemoMinutes("1 Stunde und 30 Min geübt")).toEqual({ minutes: 90, daysAgo: 0 });
    expect(parseDemoMinutes("eine halbe Stunde meditiert")).toEqual({ minutes: 30, daysAgo: 0 });
    expect(parseDemoMinutes("Gestern 3 Stunden gearbeitet")).toEqual({ minutes: 180, daysAgo: 1 });
    expect(parseDemoMinutes("heute Morgen 40 Min gelaufen")).toEqual({ minutes: 40, daysAgo: 0 });
  });
  it("ignores plans, time available, no and nonsense", () => {
    expect(parseDemoMinutes("Ich will heute 2 Stunden lernen")).toBeNull();
    expect(parseDemoMinutes("Morgen 2 Stunden trainieren")).toBeNull();
    expect(parseDemoMinutes("Ich habe heute 2 Stunden Zeit")).toBeNull();
    expect(parseDemoMinutes("Ich habe 10 Stunden pro Woche")).toBeNull();
    expect(parseDemoMinutes("Heute nicht trainiert, 2 Stunden wären gut gewesen")).toBeNull();
    expect(parseDemoMinutes("Ich habe heute trainiert")).toBeNull();
    expect(parseDemoMinutes("30 Stunden gelernt")).toBeNull();
    expect(parseDemoMinutes("Ich hab 2 hab gemacht")).toBeNull();
    expect(parseDemoMinutes("Ich habe um 18 Uhr 1 Stunde Training")).toBeNull();
    expect(parseDemoMinutes("Ich bin in 2 Stunden fertig")).toBeNull();
    expect(parseDemoMinutes("Vor einer Stunde gelaufen")).toBeNull();
    expect(parseDemoMinutes("Um 18h trainiert")).toBeNull();
    expect(parseDemoMinutes("Ich habe 2 Stunden gelernt")).toEqual({ minutes: 120, daysAgo: 0 });
  });
  it("finds the goal by its title words, else the only active goal", () => {
    const goals = [
      { id: "a", title: "Halbmarathon", status: "active" as const },
      { id: "b", title: "Prüfung in Statistik", status: "active" as const },
      { id: "c", title: "Gitarre lernen", status: "paused" as const },
    ];
    expect(recogniseDemoTime("2 Std für die Statistik gelernt", goals)).toMatchObject({ goal: { id: "b" }, minutes: 120 });
    expect(recogniseDemoTime("1,5 Stunden fürs Halbmarathon trainiert", goals)).toMatchObject({ goal: { id: "a" }, minutes: 90 });
    expect(recogniseDemoTime("45 Minuten gelaufen", goals)).toBeNull(); // two active goals, none named
    expect(recogniseDemoTime("1 Stunde Gitarre geübt", goals)).toBeNull(); // paused
    expect(recogniseDemoTime("45 Minuten gelaufen", [goals[0], goals[2]])).toMatchObject({ goal: { id: "a" }, minutes: 45 });
    expect(recogniseDemoTime("45 Minuten gelaufen", [])).toBeNull();
  });
  it("labels minutes as the coach says them", () => {
    expect(minutesLabel(45)).toBe("45 Min");
    expect(minutesLabel(90)).toBe("1.5 Std");
    expect(minutesLabel(120)).toBe("2 Std");
  });
});

describe("demo habit recognition", () => {
  const habits = [
    { id: "a", title: "Laufen", active: true },
    { id: "b", title: "Yoga", active: true },
    { id: "c", title: "Kalt duschen", active: true },
    { id: "d", title: "Meditieren", active: false },
    { id: "e", title: "Fussball", active: true },
  ];
  const ids = (text: string) => recogniseDemoHabits(text, habits).map((h) => h.id);
  it("finds habits done today, as whole words, case-insensitive", () => {
    expect(ids("Ich war heute laufen")).toEqual(["a"]);
    expect(ids("Heute Yoga gemacht und kalt duschen erledigt")).toEqual(["b", "c"]);
    expect(ids("Ich war heute Fußball spielen")).toEqual(["e"]);
  });
  it("ignores inactive habits, parts of words, no and later", () => {
    expect(ids("Ich habe heute meditieren gemacht")).toEqual([]);
    expect(ids("Ich habe Yogamatten gekauft")).toEqual([]);
    expect(ids("Ich war heute nicht laufen")).toEqual([]);
    expect(ids("Ich gehe heute laufen")).toEqual([]);
    expect(ids("Ich will morgen laufen, war heute müde")).toEqual([]);
  });
});

// ---------- the demo backend itself, on an in-memory localStorage ----------

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

describe("demo backend: plan data", () => {
  let b: DemoBackend;
  beforeEach(async () => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
    b = new DemoBackend();
    await b.signUp("demo.plan", "geheim1234");
  });

  it("keeps goals ordered by date (open ones last) with milestones by position", async () => {
    const open = await b.addGoal({ title: "Ruhiger werden" });
    const race = await b.addGoal({ title: "Halbmarathon", target_date: "2026-12-06" }, [
      { title: "10 km am Stück", due_date: "2026-11-22" },
      { title: "Lange Runde 18 km", due_date: null },
    ]);
    expect(race.milestones.map((m) => [m.title, m.position, m.done_at])).toEqual([
      ["10 km am Stück", 0, null],
      ["Lange Runde 18 km", 1, null],
    ]);
    const m3 = await b.addMilestone(race.id, { title: "Ausruhen", due_date: null });
    expect(m3.position).toBe(2);
    await b.updateMilestone(race.milestones[1].id, { position: -1 });
    const done = await b.updateMilestone(race.milestones[0].id, { done: true });
    expect(done.done_at).not.toBeNull();
    expect((await b.updateMilestone(done.id, { done: false })).done_at).toBeNull();

    let goals = await b.listGoals();
    expect(goals.map((g) => g.title)).toEqual(["Halbmarathon", "Ruhiger werden"]);
    expect(goals[0].milestones.map((m) => m.title)).toEqual(["Lange Runde 18 km", "10 km am Stück", "Ausruhen"]);

    const changed = await b.updateGoal(open.id, { status: "done" });
    expect(changed.status).toBe("done");
    goals = await b.listGoals();
    expect(goals.map((g) => g.title)).toEqual(["Halbmarathon"]);
    expect((await b.listGoals(true)).length).toBe(2);

    await b.deleteMilestone(m3.id);
    expect((await b.listGoals())[0].milestones.length).toBe(2);
  });

  it("unlinks habits and calendar entries when their goal is deleted", async () => {
    const g = await b.addGoal({ title: "Halbmarathon" });
    const h = await b.addHabit({ title: "Laufen", per_week: 3, goal_id: g.id });
    const e = await b.addEvent({
      title: "Lange Runde",
      starts_at: new Date(Date.now() + 86400000).toISOString(),
      ends_at: null,
      all_day: false,
      location: null,
      notes: null,
      reminder_minutes: null,
      kind: "block",
      goal_id: g.id,
    });
    await b.deleteGoal(g.id);
    expect((await b.listHabits()).find((x) => x.id === h.id)!.goal_id).toBeNull();
    const ev = (await b.listEvents()).find((x) => x.id === e.id)!;
    expect([ev.goal_id, ev.kind, ev.sequence]).toEqual([null, "block", 1]);
    await expect(b.addHabit({ title: "Dehnen", per_week: 2, goal_id: g.id })).rejects.toThrow();
  });

  it("lists, adds and changes calendar entries in a range", async () => {
    const base = { ends_at: null, all_day: false, location: null, notes: null, reminder_minutes: null };
    const a = await b.addEvent({ ...base, title: "Zahnarzt", starts_at: "2030-01-07T08:00:00.000Z" });
    await b.addEvent({ ...base, title: "Später", starts_at: "2030-01-14T08:00:00.000Z" });
    expect([a.kind, a.goal_id, a.source, a.sequence]).toEqual(["termin", null, "person", 0]);
    const week = await b.listEvents("2030-01-06T23:00:00.000Z", "2030-01-13T23:00:00.000Z");
    expect(week.map((e) => e.title)).toEqual(["Zahnarzt"]);
    const moved = await b.updateEvent(a.id, { starts_at: "2030-01-08T09:00:00.000Z", kind: undefined });
    expect([moved.starts_at, moved.kind, moved.sequence]).toEqual(["2030-01-08T09:00:00.000Z", "termin", 1]);
    expect((await b.listEvents()).length).toBe(2);
  });

  it("ticks habits off per day and shows the last 16 weeks", async () => {
    const h = await b.addHabit({ title: "Laufen", per_week: 3 });
    const today = dayOf();
    const tooOld = addDays(weekStart(today), -15 * 7 - 1);
    await b.setHabitDone(h.id, today, true);
    await b.setHabitDone(h.id, today, true); // twice is fine
    await b.setHabitDone(h.id, addDays(today, -1), true);
    await b.setHabitDone(h.id, tooOld, true);
    let [listed] = await b.listHabits();
    expect(listed.done_days).toEqual([addDays(today, -1), today]);
    await b.setHabitDone(h.id, today, false);
    [listed] = await b.listHabits();
    expect(listed.done_days).toEqual([addDays(today, -1)]);
    // the export keeps the whole history, like the habit_logs table
    const out = await b.exportData();
    expect((out.habit_logs as unknown[]).length).toBe(2);
    expect(out.habits).toEqual([expect.not.objectContaining({ done_days: expect.anything() })]);

    await b.updateHabit(h.id, { active: false });
    expect(await b.listHabits()).toEqual([]);
    await b.deleteHabit(h.id);
    expect((await b.exportData()).habits).toEqual([]);
  });

  it("fills in kind, goal_id, goals and habits for demo users stored earlier", async () => {
    const users = JSON.parse(localStorage.getItem("ich.demo.users")!);
    const u = users["demo.plan"];
    delete u.goals;
    delete u.habits;
    delete u.goal_time;
    u.events = [{ id: "x", title: "Alt", starts_at: new Date(Date.now() + 3600000).toISOString(), ends_at: null, all_day: false, location: null, notes: null, reminder_minutes: null, source: "person" }];
    localStorage.setItem("ich.demo.users", JSON.stringify(users));
    expect(await b.listGoals()).toEqual([]);
    expect(await b.listHabits()).toEqual([]);
    expect((await b.listEvents())[0]).toMatchObject({ kind: "termin", goal_id: null });
    expect(await b.blockAnswers(["x"])).toEqual({});
  });

  it("fills in effort for goals stored before it existed", async () => {
    const g = await b.addGoal({ title: "Halbmarathon" });
    const users = JSON.parse(localStorage.getItem("ich.demo.users")!);
    const stored = users["demo.plan"].goals[0];
    delete stored.effort_hours;
    delete stored.weekly_hours;
    delete stored.prior_hours;
    localStorage.setItem("ich.demo.users", JSON.stringify(users));
    expect((await b.listGoals())[0]).toMatchObject({ id: g.id, effort_hours: null, weekly_hours: null, prior_hours: 0, time: { logged_minutes: 0, block_minutes: 0 } });
  });
});

describe("block time entries", () => {
  const block = { kind: "block" as const, goal_id: "g", starts_at: new Date(2026, 10, 14, 23, 30).toISOString(), ends_at: new Date(2026, 10, 15, 1, 0).toISOString(), all_day: false };
  it("takes the planned length on the block's local start day", () => {
    expect(blockTimeEntry(block, true)).toEqual({ goal_id: "g", day: "2026-11-14", minutes: 90 });
    expect(blockTimeEntry(block, true, 30)).toEqual({ goal_id: "g", day: "2026-11-14", minutes: 30 });
    expect(blockTimeEntry(block, false, 30)).toMatchObject({ minutes: 0 });
    expect(blockTimeEntry(block, true, 5000)).toMatchObject({ minutes: 1440 });
  });
  it("needs a block for a goal, and a length", () => {
    expect(() => blockTimeEntry(null, true)).toThrow("gibt es nicht mehr");
    expect(() => blockTimeEntry({ ...block, kind: "termin" }, true)).toThrow("kein geplanter Block");
    expect(() => blockTimeEntry({ ...block, goal_id: null }, true)).toThrow("kein geplanter Block");
    expect(() => blockTimeEntry({ ...block, ends_at: null }, true)).toThrow("Minuten");
    expect(blockTimeEntry({ ...block, ends_at: null }, true, 40)).toMatchObject({ minutes: 40 });
    expect(blockTimeEntry({ ...block, all_day: true }, false)).toMatchObject({ minutes: 0 });
  });
});

describe("demo backend: effort and time", () => {
  let b: DemoBackend;
  const H = 3600000;
  const entry = (title: string, from: number, to: number | null, extra: Partial<EventInput> = {}): EventInput => ({
    title,
    starts_at: new Date(Date.now() + from).toISOString(),
    ends_at: to === null ? null : new Date(Date.now() + to).toISOString(),
    all_day: false,
    location: null,
    notes: null,
    reminder_minutes: null,
    kind: "block",
    ...extra,
  });
  const timeOf = async (id: string) => (await b.listGoals(true)).find((g) => g.id === id)!.time;
  beforeEach(async () => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
    b = new DemoBackend();
    await b.signUp("demo.effort", "geheim1234");
  });

  it("stores effort hours and checks them like the database", async () => {
    const g = await b.addGoal({ title: "Halbmarathon", effort_hours: 120.04, weekly_hours: 6 });
    expect([g.effort_hours, g.weekly_hours, g.prior_hours, g.time]).toEqual([120, 6, 0, { logged_minutes: 0, block_minutes: 0, provisional_minutes: 0 }]);
    const changed = await b.updateGoal(g.id, { prior_hours: 34, weekly_hours: null });
    expect([changed.effort_hours, changed.weekly_hours, changed.prior_hours]).toEqual([120, null, 34]);
    await expect(b.updateGoal(g.id, { weekly_hours: 200 })).rejects.toThrow("zwischen 0 und 168");
    await expect(b.addGoal({ title: "Olympia", effort_hours: -1 })).rejects.toThrow("Stunden");
    // a whole goal passed as patch doesn't store its time
    await b.updateGoal(g.id, { ...changed, time: { logged_minutes: 999, block_minutes: 0 } } as never);
    expect(await timeOf(g.id)).toEqual({ logged_minutes: 0, block_minutes: 0, provisional_minutes: 0 });
  });

  it("counts past blocks by themselves until they are answered (provisionally: entered after honest counting began)", async () => {
    const g = await b.addGoal({ title: "Halbmarathon" });
    const past = await b.addEvent(entry("Lange Runde", -3 * H, -2 * H, { goal_id: g.id }));
    await b.addEvent(entry("Intervalle", -1.5 * H, -1 * H, { goal_id: g.id }));
    // not counted: future, running, all-day, without end, an appointment, another goal
    await b.addEvent(entry("Später", 2 * H, 3 * H, { goal_id: g.id }));
    await b.addEvent(entry("Läuft gerade", -0.5 * H, 0.5 * H, { goal_id: g.id }));
    await b.addEvent(entry("Ganzer Tag", -48 * H, -24 * H, { goal_id: g.id, all_day: true }));
    await b.addEvent(entry("Ohne Ende", -5 * H, null, { goal_id: g.id }));
    await b.addEvent(entry("Wettkampf", -5 * H, -4 * H, { goal_id: g.id, kind: "termin" }));
    const other = await b.addGoal({ title: "Ruhiger werden" });
    await b.addEvent(entry("Meditation", -5 * H, -4 * H, { goal_id: other.id }));
    expect(await timeOf(g.id)).toEqual({ logged_minutes: 0, block_minutes: 90, provisional_minutes: 90 });

    await b.setBlockDone(past.id, true);
    expect(await timeOf(g.id)).toEqual({ logged_minutes: 60, block_minutes: 30, provisional_minutes: 30 });
    expect(await b.blockAnswers([past.id, "x"])).toEqual({ [past.id]: 60 });
    await b.setBlockDone(past.id, true, 75); // corrected, still one entry
    expect(await timeOf(g.id)).toEqual({ logged_minutes: 75, block_minutes: 30, provisional_minutes: 30 });
    await b.setBlockDone(past.id, false);
    expect(await timeOf(g.id)).toEqual({ logged_minutes: 0, block_minutes: 30, provisional_minutes: 30 });
    expect(await b.blockAnswers([past.id])).toEqual({ [past.id]: 0 });
    await b.setBlockDone(past.id, null);
    expect(await timeOf(g.id)).toEqual({ logged_minutes: 0, block_minutes: 90, provisional_minutes: 90 });
    expect(await b.blockAnswers([past.id])).toEqual({});

    const termin = (await b.listEvents(new Date(Date.now() - 6 * H).toISOString())).find((e) => e.title === "Wettkampf")!;
    await expect(b.setBlockDone(termin.id, true)).rejects.toThrow("kein geplanter Block");
    await expect(b.setBlockDone("gibt-es-nicht", true)).rejects.toThrow("gibt es nicht mehr");
  });

  it("keeps answered time when the block is deleted, drops it with the goal, and exports it", async () => {
    const g = await b.addGoal({ title: "Halbmarathon" });
    const past = await b.addEvent(entry("Lange Runde", -3 * H, -2 * H, { goal_id: g.id }));
    await b.setBlockDone(past.id, true);
    await b.deleteEvent(past.id);
    expect(await timeOf(g.id)).toEqual({ logged_minutes: 60, block_minutes: 0, provisional_minutes: 0 });
    let out = await b.exportData();
    expect(out.goal_time).toEqual([expect.objectContaining({ goal_id: g.id, minutes: 60, source: "block", event_id: null })]);
    expect(out.goals).toEqual([expect.not.objectContaining({ time: expect.anything() })]);
    await b.deleteGoal(g.id);
    out = await b.exportData();
    expect(out.goal_time).toEqual([]);
  });

  it("keeps the first done_at of a milestone", async () => {
    const g = await b.addGoal({ title: "Halbmarathon" }, [{ title: "10 km am Stück", due_date: null }]);
    const first = await b.updateMilestone(g.milestones[0].id, { done: true });
    await new Promise((r) => setTimeout(r, 5));
    const again = await b.updateMilestone(g.milestones[0].id, { done: true, title: "10 km" });
    expect([again.done_at, again.title]).toEqual([first.done_at, "10 km"]);
    expect((await b.updateMilestone(first.id, { done: false })).done_at).toBeNull();
  });

  it("rejects reminders outside a week before to a day after, like the database", async () => {
    const base = entry("Zahnarzt", 24 * H, 25 * H, { kind: "termin" });
    await expect(b.addEvent({ ...base, reminder_minutes: 10081 })).rejects.toThrow("Erinnerung");
    await expect(b.addEvent({ ...base, reminder_minutes: -1441 })).rejects.toThrow("Erinnerung");
    await expect(b.addEvent({ ...base, reminder_minutes: 2.5 })).rejects.toThrow("Erinnerung");
    const ok = await b.addEvent({ ...base, all_day: true, reminder_minutes: -480 });
    await expect(b.updateEvent(ok.id, { reminder_minutes: 20000 })).rejects.toThrow("Erinnerung");
    expect((await b.updateEvent(ok.id, { reminder_minutes: 10080 })).reminder_minutes).toBe(10080);
  });
});

describe("demo coach: goals and habits", () => {
  const ctx: CoachRequest["context"] = {
    day: dayOf(),
    localTime: "",
    timezone: "Europe/Zurich",
    season: "Herbst",
    phase: "Tag",
    hasLocation: false,
  };
  const talk = async (b: DemoBackend, message: string) => {
    const events: CoachEvent[] = [];
    await b.coach({ mode: "checkin", thread: ctx.day, message, context: ctx }, (e) => events.push(e));
    const text = events.flatMap((e) => (e.type === "text" ? [e.text] : [])).join("");
    return { events, text };
  };

  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
  });

  it("saves a goal, links its day in the calendar, and ticks off a habit", async () => {
    const b = new DemoBackend();
    await b.signUp("demo.coach", "geheim1234");
    const habit = await b.addHabit({ title: "Laufen", per_week: 3 });

    const first = await talk(b, "Mein Ziel ist der Halbmarathon am 6. Dezember");
    const saved = first.events.find((e) => e.type === "goal_saved");
    const created = first.events.find((e) => e.type === "event_created");
    expect(saved && saved.type === "goal_saved" && saved.goal.title).toBe("Halbmarathon");
    expect(saved && saved.type === "goal_saved" && [saved.created, saved.goal.effort_hours]).toEqual([true, null]);
    expect(created && created.type === "event_created" && created.event.goal_id).toBe(saved && saved.type === "goal_saved" && saved.goal.id);
    expect(first.text).toContain("ist jetzt dein Ziel");
    expect(first.events.some((e) => e.type === "mood")).toBe(false);
    expect((await b.listGoals()).length).toBe(1);

    const second = await talk(b, "Ich war heute laufen");
    expect(second.events).toContainEqual({ type: "habit_logged", habit_id: habit.id, title: "Laufen", day: ctx.day, done: true });
    expect(second.text).toContain("abgehakt");
    expect(second.events.some((e) => e.type === "focus")).toBe(false);
    expect((await b.listHabits())[0].done_days).toEqual([ctx.day]);
  }, 20000);

  it("puts 'ich will' appointments in the calendar, not in the goals", async () => {
    const b = new DemoBackend();
    await b.signUp("demo.termin", "geheim1234");
    const res = await talk(b, "Ich will am 3.12. um 18:30 ins Training");
    expect(res.events.some((e) => e.type === "goal_saved")).toBe(false);
    const created = res.events.find((e) => e.type === "event_created");
    expect(created && created.type === "event_created" && [created.event.title, new Date(created.event.starts_at).getHours()]).toEqual(["Training", 18]);
    expect(await b.listGoals()).toEqual([]);
  }, 20000);

  it("plans the day from the Plan page without setting a mood or focus", async () => {
    const b = new DemoBackend();
    await b.signUp("demo.tag", "geheim1234");
    let res = await talk(b, "Lass uns meinen Tag planen.");
    expect(res.text).toContain("Was ist heute das Wichtigste, und wann hast du Zeit dafür?");
    expect(res.text).not.toContain("Block");
    expect(res.events.some((e) => e.type === "mood" || e.type === "focus")).toBe(false);
    expect(await b.getDay(ctx.day)).toBeNull();

    await b.addGoal({ title: "Halbmarathon", target_date: addDays(dayOf(), 30) });
    res = await talk(b, "Lass uns meinen Tag planen.");
    expect(res.text).toMatch(/Für „Halbmarathon“ schlage ich einen Block (heute|morgen) um 18 Uhr vor/);
    expect(res.events.some((e) => e.type === "mood" || e.type === "focus")).toBe(false);
    expect(await b.getDay(ctx.day)).toBeNull();
  }, 20000);

  it("logs reported time for the goal", async () => {
    const b = new DemoBackend();
    await b.signUp("demo.zeit", "geheim1234");
    const g = await b.addGoal({ title: "Halbmarathon", effort_hours: 60, prior_hours: 10 });
    const res = await talk(b, "Heute 1,5 Stunden trainiert");
    expect(res.events).toContainEqual({ type: "time_logged", goal_id: g.id, title: "Halbmarathon", minutes: 90 });
    expect(res.text).toContain("Stark, 1.5 Std für „Halbmarathon“.");
    expect(res.text).toContain("Damit hast du 11.5 von ≈ 60 Std geschafft.");
    expect(res.events.some((e) => e.type === "mood" || e.type === "focus" || e.type === "event_created")).toBe(false);
    expect((await b.listGoals())[0].time).toEqual({ logged_minutes: 90, block_minutes: 0, provisional_minutes: 0 });
    expect((await b.exportData()).goal_time).toEqual([expect.objectContaining({ goal_id: g.id, day: ctx.day, minutes: 90, source: "coach", event_id: null })]);
  }, 20000);
});
