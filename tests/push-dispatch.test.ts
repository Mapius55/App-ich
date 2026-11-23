// The dispatch of the Edge Function "push" (supabase/functions/push/dispatch.ts) against a small
// in-memory stand-in for the Supabase client: it decides each slot once a day (also when two runs
// overlap), leaves it out when she was already there or after 14 quiet days without touching her
// settings, keeps the log without any text, rotates the bodies and still works without the log table.
import { describe, expect, it } from "vitest";
import { dispatch, LOG_KEEP_DAYS, type Send, type Sub } from "../supabase/functions/push/dispatch";
import { addDays, fingerprint } from "../supabase/functions/_shared/push_text";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code?: string; message?: string } | null };

/**
 * Just enough of the query builder for the dispatch: select/update/delete/upsert, eq/gte/lte/lt/in/is/or,
 * order, limit. A select returns only the columns it names, so a column the dispatch stops reading
 * shows up here as missing data.
 */
class FakeDb {
  tables: Record<string, Row[]> = {};
  missing = new Set<string>();
  failing = new Map<string, string>(); // table → user_id whose queries throw
  erroring = new Set<string>(); // tables whose queries answer with an error (as PostgREST does)
  private nextId = 1;
  from(table: string) {
    return new Query(this, table);
  }
  rows(table: string) {
    return (this.tables[table] ??= []);
  }
  insert(table: string, row: Row) {
    this.rows(table).push({ id: this.nextId++, ...row });
  }
}

