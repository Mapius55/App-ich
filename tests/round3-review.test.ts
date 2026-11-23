// Round 3, the review of the whole round: where its stages meet. One report said and ticked in the same turn counts
// once (log_time with log_habit, D1 with D2); a termin for a goal whose trainings come from Nolio is not linked to it
// (one training, one count); a training (a termin with a goal) makes a goal serious for its Plan B like a block.
// The push side (a morning that names what its reminder says within the hour, an answered training's reminder) is in
// tests/push-round3.test.ts and tests/push-dispatch.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countingTermin, dayOf, habitTimeKey, terminCountsTwice, TurnTime } from "../supabase/functions/_shared/plan";
import { irregularWeeks, shiftAskDue } from "../supabase/functions/_shared/series";
import { contextBlock, type ContextGoal, type ContextInput } from "../supabase/functions/coach/prompt";
import { DemoBackend } from "../src/lib/demoBackend";

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

describe("one report said and ticked in the same turn counts once (TurnTime)", () => {
  const goal = "G-IT";
  const day = "2026-11-16";

  it("a tick after the time writes no row of its own; per goal and day", () => {
    const t = new TurnTime();
    expect(t.tickCounts(goal, day)).toBe(true);
    t.noteSaid(goal, day);
    expect(t.tickCounts("g-it", day)).toBe(false);
    expect(t.tickCounts(goal, "2026-11-15")).toBe(true);
    expect(t.tickCounts("g-run", day)).toBe(true);
  });

  it("time after a tick takes the tick's row; an untick of the same turn drops it", () => {
    const t = new TurnTime();
    const key = habitTimeKey("8b0c6b1e-0000-4000-8000-000000000001", day);
    t.noteTick(goal, day, key);
    expect(t.ticksOf("g-it", day)).toEqual([key]);
    expect(t.ticksOf(goal, "2026-11-15")).toEqual([]);
    t.dropTick(key);
    expect(t.ticksOf(goal, day)).toEqual([]);
  });

  it("the demo mirrors it: «20 Minuten Italienisch im Bus gemacht» with the habit of 15 minutes counts 20, not 35", async () => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
    const b = new DemoBackend();
    await b.signUp("demo.italienisch", "geheim1234");
    const g = await b.addGoal({ title: "Italienisch lernen" });
    await b.addHabit({ title: "Italienisch im Bus", per_week: 5, goal_id: g.id, minutes: 15 });
    const today = dayOf();
    const context = { day: today, timezone: "Europe/Zurich" } as never;
    await b.coach({ mode: "checkin", thread: today, message: "Heute 20 Minuten Italienisch im Bus gemacht", context }, () => {});
    const rows = (await b.exportData()).goal_time as { goal_id: string; minutes: number; source: string }[];
    expect(rows.filter((r) => r.goal_id === g.id).map((r) => `${r.source} ${r.minutes}`)).toEqual(["habit 20"]);
    // a tick alone (no time said) counts the habit's length, as before
    const h2 = await b.addHabit({ title: "Vokabeln", per_week: 7, goal_id: g.id, minutes: 10 });
    await b.setHabitDone(h2.id, today, true);
    const again = (await b.exportData()).goal_time as { goal_id: string; minutes: number }[];
    expect(again.filter((r) => r.goal_id === g.id).reduce((n, r) => n + r.minutes, 0)).toBe(30);
  });
});

// the coach's tools run only on Deno: their wiring is checked as text (as in tests/coach-tools.test.ts)
const coach = readFileSync(new URL("../supabase/functions/coach/index.ts", import.meta.url), "utf8");
const handler = (name: string) => {
  const at = coach.indexOf(`case "${name}"`);
  return coach.slice(at, coach.indexOf("\n    case ", at + 10));
};

