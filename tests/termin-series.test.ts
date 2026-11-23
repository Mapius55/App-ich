// Round 3, owner decision 4 «Feste Zeiten — jede Woche, zählt vorläufig» (NEXT.md #6): her fixed times every week are a
// weekly termin rhythm (series.kind), «immer», «jeden Donnerstag», «jede Woche» without asking back, only «diese Woche»
// single entries; a termin rhythm has no reminder unless she asked and is hers whatever a goal does; a past termin
// with a goal (a training) counts like a block (provisional for 7 days, «Nein» = 0) and gets Ja · Teilweise · Nein;
// for shift work the coach asks on Sunday for next week's shifts, after her first yes every Sunday (Anstoss «dienste»).
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { DemoBackend, parseDemoRhythm } from "../src/lib/demoBackend";
import {
  addDays,
  countsLikeBlock,
  dailyNudge,
  dayMinutes,
  dayOf,
  goalDayMinutes,
  habitTimeRow,
  liveRhythms,
  openWeekBlocks,
  PROVISIONAL_DAYS,
  restsWithGoal,
  sameRhythm,
  seriesDays,
  seriesEndDay,
  seriesKeepsDay,
  seriesKind,
  shiftAskDue,
  unansweredCredit,
  weekGoalSummary,
  type DailyNudgeInput,
  type SeriesRule,
} from "../src/lib/plan";
import type { CalendarEvent, CoachEvent, CoachRequest } from "../src/lib/types";
import { plannedMinutes, weekTrack } from "../src/time/layout";
import { pastBlockMinutes } from "../src/time/useRangeEvents";
import { contextBlock, PERSONA, MODE_CHECKIN, MODE_ONBOARDING, todayNudge, type ContextEvent, type ContextGoal, type ContextInput } from "../supabase/functions/coach/prompt";
import { greetingWriteRefusal, offerNudgeKind, SHIFTS_ASKED_NOTE, SHIFTS_STOP_NOTE, SHIFTS_WEEKLY_NOTE } from "../supabase/functions/coach/rules";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const source = read("../supabase/functions/coach/index.ts");
const tools = source.slice(source.indexOf("const TOOLS"), source.indexOf("class ToolInputError"));
const tool = (name: string) => {
  const at = tools.indexOf(`name: "${name}"`);
  const next = tools.indexOf("\n  {\n    name:", at + 1);
  return tools.slice(at, next < 0 ? undefined : next);
};
const migration = read("../supabase/migrations/20261126000500_termin_series.sql");
const section = (out: string, heading: string) => {
  const at = out.indexOf(`## ${heading}`);
  if (at < 0) return "";
  const next = out.indexOf("\n## ", at + 3);
  return out.slice(at, next < 0 ? undefined : next);
};
const H = 3600000;
const DAY = 86400000;
const zurich = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(iso));

// ---------- counting: a termin with a goal like a block ----------

