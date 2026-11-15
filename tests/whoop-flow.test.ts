// The WHOOP link from start to confirmation, end to end through the real handlers of
// supabase/functions/_shared/whoop_server.ts: Supabase is an in-memory fake (only what these routes
// use, with the unique keys and cascades of 20261117000000_whoop.sql; one statement at a time, like
// PostgREST), WHOOP a fake fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

// ---------- an in-memory Supabase (service role and logins) ----------

const db: Record<string, Row[]> = {};
const reset = () => {
  for (const t of ["profiles", "connections", "whoop_tokens", "whoop_pending", "whoop_oauth_states", "whoop_days", "whoop_webhook_seen", "messages"]) db[t] = [];
};
reset();

class DbError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/** Unique keys (null values never collide) and the cascade from a connection to its tokens and days. */
const UNIQUE: Record<string, string[][]> = {
  connections: [["user_id", "provider"], ["provider", "external_user_id"]],
  whoop_tokens: [["user_id"], ["confirm_hash"]],
  whoop_pending: [["user_id"], ["confirm_hash"]],
  whoop_oauth_states: [["state"]],
  whoop_days: [["user_id", "day"]],
  whoop_webhook_seen: [["trace_id"]],
  profiles: [["id"]],
  messages: [["id"]],
};
function checkUnique(table: string, rows: Row[]) {
  for (const key of UNIQUE[table] ?? []) {
    const seen = new Set<string>();
    for (const r of rows) {
      if (key.some((k) => r[k] === null || r[k] === undefined)) continue;
      const v = key.map((k) => String(r[k])).join("|");
      if (seen.has(v)) throw new DbError("23505", `duplicate key ${table}(${key.join(",")})`);
      seen.add(v);
    }
  }
}
function cascade(table: string, gone: Row[]) {
  if (table !== "connections") return;
  for (const c of gone) for (const t of ["whoop_tokens", "whoop_days"]) db[t] = db[t].filter((r) => r.user_id !== c.user_id);
}

