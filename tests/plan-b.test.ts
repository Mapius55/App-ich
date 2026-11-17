// Round 2, owner decisions 2 and 4: the quiet «Heute: …» line on Jetzt (only confirmed acts), and Plan B once per
// serious goal (asked once, stored in her words, a quiet reminder after a «Nein» and in the Wochenblick).
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { minutesText, OBSTACLE_MAX, PLAN_B_MAX, planBDue, seriousGoal, todayWins, todayWinsLine } from "../src/lib/plan";
import { contextBlock, MODE_CHECKIN, type ContextGoal, type ContextInput } from "../supabase/functions/coach/prompt";
import { BLOCK_NO_NEXT, blockNoNext } from "../supabase/functions/coach/rules";
import { DemoBackend } from "../src/lib/demoBackend";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const zurich = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(iso));

describe("Jetzt: what she did today, one quiet line", () => {
  const goals = [
    { id: "g1", title: "Halbmarathon Zürich", milestones: [{ title: "Laufschuhe kaufen", done_at: "2026-11-16T10:00:00Z" }, { title: "15 km", done_at: null }] },
    { id: "g2", title: "Italienisch", milestones: [{ title: "Lektion 3", done_at: "2026-11-15T22:30:00Z" }] }, // 23:30 in Zurich: yesterday
  ];
  const habits = [
    { title: "Dehnen", done_days: ["2026-11-15", "2026-11-16"] },
    { title: "Meditieren", done_days: ["2026-11-15"] },
  ];

  it("names confirmed time, steps done and habits ticked today, nothing else", () => {
    const wins = todayWins(goals, habits, [{ goal_id: "g1", minutes: 25 }, { goal_id: "g1", minutes: 15 }, { goal_id: "g2", minutes: 0 }], "2026-11-16", zurich);
    expect(todayWinsLine(wins)).toBe("Heute: 40 Min für Halbmarathon Zürich · Laufschuhe kaufen · Dehnen");
  });

  it("never «0», never what is missing: no line without something done", () => {
    expect(todayWinsLine(todayWins(goals, [{ title: "Dehnen", done_days: [] }], [{ goal_id: "g2", minutes: 0 }], "2026-11-17", zurich))).toBeNull();
    expect(todayWinsLine([])).toBeNull();
    // a «Nein» (0 minutes) is data, not a win
    expect(todayWinsLine(todayWins(goals, [], [{ goal_id: "g1", minutes: 0 }], "2026-11-20", zurich))).toBeNull();
  });

  it("says time as it is said", () => {
    expect(minutesText(45)).toBe("45 Min");
    expect(minutesText(60)).toBe("1 Std");
    expect(minutesText(75)).toBe("1 Std 15 Min");
    expect(todayWinsLine([{ kind: "zeit", title: "Japanisch", minutes: 90 }])).toBe("Heute: 1 Std 30 Min für Japanisch");
  });

  it("reads goal time of today and the plan data; reloads when entries or the plan change; not during the tour", () => {
    const now = read("../src/space/NowLevel.tsx");
    expect(now).toContain(".listGoalTime(today, today)");
    expect(now).toContain("}, [today, eventsVersion, planVersion]);");
    expect(now).toContain("return todayWinsLine(todayWins(goals, habits, rows, today, (iso) => dayOf(new Date(iso))));");
    expect(now).toContain('{wins && !tourHere && <p className="now-win">{wins}</p>}');
    // under the circle's slot, over the door
    expect(now.indexOf('className="now-orb"')).toBeLessThan(now.indexOf('className="now-win"'));
    expect(now.indexOf('className="now-win"')).toBeLessThan(now.indexOf('className="now-door"'));
  });

  it("is one line in the flow, and gives way with the door when the voice stack rises", () => {
    const css = read("../src/space/space.css");
    const rule = css.slice(css.indexOf(".space .now-win {"), css.indexOf(".space .now-door {"));
    for (const p of ["flex: none;", "white-space: nowrap;", "text-overflow: ellipsis;", "color: var(--text-soft);"]) expect(rule).toContain(p);
    expect(rule).not.toContain("position: absolute");
    expect(css).toContain("html[data-typed] .space :is(.now-door, .now-win),");
    expect(css).toContain(".voice-status-text:not(.idle-hint) ~ .voice-replay)) .space :is(.now-door, .now-win) {");
  });
});