class Query implements PromiseLike<Result> {
  private op: "select" | "update" | "delete" | "upsert" = "select";
  private filters: ((r: Row) => boolean)[] = [];
  private userFilter: unknown;
  private sort: { col: string; asc: boolean } | null = null;
  private max: number | null = null;
  private patch: Row = {};
  private upsertRows: Row[] = [];
  private conflict: string[] = [];
  private cols: string[] | null = null;
  constructor(
    private db: FakeDb,
    private table: string,
  ) {}
  select(cols = "*") {
    this.cols = cols.trim() === "*" ? null : cols.split(",").map((c) => c.trim());
    return this;
  }
  /** «a.not.is.null,b.is.null,c.eq.x»: any of them */
  or(expr: string) {
    const tests = expr.split(",").map((part) => {
      const m = /^(\w+)\.(not\.)?(is|eq)\.(.*)$/.exec(part.trim());
      if (!m) throw new Error(`FakeDb: unsupported or() part ${part}`);
      const [, col, not, op, raw] = m;
      const hit = (r: Row) => (op === "is" ? (raw === "null" ? r[col] == null : String(r[col]) === raw) : String(r[col]) === raw);
      return (r: Row) => (not ? !hit(r) : hit(r));
    });
    this.filters.push((r) => tests.some((t) => t(r)));
    return this;
  }
  is(col: string, v: null | boolean) {
    this.filters.push((r) => (v === null ? r[col] == null : r[col] === v));
    return this;
  }
  not(col: string, op: "is", v: null) {
    if (op !== "is" || v !== null) throw new Error("FakeDb: only not(col, 'is', null)");
    this.filters.push((r) => r[col] != null);
    return this;
  }
  neq(col: string, v: unknown) {
    this.filters.push((r) => r[col] !== v); // like SQL: a null column is no match either way, here it passes
    return this;
  }
  eq(col: string, v: unknown) {
    if (col === "user_id") this.userFilter = v;
    this.filters.push((r) => r[col] === v);
    return this;
  }
  gte(col: string, v: string) {
    this.filters.push((r) => r[col] != null && String(r[col]) >= v);
    return this;
  }
  lte(col: string, v: string) {
    this.filters.push((r) => r[col] != null && String(r[col]) <= v);
    return this;
  }
  lt(col: string, v: string) {
    this.filters.push((r) => r[col] != null && String(r[col]) < v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  order(col: string, o: { ascending?: boolean } = {}) {
    this.sort = { col, asc: o.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  upsert(row: Row | Row[], o: { onConflict: string; ignoreDuplicates?: boolean }) {
    this.op = "upsert";
    this.upsertRows = Array.isArray(row) ? row : [row];
    this.conflict = o.onConflict.split(",");
    return this;
  }
  private run(): Result {
    if (this.db.missing.has(this.table)) return { data: null, error: { code: "42P01", message: `relation "${this.table}" does not exist` } };
    const failFor = this.db.failing.get(this.table);
    if (failFor !== undefined && this.userFilter === failFor) throw new Error(`${this.table} broke`);
    if (this.db.erroring.has(this.table)) return { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    const all = this.db.rows(this.table);
    if (this.op === "upsert") {
      const inserted: Row[] = [];
      for (const r of this.upsertRows) {
        if (all.some((x) => this.conflict.every((c) => x[c] === r[c]))) continue; // ignoreDuplicates
        this.db.insert(this.table, r);
        inserted.push(all[all.length - 1]);
      }
      return { data: inserted.map((r) => this.pick(r)), error: null };
    }
    let hit = all.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "update") {
      for (const r of hit) Object.assign(r, this.patch);
      return { data: null, error: null };
    }
    if (this.op === "delete") {
      this.db.tables[this.table] = all.filter((r) => !hit.includes(r));
      return { data: null, error: null };
    }
    if (this.sort) {
      const { col, asc } = this.sort;
      // numbers as numbers (ids: 9 before 10), the rest as text (ISO times, days)
      const key = (r: Row) => (typeof r[col] === "number" ? (r[col] as number) : String(r[col]));
      hit = [...hit].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.max !== null) hit = hit.slice(0, this.max);
    return { data: hit.map((r) => this.pick(r)), error: null };
  }
  private pick(r: Row): Row {
    if (!this.cols) return { ...r };
    const out: Row = {};
    for (const c of this.cols) if (c in r) out[c] = r[c];
    return out;
  }
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(ok, bad);
  }
}

const LEA = "u-lea";
const at = (local: string) => new Date(`${local}+01:00`); // Zurich in November
const MON = "2026-11-16";

function setup() {
  const db = new FakeDb();
  db.insert("profiles", {
    id: LEA,
    display_name: "Lea",
    timezone: "Europe/Zurich",
    notify_morning: "07:30:00",
    notify_evening: "21:00:00",
    last_morning_push: null,
    last_evening_push: null,
    created_at: "2026-09-01T10:00:00Z",
  });
  db.insert("push_subscriptions", { id: "s1", user_id: LEA, endpoint: "https://push.example/1", p256dh: "k", auth: "a", app_url: null });
  db.insert("goals", { id: "g-run", user_id: LEA, title: "Halbmarathon Zürich", kind: "goal", status: "active", done_at: null });
  db.insert("goals", { id: "g-island", user_id: LEA, title: "Island", kind: "dream", status: "active", done_at: null });
  const sent: { to: string[]; title: string; body: string }[] = [];
  const send: Send = async (subs: Sub[], m) => {
    sent.push({ to: subs.map((s) => s.id), ...m });
    return subs.length;
  };
  const said = (local: string, role: "user" | "assistant" = "user", hidden = false) =>
    db.insert("messages", { user_id: LEA, thread: local.slice(0, 10), role, content: "…", hidden, created_at: at(local).toISOString() });
  return { db, sent, send, said, sb: db as never };
}

const event = (db: FakeDb, local: string, title: string, extra: Row = {}) =>
  db.insert("events", { user_id: LEA, title, starts_at: at(local).toISOString(), ends_at: null, all_day: false, kind: "termin", goal_id: null, ...extra });

describe("dispatch", () => {
  it("sends the morning once with what is on today, and logs no text", async () => {
    const { db, sent, send, said, sb } = setup();
    said("2026-11-15T20:00:00");
    event(db, `${MON}T10:15:00`, "Vorlesung Statistik");
    event(db, `${MON}T12:00:00`, "Island: Flüge", { kind: "block", goal_id: "g-island" });
    expect(await dispatch(sb, send, at(`${MON}T07:31:00`))).toBe(1);
    expect(sent).toEqual([{ to: ["s1"], title: "Guten Morgen, Lea", body: "Heute: 10:15 Vorlesung Statistik." }]);
    const log = db.rows("push_log");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ user_id: LEA, day: MON, slot: "morning", status: "sent", template: "m.day.1", fingerprint: fingerprint(sent[0].body), reason: null, devices: 1 });
    expect(JSON.stringify(log)).not.toMatch(/Vorlesung|Statistik|Island/);
    expect(db.rows("profiles")[0].last_morning_push).toBe(MON);
    // the next run in the window: already decided
    expect(await dispatch(sb, send, at(`${MON}T07:46:00`))).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("two runs at the same time send only once (pg_cron and the GitHub workflow)", async () => {
    const { db, sent, send, said, sb } = setup();
    said("2026-11-15T20:00:00");
    event(db, `${MON}T10:15:00`, "Vorlesung Statistik");
    const [a, b] = await Promise.all([dispatch(sb, send, at(`${MON}T07:31:00`)), dispatch(sb, send, at(`${MON}T07:31:00`))]);
    expect(a + b).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("leaves the morning out once she opened the app today", async () => {
    const { db, sent, send, said, sb } = setup();
    said(`${MON}T06:50:00`, "user", true); // the hidden «app opened» turn
    said(`${MON}T06:50:05`, "assistant");
    expect(await dispatch(sb, send, at(`${MON}T07:31:00`))).toBe(0);
    expect(sent).toHaveLength(0);
    expect(db.rows("push_log")[0]).toMatchObject({ slot: "morning", status: "skipped", reason: "opened_today", template: null, fingerprint: null });
    expect(db.rows("profiles")[0].last_morning_push).toBe(MON);
  });

  it("leaves the evening out when she talked in the last 3 hours, else sends a small win", async () => {
    const one = setup();
    one.said(`${MON}T19:30:00`);
    expect(await dispatch(one.sb, one.send, at(`${MON}T21:05:00`))).toBe(0);
    expect(one.db.rows("push_log")[0]).toMatchObject({ slot: "evening", reason: "talked_recently" });

    const two = setup();
    two.said(`${MON}T12:00:00`);
    two.db.insert("goal_time", { user_id: LEA, goal_id: "g-run", day: MON, minutes: 45, source: "block" });
    two.db.insert("goal_time", { user_id: LEA, goal_id: "g-island", day: MON, minutes: 90, source: "person" });
    expect(await dispatch(two.sb, two.send, at(`${MON}T21:05:00`))).toBe(1);
    expect(two.sent[0]).toMatchObject({ title: "Guten Abend, Lea", body: "Heute 45 Minuten für Halbmarathon Zürich." });
  });

  it("names a goal reached today in the evening (goals.done_at)", async () => {
    const { db, sent, send, said, sb } = setup();
    said(`${MON}T08:00:00`);
    db.insert("goals", { id: "g-cv", user_id: LEA, title: "Bewerbung abschicken", kind: "goal", status: "done", done_at: at(`${MON}T15:00:00`).toISOString() });
    await dispatch(sb, send, at(`${MON}T21:05:00`));
    expect(sent[0].body).toBe("Heute erreicht: Bewerbung abschicken.");
  });

  it("names a habit ticked today in the evening", async () => {
    const { db, sent, send, said, sb } = setup();
    said(`${MON}T08:00:00`);
    db.insert("habits", { id: "h1", user_id: LEA, title: "Meditieren", goal_id: null, active: true });
    db.insert("habit_logs", { habit_id: "h1", user_id: LEA, day: MON });
    await dispatch(sb, send, at(`${MON}T21:05:00`));
    expect(sent[0].body).toBe("Heute abgehakt: Meditieren.");
  });

  it("pauses silently after 14 days without opening the app, keeps her switches, and resumes after she opens it", async () => {
    const { db, sent, send, said, sb } = setup();
    said("2026-11-01T20:00:00");
    expect(await dispatch(sb, send, at(`${MON}T07:31:00`))).toBe(0);
    expect(await dispatch(sb, send, at(`${MON}T21:05:00`))).toBe(0);
    expect(sent).toHaveLength(0);
    expect(db.rows("push_log").map((r) => r.reason)).toEqual(["paused", "paused"]);
    expect(db.rows("profiles")[0]).toMatchObject({ notify_morning: "07:30:00", notify_evening: "21:00:00" });
    said(`${MON}T22:00:00`); // she opens the app again
    event(db, "2026-11-17T10:15:00", "Vorlesung Statistik");
    expect(await dispatch(sb, send, at("2026-11-17T07:31:00"))).toBe(1);
  });

  it("comes 90 minutes later on Saturday at the default time (only the morning)", async () => {
    const { db, sent, send, said, sb } = setup();
    said("2026-11-20T20:00:00");
    event(db, "2026-11-21T11:00:00", "Markt mit Jonas");
    expect(await dispatch(sb, send, at("2026-11-21T07:31:00"))).toBe(0);
    expect(await dispatch(sb, send, at("2026-11-21T09:01:00"))).toBe(1);
    expect(sent[0].body).toBe("Heute: 11:00 Markt mit Jonas.");
    // the evening at its usual time, not at 22:30 (it would land after bedtime)
    db.insert("goal_time", { user_id: LEA, goal_id: "g-run", day: "2026-11-21", minutes: 45, source: "block" });
    expect(await dispatch(sb, send, at("2026-11-21T21:01:00"))).toBe(1);
    expect(sent[1].body).toMatch(/45 Minuten/);
  });

  it("comes at 09:00 summer time (CEST) on a Saturday, and names the day's entry", async () => {
    const { db, sent, send, sb } = setup();
    db.insert("messages", { user_id: LEA, thread: "2026-07-03", role: "user", content: "…", hidden: false, created_at: "2026-07-03T18:00:00Z" });
    db.insert("events", { user_id: LEA, title: "Seeüberquerung", starts_at: "2026-07-04T09:00:00Z", ends_at: null, all_day: false, kind: "termin", goal_id: null });
    expect(await dispatch(sb, send, new Date("2026-07-04T05:31:00Z"))).toBe(0); // 07:31 CEST
    expect(await dispatch(sb, send, new Date("2026-07-04T07:01:00Z"))).toBe(1); // 09:01 CEST
    expect(sent[0].body).toBe("Heute: 11:00 Seeüberquerung.");
    expect(db.rows("push_log")[0]).toMatchObject({ day: "2026-07-04", slot: "morning" });
  });

  it("names an all-day entry over several days that began before the last three days", async () => {
    const { db, sent, send, said, sb } = setup();
    said("2026-11-15T20:00:00");
    // ten days of holidays: from the 11th to the 20th (ends_at is the local midnight of the last day)
    event(db, "2026-11-11T00:00:00", "Ferien im Tessin", { all_day: true, ends_at: at("2026-11-20T00:00:00").toISOString() });
    // one that is already over, and one that started long ago on a single day
    event(db, "2026-11-01T00:00:00", "Herbstlager", { all_day: true, ends_at: at("2026-11-08T00:00:00").toISOString() });
    event(db, "2026-11-02T00:00:00", "Abgabe", { all_day: true });
    expect(await dispatch(sb, send, at(`${MON}T07:31:00`))).toBe(1);
    expect(sent[0].body).toBe("Heute: Ferien im Tessin.");
  });

  it("names a step due today, never one that is done or of a dream", async () => {
    const { db, sent, send, said, sb } = setup();
    said("2026-11-15T20:00:00");
    db.insert("milestones", { user_id: LEA, goal_id: "g-run", title: "Startnummer abholen", due_date: MON, done_at: null });
    db.insert("milestones", { user_id: LEA, goal_id: "g-run", title: "Schon erledigt", due_date: MON, done_at: at(`${MON}T06:00:00`).toISOString() });
    db.insert("milestones", { user_id: LEA, goal_id: "g-island", title: "Flüge vergleichen", due_date: MON, done_at: null });
    db.insert("milestones", { user_id: LEA, goal_id: "g-run", title: "Morgen", due_date: "2026-11-17", done_at: null });
    await dispatch(sb, send, at(`${MON}T07:31:00`));
    expect(sent[0].body).toBe("Heute an der Reihe: Startnummer abholen.");
  });

  it("when her entries can't be read: nothing (no filler, never «nothing planned»)", async () => {
    const { db, sent, send, said, sb } = setup();
    said("2026-11-15T20:00:00");
    event(db, `${MON}T10:15:00`, "Vorlesung Statistik");
    db.erroring.add("events");
    expect(await dispatch(sb, send, at(`${MON}T07:31:00`))).toBe(0);
    expect(sent).toHaveLength(0);
    expect(db.rows("push_log")[0]).toMatchObject({ slot: "morning", status: "skipped", reason: "empty", template: null });
  });

  it("nothing of her own to say: no message, decided once («empty»)", async () => {
    const { db, sent, send, said, sb } = setup();
    said("2026-11-15T20:00:00");
    expect(await dispatch(sb, send, at(`${MON}T07:31:00`))).toBe(0);
    expect(await dispatch(sb, send, at(`${MON}T21:05:00`))).toBe(0);
    expect(sent).toHaveLength(0);
    expect(db.rows("push_log").map((r) => [r.slot, r.reason])).toEqual([
      ["morning", "empty"],
      ["evening", "empty"],
    ]);
  });

  it("the evening without a win names one of her own finished entries of the day, never work or something sensitive", async () => {
    const { db, sent, send, said, sb } = setup();
    said(`${MON}T08:00:00`);
    event(db, `${MON}T08:00:00`, "Schicht Station 3", { ends_at: at(`${MON}T16:00:00`).toISOString() });
    event(db, `${MON}T17:00:00`, "Physio Knie", { ends_at: at(`${MON}T17:45:00`).toISOString() });
    event(db, `${MON}T18:30:00`, "Malen mit Lina", { ends_at: at(`${MON}T19:30:00`).toISOString() });
    event(db, `${MON}T22:00:00`, "Später", { ends_at: at(`${MON}T23:00:00`).toISOString() });
    expect(await dispatch(sb, send, at(`${MON}T21:05:00`))).toBe(1);
    expect(sent[0].body).toBe("Heute war: 18:30 Malen mit Lina.");
    expect(db.rows("push_log")[0].named).toEqual([fingerprint("Malen mit Lina")]);
  });

  it("waits while one of her entries runs and ends within the hour, else leaves it out («busy»)", async () => {
    const one = setup();
    one.said("2026-11-15T20:00:00");
    event(one.db, `${MON}T07:00:00`, "Joggen", { ends_at: at(`${MON}T07:50:00`).toISOString() });
    event(one.db, `${MON}T10:15:00`, "Vorlesung Statistik");
    expect(await dispatch(one.sb, one.send, at(`${MON}T07:31:00`))).toBe(0);
    expect(await dispatch(one.sb, one.send, at(`${MON}T07:46:00`))).toBe(0);
    expect(one.db.rows("push_log")).toHaveLength(0); // not decided yet
    expect(await dispatch(one.sb, one.send, at(`${MON}T08:01:00`))).toBe(1);
    expect(one.sent[0].body).toBe("Heute: 10:15 Vorlesung Statistik.");

    const two = setup();
    two.said("2026-11-15T20:00:00");
    event(two.db, `${MON}T06:45:00`, "Frühdienst", { ends_at: at(`${MON}T15:00:00`).toISOString() });
    event(two.db, `${MON}T17:00:00`, "Chor");
    expect(await dispatch(two.sb, two.send, at(`${MON}T07:31:00`))).toBe(0);
    expect(two.db.rows("push_log")[0]).toMatchObject({ slot: "morning", status: "skipped", reason: "busy" });
  });

  it("after an entry that ended after 22:00 the morning comes two hours later, or not at all after 11:00", async () => {
    const one = setup();
    one.said("2026-11-15T20:00:00");
    event(one.db, "2026-11-15T14:00:00", "Spätdienst", { ends_at: at("2026-11-15T22:30:00").toISOString() });
    event(one.db, `${MON}T12:00:00`, "Mittag mit Sara");
    expect(await dispatch(one.sb, one.send, at(`${MON}T07:31:00`))).toBe(0);
    expect(one.db.rows("push_log")).toHaveLength(0);
    expect(await dispatch(one.sb, one.send, at(`${MON}T09:31:00`))).toBe(1);
    expect(one.sent[0].body).toBe("Heute: 12:00 Mittag mit Sara.");

    // Saturday at the default time (09:00) + 2 h would be after 11:00? 11:00 itself still comes; from her own 09:30 on, none
    const two = setup();
    two.db.rows("profiles")[0].notify_morning = "09:30:00";
    two.said("2026-11-15T20:00:00");
    event(two.db, "2026-11-15T14:00:00", "Spätdienst", { ends_at: at("2026-11-15T23:00:00").toISOString() });
    event(two.db, `${MON}T14:00:00`, "Mittag mit Sara");
    expect(await dispatch(two.sb, two.send, at(`${MON}T09:31:00`))).toBe(0);
    expect(two.db.rows("push_log")[0]).toMatchObject({ slot: "morning", status: "skipped", reason: "late_night" });
  });

  it("an entry of every day is named at most twice in 7 days (in the morning)", async () => {
    const { db, sent, send, said, sb } = setup();
    db.rows("profiles")[0].notify_morning = "07:15:00";
    for (let i = 0; i < 14; i++) {
      const day = addDays(MON, i);
      said(`${addDays(day, -1)}T20:00:00`);
      event(db, `${day}T21:30:00`, "10 Minuten dehnen");
      await dispatch(sb, send, at(`${day}T07:16:00`));
    }
    expect(sent.map((s) => s.body.includes("dehnen"))).toEqual(sent.map(() => true));
    // the first two days (not yet «every day»), then at most twice in any 7 days
    expect(sent.length).toBe(4);
    expect(sent[0].body).toBe("Heute Abend um 21:30: 10 Minuten dehnen.");
  });

  it("after a few days away: one line from her own data, then nothing until she opens the app", async () => {
    const { db, sent, send, said, sb } = setup();
    said("2026-11-13T20:00:00"); // 2½ days before the morning
    event(db, "2026-11-17T09:00:00", "Vorlesung Statistik");
    expect(await dispatch(sb, send, at(`${MON}T07:31:00`))).toBe(1);
    expect(sent[0].body).toBe("Morgen: 09:00 Vorlesung Statistik.");
    expect(sent[0].body).not.toMatch(/Pause|lange|vermiss|wieder/i);
    expect(db.rows("push_log")[0].template).toMatch(/^p\./);
    // the evening and the next days: silent
    db.insert("goal_time", { user_id: LEA, goal_id: "g-run", day: MON, minutes: 45, source: "person" });
    expect(await dispatch(sb, send, at(`${MON}T21:05:00`))).toBe(0);
    expect(await dispatch(sb, send, at("2026-11-17T07:31:00"))).toBe(0);
    expect(db.rows("push_log").slice(1).map((r) => r.reason)).toEqual(["paused", "paused"]);
    // she opens the app: back to normal
    said("2026-11-17T12:00:00");
    event(db, "2026-11-18T10:00:00", "Chor");
    expect(await dispatch(sb, send, at("2026-11-18T07:31:00"))).toBe(1);
  });

  it("when her goals can't be read: times only, so no dream slips through a free title", async () => {
    const { db, sent, send, said, sb } = setup();
    said("2026-11-15T20:00:00");
    event(db, `${MON}T11:00:00`, "Island-Reise buchen");
    db.erroring.add("goals");
    await dispatch(sb, send, at(`${MON}T07:31:00`));
    expect(sent[0].body).toBe("Heute: 11:00 Termin.");
  });

  it("counts the pause from her sign-up (profiles.created_at) while she has no message yet", async () => {
    const { db, sent, send, sb } = setup();
    db.rows("profiles")[0].created_at = "2026-10-20T10:00:00Z";
    expect(await dispatch(sb, send, at(`${MON}T07:31:00`))).toBe(0);
    expect(db.rows("push_log")[0]).toMatchObject({ reason: "paused" });
    db.rows("profiles")[0].created_at = "2026-11-16T10:00:00Z";
    db.insert("goal_time", { user_id: LEA, goal_id: "g-run", day: MON, minutes: 45, source: "person" });
    expect(await dispatch(sb, send, at(`${MON}T21:05:00`))).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("only asks people with a time set", async () => {
    const { db, sent, send, said, sb } = setup();
    said("2026-11-15T20:00:00");
    event(db, `${MON}T10:15:00`, "Vorlesung Statistik");
    event(db, `${MON}T10:15:00`, "Vorlesung", { user_id: "u-off" });
    db.insert("profiles", { ...db.rows("profiles")[0], id: "u-off", display_name: "Off", notify_morning: null, notify_evening: null });
    db.insert("push_subscriptions", { id: "s3", user_id: "u-off", endpoint: "https://push.example/3", p256dh: "k", auth: "a", app_url: null });
    expect(await dispatch(sb, send, at(`${MON}T07:31:00`))).toBe(1);
    expect(sent.map((s) => s.to)).toEqual([["s1"]]);
    expect(db.rows("push_log").map((r) => r.user_id)).toEqual([LEA]);
  });

  it("rotates: the same data for two weeks, no identical body within 7 days", async () => {
    const { db, sent, send, said, sb } = setup();
    db.rows("profiles")[0].notify_morning = "07:15:00"; // her own time: the same on the weekend
    for (let i = 0; i < 14; i++) {
      const day = addDays(MON, i);
      said(`${addDays(day, -1)}T20:00:00`);
      db.insert("milestones", { user_id: LEA, goal_id: "g-run", title: "Intervalle laufen", due_date: day, done_at: null });
      await dispatch(sb, send, at(`${day}T07:16:00`));
    }
    expect(sent).toHaveLength(14);
    for (let i = 0; i < sent.length; i++) for (let j = i + 1; j < Math.min(sent.length, i + 7); j++) expect(sent[j].body).not.toBe(sent[i].body);
    expect(sent.every((s) => s.body.includes("Intervalle laufen") && !s.body.includes("?"))).toBe(true);
  });

  it("still works without the log table (migration not run yet)", async () => {
    const { db, sent, send, said, sb } = setup();
    db.missing.add("push_log");
    said("2026-11-15T20:00:00");
    event(db, `${MON}T10:15:00`, "Vorlesung Statistik");
    expect(await dispatch(sb, send, at(`${MON}T07:31:00`))).toBe(1);
    expect(await dispatch(sb, send, at(`${MON}T07:46:00`))).toBe(0); // last_morning_push still guards the day
    expect(sent).toHaveLength(1);
  });

  it("nothing without a device, and nothing decided then", async () => {
    const { db, sent, send, sb } = setup();
    db.tables.push_subscriptions = [];
    expect(await dispatch(sb, send, at(`${MON}T07:31:00`))).toBe(0);
    expect(sent).toHaveLength(0);
    expect(db.rows("push_log")).toHaveLength(0);
    expect(db.rows("profiles")[0].last_morning_push).toBeNull();
  });

  it("one person's trouble does not stop the others", async () => {
    const { db, sent, send, said, sb } = setup();
    said("2026-11-15T20:00:00");
    db.insert("profiles", { ...db.rows("profiles")[0], id: "u-max", display_name: "Max" });
    db.insert("push_subscriptions", { id: "s2", user_id: "u-max", endpoint: "https://push.example/2", p256dh: "k", auth: "a", app_url: null });
    db.insert("messages", { user_id: "u-max", thread: "2026-11-15", role: "user", content: "…", hidden: false, created_at: at("2026-11-15T19:00:00").toISOString() });
    event(db, `${MON}T10:15:00`, "Vorlesung", { user_id: "u-max" });
    db.failing.set("messages", LEA);
    expect(await dispatch(sb, send, at(`${MON}T07:31:00`))).toBe(1);
    expect(sent.map((s) => s.title)).toEqual(["Guten Morgen, Max"]);
  });

  describe("reminders («Blöcke und Wunsch»)", () => {
    /** Lea with the reminders on, no calendar subscription, and the morning and evening off (only reminders) */
    const reminderSetup = () => {
      const t = setup();
      Object.assign(t.db.rows("profiles")[0], { notify_morning: null, notify_evening: null, notify_reminders: true, calendar_fetched_at: null });
      t.said("2026-11-15T20:00:00");
      return t;
    };
    const block = (db: FakeDb, local: string, title: string, extra: Row = {}) =>
      event(db, local, title, { id: `e-${title}`, kind: "block", goal_id: "g-run", reminder_minutes: 10, source: "coach", ends_at: new Date(at(local).getTime() + 30 * 60000).toISOString(), ...extra });

    it("comes once, at starts_at − reminder_minutes, in the run before that moment, never late", async () => {
      const { db, sent, send, sb } = reminderSetup();
      block(db, `${MON}T10:00:00`, "Intervalle");
      expect(await dispatch(sb, send, at(`${MON}T09:31:00`))).toBe(0); // 09:50 is not in this run's 15 minutes
      expect(await dispatch(sb, send, at(`${MON}T09:46:00`))).toBe(1);
      expect(sent).toEqual([{ to: ["s1"], title: "Um 10:00", body: "Intervalle." }]);
      expect(await dispatch(sb, send, at(`${MON}T09:51:00`))).toBe(0); // the push log: once per entry
      expect(await dispatch(sb, send, at(`${MON}T10:01:00`))).toBe(0); // it began: never late
      const log = db.rows("push_log");
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ slot: "reminder", event_id: "e-Intervalle", status: "sent", template: "r.block", devices: 1 });
      expect(JSON.stringify(log.map(({ event_id: _, ...r }) => r))).not.toMatch(/Intervalle/); // the log keeps no text
    });

    it("a missed run a few minutes late still reminds while the entry has not begun", async () => {
      const { db, sent, send, sb } = reminderSetup();
      block(db, `${MON}T10:00:00`, "Intervalle");
      expect(await dispatch(sb, send, at(`${MON}T09:53:00`))).toBe(1); // 3 minutes after 09:50
      expect(sent[0].title).toBe("Um 10:00");
    });

    it("at most three a day", async () => {
      const { db, sent, send, sb } = reminderSetup();
      for (const [i, h] of ["08", "10", "12", "14"].entries()) block(db, `${MON}T${h}:00:00`, `Block ${i + 1}`);
      for (const h of ["07:46", "09:46", "11:46", "13:46"]) await dispatch(sb, send, at(`${MON}T${h}:00`));
      expect(sent.map((x) => x.body)).toEqual(["Block 1.", "Block 2.", "Block 3."]);
    });

    it("none with the iPhone calendar subscribed (its own alarm), with the switch off, without a device", async () => {
      const one = reminderSetup();
      one.db.rows("profiles")[0].calendar_fetched_at = at(`${MON}T06:00:00`).toISOString();
      block(one.db, `${MON}T10:00:00`, "Intervalle");
      expect(await dispatch(one.sb, one.send, at(`${MON}T09:46:00`))).toBe(0);
      // a subscription not fetched for more than 3 days counts as gone: reminders come again
      one.db.rows("profiles")[0].calendar_fetched_at = at("2026-11-12T06:00:00").toISOString();
      expect(await dispatch(one.sb, one.send, at(`${MON}T09:47:00`))).toBe(1);

      const two = reminderSetup();
      two.db.rows("profiles")[0].notify_reminders = false;
      block(two.db, `${MON}T10:00:00`, "Intervalle");
      expect(await dispatch(two.sb, two.send, at(`${MON}T09:46:00`))).toBe(0);

      const three = reminderSetup();
      three.db.tables.push_subscriptions = [];
      block(three.db, `${MON}T10:00:00`, "Intervalle");
      expect(await dispatch(three.sb, three.send, at(`${MON}T09:46:00`))).toBe(0);
      expect(three.db.rows("push_log")).toHaveLength(0);
    });

    it("never for her trainer's entries (Nolio), never for a termin she did not ask about, never for an answered block", async () => {
      const { db, sent, send, sb } = reminderSetup();
      block(db, `${MON}T10:00:00`, "Intervalle Nolio", { source: "nolio" });
      event(db, `${MON}T10:00:00`, "Zahnreinigung", { id: "e-t", kind: "termin", reminder_minutes: 10, source: "coach" });
      block(db, `${MON}T10:00:00`, "Schon gemacht");
      db.insert("goal_time", { user_id: LEA, goal_id: "g-run", day: MON, minutes: 30, source: "block", event_id: "e-Schon gemacht" });
      expect(await dispatch(sb, send, at(`${MON}T09:46:00`))).toBe(0);
      expect(sent).toHaveLength(0);
    });

    it("a reminder she asked for comes for a termin too, with her own title, also a dream step's; never a sensitive one", async () => {
      const { db, sent, send, sb } = reminderSetup();
      event(db, `${MON}T10:00:00`, "Nachricht an die Stationsleitung", { id: "e-1", kind: "termin", goal_id: "g-island", reminder_minutes: 0, reminder_asked: true, source: "coach" });
      event(db, `${MON}T12:00:00`, "Physio Knie", { id: "e-2", kind: "termin", reminder_minutes: 15, reminder_asked: true, source: "coach" });
      // a dream's block she did not ask for: no reminder at all (dreams are never pushed); one she asked for: her title
      block(db, `${MON}T14:00:00`, "Island: Flüge vergleichen", { goal_id: "g-island" });
      block(db, `${MON}T16:00:00`, "Island: Flüge buchen", { goal_id: "g-island", reminder_asked: true });
      await dispatch(sb, send, at(`${MON}T09:46:00`));
      await dispatch(sb, send, at(`${MON}T11:31:00`));
      await dispatch(sb, send, at(`${MON}T13:46:00`));
      await dispatch(sb, send, at(`${MON}T15:46:00`));
      expect(sent.map((x) => `${x.title} · ${x.body}`)).toEqual(["Um 10:00 · Nachricht an die Stationsleitung.", "Um 12:00 · Dein Termin.", "Um 16:00 · Island: Flüge buchen."]);
      expect(db.rows("push_log").map((r) => r.event_id)).toEqual(["e-1", "e-2", "e-Island: Flüge buchen"]);
    });

    it("once per entry also across midnight: the run before and the one after it share the day of its moment", async () => {
      const { db, sent, send, sb } = reminderSetup();
      event(db, "2026-11-17T00:05:00", "Nachtzug nach Wien", { id: "e-n", kind: "termin", reminder_minutes: 10, reminder_asked: true, source: "coach" });
      expect(await dispatch(sb, send, at(`${MON}T23:45:00`))).toBe(1);
      expect(await dispatch(sb, send, at("2026-11-17T00:00:00"))).toBe(0);
      expect(sent.map((x) => `${x.title} · ${x.body}`)).toEqual(["Morgen um 00:05 · Nachtzug nach Wien."]);
      expect(db.rows("push_log")).toMatchObject([{ day: MON, slot: "reminder", event_id: "e-n", devices: 1 }]);
    });

    it("her blocks leave room for what she asked for later today (the three a day never crowd hers out)", async () => {
      const { db, sent, send, sb } = reminderSetup();
      block(db, `${MON}T08:00:00`, "Intervalle");
      block(db, `${MON}T09:00:00`, "Kraft");
      event(db, `${MON}T15:00:00`, "Bank anrufen", { id: "e-bank", kind: "termin", reminder_minutes: 10, reminder_asked: true, source: "coach" });
      event(db, `${MON}T18:00:00`, "Paket holen", { id: "e-paket", kind: "termin", reminder_minutes: 10, reminder_asked: true, source: "coach" });
      for (const h of ["07:46", "08:46", "14:46", "17:46"]) await dispatch(sb, send, at(`${MON}T${h}:00`));
      expect(sent.map((x) => x.body)).toEqual(["Intervalle.", "Bank anrufen.", "Paket holen."]);
    });

    it("someone with a time and a reminder is asked once (one reminder, not two)", async () => {
      const { db, sent, send, said, sb } = setup();
      said("2026-11-15T20:00:00");
      Object.assign(db.rows("profiles")[0], { notify_reminders: true, calendar_fetched_at: null });
      block(db, `${MON}T10:00:00`, "Intervalle");
      expect(await dispatch(sb, send, at(`${MON}T09:46:00`))).toBe(1);
      expect(sent.map((x) => x.body)).toEqual(["Intervalle."]);
    });

    it("away for a few days: her blocks rest, what she asked for still comes; after 14 days nothing", async () => {
      const { db, sent, send, said, sb } = reminderSetup();
      db.tables.messages = [];
      said("2026-11-12T20:00:00");
      block(db, `${MON}T10:00:00`, "Intervalle");
      event(db, `${MON}T10:00:00`, "Paket abholen", { id: "e-p", kind: "termin", reminder_minutes: 10, reminder_asked: true, source: "person" });
      expect(await dispatch(sb, send, at(`${MON}T09:46:00`))).toBe(1);
      expect(sent.map((x) => x.body)).toEqual(["Paket abholen."]);
      db.tables.messages = [];
      said("2026-11-01T20:00:00");
      event(db, `${MON}T12:00:00`, "Paket bringen", { id: "e-q", kind: "termin", reminder_minutes: 10, reminder_asked: true, source: "person" });
      expect(await dispatch(sb, send, at(`${MON}T11:46:00`))).toBe(0);
    });

    it("without the push log (migration not run) no reminder at all, the morning still comes", async () => {
      const { db, sent, send, sb } = reminderSetup();
      db.missing.add("push_log");
      Object.assign(db.rows("profiles")[0], { notify_morning: "07:30:00" });
      block(db, `${MON}T07:50:00`, "Intervalle");
      expect(await dispatch(sb, send, at(`${MON}T07:36:00`))).toBe(1);
      expect(sent.map((x) => x.title)).toEqual(["Guten Morgen, Lea"]);
    });
  });

  it("removes log rows after a while", async () => {
    const { db, send, sb } = setup();
    db.insert("push_log", { user_id: LEA, day: addDays(MON, -LOG_KEEP_DAYS - 1), slot: "morning", status: "sent" });
    db.insert("push_log", { user_id: LEA, day: addDays(MON, -3), slot: "morning", status: "sent" });
    await dispatch(sb, send, at(`${MON}T12:00:00`));
    expect(db.rows("push_log").map((r) => r.day)).toEqual([addDays(MON, -3)]);
  });
});