describe("a past termin with a goal counts like a block (provisional for a week, «Nein» = 0)", () => {
  const now = new Date("2026-11-23T12:00:00Z");
  const from = "2026-11-01T00:00:00Z"; // honest counting began
  const ev = (id: string, o: Partial<CalendarEvent> = {}) => ({
    id,
    starts_at: new Date(now.getTime() - 50 * H).toISOString(),
    ends_at: new Date(now.getTime() - 48.5 * H).toISOString(),
    all_day: false,
    kind: "termin",
    goal_id: "g1",
    source: "coach",
    created_at: "2026-11-15T08:00:00Z",
    ...o,
  });

  it("countsLikeBlock: a block, a termin with a goal; never a termin without one", () => {
    expect(countsLikeBlock({ kind: "block", goal_id: null })).toBe(true);
    expect(countsLikeBlock({ kind: undefined })).toBe(true); // older rows
    expect(countsLikeBlock({ kind: "termin", goal_id: "g1" })).toBe(true);
    expect(countsLikeBlock({ kind: "termin", goal_id: null })).toBe(false);
  });

  it("unansweredCredit: a termin is only ever provisional (it never counted before, so none is kept)", () => {
    const old = { ends_at: "2026-10-01T10:00:00Z", created_at: "2026-09-30T10:00:00Z" };
    expect(unansweredCredit({ ...old, kind: "block" }, now.getTime(), from)).toBe("kept");
    expect(unansweredCredit({ ...old, kind: "termin" }, now.getTime(), from)).toBeNull();
    expect(unansweredCredit({ ...old, kind: "termin" }, now.getTime(), null)).toBeNull();
    const recent = { ends_at: new Date(now.getTime() - 2 * DAY).toISOString(), kind: "termin" };
    expect(unansweredCredit(recent, now.getTime(), from)).toBe("provisional");
    expect(unansweredCredit({ ...recent, ends_at: new Date(now.getTime() - (PROVISIONAL_DAYS + 1) * DAY).toISOString() }, now.getTime(), from)).toBeNull();
  });

  it("goalDayMinutes and dayMinutes: the training counts provisionally; without a goal, all-day, Nolio or answered never", () => {
    const blocks = [
      ev("training"),
      ev("kino", { goal_id: null }),
      ev("race", { all_day: true }),
      ev("nolio", { source: "nolio" }),
      ev("answered"),
      ev("old", { starts_at: "2026-10-01T08:00:00Z", ends_at: "2026-10-01T09:30:00Z", created_at: "2026-09-30T08:00:00Z" }),
    ];
    const m = goalDayMinutes([], blocks, new Set(["answered"]), now, zurich, from);
    const d = zurich(blocks[0].starts_at);
    expect(m.total).toEqual({ [d]: 90 });
    expect(m.provisional).toEqual({ [d]: 90 });
    expect(dayMinutes([], blocks, new Set(["answered"]), now, zurich, from)).toEqual({ [d]: 90 });
    // her «Nein» (an answer of 0 minutes) is in the log: the termin counts 0
    expect(dayMinutes([{ day: d, minutes: 0 }], blocks, new Set(["training", "answered"]), now, zurich, from)).toEqual({});
  });

  it("weekGoalSummary and openWeekBlocks: planned, open and counted with the training; asked about one by one", () => {
    const monday = "2026-11-16";
    const rows = [
      { ...ev("training"), answered: false },
      { ...ev("block", { kind: "block", starts_at: "2026-11-17T17:00:00Z", ends_at: "2026-11-17T18:00:00Z" }), answered: false },
      { ...ev("kino", { goal_id: null }), answered: false },
    ];
    const [s] = weekGoalSummary(["g1"], rows, [], monday, now, zurich, "2026-11-01T00:00:00Z");
    expect(s).toMatchObject({ planned_minutes: 150, blocks: 2, open_minutes: 150, counted_minutes: 150, done_minutes: 0 });
    expect(openWeekBlocks(rows, ["g1"], monday, now, zurich).map((b) => b.id)).toEqual(["block", "training"]);
  });

  it("a habit tick that is the training answers it (counted once); a termin without an end counts for nothing, so never", () => {
    const habit = { id: "11111111-1111-4111-8111-111111111111", title: "Training", goal_id: "g1", minutes: 90 };
    const training = { id: "t1", title: "Training Halle", goal_id: "g1", starts_at: "2026-11-21T17:00:00Z", ends_at: "2026-11-21T18:30:00Z", all_day: false, kind: "termin", source: "coach", answered: false };
    // ticked after the training
    const now = Date.parse("2026-11-21T19:00:00Z");
    expect(habitTimeRow(habit, "2026-11-21", { blocks: [training], times: [], dayOfIso: zurich, now })?.event_id).toBe("t1");
    // without its end (or the end not fetched) the tick is her own time, never the termin's answer: an answer of an
    // entry without an end goes with its next change (sync_block_answer), and the tick's minutes would go with it
    for (const ends_at of [null, undefined]) {
      const row = habitTimeRow(habit, "2026-11-21", { blocks: [{ ...training, ends_at }], times: [], dayOfIso: zurich, now });
      expect(row).toMatchObject({ event_id: null, minutes: 90, source: "habit" });
    }
    // a block as before (with or without an end)
    expect(habitTimeRow(habit, "2026-11-21", { blocks: [{ ...training, kind: "block", ends_at: undefined }], times: [], dayOfIso: zurich, now })?.event_id).toBe("t1");
    // both backends fetch the end with the entries
    expect(source).toContain('.select("id, title, goal_id, starts_at, ends_at, all_day, kind, source, goal_time(id)")');
    expect(read("../src/lib/supabaseBackend.ts")).toContain('.select("id, title, goal_id, starts_at, ends_at, all_day, kind, source, goal_time(id)")');
  });

  it("the Tag answer row (Ja · Teilweise · Nein) appears for it; Woche draws and plans it as goal time", () => {
    const e: CalendarEvent = {
      id: "t1",
      title: "Training",
      starts_at: new Date(now.getTime() - 3 * H).toISOString(),
      ends_at: new Date(now.getTime() - 1.5 * H).toISOString(),
      all_day: false,
      location: null,
      notes: null,
      reminder_minutes: null,
      source: "coach",
      kind: "termin",
      goal_id: "g1",
    };
    expect(pastBlockMinutes(e, now.getTime())).toBe(90);
    expect(pastBlockMinutes({ ...e, goal_id: null }, now.getTime())).toBeNull();
    expect(pastBlockMinutes({ ...e, all_day: true }, now.getTime())).toBeNull();
    const day = read("../src/time/DayLevel.tsx");
    expect(day).toContain("const planned = goal && !nolio ? pastBlockMinutes(e, now) : null;");
    expect(day).toContain("{planned !== null && goal && <BlockAnswer");
    const later = { ...e, starts_at: new Date(now.getTime() + H).toISOString(), ends_at: new Date(now.getTime() + 2 * H).toISOString() };
    expect(plannedMinutes([later], now)).toBe(60);
    expect(plannedMinutes([{ ...later, goal_id: null }], now)).toBe(0);
    expect(weekTrack([later], dayOf(new Date(later.starts_at)), { from: 0, to: 1440 })[0].goal).toBe(true);
  });

  it("the views and the backends count it the same way", () => {
    for (const f of ["../src/components/plan/YearView.tsx", "../src/time/useYearData.ts", "../src/time/WeekLevel.tsx"]) expect(read(f)).toContain("countsLikeBlock(e) && e.goal_id");
    expect(read("../src/lib/demoBackend.ts")).toContain('if (e.goal_id !== g.id || !countsLikeBlock(e) || e.source === "nolio" || e.all_day || !e.ends_at || answered.has(e.id)) continue;');
    expect(read("../src/lib/demoBackend.ts")).toContain('if (!countsLikeBlock(ev) || !ev.goal_id) throw new Error("Das ist kein geplanter Block für ein Ziel.");');
    expect(read("../src/lib/supabaseBackend.ts")).not.toMatch(/\.eq\("kind", "block"\)/);
  });
});