describe("Plan B: when a goal is serious", () => {
  const today = "2026-11-16";
  const goal = { kind: "goal", status: "active", target_date: "2027-04-12", weekly_hours: 4 as number | null };

  it("an active goal with a date ahead and hours per week or blocks", () => {
    expect(seriousGoal(goal, false, today)).toBe(true);
    expect(seriousGoal({ ...goal, weekly_hours: null }, true, today)).toBe(true);
    expect(seriousGoal({ ...goal, weekly_hours: null }, false, today)).toBe(false);
    expect(seriousGoal({ ...goal, target_date: null }, true, today)).toBe(false);
    expect(seriousGoal({ ...goal, target_date: today }, true, today)).toBe(false); // the day itself: too late to ask
    expect(seriousGoal({ ...goal, target_date: "2026-11-01" }, true, today)).toBe(false);
    expect(seriousGoal({ ...goal, status: "paused" }, true, today)).toBe(false);
    expect(seriousGoal({ ...goal, kind: "dream" }, true, today)).toBe(false);
  });

  it("asks once: never asked, and no Plan B or obstacle yet; unknown means never", () => {
    expect(planBDue({ ...goal, plan_b_asked_at: null }, false, today)).toBe(true);
    expect(planBDue({ ...goal, plan_b_asked_at: "2026-11-10T08:00:00Z" }, false, today)).toBe(false);
    expect(planBDue({ ...goal, plan_b_asked_at: undefined }, false, today)).toBe(false);
    expect(planBDue({ ...goal }, false, today)).toBe(false);
    expect(planBDue({ ...goal, plan_b_asked_at: null, plan_b: "Wenn es regnet, laufe ich auf dem Laufband." }, false, today)).toBe(false);
    expect(planBDue({ ...goal, plan_b_asked_at: null, obstacle: "Regen" }, false, today)).toBe(false);
    expect(planBDue({ ...goal, plan_b_asked_at: null, weekly_hours: null }, false, today)).toBe(false);
  });
});

