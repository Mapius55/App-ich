// The connection calls of the real backend against a stubbed fetch: a function that isn't deployed or
// can't be reached resolves to null ("Bald verfügbar"), and the WHOOP confirm reads the server's
// {ok:false, reason} whatever status code carries it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseBackend } from "../src/lib/supabaseBackend";

const URL_ = "https://example.supabase.co";
const PROFILE = { id: "u1", username: "zora", display_name: "Zora", birth_year: 1994, calendar_token: "0b9f5c1e-7d1a-4c55-9a43-2f1f4b9e6a10" };
type Reply = { status: number; body?: unknown } | "network";
let replies: Record<string, Reply> = {};
const calls: { url: string; method: string; body: string | null }[] = [];

function respond(r: Reply): Response {
  if (r === "network") throw new TypeError("Failed to fetch");
  return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  replies = {};
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null });
      if (url.includes("/rest/v1/profiles")) return respond({ status: 200, body: PROFILE });
      if (url.includes("/rest/v1/")) return respond({ status: 200, body: [] });
      const name = url.replace(`${URL_}/functions/v1/`, "");
      const action = init?.body ? (JSON.parse(String(init.body)) as { action?: string }).action : null;
      const r = replies[action ? `${name}:${action}` : name];
      return respond(r ?? { status: 404, body: { error: "not found" } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

// logged in unless asked otherwise: the connection calls go out only with a login
const be = (userId: string | null = "u1") => {
  const b = new SupabaseBackend(URL_, "anon-key");
  vi.spyOn(b, "currentUserId").mockResolvedValue(userId);
  return b;
};

const STATUS = {
  available: true,
  connected: true,
  status: "connected",
  consent_ai: false,
  connected_at: "2026-11-14T10:00:00Z",
  last_sync_at: "2026-11-14T10:00:30Z",
  last_error: null,
  attribution: "Daten von WHOOP",
  days: [{ day: "2026-11-14", recovery_score: 71 }, { nope: 1 }],
};

describe("supabase backend: WHOOP status", () => {
  it("is null when the function isn't deployed or can't be reached", async () => {
    for (const r of ["network", { status: 404 }, { status: 502 }, { status: 503 }, { status: 504 }] as Reply[]) {
      replies["whoop?action=status"] = r;
      expect(await be().whoopStatus()).toBeNull();
    }
  });

  it("is null when the answer isn't a status", async () => {
    replies["whoop?action=status"] = { status: 200, body: { hello: "world" } };
    expect(await be().whoopStatus()).toBeNull();
  });

  it("throws on other failures (the row offers 'Nochmal versuchen')", async () => {
    replies["whoop?action=status"] = { status: 500, body: { error: "internal" } };
    await expect(be().whoopStatus()).rejects.toThrow(/nicht erreichbar/);
  });

  it("reads a status field by field (days without a date dropped)", async () => {
    replies["whoop?action=status"] = { status: 200, body: { ...STATUS, attribution: "" } };
    const s = await be().whoopStatus();
    expect(s).toMatchObject({ available: true, connected: true, status: "connected", consent_ai: false, attribution: "Daten von WHOOP" });
    expect(s!.days).toHaveLength(1);
  });
});

describe("supabase backend: WHOOP confirm", () => {
  it("sends the code with the action", async () => {
    replies["whoop:confirm"] = { status: 200, body: STATUS };
    const r = await be().whoopConfirm("x".repeat(43));
    expect(r).toMatchObject({ ok: true, connected: true });
    expect(calls.find((c) => c.url.endsWith("/functions/v1/whoop"))?.body).toBe(JSON.stringify({ action: "confirm", code: "x".repeat(43) }));
  });

  it("passes mismatch and expired on, also with a 4xx status", async () => {
    replies["whoop:confirm"] = { status: 200, body: { ok: false, reason: "mismatch" } };
    expect(await be().whoopConfirm("c")).toEqual({ ok: false, reason: "mismatch" });
    replies["whoop:confirm"] = { status: 400, body: { ok: false, reason: "expired" } };
    expect(await be().whoopConfirm("c")).toEqual({ ok: false, reason: "expired" });
    replies["whoop:confirm"] = { status: 403, body: { ok: false, reason: "mismatch" } };
    expect(await be().whoopConfirm("c")).toEqual({ ok: false, reason: "mismatch" });
  });

  it("is a plain error when the function can't be reached or answers nonsense", async () => {
    for (const r of ["network", { status: 404 }, { status: 500 }, { status: 200, body: { ok: true } }] as Reply[]) {
      replies["whoop:confirm"] = r;
      expect(await be().whoopConfirm("c")).toEqual({ ok: false, reason: "error" });
    }
  });
});

describe("supabase backend: WHOOP start and Nolio", () => {
  it("only goes to an https consent page", async () => {
    replies["whoop:start"] = { status: 200, body: { url: "https://api.prod.whoop.com/oauth/oauth2/auth?x=1" } };
    expect(await be().whoopStart()).toEqual({ url: "https://api.prod.whoop.com/oauth/oauth2/auth?x=1" });
    replies["whoop:start"] = { status: 200, body: { ok: false, reason: "not_configured" } };
    await expect(be().whoopStart()).rejects.toThrow(/noch nicht eingerichtet/);
    replies["whoop:start"] = { status: 200, body: { url: "javascript:alert(1)" } };
    await expect(be().whoopStart()).rejects.toThrow();
  });

  it("sends the app's own address as return_to (BASE_URL on this origin), so WHOOP brings the browser back here", async () => {
    replies["whoop:start"] = { status: 200, body: { url: "https://api.prod.whoop.com/oauth/oauth2/auth?x=1" } };
    vi.stubGlobal("location", { origin: "https://mapius55.github.io" });
    try {
      for (const base of ["/bucket-list/", "/App-ich/"]) {
        vi.stubEnv("BASE_URL", base);
        calls.length = 0;
        await be().whoopStart();
        const body = JSON.parse(calls.find((c) => c.url.endsWith("/functions/v1/whoop"))!.body!) as { action: string; return_to: string };
        expect(body).toEqual({ action: "start", return_to: `https://mapius55.github.io${base}` });
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("Nolio: null when not deployed, 'not available' for everyone but the owner", async () => {
    expect(await be().nolioStatus()).toBeNull();
    replies["nolio?action=status"] = { status: 200, body: { available: false, connected: false, last_sync_at: null, last_error: null, running: false, counts: null } };
    expect(await be().nolioStatus()).toMatchObject({ available: false, connected: false, counts: null, garmin: null });
  });
});

describe("supabase backend: signed out", () => {
  it("sends no connection call without a login (signing out clears the states while Du is still shown)", async () => {
    const b = be(null);
    expect(await b.whoopStatus()).toBeNull();
    expect(await b.nolioStatus()).toBeNull();
    expect(await b.whoopConfirm("c")).toEqual({ ok: false, reason: "error" });
    expect(calls.filter((c) => c.url.includes("/functions/v1/"))).toHaveLength(0);
  });
});

describe("supabase backend: export", () => {
  it("leaves the calendar link's token out of the file", async () => {
    const out = await be().exportData();
    expect(out.profile).toEqual({ id: "u1", username: "zora", display_name: "Zora", birth_year: 1994 });
    expect(JSON.stringify(out)).not.toContain(PROFILE.calendar_token);
  });
});
