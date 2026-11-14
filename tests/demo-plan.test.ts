import { beforeEach, describe, expect, it } from "vitest";
import { DemoBackend, parseDemoDate, parseDemoEvent, parseDemoGoal, recogniseDemoHabits } from "../src/lib/demoBackend";
import { addDays, dayOf, weekStart } from "../src/lib/plan";
import type { CoachEvent, CoachRequest } from "../src/lib/types";

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
    u.events = [{ id: "x", title: "Alt", starts_at: new Date(Date.now() + 3600000).toISOString(), ends_at: null, all_day: false, location: null, notes: null, reminder_minutes: null, source: "person" }];
    localStorage.setItem("ich.demo.users", JSON.stringify(users));
    expect(await b.listGoals()).toEqual([]);
    expect(await b.listHabits()).toEqual([]);
    expect((await b.listEvents())[0]).toMatchObject({ kind: "termin", goal_id: null });
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
});