type Filter = (r: Row) => boolean;
const val = (r: Row, col: string): unknown => {
  if (col.includes(".")) {
    const [rel, c] = col.split(".");
    return (r[rel] as Row | undefined)?.[c];
  }
  return r[col];
};
const cmp = (a: unknown, b: unknown) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
function orFilter(expr: string): Filter {
  const parts = expr.split(",").map((p) => {
    const [col, op, ...rest] = p.split(".");
    const raw = rest.join(".").replace(/^"|"$/g, "");
    return (r: Row) => {
      const v = r[col];
      if (op === "is") return raw === "null" ? v === null || v === undefined : String(v) === raw;
      if (v === null || v === undefined) return false;
      if (op === "lt") return cmp(v, raw) < 0;
      if (op === "gt") return cmp(v, raw) > 0;
      if (op === "eq") return String(v) === raw;
      if (op === "neq") return String(v) !== raw;
      throw new Error(`or: ${op}`);
    };
  });
  return (r) => parts.some((f) => f(r));
}

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Filter[] = [];
  private op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private payload: Row | Row[] | null = null;
  private returning = false;
  private cols = "*";
  private one: "many" | "single" | "maybe" = "many";
  private sort: [string, boolean][] = [];
  private max = Infinity;
  private conflict: string[] = [];
  private ignoreDup = false;
  constructor(private table: string) {}
  select(cols = "*") {
    if (this.op === "select") this.cols = cols;
    else this.returning = true;
    return this;
  }
  insert(p: Row | Row[]) {
    this.op = "insert";
    this.payload = p;
    return this;
  }
  upsert(p: Row | Row[], o: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = "upsert";
    this.payload = p;
    this.conflict = (o.onConflict ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    this.ignoreDup = !!o.ignoreDuplicates;
    return this;
  }
  update(p: Row) {
    this.op = "update";
    this.payload = p;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push((r) => val(r, c) === v);
    return this;
  }
  neq(c: string, v: unknown) {
    this.filters.push((r) => val(r, c) !== v);
    return this;
  }
  lt(c: string, v: unknown) {
    this.filters.push((r) => val(r, c) !== null && val(r, c) !== undefined && cmp(val(r, c), v) < 0);
    return this;
  }
  lte(c: string, v: unknown) {
    this.filters.push((r) => val(r, c) !== null && cmp(val(r, c), v) <= 0);
    return this;
  }
  gt(c: string, v: unknown) {
    this.filters.push((r) => val(r, c) !== null && val(r, c) !== undefined && cmp(val(r, c), v) > 0);
    return this;
  }
  gte(c: string, v: unknown) {
    this.filters.push((r) => val(r, c) !== null && cmp(val(r, c), v) >= 0);
    return this;
  }
  in(c: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(val(r, c)));
    return this;
  }
  not(c: string, op: string, v: unknown) {
    if (op === "in") {
      const list = String(v).replace(/^\(|\)$/g, "").split(",");
      this.filters.push((r) => !list.includes(String(val(r, c))));
    } else if (op === "is") this.filters.push((r) => val(r, c) !== null && val(r, c) !== undefined);
    else throw new Error(`not: ${op}`);
    return this;
  }
  or(expr: string) {
    this.filters.push(orFilter(expr));
    return this;
  }
  order(c: string, o: { ascending?: boolean } = {}) {
    this.sort.push([c, o.ascending !== false]);
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    this.one = "maybe";
    return this;
  }
  single() {
    this.one = "single";
    return this;
  }
  private rows(): Row[] {
    if (/!inner|\(/.test(this.cols)) throw new Error(`embedded selects are not part of this fake: ${this.cols}`);
    return db[this.table].map((r) => ({ ...r })).filter((r) => this.filters.every((f) => f(r)));
  }
  private run(): { data: unknown; error: unknown } {
    try {
      const now = new Date().toISOString();
      let out: Row[] = [];
      if (this.op === "select") {
        out = this.rows();
        for (const [c, asc] of [...this.sort].reverse()) out.sort((a, b) => (asc ? 1 : -1) * cmp(a[c], b[c]));
        out = out.slice(0, this.max);
      } else if (this.op === "insert" || this.op === "upsert") {
        const items = (Array.isArray(this.payload) ? this.payload : [this.payload!]).map((p) => ({ ...p }));
        const next = db[this.table].map((r) => ({ ...r }));
        for (const item of items) {
          const hit = this.op === "upsert" ? next.find((r) => this.conflict.every((k) => r[k] === item[k])) : undefined;
          if (hit) {
            if (this.ignoreDup) continue;
            Object.assign(hit, item, { updated_at: now });
            out.push(hit);
          } else {
            const row = { ...defaults(this.table, now), ...item };
            next.push(row);
            out.push(row);
          }
        }
        checkUnique(this.table, next);
        db[this.table] = next;
      } else if (this.op === "update") {
        const hits = new Set(this.rows().map((r) => keyOf(this.table, r)));
        const next = db[this.table].map((r) => (hits.has(keyOf(this.table, r)) ? { ...r, ...this.payload, updated_at: now } : { ...r }));
        checkUnique(this.table, next);
        db[this.table] = next;
        out = next.filter((r) => hits.has(keyOf(this.table, r)));
      } else {
        const hits = new Set(this.rows().map((r) => keyOf(this.table, r)));
        out = db[this.table].filter((r) => hits.has(keyOf(this.table, r)));
        db[this.table] = db[this.table].filter((r) => !hits.has(keyOf(this.table, r)));
        cascade(this.table, out);
      }
      const shaped = this.op === "select" || this.returning ? out : null;
      if (this.one === "many") return { data: shaped, error: null };
      if (this.one === "single" && out.length !== 1) return { data: null, error: new DbError("PGRST116", "not one row") };
      if (out.length > 1) return { data: null, error: new DbError("PGRST116", "more than one row") };
      return { data: out[0] ?? null, error: null };
    } catch (e) {
      return { data: null, error: e };
    }
  }
  then<A = { data: unknown; error: unknown }, B = never>(ok?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null) {
    // like PostgREST: one statement at a time, answered asynchronously
    return Promise.resolve()
      .then(() => this.run())
      .then(ok, bad);
  }
}
const keyOf = (table: string, r: Row) => (UNIQUE[table]?.[0] ?? ["id"]).map((k) => String(r[k])).join("|");
const defaults = (table: string, now: string): Row =>
  table === "connections"
    ? { status: "connected", consent_ai: false, external_user_id: null, connected_at: now, last_sync_at: null, last_error: null, manual_sync_at: null, updated_at: now }
    : table === "whoop_oauth_states" || table === "whoop_pending"
      ? { created_at: now }
      : table === "whoop_tokens"
        ? { refresh_lock: null, refresh_lock_until: null, confirm_hash: null, confirm_until: null }
        : table === "messages"
          ? { whoop: false, hidden: false, created_at: now }
          : {};

