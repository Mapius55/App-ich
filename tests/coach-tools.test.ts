// The coach's tool definitions live in supabase/functions/coach/index.ts, which only runs on Deno
// (npm: imports, Deno.serve), so they are checked here as text.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../supabase/functions/coach/index.ts", import.meta.url), "utf8");
const tools = source.slice(source.indexOf("const TOOLS"), source.indexOf("class ToolInputError"));
const tool = (name: string) => {
  const at = tools.indexOf(`name: "${name}"`);
  const next = tools.indexOf("\n  {\n    name:", at + 1);
  return tools.slice(at, next < 0 ? undefined : next);
};

describe("coach tools", () => {
  it("name the calendar „Bucket List“ (create, update, delete) and never „I am“", () => {
    for (const t of ["create_event", "update_event", "delete_event"]) expect(tool(t)).toContain("Kalender „Bucket List“");
    expect(source).not.toContain("I am");
  });

  it("create_goal and update_goal know kind, memory and done_date; update_goal knows reminded", () => {
    for (const t of ["create_goal", "update_goal"]) {
      expect(tool(t)).toContain("kind: {");
      expect(tool(t)).toContain("enum: [...GOAL_KINDS]");
      expect(tool(t)).toContain("memory: {");
      expect(tool(t)).toContain("done_date: {");
    }
    expect(tool("update_goal")).toContain('reminded: { type: "boolean"');
    expect(tool("create_goal")).not.toContain("reminded");
    expect(tool("create_goal")).toContain("Bucket List");
    expect(tool("create_goal")).not.toContain("Traumziel");
  });

  it("update_profile knows birth_year as an integer, and null removes it", () => {
    expect(tool("update_profile")).toContain('birth_year: { type: ["integer", "null"], minimum: 1900, maximum: 2100');
    expect(tool("update_profile")).toContain("nie danach fragen");
    expect(tool("update_profile")).toContain("null entfernt es");
    expect(source).toContain("if (input.birth_year === null) patch.birth_year = null;");
    // a future year is a clear tool error before any write (the database refuses it too)
    expect(source).toContain("const problem = birthYearProblem(input.birth_year, day);");
  });

  it("tell the app when a call made a dream come true (its done_at may lie days back)", () => {
    expect(source).toContain('send({ type: "goal_saved", goal, ...(!wasDone && data.status === "done" && goal.kind === "dream" ? { fulfilled: true } : {}) });');
    expect(source).toContain('...(saved.kind === "dream" && status === "done" ? { fulfilled: true } : {})');
  });

  it("give a dream without an estimate no effort line, also after log_time", () => {
    expect(source.match(/kind !== "dream" \|\| \w+\.effort_hours \? \{ aufwand: effortLine/g)).toHaveLength(3);
    expect(source).not.toMatch(/^\s+aufwand: effortLine/m);
  });

  it("stay static, so the prompt can be cached: nothing computed per request, no dates", () => {
    expect(tools).not.toMatch(/\$\{|\d{4}-\d{2}-\d{2}/);
    expect(tools).not.toContain("ß");
  });

  it("ask for a fulfilled dream's memory in her own words, in the first person", () => {
    for (const t of ["create_goal", "update_goal"]) expect(tool(t)).toContain("in der Ich-Form, so wie sie es sagt (nicht in der dritten Person)");
    // remember keeps its own convention
    expect(tool("remember")).not.toContain("Ich-Form");
  });

  it("give no planning hint when update_goal only notes a reminder (a dream is never pushed)", () => {
    expect(source).toContain("...(Object.keys(patch).length === 1 && patch.reminded_at ? {} : goalHints(goal, day, input.planen === true && ctx.mode !== \"onboarding\")),");
  });

  it("let update_goal say it is planning a dream (planen), so a year she only names never brings the milestone step", () => {
    expect(tool("update_goal")).toContain("planen");
    expect(tool("update_goal")).toContain("Nicht, wenn sie nur nennt, wann.");
    expect(source).not.toContain("!!patch.target_date && ctx.mode");
  });

  it("give a dream its milestone step only when update_goal set its date, not when create_goal adds one she mentioned", () => {
    // create_goal: never planned (a dream she names with a year is only noted)
    expect(source).toContain("...goalHints(saved, day),");
    expect(source.match(/goalHints\(/g)?.length).toBe(2);
  });

  it("set reminded_at on the server and keep done_at to the trigger unless a date is given", () => {
    expect(source).toContain("patch.reminded_at = new Date().toISOString()");
    expect(source).toContain('return zonedToUtc(`${day}T12:00`, tz);');
  });

  it("the daily coach's tools: wochenblick, note_offer and the weekly rhythm only in the daily conversation; tidying keeps its three", () => {
    expect(tool("wochenblick")).toContain("gemacht");
    expect(tool("wochenblick")).toContain("will_nicht");
    // the schema and the check share one list
    expect(tool("note_offer")).toContain("what: { type: \"string\", enum: [...OFFERS] },");
    expect(source).toContain('const OFFERS = ["experiment", "begleitung", "blockmuster", "plan_b", "rhythmus", "flaute", "stunden", "etappen", "dienste"] as const;');
    expect(source).toContain('const what = oneOf(input.what, OFFERS, "what");');
    expect(source.match(/if \(ctx\.mode !== "checkin"\) throw new ToolInputError\("nur im täglichen Gespräch"\);/g)).toHaveLength(4);
    expect(source).toContain('TOOLS.filter((t) => ["remember", "update_memory", "forget"].includes(t.name))');
  });

  it("getting to know her, the tools only the daily conversation runs are not offered (no call that can only fail)", () => {
    expect(source).toContain('const CHECKIN_ONLY = new Set(["update_series", "note_offer", "wochenblick", "come_back"]);');
    expect(source).toContain('mode === "onboarding"\n      ? TOOLS.filter((t) => !CHECKIN_ONLY.has(t.name))');
    // exactly the four whose runTool case refuses outside the daily conversation
    for (const name of ["update_series", "note_offer", "wochenblick", "come_back"]) {
      const at = source.indexOf(`case "${name}": {`);
      expect(at).toBeGreaterThan(0);
      expect(source.slice(at, at + 200)).toContain('if (ctx.mode !== "checkin") throw new ToolInputError("nur im täglichen Gespräch");');
    }
    // her fixed times every week also while getting to know her («Training jeden Dienstag»); blocks only daily
    const at = source.indexOf('case "create_series": {');
    expect(source.slice(at, at + 400)).toContain('if (ctx.mode === "tidy" || (ctx.mode !== "checkin" && kind !== "termin")) throw new ToolInputError("nur im täglichen Gespräch");');
  });

  it("mark «once» with their own writes, so a missing column never blocks the change itself", () => {
    expect(tool("update_memory")).toContain("nachgefragt");
    expect(tool("update_milestone")).toContain("nachgefragt");
    expect(tool("update_goal")).toContain("nicht_jetzt");
    for (const col of ["followed_up_at", "overdue_asked_for", "nudge_after"]) expect(source).toMatch(new RegExp(`console\\.error\\("${col}:`));
  });

  it("log_habit never hands back «0 von N» to repeat", () => {
    expect(source).toContain("...(habitWeekLabel(h, day) ? { this_week: habitWeekLabel(h, day) } : {}),");
    expect(source).not.toContain("this_week: `${habitWeek(h, day).doneThisWeek} von ${h.per_week}`");
  });
});
