// Round 2, the whole-round review: what the four stages (honest counting, wins on Jetzt, Plan B, the weekly rhythm)
// share must agree across the server and the app: the account export, the privacy page, the scheduled job.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** The table names of an export list: the first string of every row between `start` and the closing `];`. */
function tablesOf(source: string, start: string): string[] {
  const at = source.indexOf(start);
  expect(at).toBeGreaterThanOrEqual(0);
  const list = source.slice(at, source.indexOf("];", at));
  return [...list.matchAll(/^\s*\["(\w+)",/gm)].map((m) => m[1]);
}

describe("the account export", () => {
  const server = read("../supabase/functions/account/index.ts");
  const app = read("../src/lib/supabaseBackend.ts");

  it("the server reads the same tables as the app's own export (the notification log and the rhythms included)", () => {
    const serverTables = [...tablesOf(server, "const TABLES"), ...tablesOf(server, "const CONNECTION_TABLES")].sort();
    const appTables = [...tablesOf(app, "const EXPORT_TABLES"), ...tablesOf(app, "const EXPORT_CONNECTION_TABLES")].sort();
    expect(serverTables).toEqual(appTables);
    for (const t of ["series", "push_log", "goal_time", "goals", "events"]) expect(serverTables).toContain(t);
  });

  it("goals and events go out with every column (Plan B, the «once» marks, a day's rhythm)", () => {
    expect(server).toContain('["goals", "*", ["id"]],');
    expect(server).toContain('["events", "*", ["id"]],');
  });
});

describe("the privacy page names what this round stores and sends", () => {
  const page = read("../public/datenschutz.html");

  it("the answers to blocks, the coach's notes of its offers, the notification log", () => {
    expect(page).toContain("ob ein\n          geplanter Block geklappt hat: ja, teilweise oder nein");
    expect(page).toContain("vorgeschlagen hat, die Blöcke\n          eines Ziels anders zu legen oder einen Wochenrhythmus zu ändern oder zu pausieren");
    expect(page).toContain("mit einer Kennung der Vorlage, nie mit ihrem Text");
    expect(page).toContain("<li>Das Protokoll der Nachrichten vom Coach: 90 Tage.</li>");
  });

  it("what the coach gets: the rhythms, the Plan B, the pattern of the blocks", () => {
    expect(page).toContain("kommende Termine und deine Wochenrhythmen, deine Bucket List, Ziele (mit ihrem Plan B) und Gewohnheiten");
    expect(page).toContain("wie deine geplanten Blöcke für ein Ziel in den letzten vier Wochen geklappt haben");
    expect(page).not.toContain("ß");
  });
});

describe("the daily job of the weekly rhythms", () => {
  it("the README names it with the migration's own schedule, and how to plan it by hand without pg_cron", () => {
    const readme = read("../README.md");
    const sql = read("../supabase/migrations/20261124000000_series.sql");
    const schedule = "select cron.schedule('i-am-series', '23 3 * * *', 'select public.extend_series(14)')";
    expect(sql).toContain(schedule);
    expect(readme).toContain(`\`${schedule};\``);
    expect(readme).toContain("**Wochenrhythmen**: einmal am Tag (03:23 UTC)");
    expect(readme).not.toContain("ß");
  });
});