const fakeClient = {
  from: (t: string) => new Query(t),
  rpc: async () => ({ data: null, error: new DbError("42883", "no rpc in this fake") }),
  auth: {
    getUser: async (token: string) =>
      token.startsWith("jwt-") ? { data: { user: { id: token.slice(4) } }, error: null } : { data: { user: null }, error: new Error("bad jwt") },
  },
};
vi.mock("npm:@supabase/supabase-js@2.119.0", () => ({ createClient: () => fakeClient }));

// ---------- a fake WHOOP ----------

const env: Record<string, string> = {};
const calls: { method: string; url: string; token?: string }[] = [];
let grantFor: Record<string, string> = {}; // authorization code → WHOOP user id
let issued = 0;
const tokenOwner: Record<string, string> = {}; // access token → WHOOP user id
const refreshOwner: Record<string, string> = {}; // refresh token → WHOOP user id (used once: they rotate)

async function whoopFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input);
  const method = init.method ?? "GET";
  const auth = new Headers(init.headers).get("Authorization")?.replace("Bearer ", "");
  calls.push({ method, url, token: auth });
  if (url.endsWith("/oauth/oauth2/token")) {
    const body = new URLSearchParams(String(init.body));
    const refresh = body.get("grant_type") === "refresh_token" ? (body.get("refresh_token") ?? "") : null;
    const who = refresh !== null ? refreshOwner[refresh] : grantFor[body.get("code") ?? ""];
    if (!who) return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    if (refresh !== null) delete refreshOwner[refresh];
    issued++;
    tokenOwner[`acc-${issued}`] = who;
    refreshOwner[`ref-${issued}`] = who;
    return new Response(JSON.stringify({ access_token: `acc-${issued}`, refresh_token: `ref-${issued}`, expires_in: 3600, scope: "offline read:recovery" }));
  }
  if (url.includes("/v2/user/profile/basic")) return new Response(`{"user_id":${tokenOwner[auth ?? ""] ?? 0},"email":"x@example.org","first_name":"X"}`);
  if (url.includes("/v2/user/access") && method === "DELETE") return new Response(null, { status: 204 });
  if (/\/v2\/(cycle|recovery|activity\/sleep|activity\/workout)/.test(url)) return new Response(JSON.stringify({ records: [], next_token: null }));
  return new Response("not found", { status: 404 });
}

// ---------- helpers ----------

type Server = typeof import("../supabase/functions/_shared/whoop_server");
let server: Server;
const APP = "https://mapius55.github.io/App-ich/";
const BASE = "https://proj.supabase.co/functions/v1";