describe("Plan B in the coach's context", () => {
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
  const race: ContextGoal = { id: "g1", title: "Halbmarathon Zürich", why: null, target_date: "2027-04-12", status: "active", weekly_hours: 4, milestones: [], plan_b_asked_at: null };
  const exam: ContextGoal = { id: "g2", title: "Prüfung Statistik", why: null, target_date: "2027-01-20", status: "active", weekly_hours: null, milestones: [], plan_b_asked_at: null };
  const block = { id: "b1", title: "Lernen", starts_at: "2026-11-18T17:00:00Z", ends_at: "2026-11-18T18:00:00Z", all_day: false, location: null, kind: "block", goal_id: "g2" };
  const goalsOf = (out: string) => out.slice(out.indexOf("## Ziele"), out.indexOf("## Gewohnheiten"));
  const ctx = (c: Partial<ContextInput>) => goalsOf(contextBlock({ ...base, ...c }));
  const ASK = "Plan B: noch keiner → einmal fragen";

  it("asks for one serious goal at a time, the nearest first", () => {
    const out = ctx({ goals: [exam, race], events: [block] });
    expect(out.match(/einmal fragen/g)).toHaveLength(1);
    expect(out.slice(out.indexOf("[g2]"), out.indexOf("[g1]"))).toContain(ASK);
    // without its block the exam is not serious yet: the race is asked about
    const race2 = ctx({ goals: [exam, race] });
    expect(race2.slice(race2.indexOf("[g1]"))).toContain(ASK);
    expect(race2.slice(race2.indexOf("[g2]"), race2.indexOf("[g1]"))).not.toContain("Plan B");
  });

  it("shows her Plan B in her words (with the obstacle), and then never asks", () => {
    const out = ctx({ goals: [{ ...race, plan_b: "Wenn es regnet, laufe ich auf dem Laufband.", obstacle: "Regen", plan_b_asked_at: "2026-11-10T08:00:00Z" }] });
    expect(out).toContain("\n  Plan B: „Wenn es regnet, laufe ich auf dem Laufband.“ (Hindernis: Regen)");
    expect(out).not.toContain("einmal fragen");
    expect(ctx({ goals: [{ ...race, obstacle: "Spätschicht", plan_b_asked_at: "2026-11-10T08:00:00Z" }] })).toContain("Hindernis: Spätschicht · noch kein Plan B");
    // asked once, nothing came of it: no line, no second question
    expect(ctx({ goals: [{ ...race, plan_b_asked_at: "2026-11-10T08:00:00Z" }] })).not.toContain("Plan B");
  });

  it("one Plan B question a day: once asked for a goal today, the next serious goal waits for another day", () => {
    const asked = { ...exam, plan_b_asked_at: "2026-11-16T07:40:00Z" };
    // the exam was asked this morning (nothing came of it yet): the race is not asked today
    expect(ctx({ goals: [asked, race], events: [block] })).not.toContain(ASK);
    // asked yesterday: today the race may be asked
    const yesterday = ctx({ goals: [{ ...exam, plan_b_asked_at: "2026-11-15T09:00:00Z" }, race], events: [block] });
    expect(yesterday.slice(yesterday.indexOf("[g1]"))).toContain(ASK);
    // her local day decides: 23:30 UTC on the 15th is 00:30 on the 16th in Zurich (today)
    expect(ctx({ goals: [{ ...exam, plan_b_asked_at: "2026-11-15T23:30:00Z" }, race], events: [block] })).not.toContain(ASK);
    // her own Plan B written today (the trigger notes it as asked): no new question today either, hers shows
    const own = ctx({ goals: [{ ...exam, plan_b: "Wenn ich müde bin, lerne ich nur 20 Minuten.", plan_b_asked_at: "2026-11-16T07:40:00Z" }, race], events: [block] });
    expect(own).toContain("Plan B: „Wenn ich müde bin, lerne ich nur 20 Minuten.“");
    expect(own).not.toContain(ASK);
  });

  it("never after a pause, in a heavy time, unknown, or for a dream", () => {
    expect(ctx({ goals: [race], lastSeen: "2026-11-01" })).not.toContain(ASK);
    expect(ctx({ goals: [race], today: { mood: { word: "schwer", valence: -0.7, energy: 0.2 }, focus: null } })).not.toContain(ASK);
    expect(ctx({ goals: [{ ...race, plan_b_asked_at: undefined }] })).not.toContain("Plan B");
    const dream: ContextGoal = { ...race, id: "d1", kind: "dream", title: "Marathon in New York" };
    expect(contextBlock({ ...base, goals: [dream] })).not.toContain("Plan B");
    // her own plan still shows after a pause (it is data, not a question)
    expect(ctx({ goals: [{ ...race, plan_b: "Wenn ich müde bin, laufe ich nur 15 Minuten.", plan_b_asked_at: "2026-11-01T08:00:00Z" }], lastSeen: "2026-11-01" })).toContain(
      "Plan B: „Wenn ich müde bin, laufe ich nur 15 Minuten.“",
    );
  });

  it("puts her Plan B into the Wochenblick's obstacle step", () => {
    const review = { due: "anbieten" as const, monday: "2026-11-09", goals: [{ goal_id: "g1", planned_minutes: 180, blocks: 3, done_minutes: 60, open_minutes: 0, counted_minutes: 60 }] };
    const out = contextBlock({ ...base, goals: [{ ...race, plan_b: "Wenn es regnet, laufe ich auf dem Laufband.", plan_b_asked_at: "2026-11-10T08:00:00Z" }], review });
    const wb = out.slice(out.indexOf("## Wochenblick"));
    expect(wb).toContain("sie plant 4 Std/Woche · Plan B „Wenn es regnet, laufe ich auf dem Laufband.“");
    // while the Wochenblick waits, no Plan B question on top of its five short turns (another day)
    expect(goalsOf(contextBlock({ ...base, goals: [race], review }))).not.toContain(ASK);
    expect(goalsOf(contextBlock({ ...base, goals: [race], review: { ...review, due: "fragen" as const } }))).not.toContain(ASK);
    expect(goalsOf(contextBlock({ ...base, goals: [race] }))).toContain(ASK);
  });

  it("the rule: once, while planning, as a setup question; a reminder only after a «Nein» and in the Wochenblick, never a reproach", () => {
    expect(MODE_CHECKIN).toContain(
      "- Plan B: Steht bei einem Ziel „Plan B: noch keiner → einmal fragen“, fragst du, am liebsten beim Planen: „Was könnte dir dazwischenkommen?“, und rufst note_offer mit plan_b und der goal_id auf.",
    );
    expect(MODE_CHECKIN).toContain(
      "Hat ein Ziel einen Plan B, erinnerst du leise daran, wenn sie zu einem seiner vergangenen Blöcke Nein sagt (nicht, wenn sie einen Vorschlag ablehnt), und beim Wochenblick, statt nach dem Grund zu fragen, nie als Vorwurf; sonst nicht.",
    );
    expect(MODE_CHECKIN).toContain("und die nach einem Plan B sind Einrichtungsfragen: Pro Gespräch stellst du höchstens eine von allen.");
    expect(MODE_CHECKIN).not.toContain("ß");
    expect(MODE_CHECKIN).not.toMatch(/verpasst/i);
  });

  it("after a «Nein»: her Plan B instead of the question, as an offer for next time", () => {
    const plan = blockNoNext("Wenn es regnet,\n laufe ich auf dem Laufband.");
    expect(plan).toContain("Danke ihr, dass sie es sagt.");
    expect(plan).toContain("ihren Plan B („Wenn es regnet, laufe ich auf dem Laufband.“), als Angebot fürs nächste Mal, nie als Vorwurf");
    expect(plan).toContain("Zähl nie auf, was sonst nicht geklappt hat.");
    expect(plan).not.toMatch(/verpasst|ß/i);
    expect(blockNoNext(null)).toBe(BLOCK_NO_NEXT);
    expect(blockNoNext("  ")).toBe(BLOCK_NO_NEXT);
    expect(blockNoNext(undefined)).toBe(BLOCK_NO_NEXT);
  });
});