describe("the coach's tools keep one report to one count", () => {
  it("one TurnTime per turn, handed to every tool", () => {
    expect(coach).toContain("const turn = new TurnTime();");
    expect(coach).toContain("whoop: whoopInContext, turn }");
  });
  it("log_habit: no row of its own after the time said in this turn; its row noted for a log_time after it", () => {
    const habitTime = coach.slice(coach.indexOf("async function habitTime"), coach.indexOf("const CHECKIN_ONLY"));
    expect(habitTime).toContain("if (turn && !turn.tickCounts(goalId, day)) return 0;");
    expect(habitTime).toContain("turn?.noteTick(goalId, day, key)");
    expect(habitTime).toContain("turn?.dropTick(key)");
    expect(handler("log_habit")).toContain("habitTime(sb, userId, habit, logDay, done, ctx.tz, ctx.turn)");
  });
  it("log_time without a block: the tick's row of this turn takes her minutes, else the time is noted for a tick after it", () => {
    const t = handler("log_time");
    expect(t).toContain("ctx.turn?.ticksOf(goalId, logDay)");
    expect(t).toContain('.eq("source", "habit").in("external_id", ticks)');
    expect(t.match(/ctx\.turn\?\.noteSaid\(goalId, logDay\)/g)).toHaveLength(2);
    expect(t).toContain("notiert: TIME_WITH_TICK");
  });
  it("a termin for a goal whose trainings come from Nolio stands without it, single or every week", () => {
    // create_event and update_event share one case
    expect(handler("update_event").match(/await countsTwice\(/g)).toHaveLength(2);
    expect(handler("create_series")).toContain('terminCountsTwice({ kind, ends_at: "end" }, goal?.data)');
    expect(handler("create_series")).toContain('select("status, target_date, sports")');
    expect(handler("update_series")).toContain('seriesKind(s) === "termin" && (await countsTwice(');
    for (const name of ["update_event", "create_series", "update_series"]) expect(handler(name)).toContain("ohne_ziel: NOLIO_TERMIN_NOTE");
    expect(handler("update_event").match(/ohne_ziel: NOLIO_TERMIN_NOTE/g)).toHaveLength(2);
  });
});

describe("a termin for a goal whose trainings come from Nolio is not linked to it (one training, one count)", () => {
  const nolio = { sports: ["spt_run"] };

  it("only a termin that would count (timed, with an end) and only for a goal with its sports chosen", () => {
    const training = { kind: "termin", all_day: false, ends_at: "2026-11-17T18:00:00Z" };
    expect(countingTermin(training)).toBe(true);
    expect(countingTermin({ ...training, kind: undefined })).toBe(true); // the default kind
    expect(terminCountsTwice(training, nolio)).toBe(true);
    expect(terminCountsTwice(training, { sports: [] })).toBe(false);
    expect(terminCountsTwice(training, { sports: null })).toBe(false);
    expect(terminCountsTwice(training, null)).toBe(false);
    // a race day without an end or all-day counts for nothing: it keeps its goal
    expect(terminCountsTwice({ ...training, ends_at: null }, nolio)).toBe(false);
    expect(terminCountsTwice({ ...training, all_day: true }, nolio)).toBe(false);
    // a block is planned time, never a Nolio training
    expect(terminCountsTwice({ ...training, kind: "block" }, nolio)).toBe(false);
  });

  it("the demo's fixed times every week: not linked to such a goal (linked to one without Nolio, as before)", async () => {
    const run = async (name: string, sports: string[] | null) => {
      (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
      const b = new DemoBackend();
      await b.signUp(name, "geheim1234");
      const g = await b.addGoal({ title: "Halbmarathon Zürich", target_date: "2027-04-12" });
      if (sports) await b.updateGoal(g.id, { sports });
      const today = dayOf();
      await b.coach({ mode: "checkin", thread: today, message: "Ich habe jeden Dienstag um 18 Uhr Lauftraining", context: { day: today, timezone: "Europe/Zurich" } as never }, () => {});
      const series = ((await b.exportData()).series ?? []) as { kind: string; goal_id: string | null }[];
      return series.map((x) => `${x.kind} ${x.goal_id === g.id ? "goal" : String(x.goal_id)}`);
    };
    expect(await run("demo.nolio", ["spt_run"])).toEqual(["termin null"]);
    expect(await run("demo.ohne", null)).toEqual(["termin goal"]);
  });
});

describe("a training (a termin with a goal) makes a goal serious for its Plan B, like a block", () => {
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
  const exam: ContextGoal = { id: "g2", title: "Halbmarathon Zürich", why: null, target_date: "2027-04-12", status: "active", weekly_hours: null, milestones: [], plan_b_asked_at: null };
  const goalsOf = (out: string) => out.slice(out.indexOf("## Ziele"), out.indexOf("## Gewohnheiten"));
  const entry = (kind: string, goal_id: string | null) => ({ id: "t1", title: "Training", starts_at: "2026-11-18T17:00:00Z", ends_at: "2026-11-18T18:00:00Z", all_day: false, location: null, kind, goal_id });

  it("asks once with her weekly training for the goal; a termin without a goal does not", () => {
    expect(goalsOf(contextBlock({ ...base, goals: [exam], events: [entry("termin", "g2")] }))).toContain("Plan B: noch keiner → einmal fragen");
    expect(goalsOf(contextBlock({ ...base, goals: [exam], events: [entry("termin", null)] }))).not.toContain("Plan B");
  });
});

describe("fixed shifts every week are no irregular weeks (termin rhythm with the Sunday ask and the rhythm offer)", () => {
  const shift = (day: string, extra: Record<string, unknown> = {}) => ({ title: "Frühdienst", kind: "termin", starts_at: `${day}T05:45:00Z`, ...extra });
  const weekly = ["2026-11-23", "2026-11-24", "2026-11-30", "2026-12-01"].map((d) => shift(d, { series_id: "s1" }));

  it("the days of a weekly rhythm of shifts are no sign; single shifts and a note still are", () => {
    expect(irregularWeeks([], weekly)).toBe(false);
    expect(irregularWeeks([], [shift("2026-11-23"), shift("2026-11-25")])).toBe(true);
    expect(irregularWeeks([{ content: "Arbeitet Schicht im Spital." }], weekly)).toBe(true);
  });

  it("so a block rhythm can still be offered and no Sunday ask comes for shifts that stand every week", () => {
    const due = shiftAskDue({ today: "2026-11-22", irregular: irregularWeeks([], weekly), askedAt: null, weekly: false, entries: weekly, dayOfIso: (s) => s.slice(0, 10) });
    expect(due).toBe(false);
  });
});

describe("the privacy page and the README name what round 3 stores, sends and does on its own", () => {
  const flat = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\s+/g, " ");
  const page = flat("../public/datenschutz.html");
  const readme = flat("../README.md");

  it("the privacy page: what to come back to, the Anstoss marks, habit lengths, reminders and their log", () => {
    expect(page).toContain("notiert er es nach deinem Ja kurz in deinen Worten beim Tag, an dem du es gesagt hast");
    expect(page).toContain("Dazu der eine Anstoss, den er dir höchstens am Tag gibt (an welchem Tag und welche Art)");
    expect(page).toContain("ob er am Sonntag nach deinen Diensten der nächsten Woche gefragt hat");
    expect(page).toContain("Gewohnheiten (mit ihrer Dauer, wenn du eine nennst: dann zählt jeder Haken so viel für das Ziel)");
    expect(page).toContain("schaut der Server alle 15 Minuten, ob bald einer deiner Blöcke beginnt");
    expect(page).toContain("an welchen Eintrag eine Erinnerung ging (nur seine Kennnummer)");
    expect(page).toContain("worauf er auf deinen Wunsch zurückkommen soll");
    expect(page).not.toMatch(/ß/);
  });

  it("the README: messages only with her own content, the reminders and their schedule", () => {
    expect(readme).toContain("und nur, wenn es etwas aus deinem Tag gibt");
    expect(readme).toContain("**Erinnerungen an Einträge** (Du → Benachrichtigungen)");
    expect(readme).toContain("alle 15 Minuten der Versand der Morgen- und Abendnachricht und der Erinnerungen");
    expect(readme).not.toMatch(/ß/);
  });
});