// ---------- the rhythm's kind ----------

describe("a termin rhythm: her fixed times, whatever a goal does", () => {
  const rule = (o: Partial<SeriesRule> = {}): SeriesRule => ({
    id: "s1",
    goal_id: "g1",
    kind: "termin",
    title: "Training",
    weekdays: [4],
    start_time: "18:00",
    duration_minutes: 90,
    location: null,
    reminder_minutes: null,
    time_zone: "Europe/Zurich",
    start_date: "2026-11-23",
    until_date: null,
    active: true,
    skip_days: [],
    ...o,
  });
  const now = Date.parse("2026-11-23T08:00:00Z");

  it("seriesKind: termin, else block (before its migration every rhythm is one of blocks)", () => {
    expect(seriesKind({ kind: "termin" })).toBe("termin");
    expect(seriesKind({})).toBe("block");
    expect(seriesKind({ kind: null })).toBe("block");
  });

  it("runs past the goal's target date and while the goal rests; a rhythm of blocks does not", () => {
    const goal = { status: "active", target_date: "2026-12-10" };
    expect(seriesEndDay(rule(), goal.target_date)).toBeNull();
    expect(seriesEndDay(rule({ kind: "block" }), goal.target_date)).toBe("2026-12-09");
    const days = seriesDays(rule(), { now, goal });
    expect(days.length).toBe(8);
    expect(days.at(-1)!.day > goal.target_date).toBe(true);
    expect(seriesDays(rule({ kind: "block" }), { now, goal }).every((d) => d.day < goal.target_date)).toBe(true);
    const paused = { status: "paused", target_date: "2026-12-10" };
    expect(seriesDays(rule(), { now, goal: paused }).length).toBe(8);
    expect(seriesDays(rule({ kind: "block" }), { now, goal: paused })).toEqual([]);
    expect(seriesKeepsDay(rule(), "2027-01-07", false, paused)).toBe(true);
    expect(seriesKeepsDay(rule({ kind: "block" }), "2027-01-07", false, paused)).toBe(false);
    // its own end and pause still count
    expect(seriesDays(rule({ active: false }), { now, goal })).toEqual([]);
    expect(seriesDays(rule({ until_date: "2026-12-03" }), { now, goal }).map((d) => d.day)).toEqual(["2026-11-26", "2026-12-03"]);
  });
});

describe("the coach tells the truth about a goal's rhythms when it rests, is reached or goes", () => {
  it("restsWithGoal: only a rhythm of blocks rests and ends with its goal; her fixed times stay", () => {
    expect(restsWithGoal({ kind: "block" })).toBe(true);
    expect(restsWithGoal({})).toBe(true); // before its migration: blocks
    expect(restsWithGoal({ kind: "termin" })).toBe(false);
  });

  it("update_goal and delete_goal name only the rhythms of blocks as resting or ended (no «aus dem Kalender» for her training)", () => {
    const helper = (name: string) => source.slice(source.indexOf(`const ${name} = async`), source.indexOf(";\n", source.indexOf(`const ${name} = async`)));
    for (const name of ["goalRhythms", "restingRhythms"]) {
      // "*": the kind only after its migration; then only the ones that rest with the goal
      expect(helper(name)).toContain('sb.from("series").select("*").eq("goal_id", goalId)');
      expect(helper(name)).toContain(".filter(restsWithGoal)");
    }
    // both tool results and the app's notices go through them
    expect(source).toContain('const resting = patch.status !== undefined && patch.status !== "active" ? await goalRhythms(sb, id, day) : [];');
    expect(source).toContain("const rhythms = await goalRhythms(sb, id, day);");
    expect(source).toContain("restingRhythms(sb, id, day)]);");
  });
});

