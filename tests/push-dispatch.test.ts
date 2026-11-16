// The dispatch of the Edge Function "push" (supabase/functions/push/dispatch.ts) against a small
// in-memory stand-in for the Supabase client: it decides each slot once a day (also when two runs
// overlap), leaves it out when she was already there or after 14 quiet days without touching her
// settings, keeps the log without any text, rotates the bodies and still works without the log table.
import { describe, expect, it } from "vitest";
import { dispatch, LOG_KEEP_DAYS, type Send, type Sub } from "../supabase/functions/push/dispatch";
import { addDays, fingerprint } from "../supabase/functions/_shared/push_text";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code?: string; message?: string } | null };

/** just enough of the query builder for the dispatch: select/update/delete/upsert, eq/gte/lte/lt/in, order, limit */
class FakeDb {
  tables: Record<string, Row[]> = {};
  missing = new Set<string>();
  failing = new Map<string, string>(); // table → user_id whose queries fail
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
  constructor(
    private db: FakeDb,
    private table: string,
  ) {}
  select() {
    return this;
  }
  or() {
    return this; // profiles with a time set: the test only has those
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
    const all = this.db.rows(this.table);
    if (this.op === "upsert") {
      const inserted: Row[] = [];
      for (const r of this.upsertRows) {
        if (all.some((x) => this.conflict.every((c) => x[c] === r[c]))) continue; // ignoreDuplicates
        this.db.insert(this.table, r);
        inserted.push(all[all.length - 1]);
      }
      return { data: inserted, error: null };
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
      hit = [...hit].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.max !== null) hit = hit.slice(0, this.max);
    return { data: hit.map((r) => ({ ...r })), error: null };
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
    const { sent, send, said, sb } = setup();
    said("2026-11-15T20:00:00");
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
    expect(await dispatch(sb, send, at("2026-11-17T07:31:00"))).toBe(1);
  });

  it("comes 90 minutes later on Saturday at the default time", async () => {
    const { sent, send, said, sb } = setup();
    said("2026-11-20T20:00:00");
    expect(await dispatch(sb, send, at("2026-11-21T07:31:00"))).toBe(0);
    expect(await dispatch(sb, send, at("2026-11-21T09:01:00"))).toBe(1);
    expect(sent[0].body).toBe("Heute steht nichts im Kalender. Der Tag gehört dir.");
  });

  it("rotates: the same data for two weeks, no identical body within 7 days", async () => {
    const { db, sent, send, said, sb } = setup();
    db.rows("profiles")[0].notify_morning = "07:15:00"; // her own time: the same on the weekend
    for (let i = 0; i < 14; i++) {
      const day = addDays(MON, i);
      said(`${addDays(day, -1)}T20:00:00`);
      event(db, `${day}T08:00:00`, "Arbeit");
      await dispatch(sb, send, at(`${day}T07:16:00`));
    }
    expect(sent).toHaveLength(14);
    for (let i = 0; i < sent.length; i++) for (let j = i + 1; j < Math.min(sent.length, i + 7); j++) expect(sent[j].body).not.toBe(sent[i].body);
    expect(sent.every((s) => s.body.includes("08:00") && !s.body.includes("?"))).toBe(true);
  });

  it("still works without the log table (migration not run yet)", async () => {
    const { db, sent, send, said, sb } = setup();
    db.missing.add("push_log");
    said("2026-11-15T20:00:00");
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
    db.failing.set("messages", LEA);
    expect(await dispatch(sb, send, at(`${MON}T07:31:00`))).toBe(1);
    expect(sent.map((s) => s.title)).toEqual(["Guten Morgen, Max"]);
  });

  it("removes log rows after a while", async () => {
    const { db, send, sb } = setup();
    db.insert("push_log", { user_id: LEA, day: addDays(MON, -LOG_KEEP_DAYS - 1), slot: "morning", status: "sent" });
    db.insert("push_log", { user_id: LEA, day: addDays(MON, -3), slot: "morning", status: "sent" });
    await dispatch(sb, send, at(`${MON}T12:00:00`));
    expect(db.rows("push_log").map((r) => r.day)).toEqual([addDays(MON, -3)]);
  });
});