describe("Plan B: the coach's tools", () => {
  const source = read("../supabase/functions/coach/index.ts");
  const tools = source.slice(source.indexOf("const TOOLS"), source.indexOf("class ToolInputError"));
  const tool = (name: string) => {
    const at = tools.indexOf(`name: "${name}"`);
    const next = tools.indexOf("\n  {\n    name:", at + 1);
    return tools.slice(at, next < 0 ? undefined : next);
  };

  it("update_goal stores the obstacle and the plan in her words, in the first person, after her yes", () => {
    expect(tool("update_goal")).toContain("obstacle: {");
    expect(tool("update_goal")).toContain("Ihr Plan B: ein Wenn-dann-Satz in ihren Worten, in der Ich-Form");
    expect(tool("update_goal")).toContain("Erst nach ihrem Ja; sie sieht ihn im Ziel. Leer entfernt ihn.");
    expect(tool("create_goal")).not.toContain("plan_b");
    expect(source).toContain('const planB = optText(input.plan_b, PLAN_B_MAX, "plan_b");');
    expect(source).toContain('const obstacle = optText(input.obstacle, OBSTACLE_MAX, "obstacle");');
  });

  it("note_offer notes the question once per goal (the server's clock)", () => {
    expect(tool("note_offer")).toContain("plan_b (du hast gefragt, was ihr bei einem Ziel dazwischenkommen könnte; mit goal_id, einmal pro Ziel)");
    expect(source).toContain('.update({ plan_b_asked_at: new Date().toISOString() }).eq("id", goalId).select("id")');
  });

  it("reads the Plan B for the daily context on its own (a missing column never breaks the rest)", () => {
    expect(source).toContain('sb.from("goals").select("id, obstacle, plan_b, plan_b_asked_at").not("plan_b_asked_at", "is", null).limit(200),');
    expect(source).toContain("...planBOf(dailyCtx?.planB, goal.id),");
    expect(source).toContain("if (!rows) return { plan_b_asked_at: undefined };");
  });
});

describe("Plan B: the migration", () => {
  const sql = read("../supabase/migrations/20261123000000_plan_b.sql");
  it("adds the columns with limits like PLAN_B_MAX and OBSTACLE_MAX, idempotent", () => {
    expect(PLAN_B_MAX).toBe(200);
    expect(OBSTACLE_MAX).toBe(160);
    expect(sql).toContain("add column if not exists obstacle text,");
    expect(sql).toContain("add column if not exists plan_b text,");
    expect(sql).toContain("add column if not exists plan_b_asked_at timestamptz;");
    expect(sql).toContain("check (plan_b is null or length(btrim(plan_b)) between 1 and 200)");
    expect(sql).toContain("check (obstacle is null or length(btrim(obstacle)) between 1 and 160)");
    expect(sql).toContain("drop trigger if exists goals_plan_b_asked on public.goals;");
  });
  it("a stored plan marks the question; noting the question keeps updated_at; search_path pinned", () => {
    expect(sql).toContain("if new.plan_b_asked_at is null and (new.plan_b is not null or new.obstacle is not null) then");
    expect(sql).toContain("array['reminded_at', 'nudge_after', 'pattern_asked_at', 'plan_b_asked_at', 'updated_at']");
    expect(sql.match(/language plpgsql set search_path = ''/g)).toHaveLength(2);
  });
});