describe("create_series: the same rhythm never twice, of either kind", () => {
  const run = (o: Partial<{ goal_id: string | null; kind: string; weekdays: number[]; start_time: string; start_date: string; until_date: string | null }> = {}) => ({
    goal_id: "g1",
    kind: "block",
    weekdays: [2, 4],
    start_time: "18:00:00",
    active: true,
    start_date: "2026-10-01",
    until_date: null as string | null,
    ...o,
  });

  it("sameRhythm: same goal (or none), same start, a shared weekday; the kind does not matter", () => {
    expect(sameRhythm(run(), { goal_id: "g1", start_time: "18:00", weekdays: [4] })).toBe(true);
    expect(sameRhythm(run({ kind: "termin" }), { goal_id: "g1", start_time: "18:00", weekdays: [2] })).toBe(true);
    expect(sameRhythm(run({ goal_id: null }), { goal_id: null, start_time: "18:00", weekdays: [2] })).toBe(true);
    expect(sameRhythm(run(), { goal_id: "g1", start_time: "19:00", weekdays: [2] })).toBe(false);
    expect(sameRhythm(run(), { goal_id: "g1", start_time: "18:00", weekdays: [1, 3] })).toBe(false);
    expect(sameRhythm(run(), { goal_id: "g2", start_time: "18:00", weekdays: [2] })).toBe(false);
    expect(sameRhythm(run(), { goal_id: null, start_time: "18:00", weekdays: [2] })).toBe(false);
    // the tool checks every rhythm that runs, of both kinds, before the limit per kind
    expect(source).toContain("const running = liveRhythms((others.data ?? []) as Running[], day);");
    expect(source).toContain("if (running.some((o) => sameRhythm(o, { goal_id: (row.goal_id as string | null) ?? null, start_time: time, weekdays })))");
    expect(source).toContain("const active = running.filter((o) => seriesKind(o) === kind);");
  });

  it("liveRhythms: a split «ab Januar» counts once; a rhythm of the other kind starting the next day is no split", () => {
    const old = run({ until_date: "2026-12-31" });
    expect(liveRhythms([old, run({ start_date: "2027-01-01" })], "2026-11-23")).toHaveLength(1);
    expect(liveRhythms([old, run({ kind: "termin", start_date: "2027-01-01" })], "2026-11-23")).toHaveLength(2);
  });
});

describe("the migration 20261126000500_termin_series.sql", () => {
  it("series.kind with a check; fill, sync and split write it; a termin rhythm's reminder is one she asked for", () => {
    expect(migration).toContain("add column if not exists kind text not null default 'block';");
    expect(migration).toContain("check (kind in ('block', 'termin'))");
    expect(migration).toContain("s.reminder_minutes, termin and s.reminder_minutes is not null, s.source, s.kind, s.goal_id, s.id, x.day");
    expect(migration).toContain("kind = s.kind, all_day = false");
    expect(migration).toContain("values (s.user_id, s.goal_id, s.kind, s.title,");
    expect(migration).toContain("after insert or update of goal_id, kind, title,");
  });

  it("goal_minutes keeps its columns; a termin with a goal counts provisionally, the kept ones stay blocks", () => {
    expect(migration).toContain("create or replace view public.goal_minutes with (security_invoker = true) as");
    expect(migration.match(/e\.kind in \('block', 'termin'\) and not e\.all_day and e\.source <> 'nolio'/g)).toHaveLength(2);
    expect(migration).toContain("and ((e.kind = 'block' and e.ends_at < public.honest_count_from() and e.created_at < public.honest_count_from())");
    expect(migration).toContain("and not (e.kind = 'block' and e.ends_at < public.honest_count_from() and e.created_at < public.honest_count_from())");
    for (const c of ["as logged_minutes", "as block_minutes", "as provisional_minutes"]) expect(migration).toContain(c);
  });

  it("fixed times stay when a goal ends or goes; the account's removal never fails on it; every function pinned", () => {
    expect(migration).toContain("update public.series set active = false where goal_id = new.id and active and kind = 'block';");
    expect(migration).toContain("update public.series set goal_id = null where goal_id = new.id and kind = 'termin';");
    expect(migration).toContain("if current_user = 'authenticated' then");
    expect(migration).toContain("create trigger goals_series_unlink before delete on public.goals");
    expect(migration).toContain("if new.kind not in ('block', 'termin') or new.all_day or new.ends_at is null");
    const fns = migration.match(/create or replace function [^\n]+(?:\n[^\n]+)?/g)!;
    expect(fns.length).toBe(7);
    for (const f of fns) expect(f).toContain("set search_path = ''");
    expect(migration).not.toContain("security definer");
    expect(migration).toContain("'experiment', 'dienste')");
    expect(migration).toContain("add column if not exists shifts_asked_at timestamptz,");
    expect(migration).toContain("add column if not exists shifts_weekly boolean not null default false;");
  });

  it("is new: the applied migrations stay as they were", () => {
    expect(read("../supabase/migrations/20261124000000_series.sql")).toContain("s.reminder_minutes, s.source, 'block', s.goal_id, s.id, x.day");
  });
});