const post = async (user: string, body: unknown) => {
  const res = await server.handleApp(new Request(`${BASE}/whoop`, { method: "POST", headers: { Authorization: `Bearer jwt-${user}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return (await res.json()) as Record<string, unknown>;
};
const statusOf = async (user: string) =>
  (await (await server.handleApp(new Request(`${BASE}/whoop?action=status`, { headers: { Authorization: `Bearer jwt-${user}` } }))).json()) as Record<string, unknown>;
/** "start" in the app, then the browser at WHOOP (whoever it belongs to) and back through the callback. */
async function linkVia(starter: string, whoopUser: string, opts: { deny?: boolean } = {}) {
  const { url } = (await post(starter, { action: "start" })) as { url: string };
  const state = new URL(url).searchParams.get("state")!;
  const authCode = `auth-${Math.random().toString(36).slice(2)}`;
  grantFor[authCode] = whoopUser;
  const q = opts.deny ? `error=access_denied&state=${state}` : `code=${authCode}&state=${state}`;
  const res = await server.handleCallback(new Request(`${BASE}/whoop-callback?${q}`));
  const loc = res.headers.get("Location")!;
  const hash = new URLSearchParams(loc.slice(loc.indexOf("?") + 1));
  return { status: res.status, location: loc, result: hash.get("whoop"), code: hash.get("code") };
}
const conn = (user: string) => db.connections.find((c) => c.user_id === user) ?? null;
const tokens = (user: string) => db.whoop_tokens.find((t) => t.user_id === user) ?? null;
const grant = (user: string) => db.whoop_pending.find((t) => t.user_id === user) ?? null;
const revokes = () => calls.filter((c) => c.method === "DELETE" && c.url.includes("/v2/user/access"));
const lists = () => calls.filter((c) => /\/v2\/(cycle|recovery|activity)/.test(c.url));

beforeEach(async () => {
  reset();
  calls.length = 0;
  grantFor = {};
  for (const u of ["anna", "ben", "eve"]) db.profiles.push({ id: u, timezone: "Europe/Zurich" });
  Object.assign(env, {
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key-for-tests",
    WHOOP_CLIENT_ID: "client-id",
    WHOOP_CLIENT_SECRET: "client-secret",
    WHOOP_TOKEN_KEY: "a-token-key-of-at-least-32-characters!",
    WHOOP_APP_URL: APP,
  });
  (globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => env[k] } };
  vi.stubGlobal("fetch", whoopFetch);
  server = await import("../supabase/functions/_shared/whoop_server");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---------- the flow ----------

describe("WHOOP link: the callback never connects, the app confirms", () => {
  it("keeps a pending link with a hashed single-use code, and connects only on the person's confirmation", async () => {
    const back = await linkVia("anna", "10129");
    expect(back.status).toBe(302);
    expect(back.location.startsWith(`${APP}#du/verbindungen?whoop=confirm&code=`)).toBe(true);
    expect(back.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // pending: kept apart, no connection or tokens a sync or webhook could use, the code only hashed
    expect(conn("anna")).toBeNull();
    expect(tokens("anna")).toBeNull();
    expect(grant("anna")).toMatchObject({ external_user_id: "10129" });
    expect(JSON.stringify(db)).not.toContain(back.code!);
    expect(String(grant("anna")!.access_token)).toMatch(/^v1\./); // sealed
    expect(lists()).toHaveLength(0);
    expect(await statusOf("anna")).toMatchObject({ connected: false, status: "pending", days: [] });

    const ok = await post("anna", { action: "confirm", code: back.code });
    expect(ok).toMatchObject({ ok: true, available: true, connected: true, status: "connected", consent_ai: false, attribution: "Daten von WHOOP" });
    expect(Array.isArray(ok.days)).toBe(true);
    expect(conn("anna")).toMatchObject({ status: "connected", external_user_id: "10129" });
    expect(grant("anna")).toBeNull(); // moved into the link
    expect(String(tokens("anna")!.access_token)).toMatch(/^v1\./);
    expect(lists().length).toBeGreaterThan(0); // the first 14 days were fetched
    expect(revokes()).toHaveLength(0);

    // the same confirmation again (a reload): the status, no second link or sync
    const before = lists().length;
    expect(await post("anna", { action: "confirm", code: back.code })).toMatchObject({ ok: true, connected: true });
    expect(lists().length).toBe(before);
  });

  it("refuses a link someone else started (the CSRF case): the victim's app sends the code, the forged link goes", async () => {
    // eve starts the flow and sends ben the consent link; ben logs in at WHOOP with HIS account
    const back = await linkVia("eve", "20001");
    expect(grant("eve")).not.toBeNull();
    // ben's browser comes back to the app: ben's app confirms with ben's login
    const res = await post("ben", { action: "confirm", code: back.code });
    expect(res).toEqual({ ok: false, reason: "mismatch" });
    expect(grant("eve")).toBeNull(); // the forged grant is gone
    expect(conn("eve")).toBeNull();
    expect(tokens("eve")).toBeNull();
    expect(conn("ben")).toBeNull(); // and ben has nothing linked to someone else's account
    expect(revokes()).toHaveLength(1); // the access WHOOP gave is ended
    expect(lists()).toHaveLength(0); // nothing of ben's WHOOP was ever read
  });

  it("the starter can't confirm without the code that only went to the other browser", async () => {
    await linkVia("eve", "20001");
    expect(await post("eve", { action: "confirm", code: "x".repeat(43) })).toEqual({ ok: false, reason: "mismatch" });
    expect(grant("eve")).toBeNull(); // her pending grant can't be confirmed any more: removed
    expect(conn("eve")).toBeNull();
    expect(await post("eve", { action: "confirm", code: "kurz" })).toEqual({ ok: false, reason: "mismatch" });
    expect(await post("eve", { action: "confirm" })).toEqual({ ok: false, reason: "mismatch" });
  });

  it("an expired code removes the pending link", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T10:00:00Z"));
    const back = await linkVia("anna", "10129");
    vi.setSystemTime(new Date("2026-11-15T10:10:01Z"));
    expect(await post("anna", { action: "confirm", code: back.code })).toEqual({ ok: false, reason: "expired" });
    expect(grant("anna")).toBeNull();
    expect(conn("anna")).toBeNull();
    expect(revokes()).toHaveLength(1);
  });

  it("does not revoke when the forged link points to a WHOOP account someone linked for real", async () => {
    const own = await linkVia("ben", "20001");
    await post("ben", { action: "confirm", code: own.code });
    // eve tries the same account again: the callback already refuses and says why, nothing pending,
    // nothing revoked
    const forged = await linkVia("eve", "20001");
    expect(forged.result).toBe("taken");
    expect(forged.location).toBe(`${APP}#du/verbindungen?whoop=taken`);
    expect(grant("eve")).toBeNull();
    expect(conn("eve")).toBeNull();
    expect(revokes()).toHaveLength(0);
    expect(conn("ben")).toMatchObject({ status: "connected" });
  });

  it("removes other members' pending links to the same account when the owner confirms, without revoking hers", async () => {
    const forged = await linkVia("eve", "20001"); // still pending (ben never clicked the confirm)
    expect(forged.result).toBe("confirm");
    const own = await linkVia("ben", "20001");
    expect(await post("ben", { action: "confirm", code: own.code })).toMatchObject({ ok: true, connected: true });
    expect(grant("eve")).toBeNull();
    expect(conn("eve")).toBeNull();
    expect(revokes()).toHaveLength(0);
  });

  it("never revokes an account someone else is linking right now (disconnecting a forged pending link)", async () => {
    await linkVia("eve", "20001"); // forged, pending
    const own = await linkVia("ben", "20001"); // ben links his own account, also still pending
    expect(await post("eve", { action: "disconnect" })).toMatchObject({ ok: true, revoked: false });
    expect(revokes()).toHaveLength(0);
    expect(grant("eve")).toBeNull();
    expect(conn("eve")).toBeNull();
    expect(await post("ben", { action: "confirm", code: own.code })).toMatchObject({ ok: true, connected: true });
  });

  it("says 'denied' when the person declined at WHOOP, 'error' for a broken state", async () => {
    expect((await linkVia("anna", "10129", { deny: true })).result).toBe("denied");
    const bad = await server.handleCallback(new Request(`${BASE}/whoop-callback?code=abc&state=nope`));
    expect(bad.headers.get("Location")).toBe(`${APP}#du/verbindungen?whoop=error`);
    expect(conn("anna")).toBeNull();
  });
});

describe("WHOOP: Jetzt holen, unreadable tokens, account deletion", () => {
  async function connected(user: string, whoopUser: string) {
    const back = await linkVia(user, whoopUser);
    await post(user, { action: "confirm", code: back.code });
  }

  it("'Jetzt holen' runs at most once a minute, also for two taps at the same moment", async () => {
    await connected("anna", "10129");
    expect(await post("anna", { action: "sync" })).toMatchObject({ ok: true, skipped: "recent" }); // just synced
    const c = conn("anna")!;
    c.last_sync_at = new Date(Date.now() - 5 * 60_000).toISOString();
    const before = lists().length;
    const [a, b] = await Promise.all([post("anna", { action: "sync" }), post("anna", { action: "sync" })]);
    expect([a.skipped, b.skipped].filter((s) => s === "recent")).toHaveLength(1);
    expect(lists().length - before).toBe(4); // one run: cycles, recoveries, sleeps, workouts
  });

  it("a token that can't be opened any more (the key changed) asks for a reconnect instead of failing every time", async () => {
    await connected("anna", "10129");
    conn("anna")!.last_sync_at = new Date(Date.now() - 5 * 60_000).toISOString();
    env.WHOOP_TOKEN_KEY = "another-token-key-of-at-least-32-chars";
    const r = await post("anna", { action: "sync" });
    expect(r).toMatchObject({ ok: false, connected: true });
    expect(conn("anna")).toMatchObject({ status: "needs_reconnect", last_error: "Die Verbindung zu WHOOP muss neu eingerichtet werden. Bitte verbinde WHOOP neu." });
    expect(tokens("anna")).toBeNull();
    // the next run doesn't try again
    expect(await post("anna", { action: "sync" })).toMatchObject({ ok: false, connected: false, status: "needs_reconnect" });
  });

  it("deleting the account revokes at WHOOP first and leaves no WHOOP rows", async () => {
    await connected("anna", "10129");
    db.whoop_days.push({ user_id: "anna", day: "2026-11-14", recovery_score: 70 });
    expect(await server.disconnectWhoopForAccount("anna")).toEqual({ revoked: true });
    expect(revokes()).toHaveLength(1);
    expect(conn("anna")).toBeNull();
    expect(tokens("anna")).toBeNull();
    expect(db.whoop_days.filter((d) => d.user_id === "anna")).toHaveLength(0);
    // nothing linked: nothing to do
    expect(await server.disconnectWhoopForAccount("ben")).toEqual({ revoked: false });
  });

  it("the reconciliation run removes links that were never confirmed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T10:00:00Z"));
    await linkVia("eve", "20001");
    vi.setSystemTime(new Date("2026-11-15T10:30:00Z"));
    const res = await server.handleApp(new Request(`${BASE}/whoop`, { method: "POST", headers: { "x-cron-secret": "cron-secret-for-tests" }, body: JSON.stringify({ action: "sync" }) }));
    expect(res.status).toBe(401); // no cron secret configured
    env.WHOOP_CRON_SECRET = "cron-secret-for-tests";
    const ok = await server.handleApp(new Request(`${BASE}/whoop`, { method: "POST", headers: { "x-cron-secret": "cron-secret-for-tests" }, body: JSON.stringify({ action: "sync" }) }));
    expect(await ok.json()).toMatchObject({ ok: true, total: 0 });
    expect(grant("eve")).toBeNull();
    expect(revokes()).toHaveLength(1);
  });
});