describe("Plan B: the goal's detail and the backends", () => {
  it("the detail shows an editable «Plan B» for goals (a dream only when it has one), sent only when changed", () => {
    const form = read("../src/components/plan/GoalSheet.tsx");
    expect(form).toContain("<span>Plan B (optional)</span>");
    expect(form).toContain('placeholder="Wenn …, dann …"');
    expect(form).toContain("maxLength={PLAN_B_MAX}");
    // a dream: only with a Plan B; once shown it stays while she empties it (never pulled away under her fingers)
    expect(form).toContain("const [planBShown, setPlanBShown] = useState(() => !!goal?.plan_b?.trim());");
    expect(form).toContain("{(!isDream || planBShown) && (");
    expect(form).toContain("if (e.target.value.trim()) setPlanBShown(true);");
    expect(form).not.toContain('planB.trim() !== "") && (');
    expect(form).toContain("const planPatch = plan !== (goal?.plan_b?.trim() || null) ? { plan_b: plan, ...(goal ? { obstacle: null } : {}) } : {};");
  });

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
    await b.signUp("demo.planb", "geheim1234");
  });

  it("the demo mirrors the trigger and the checks", async () => {
    const g = await b.addGoal({ title: "Halbmarathon", target_date: "2027-04-12", weekly_hours: 4 });
    expect(g.plan_b).toBeNull();
    expect(g.plan_b_asked_at).toBeNull();
    const withPlan = await b.updateGoal(g.id, { plan_b: "Wenn es regnet, laufe ich auf dem Laufband.", obstacle: "Regen" });
    expect(withPlan.plan_b).toBe("Wenn es regnet, laufe ich auf dem Laufband.");
    expect(withPlan.obstacle).toBe("Regen");
    expect(withPlan.plan_b_asked_at).toBeTruthy();
    // cleared: none, but it stays asked (the coach never asks again)
    const cleared = await b.updateGoal(g.id, { plan_b: "  ", obstacle: null });
    expect(cleared.plan_b).toBeNull();
    expect(cleared.obstacle).toBeNull();
    expect(cleared.plan_b_asked_at).toBe(withPlan.plan_b_asked_at);
    // too long: refused, nothing stored
    await expect(b.updateGoal(g.id, { plan_b: "x".repeat(201) })).rejects.toThrow("höchstens 200 Zeichen");
    await expect(b.updateGoal(g.id, { obstacle: "x".repeat(161) })).rejects.toThrow("höchstens 160 Zeichen");
    expect((await b.listGoals()).find((x) => x.id === g.id)?.plan_b).toBeNull();
    // her own Plan B in a new goal
    const own = await b.addGoal({ title: "Prüfung", plan_b: "Wenn ich müde bin, lerne ich nur 20 Minuten." });
    expect(own.plan_b_asked_at).toBeTruthy();
    // in the export
    const data = (await b.exportData()) as { goals: { plan_b?: string | null }[] };
    expect(data.goals.some((x) => x.plan_b === "Wenn ich müde bin, lerne ich nur 20 Minuten.")).toBe(true);
  });

  it("the Supabase backend stores an emptied Plan B as none and reads the columns", () => {
    const sb = read("../src/lib/supabaseBackend.ts");
    expect(sb).toContain('if (typeof g.plan_b === "string" && !g.plan_b.trim()) out = { ...out, plan_b: null };');
    expect(sb).toContain("plan_b: row.plan_b ?? null,");
    expect(sb).toContain("plan_b_asked_at: row.plan_b_asked_at ?? null,");
  });

  it("the privacy page names it", () => {
    const page = read("../public/datenschutz.html");
    expect(page).toContain("Ziele mit ihrem Plan B");
    expect(page).toContain("ob er für ein Ziel schon nach einem Plan B gefragt hat");
  });
});