// ---------- the coach: «immer», «jeden Donnerstag», «jede Woche» ----------

describe("the coach: a weekly termin rhythm without asking back, single termine only for this week", () => {
  it("the rule replaces «feste Zeiten für diese Woche» (lean: one sentence)", () => {
    expect(PERSONA).toContain(
      "Was jede Woche gleich ist, ob sie „immer“, „jeden Donnerstag“ oder „jede Woche“ sagt oder ihre normale Woche beschreibt, legst du ohne Rückfrage als Wochenrhythmus mit kind termin an und sagst „steht jetzt jede Woche im Kalender“; einzelne Termine nur für diese Woche und für wechselnde Schichten.",
    );
    expect(PERSONA).not.toContain("Nennt sie feste Zeiten für diese Woche");
    expect(PERSONA).toContain("Ein Wochenrhythmus sind Termine oder Blöcke");
    // Swiss High German: «ss» (the only «ß» is the rule that names it)
    for (const p of [PERSONA, MODE_CHECKIN, MODE_ONBOARDING]) expect(p.replace("statt „ß“", "")).not.toContain("ß");
  });

  it("create_series: kind, no reminder for a termin unless she asked, also while getting to know her", () => {
    expect(tool("create_series")).toContain("enum: [...SERIES_KINDS]");
    expect(tool("create_series")).toContain("termin: ihre festen Zeiten, etwa ein Training, der Laden, eine Vorlesung; ohne Erinnerung, ausser sie bittet darum.");
    expect(tool("create_series")).toContain("erinnern:");
    expect(source).toContain(`          : kind === "block"
            ? 10
            : asked
              ? 30
              : null;`);
    expect(source).toContain('...(kind === "termin" ? { kind } : {}),');
    expect(source).toContain('const CHECKIN_ONLY = new Set(["update_series", "note_offer", "wochenblick", "come_back"]);');
    expect(tool("update_series")).toContain('goal_id: { type: "string", description: "Das Ziel, für das er zählt, oder leer, um die Verbindung zu lösen." },');
  });

  it("log_time answers a termin with a goal and a time; the context asks about it and lists only three weeks of a rhythm", () => {
    expect(source).toContain('if (!countsLikeBlock(ev.data) || (ev.data.kind === "termin" && (ev.data.all_day || !ev.data.ends_at)))');
    expect(source).toContain('.or(`series_id.is.null,starts_at.lt."${iso(now + SERIES_CONTEXT_DAYS * DAY_MS)}"`)');
    const day = "2026-11-23";
    const training: ContextEvent = { id: "t1", title: "Training", starts_at: "2026-11-22T17:00:00Z", ends_at: "2026-11-22T18:30:00Z", all_day: false, location: null, kind: "termin", goal_id: "g1" };
    const g: ContextGoal = { id: "g1", title: "Halbmarathon", why: null, target_date: "2027-04-12", status: "active", weekly_hours: 3, milestones: [] };
    const c: ContextInput = {
      day,
      localTime: "Montag, 23. November 2026, 08:00",
      timezone: "Europe/Zurich",
      season: "Herbst",
      phase: "Morgen",
      hasLocation: false,
      now: "2026-11-23T07:00:00Z",
      lastSeen: "2026-11-22",
      profile: { display_name: "Mia", location_name: null, summary: null, nature_palette: null },
      memories: [],
      recentDays: [],
      goals: [g],
      pastBlocks: [training],
      recentBlocks: [{ ...training, minutes: null }],
      series: [
        {
          id: "s1",
          goal_id: "g1",
          kind: "termin",
          title: "Training",
          weekdays: [2, 4],
          start_time: "18:00",
          duration_minutes: 90,
          location: "Halle",
          reminder_minutes: null,
          time_zone: "Europe/Zurich",
          start_date: "2026-10-01",
          until_date: null,
          active: true,
          skip_days: [],
        },
      ],
    };
    const out = contextBlock(c);
    expect(section(out, "Vergangene Blöcke ohne Rückmeldung")).toContain("[t1]");
    expect(section(out, "Ziele")).toContain("Wochenrhythmus [s1]: Termin „Training“ Di, Do 18:00–19:30 (Halle) · seit 7 Wochen");
    expect(section(out, "Ziele")).not.toContain("klappt selten");
  });
});