// ---------- a forged grant never reaches a link that is connected (review round 2) ----------

describe("WHOOP: an unconfirmed grant is never used, also while a sync is running", () => {
  const H = 3600_000;
  const benCycle = () => ({
    records: [{ id: 99, start: new Date(Date.now() - 20 * H).toISOString(), end: new Date(Date.now() - H).toISOString(), timezone_offset: "+01:00", score_state: "SCORED", score: { strain: 17.7 } }],
    next_token: null,
  });
  const tokenOf = (init?: RequestInit) => new Headers(init?.headers).get("Authorization")?.replace("Bearer ", "") ?? "";
  const readsAs = (whoopUser: string) => calls.filter((c) => /\/v2\/(cycle|recovery|activity)/.test(c.url) && tokenOwner[c.token ?? ""] === whoopUser);
  async function connected(user: string, whoopUser: string) {
    const back = await linkVia(user, whoopUser);
    expect(await post(user, { action: "confirm", code: back.code })).toMatchObject({ ok: true, connected: true });
  }
  /** eve's second "Verbinden": the state of a consent link she can send to someone else */
  async function forgedState(user: string) {
    const { url } = (await post(user, { action: "start" })) as { url: string };
    return new URL(url).searchParams.get("state")!;
  }
  /** WHOOP, where ben's account has a hard day, and `during` runs once while the first matching request waits */
  function whoopWith(match: RegExp, during: () => Promise<void>) {
    let fired = false;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const u = String(input);
      if (!fired && match.test(u)) {
        fired = true;
        await during();
      }
      const res = await whoopFetch(input, init);
      if (/\/v2\/cycle/.test(u) && tokenOwner[tokenOf(init)] === "20001") return new Response(JSON.stringify(benCycle()));
      return res;
    });
  }

  it("'Jetzt holen' running while a forged grant lands: eve stays on her own account, ben's data never comes", async () => {
    await connected("eve", "30001");
    conn("eve")!.last_sync_at = new Date(Date.now() - 5 * 60_000).toISOString();
    const state = await forgedState("eve");
    grantFor["ben-auth"] = "20001";
    let benCode: string | null = null;
    whoopWith(/\/v2\/cycle/, async () => {
      const res = await server.handleCallback(new Request(`${BASE}/whoop-callback?code=ben-auth&state=${state}`));
      const loc = res.headers.get("Location")!;
      benCode = new URLSearchParams(loc.slice(loc.indexOf("?") + 1)).get("code");
    });
    expect(await post("eve", { action: "sync" })).toMatchObject({ ok: true });
    expect(benCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(conn("eve")).toMatchObject({ status: "connected", external_user_id: "30001" });
    expect(grant("eve")).toMatchObject({ external_user_id: "20001" }); // waits apart

    // ben's app confirms: mismatch, and the forged grant ends (revoked, ben's account is linked nowhere)
    expect(await post("ben", { action: "confirm", code: benCode })).toEqual({ ok: false, reason: "mismatch" });
    expect(grant("eve")).toBeNull();
    expect(revokes()).toHaveLength(1);
    // the next runs read eve's own WHOOP only
    conn("eve")!.last_sync_at = new Date(Date.now() - 5 * 60_000).toISOString();
    conn("eve")!.manual_sync_at = null;
    expect(await post("eve", { action: "sync" })).toMatchObject({ ok: true });
    expect(readsAs("20001")).toHaveLength(0);
    expect(db.whoop_days.some((d) => d.day_strain === 17.7)).toBe(false);
    expect(conn("eve")).toMatchObject({ status: "connected", external_user_id: "30001" });
  });

  it("a webhook for eve's own account while a forged grant lands reads only with eve's token", async () => {
    await connected("eve", "30001");
    const state = await forgedState("eve");
    grantFor["ben-auth2"] = "20001";
    whoopWith(/\/v2\/activity\/sleep\/[a-z0-9-]+$/, async () => {
      await server.handleCallback(new Request(`${BASE}/whoop-callback?code=ben-auth2&state=${state}`));
    });
    const { whoopSignature } = await import("../supabase/functions/_shared/whoop");
    const body = JSON.stringify({ user_id: 30001, id: "abcd-1234", type: "sleep.updated", trace_id: "t-1" });
    const ts = String(Date.now());
    const sig = await whoopSignature(body, ts, "client-secret");
    const res = await server.handleWebhook(new Request(`${BASE}/whoop-webhook`, { method: "POST", headers: { "X-WHOOP-Signature-Timestamp": ts, "X-WHOOP-Signature": sig }, body }));
    expect(res.status).toBe(204);
    expect(grant("eve")).toMatchObject({ external_user_id: "20001" });
    expect(readsAs("20001")).toHaveLength(0);
    expect(readsAs("30001").length).toBeGreaterThan(0);
    expect(db.whoop_days.some((d) => d.day_strain === 17.7)).toBe(false);
  });

  it("a forged grant does not touch her link: no pending status, her days stay, the 3-hourly run syncs her own account", async () => {
    await connected("eve", "30001");
    db.whoop_days.push({ user_id: "eve", day: "2026-11-14", recovery_score: 70 });
    const state = await forgedState("eve");
    grantFor["ben-auth3"] = "20001";
    await server.handleCallback(new Request(`${BASE}/whoop-callback?code=ben-auth3&state=${state}`));
    expect(await statusOf("eve")).toMatchObject({ connected: true, status: "connected" });
    expect(db.whoop_days.filter((d) => d.user_id === "eve")).not.toHaveLength(0);
    env.WHOOP_CRON_SECRET = "cron-secret-for-tests";
    const run = await server.handleApp(new Request(`${BASE}/whoop`, { method: "POST", headers: { "x-cron-secret": "cron-secret-for-tests" }, body: JSON.stringify({ action: "sync" }) }));
    expect(await run.json()).toMatchObject({ ok: true, synced: 1, total: 1 });
    expect(readsAs("20001")).toHaveLength(0);
  });

  it("her own reconnect keeps the link (and its tokens) until she confirms, then swaps them in", async () => {
    await connected("anna", "10129");
    const before = tokens("anna")!.access_token;
    const back = await linkVia("anna", "10129");
    expect(conn("anna")).toMatchObject({ status: "connected" });
    expect(tokens("anna")!.access_token).toBe(before);
    expect(await post("anna", { action: "confirm", code: back.code })).toMatchObject({ ok: true, connected: true });
    expect(tokens("anna")!.access_token).not.toBe(before);
    expect(grant("anna")).toBeNull();
    expect(revokes()).toHaveLength(0); // the same WHOOP account: never revoked
  });

  it("an unconfirmed grant of her own WHOOP account that runs out is not revoked (that would end her link)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T10:00:00Z"));
    await connected("anna", "10129");
    await linkVia("anna", "10129"); // never confirmed
    vi.setSystemTime(new Date("2026-11-15T10:30:00Z"));
    env.WHOOP_CRON_SECRET = "cron-secret-for-tests";
    await server.handleApp(new Request(`${BASE}/whoop`, { method: "POST", headers: { "x-cron-secret": "cron-secret-for-tests" }, body: JSON.stringify({ action: "sync" }) }));
    expect(grant("anna")).toBeNull();
    expect(revokes()).toHaveLength(0);
    expect(conn("anna")).toMatchObject({ status: "connected" });
  });

  it("a sync never turns a link back to connected once it needs a reconnect", async () => {
    await connected("anna", "10129");
    conn("anna")!.last_sync_at = new Date(Date.now() - 5 * 60_000).toISOString();
    whoopWith(/\/v2\/cycle/, async () => {
      conn("anna")!.status = "needs_reconnect"; // a parallel webhook found the tokens revoked
    });
    await post("anna", { action: "sync" });
    expect(conn("anna")!.status).toBe("needs_reconnect");
  });

  it("revokes an expired unconfirmed grant with a refreshed token (access tokens live an hour)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T10:00:00Z"));
    await linkVia("eve", "20001"); // forged, ben never confirms
    const dead = `acc-${issued}`; // WHOOP no longer takes it at the time of the run
    vi.setSystemTime(new Date("2026-11-15T11:41:00Z")); // the 3-hourly run
    const grants: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const u = String(input);
      if (u.endsWith("/oauth/oauth2/token")) grants.push(new URLSearchParams(String(init.body)).get("grant_type") ?? "");
      if (u.includes("/v2/user/access") && tokenOf(init) === dead) {
        calls.push({ method: init.method ?? "GET", url: u, token: dead });
        return new Response(JSON.stringify({ error: "token expired" }), { status: 401 });
      }
      return whoopFetch(input, init);
    });
    env.WHOOP_CRON_SECRET = "cron-secret-for-tests";
    await server.handleApp(new Request(`${BASE}/whoop`, { method: "POST", headers: { "x-cron-secret": "cron-secret-for-tests" }, body: JSON.stringify({ action: "sync" }) }));
    expect(grants).toEqual(["refresh_token"]); // refreshed before the revoke
    expect(revokes()).toHaveLength(1);
    expect(revokes()[0].token).not.toBe(dead);
    expect(tokenOwner[revokes()[0].token ?? ""]).toBe("20001"); // with the new, live token
    expect(grant("eve")).toBeNull();
  });

  it("refreshes once and revokes again when WHOOP refuses a token that looked valid", async () => {
    await linkVia("eve", "20001");
    const dead = `acc-${issued}`;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const u = String(input);
      if (u.includes("/v2/user/access") && tokenOf(init) === dead) {
        calls.push({ method: "DELETE", url: u, token: dead });
        return new Response(null, { status: 401 });
      }
      return whoopFetch(input, init);
    });
    expect(await post("eve", { action: "disconnect" })).toMatchObject({ ok: true, revoked: true });
    expect(revokes().map((c) => c.token === dead)).toEqual([true, false]);
  });

  it("a newer grant of another WHOOP account ends the earlier unconfirmed one", async () => {
    await linkVia("anna", "10129");
    await linkVia("anna", "10130");
    expect(grant("anna")).toMatchObject({ external_user_id: "10130" });
    expect(revokes()).toHaveLength(1);
    expect(tokenOwner[revokes()[0].token ?? ""]).toBe("10129");
  });

  it("disconnecting clears the coach's replies that had WHOOP values in mind, and only those", async () => {
    await connected("anna", "10129");
    db.messages.push(
      { id: 1, user_id: "anna", thread: "2026-11-15", role: "assistant", content: "Gut geschlafen, Erholung 82 %.", whoop: true },
      { id: 2, user_id: "anna", thread: "2026-11-15", role: "assistant", content: "Schön, dass du da bist.", whoop: false },
      { id: 3, user_id: "ben", thread: "2026-11-15", role: "assistant", content: "Erholung 40 %.", whoop: true },
    );
    await post("anna", { action: "disconnect" });
    const { WHOOP_CLEARED_TEXT } = await import("../supabase/functions/_shared/whoop");
    expect(db.messages.find((m) => m.id === 1)).toMatchObject({ content: WHOOP_CLEARED_TEXT, whoop: false });
    expect(db.messages.find((m) => m.id === 2)).toMatchObject({ content: "Schön, dass du da bist." });
    expect(db.messages.find((m) => m.id === 3)).toMatchObject({ content: "Erholung 40 %.", whoop: true });
  });

  it("deleting the account also ends a grant that was never confirmed", async () => {
    await linkVia("anna", "10129");
    expect(await server.disconnectWhoopForAccount("anna")).toEqual({ revoked: true });
    expect(grant("anna")).toBeNull();
  });
});
