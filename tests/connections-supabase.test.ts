// The connection calls of the real backend against a stubbed fetch: a function that isn't deployed or
// can't be reached resolves to null ("Bald verfügbar"), and the WHOOP confirm reads the server's
// {ok:false, reason} whatever status code carries it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseBackend } from "../src/lib/supabaseBackend";

const URL_ = "https://example.supabase.co";
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
      if (url.includes("/rest/v1/")) return respond({ status: 200, body: [] });
      const name = url.replace(`${URL_}/functions/v1/`, "");
      const action = init?.body ? (JSON.parse(String(init.body)) as { action?: string }).action : null;
      const r = replies[action ? `${name}:${action}` : name];
      return respond(r ?? { status: 404, body: { error: "not found" } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const be = () => new SupabaseBackend(URL_, "anon-key");

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

  it("Nolio: null when not deployed, 'not available' for everyone but the owner", async () => {
    expect(await be().nolioStatus()).toBeNull();
    replies["nolio?action=status"] = { status: 200, body: { available: false, connected: false, last_sync_at: null, last_error: null, running: false, counts: null } };
    expect(await be().nolioStatus()).toMatchObject({ available: false, connected: false, counts: null, garmin: null });
  });
});