// ---------- shift work: the Sunday ask ----------

describe("shift work: the coach asks on Sunday for next week's shifts, after her first yes every Sunday", () => {
  const SUNDAY = "2026-11-22";
  const o = (x: Partial<Parameters<typeof shiftAskDue>[0]> = {}) =>
    shiftAskDue({ today: SUNDAY, irregular: true, askedAt: null, weekly: false, entries: [], dayOfIso: zurich, ...x });

  it("shiftAskDue: Sunday, shift work, once; after her yes every Sunday; not when the shifts are named; unknown never", () => {
    expect(o()).toBe(true);
    expect(o({ today: "2026-11-21" })).toBe(false);
    expect(o({ irregular: false })).toBe(false);
    expect(o({ askedAt: "2026-11-15T09:00:00Z" })).toBe(false); // asked once, no yes: never again
    expect(o({ askedAt: "2026-11-15T09:00:00Z", weekly: true })).toBe(true);
    expect(o({ askedAt: undefined })).toBe(false);
    const shift = (day: string, title = "Frühdienst") => ({ title, kind: "termin", starts_at: `${day}T05:00:00Z` });
    expect(o({ entries: [shift("2026-11-23"), shift("2026-11-25", "Spätdienst")] })).toBe(false);
    expect(o({ entries: [shift("2026-11-23")] })).toBe(true);
    expect(o({ entries: [shift("2026-11-20"), shift("2026-11-21")] })).toBe(true); // this week's do not count
  });

  const input = (x: Partial<DailyNudgeInput> = {}): DailyNudgeInput => ({
    today: SUNDAY,
    heavy: false,
    pause: false,
    review: null,
    lastDay: "2026-11-20",
    startDay: "2026-10-01",
    no: {},
    entriesToday: 0,
    goals: [{ id: "g1", target_date: "2027-06-30", weekly_hours: null, steps: 0, hours_asked_at: null, steps_asked_at: null }],
    dreams: [{ id: "d1", flag: "lange" }],
    experiment: false,
    shifts: true,
    ...x,
  });

  it("dailyNudge: the kind «dienste», before everything but the Wochenblick, in the greeting; with it, the Wochenblick asks first", () => {
    expect(dailyNudge(input())).toEqual({ kind: "dienste", greeting: true });
    expect(dailyNudge(input({ review: "anbieten" }))).toEqual({ kind: "wochenblick", greeting: true, dienste: true });
    expect(dailyNudge(input({ shifts: false }))?.kind).toBe("traum");
    // her «Nein» rests it two weeks; not twice a day; never in a heavy time
    expect(dailyNudge(input({ no: { dienste: "2026-11-15" } }))?.kind).toBe("traum");
    expect(dailyNudge(input({ review: "anbieten", no: { dienste: "2026-11-15" } }))).toEqual({ kind: "wochenblick", greeting: true });
    expect(dailyNudge(input({ lastDay: SUNDAY }))).toBeNull();
    expect(dailyNudge(input({ heavy: true }))).toBeNull();
  });

  const sunday: ContextInput = {
    day: SUNDAY,
    localTime: "Sonntag, 22. November 2026, 10:00",
    timezone: "Europe/Zurich",
    season: "Herbst",
    phase: "Tag",
    hasLocation: false,
    now: "2026-11-22T09:00:00Z",
    lastSeen: "2026-11-21",
    startedAt: "2026-10-01T09:00:00Z",
    profile: { display_name: "Lea", location_name: null, summary: null, nature_palette: null },
    memories: [{ id: "m1", category: "arbeit", event_date: null, content: "Arbeitet im Schichtdienst als Pflegefachfrau.", source: "coach" }],
    recentDays: [],
    nudge: { day: "2026-11-20", kind: "traum", no: {} },
    shifts: { askedAt: null, weekly: false },
    goals: [],
    events: [],
    series: [],
  };

  it("the context: «Anstoss heute» names the shifts and how her yes is noted; the greeting carries it", () => {
    expect(todayNudge(sunday)).toEqual({ kind: "dienste", greeting: true });
    const out = section(contextBlock({ ...sunday, opener: "anstoss" }), "Anstoss heute");
    expect(out).toContain("- Die Dienste der nächsten Woche: frag, wann sie arbeitet, und trag sie als Termine ein · note_offer dienste, nennt sie sie, mit jede_woche true");
    expect(out).toContain("Moment: diese Begrüssung, als ihre eine Frage");
    // after her yes: every Sunday, without the hint
    const weekly = section(contextBlock({ ...sunday, shifts: { askedAt: "2026-11-15T09:00:00Z", weekly: true } }), "Anstoss heute");
    expect(weekly).toContain("trag sie als Termine ein · note_offer dienste\n");
    // asked once without a yes, or unknown: nothing
    expect(todayNudge({ ...sunday, shifts: { askedAt: "2026-11-15T09:00:00Z", weekly: false } })?.kind).not.toBe("dienste");
    expect(todayNudge({ ...sunday, shifts: undefined })?.kind).not.toBe("dienste");
    // spent today: «Heute kam schon einer (die Dienste der nächsten Woche)»
    expect(section(contextBlock({ ...sunday, nudge: { day: SUNDAY, kind: "dienste", no: {} } }), "Anstoss heute")).toContain("(die Dienste der nächsten Woche)");
  });

  it("note_offer dienste notes the ask once, and her yes (jede_woche) or her wish to stop", () => {
    expect(offerNudgeKind("dienste")).toBe("dienste");
    expect(tool("note_offer")).toContain("dienste (du hast am Sonntag nach ihren Diensten der nächsten Woche gefragt)");
    expect(tool("note_offer")).toContain("jede_woche:");
    expect(source).toContain('await sb.from("profiles").update({ shifts_asked_at: new Date().toISOString() }).eq("id", userId).is("shifts_asked_at", null);');
    expect(source).toContain('const res = await sb.from("profiles").update({ shifts_weekly: weekly }).eq("id", userId);');
    expect(source).toContain('sb.from("profiles").select("shifts_asked_at, shifts_weekly").eq("id", userId).maybeSingle(),');
    for (const n of [SHIFTS_ASKED_NOTE, SHIFTS_WEEKLY_NOTE, SHIFTS_STOP_NOTE]) expect(n).not.toContain("ß");
    // the greeting notes that it asked, never her answer (she has not said anything yet)
    expect(greetingWriteRefusal("note_offer", { what: "dienste" })).toBeNull();
    expect(greetingWriteRefusal("note_offer", { what: "dienste", jede_woche: true })).not.toBeNull();
    expect(greetingWriteRefusal("note_offer", { what: "stunden", goal_id: "g1", nein: true })).not.toBeNull();
    expect(greetingWriteRefusal("create_series", { kind: "termin" })).not.toBeNull();
  });
});

// ---------- the demo mirrors it ----------

describe("the demo backend mirrors it", () => {
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
  const add = (d: number) => addDays(today, d);
  beforeEach(async () => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
    b = new DemoBackend();
    await b.signUp("demo.termin", "geheim1234");
  });
  const days = async (id: string) => (await b.listEvents(new Date(Date.now() - 40 * DAY).toISOString(), new Date(Date.now() + 70 * DAY).toISOString())).filter((e) => e.series_id === id);
  const say = async (message: string | undefined, day = today) => {
    const events: CoachEvent[] = [];
    const req: CoachRequest = { mode: "checkin", thread: day, message, context: { day, localTime: "", timezone: "Europe/Zurich", season: "Herbst", phase: "Tag", hasLocation: false } };
    await b.coach(req, (e) => events.push(e));
    return { events, text: events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("") };
  };

  it("«immer donnerstags um 18 Uhr Training»: a termin rhythm for her goal, without a reminder, past the goal's date", async () => {
    expect(parseDemoRhythm("Ich habe immer donnerstags um 18 Uhr Training")).toEqual({ weekdays: [4], time: "18:00", title: "Training" });
    expect(parseDemoRhythm("jede Woche am Montag um 9 Laden")).toEqual({ weekdays: [1], time: "09:00", title: null });
    const g = await b.addGoal({ title: "Halbmarathon", target_date: add(20), weekly_hours: 3 });
    const { events, text } = await say("Ich habe immer donnerstags um 18 Uhr Training");
    const created = events.find((e) => e.type === "event_created") as Extract<CoachEvent, { type: "event_created" }>;
    const list = await days(created.event.series_id!);
    expect(list.every((e) => e.kind === "termin" && e.reminder_minutes === null && !e.reminder_asked && e.goal_id === g.id)).toBe(true);
    expect(list.some((e) => e.series_day! > g.target_date!)).toBe(true);
    expect(text).toContain("steht jetzt jede Woche im Kalender");
  });

  it("a past termin with a goal counts provisionally, is answered like a block; the goal done lets go of the rhythm", async () => {
    const g = await b.addGoal({ title: "Halbmarathon", target_date: add(60), weekly_hours: 3 });
    const past = await b.addEvent({
      title: "Training",
      starts_at: new Date(Date.now() - 3 * H).toISOString(),
      ends_at: new Date(Date.now() - 1.5 * H).toISOString(),
      all_day: false,
      location: null,
      notes: null,
      reminder_minutes: null,
      kind: "termin",
      goal_id: g.id,
    });
    const time = async () => (await b.listGoals()).find((x) => x.id === g.id)!.time;
    expect(await time()).toEqual({ logged_minutes: 0, block_minutes: 90, provisional_minutes: 90 });
    await b.setBlockDone(past.id, false);
    expect(await time()).toEqual({ logged_minutes: 0, block_minutes: 0, provisional_minutes: 0 });
    // the answer stays when she renames it (a termin's answer follows it like a block's)
    await b.updateEvent(past.id, { title: "Training (Halle)" });
    expect(await b.blockAnswers([past.id])).toEqual({ [past.id]: 0 });

    const { series } = await b.addSeries({
      goal_id: g.id,
      kind: "termin",
      title: "Training",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      start_time: "23:59",
      duration_minutes: 1,
      location: null,
      reminder_minutes: null,
      time_zone: "Europe/Zurich",
      start_date: add(1),
      until_date: null,
    });
    const n = (await days(series.id)).length;
    await b.updateGoal(g.id, { status: "paused" });
    expect((await days(series.id)).length).toBe(n);
    await b.updateGoal(g.id, { status: "done" });
    const after = await days(series.id);
    expect(after.length).toBe(n);
    expect(after.every((e) => e.goal_id === null)).toBe(true);
  });

  it("time she names answers her training of that day only when it has an end (like the coach's log_time)", async () => {
    const g = await b.addGoal({ title: "Halbmarathon", target_date: add(60), weekly_hours: 3 });
    const at = (h: number) => new Date(`${today}T${String(h).padStart(2, "0")}:00:00`).toISOString();
    const entry = (o: Partial<CalendarEvent>) =>
      b.addEvent({ title: "Training", starts_at: at(7), ends_at: null, all_day: false, location: null, notes: null, reminder_minutes: null, kind: "termin", goal_id: g.id, ...o });
    const open = await entry({});
    await say("Heute 40 Minuten trainiert");
    // a termin without an end counts for nothing: the time is hers, the termin gets no answer
    expect(await b.blockAnswers([open.id])).toEqual({});
    expect((await b.listGoals()).find((x) => x.id === g.id)!.time.logged_minutes).toBe(40);
    const timed = await entry({ starts_at: at(6), ends_at: at(7) });
    await say("Heute 50 Minuten trainiert");
    expect(await b.blockAnswers([timed.id])).toEqual({ [timed.id]: 50 });
  });

  it("a reminder she asked for on a termin rhythm comes as one she asked for; a goal deleted lets its fixed times stay", async () => {
    const g = await b.addGoal({ title: "Japanisch", target_date: add(200), weekly_hours: 2 });
    const { series } = await b.addSeries({
      goal_id: g.id,
      kind: "termin",
      title: "Japanischkurs",
      weekdays: [3],
      start_time: "19:00",
      duration_minutes: 90,
      location: null,
      reminder_minutes: 60,
      time_zone: "Europe/Zurich",
      start_date: add(1),
      until_date: null,
    });
    expect((await days(series.id)).every((e) => e.reminder_minutes === 60 && e.reminder_asked === true)).toBe(true);
    await b.deleteGoal(g.id);
    const kept = await days(series.id);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((e) => e.goal_id === null)).toBe(true);
  });

  it("the Sunday ask for next week's shifts: in the greeting, once; her answer is her yes, then every Sunday", async () => {
    // the next Sunday from today, and the one after
    const offset = (7 - ((new Date(`${today}T12:00:00Z`).getUTCDay() + 7) % 7)) % 7;
    const sun = add(offset);
    await b.addMemory({ content: "Arbeitet im Schichtdienst.", category: "arbeit", event_date: null, source: "coach" });
    const first = await say(undefined, sun);
    expect(first.text).toContain("Wie sehen deine Dienste nächste Woche aus?");
    const yes = await say("Montag Frühdienst, Mittwoch Spätdienst", sun);
    expect(yes.text).toContain("jeden Sonntag");
    const next = await say(undefined, addDays(sun, 7));
    expect(next.text).toContain("Wie sehen deine Dienste nächste Woche aus?");
  });
});
