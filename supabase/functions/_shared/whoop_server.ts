// WHOOP connection (API v2) for every member: OAuth, daily summaries (at most 14 days), webhooks.
// Shared by three Edge Functions, each deployed with --no-verify-jwt (every caller is checked here):
//   whoop           GET  ?action=status (login)         → connection, consent, last sync, the last 14 daily summaries
//                   POST {action:"start"} (login)       → {url}: WHOOP's consent page (state valid 10 minutes)
//                   POST {action:"confirm", code} (login) → confirms the pending link of THIS person (CSRF fix),
//                                                         starts the first 14 days and answers like ?action=status;
//                                                         {ok:false, reason:"mismatch"|"expired"|"taken"} otherwise
//                   POST {action:"sync"} (login)        → "Jetzt holen": recompute the last days now (once a minute)
//                   POST {action:"sync"} + x-cron-secret → reconciliation for every connected member
//                                                         (pg_cron job "i-am-whoop", every 3 hours at minute 41)
//                   POST {action:"disconnect"} (login)  → revoke at WHOOP, then delete tokens, days and connection
//   whoop-callback  GET from WHOOP (?code&state | ?error&state) → keeps the new grant apart (whoop_pending,
//                   never used for a sync) plus a single-use code (only its hash is stored, valid 10 minutes)
//                   and sends the browser back: 302 <app>#du/verbindungen?whoop=confirm&code=…
//                   (whoop=error / whoop=denied / whoop=taken: that WHOOP account is another member's)
//   whoop-webhook   POST from WHOOP, signed with the client secret → 204 at once, the changed day follows
// Secrets: WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, WHOOP_TOKEN_KEY (at least 32 characters; encrypts the
// tokens before they reach the database), PUSH_CRON_SECRET (shared with the notifications job) or
// WHOOP_CRON_SECRET. Optional: WHOOP_REDIRECT_URI (default <SUPABASE_URL>/functions/v1/whoop-callback),
// WHOOP_APP_URL (default https://mapius55.github.io/App-ich/).
// Logs carry route names and status codes only: no ids, tokens or health values.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.119.0";
import {
  appReturnUrl,
  authorizeUrl,
  CONFIRM_CODE_RE,
  CONFIRM_TTL_MS,
  confirmOutcome,
  dayWindow,
  DEFAULT_TZ,
  extractUserId,
  hashConfirmCode,
  keepFrom,
  localDate,
  needsReconnect,
  openStoredToken,
  parseTokenResponse,
  parseWebhookEvent,
  randomConfirmCode,
  randomState,
  recordDay,
  type RefreshClaim,
  safeEqual,
  sealToken,
  STATE_RE,
  STATE_TTL_MS,
  summarizeDays,
  type SyncWindow,
  syncWindow,
  TOKEN_SKEW_MS,
  tokenRequestBody,
  type TokenSet,
  validAccessToken,
  validTimeZone,
  WHOOP_API,
  WHOOP_ATTRIBUTION,
  WHOOP_TOKEN_URL,
  type PendingLink,
  type WhoopCycle,
  WHOOP_CLEARED_TEXT,
  whoopClient,
  WhoopError,
  whoopErrorMessage,
  type WhoopRecovery,
  type WhoopSleep,
  type WhoopWebhookEvent,
  type WhoopWorkout,
  verifyWhoopSignature,
} from "./whoop.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const DEFAULT_APP_URL = "https://mapius55.github.io/App-ich/";
const PROVIDER = "whoop";
const LEASE_SECONDS = 30; // refresh lock; the token request itself times out after 10 s
const MANUAL_MIN_GAP_MS = 60_000; // "Jetzt holen" at most once a minute
const CONFIRM_SYNC_MS = 12_000; // the app waits this long at most for the first 14 days
const CLEANUP_MAX = 50; // unconfirmed links removed per reconciliation run

interface Config {
  clientId: string;
  clientSecret: string;
  tokenKey: string;
  redirectUri: string;
  appUrl: string;
}

function config(): Config | null {
  const clientId = (Deno.env.get("WHOOP_CLIENT_ID") ?? "").trim();
  const clientSecret = (Deno.env.get("WHOOP_CLIENT_SECRET") ?? "").trim();
  const tokenKey = (Deno.env.get("WHOOP_TOKEN_KEY") ?? "").trim();
  if (!clientId || !clientSecret || tokenKey.length < 32) return null;
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const redirectUri = (Deno.env.get("WHOOP_REDIRECT_URI") ?? "").trim() || `${base}/functions/v1/whoop-callback`;
  const app = (Deno.env.get("WHOOP_APP_URL") ?? "").trim();
  return { clientId, clientSecret, tokenKey, redirectUri, appUrl: /^https:\/\//.test(app) ? app : DEFAULT_APP_URL };
}

const admin = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const bearer = (req: Request) => (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

async function loggedInUser(sb: SupabaseClient, req: Request): Promise<string | null> {
  const token = bearer(req);
  if (!token) return null;
  const { data, error } = await sb.auth.getUser(token);
  return error || !data.user ? null : data.user.id;
}

function cronAllowed(header: string): boolean {
  return [Deno.env.get("WHOOP_CRON_SECRET"), Deno.env.get("PUSH_CRON_SECRET")].some((s) => !!s && safeEqual(header, s));
}

/** Status code or error code only: nothing personal in the logs. */
const errCode = (e: unknown) =>
  e instanceof WhoopError ? `${e.status}${e.code ? ` ${e.code}` : ""}` : String((e as { code?: unknown })?.code ?? (e as { name?: unknown })?.name ?? "internal");

const check = async (r: PromiseLike<{ error: unknown }>) => {
  const { error } = await r;
  if (error) throw error;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Keep working after the response (Supabase Edge Runtime); false when the runtime can't, then the caller awaits. */
function background(p: Promise<unknown>): boolean {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (typeof rt?.waitUntil !== "function") return false;
  rt.waitUntil(p.catch((e) => console.error("whoop background failed:", errCode(e))));
  return true;
}

async function timeZoneOf(sb: SupabaseClient, userId: string): Promise<string> {
  const { data } = await sb.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  return validTimeZone(data?.timezone, DEFAULT_TZ);
}

// ---------- tokens ----------

const ctx = (userId: string, kind: "access" | "refresh") => `${userId}:${kind}`;

async function exchange(body: URLSearchParams): Promise<TokenSet> {
  let res: Response;
  try {
    res = await fetch(WHOOP_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new WhoopError(0, "network");
  }
  const text = await res.text();
  let j: unknown = null;
  try {
    j = JSON.parse(text);
  } catch {
    // not JSON
  }
  if (!res.ok) {
    const code = typeof (j as { error?: unknown })?.error === "string" ? String((j as { error: string }).error).slice(0, 40) : null;
    // invalid_grant: the refresh token is used up or revoked → reconnect. invalid_client: our secrets are wrong.
    if (code === "invalid_grant") throw new WhoopError(400, "invalid_grant");
    throw new WhoopError(res.status === 401 || res.status === 400 ? 500 : res.status, code ?? "token_endpoint");
  }
  const t = parseTokenResponse(j);
  if (!t) throw new WhoopError(502, "bad_token_response");
  return t;
}

/** The sealed row. A new grant (callback) replaces the refresh token even when WHOOP sent none; a refresh
 *  keeps the stored one if WHOOP did not rotate it. */
async function tokenRow(cfg: Config, userId: string, t: TokenSet, grant: "new" | "refresh") {
  const row: Record<string, unknown> = {
    user_id: userId,
    access_token: await sealToken(t.access_token, cfg.tokenKey, ctx(userId, "access")),
    expires_at: t.expires_at,
    scope: t.scope,
    refresh_lock: null,
    refresh_lock_until: null,
    updated_at: new Date().toISOString(),
  };
  if (t.refresh_token) row.refresh_token = await sealToken(t.refresh_token, cfg.tokenKey, ctx(userId, "refresh"));
  else if (grant === "new") row.refresh_token = null;
  return row;
}

/** A valid access token for this person; refreshes single-flight (row lock in whoop_claim_refresh). */
function accessToken(sb: SupabaseClient, cfg: Config, userId: string, force = false): Promise<string> {
  return validAccessToken(
    {
      async read() {
        const { data, error } = await sb.from("whoop_tokens").select("access_token, expires_at").eq("user_id", userId).maybeSingle();
        if (error) throw error;
        if (!data) return null;
        // a token sealed with another key (WHOOP_TOKEN_KEY changed) → needs_reconnect, not a crash loop
        return { access: await openStoredToken(data.access_token, cfg.tokenKey, ctx(userId, "access")), expiresAt: data.expires_at };
      },
      async claim(): Promise<RefreshClaim> {
        const { data, error } = await sb.rpc("whoop_claim_refresh", { p_user: userId, p_lease_seconds: LEASE_SECONDS });
        if (error) throw error;
        const c = (Array.isArray(data) ? data[0] : data) as {
          state?: string;
          lock_id?: string | null;
          sealed_refresh?: string | null;
          sealed_access?: string | null;
          access_expires_at?: string | null;
        } | null;
        if (c?.state === "claimed" && c.lock_id && c.sealed_refresh) {
          let refresh: string;
          try {
            refresh = await openStoredToken(c.sealed_refresh, cfg.tokenKey, ctx(userId, "refresh"));
          } catch (e) {
            await sb.from("whoop_tokens").update({ refresh_lock: null, refresh_lock_until: null }).eq("user_id", userId).eq("refresh_lock", c.lock_id);
            throw e;
          }
          // the token stored at the moment of the claim: another worker may just have refreshed it
          const current =
            c.sealed_access && c.access_expires_at
              ? await openStoredToken(c.sealed_access, cfg.tokenKey, ctx(userId, "access")).then(
                  (access) => ({ access, expiresAt: String(c.access_expires_at) }),
                  () => null,
                )
              : null;
          return { state: "claimed", lock: c.lock_id, refresh, current };
        }
        if (c?.state === "busy" || c?.state === "no_refresh") return { state: c.state };
        return { state: "missing" };
      },
      async save(lock, t) {
        // access and the rotated refresh token in one statement, which also releases the lock; only while
        // this caller still holds it (a confirmed new link replaced the row meanwhile: it stays)
        const row = await tokenRow(cfg, userId, t, "refresh");
        delete row.user_id;
        for (let attempt = 0; ; attempt++) {
          const { error } = await sb.from("whoop_tokens").update(row).eq("user_id", userId).eq("refresh_lock", lock);
          if (!error) return;
          if (attempt >= 2) throw error;
          await sleep(300);
        }
      },
      async release(lock) {
        await sb.from("whoop_tokens").update({ refresh_lock: null, refresh_lock_until: null }).eq("user_id", userId).eq("refresh_lock", lock);
      },
      exchange: (refreshToken) => exchange(tokenRequestBody({ grant: "refresh_token", refreshToken, clientId: cfg.clientId, clientSecret: cfg.clientSecret })),
      sleep,
    },
    { force },
  );
}

function apiFor(sb: SupabaseClient, cfg: Config, userId: string) {
  return whoopClient({
    fetch,
    token: () => accessToken(sb, cfg, userId),
    onUnauthorized: () => accessToken(sb, cfg, userId, true),
  });
}

/** The tokens no longer work: the person has to connect again. The summaries stay until the daily purge. */
async function markNeedsReconnect(sb: SupabaseClient, userId: string, e: unknown) {
  await sb.from("whoop_tokens").delete().eq("user_id", userId);
  await sb.from("connections").update({ status: "needs_reconnect", last_error: whoopErrorMessage(e) }).eq("user_id", userId).eq("provider", PROVIDER).eq("status", "connected");
}

/** No token row at all: a disconnect or a confirmation is just writing it. Not a reason to ask for a reconnect. */
const tokenMissing = (e: unknown) => e instanceof WhoopError && e.code === "not_connected";

/** Clears the text of the coach's replies that had WHOOP values in their context (messages.whoop). */
async function clearWhoopMessages(sb: SupabaseClient, userId: string) {
  const { error } = await sb.from("messages").update({ content: WHOOP_CLEARED_TEXT, whoop: false }).eq("user_id", userId).eq("whoop", true);
  if (error) console.error("whoop: clearing coach replies failed:", errCode(error));
}

// ---------- sync ----------

const DAY_COLS = "day, recovery_score, hrv_ms, resting_hr, sleep_minutes, sleep_performance, day_strain, workout_count, workout_minutes";

/** Fetch the window's cycles, recoveries, sleeps and workouts and rewrite the summaries of its days. */
async function syncUser(sb: SupabaseClient, cfg: Config, userId: string, w: SyncWindow, tz: string): Promise<number> {
  const api = apiFor(sb, cfg, userId); // the four requests share one token (and at most one refresh)
  const q = { start: w.start, end: w.end };
  const [cycles, recoveries, sleeps, workouts] = await Promise.all([
    api.list<WhoopCycle>("/v2/cycle", q),
    api.list<WhoopRecovery>("/v2/recovery", q),
    api.list<WhoopSleep>("/v2/activity/sleep", q),
    api.list<WhoopWorkout>("/v2/activity/workout", q),
  ]);
  const today = localDate(new Date(), tz);
  const from = w.from > keepFrom(today) ? w.from : keepFrom(today);
  const days = summarizeDays(
    { cycles: cycles.items, recoveries: recoveries.items, sleeps: sleeps.items, workouts: workouts.items },
    { tz, from, to: w.to },
  );
  const now = new Date().toISOString();
  if (days.length) {
    await check(sb.from("whoop_days").upsert(days.map((d) => ({ ...d, user_id: userId, updated_at: now })), { onConflict: "user_id,day" }));
  }
  // days that have nothing any more (records deleted at WHOOP): only when every list was read completely
  if (![cycles, recoveries, sleeps, workouts].some((l) => l.truncated)) {
    const keep = days.map((d) => d.day);
    let del = sb.from("whoop_days").delete().eq("user_id", userId).gte("day", from).lte("day", w.to);
    if (keep.length) del = del.not("day", "in", `(${keep.join(",")})`);
    await check(del);
  }
  // nothing older than 14 days (the daily purge does the same for everyone)
  await check(sb.from("whoop_days").delete().eq("user_id", userId).lt("day", keepFrom(today)));
  return days.length;
}

interface SyncResult {
  ok: boolean;
  days?: number;
  last_sync_at?: string;
  error?: string;
  retryAfter?: number | null;
}

/** syncUser plus the bookkeeping in connections (last_sync_at / last_error / needs_reconnect). */
async function syncAndRecord(sb: SupabaseClient, cfg: Config, userId: string, w: SyncWindow, tz: string): Promise<SyncResult> {
  const started = new Date().toISOString();
  try {
    const days = await syncUser(sb, cfg, userId, w, tz);
    // bookkeeping only: a sync never changes the link's status (a disconnect or reconnect meanwhile wins)
    await sb.from("connections").update({ last_sync_at: started, last_error: null }).eq("user_id", userId).eq("provider", PROVIDER).eq("status", "connected");
    return { ok: true, days, last_sync_at: started };
  } catch (e) {
    console.error("whoop sync failed:", errCode(e));
    if (needsReconnect(e) && !tokenMissing(e)) await markNeedsReconnect(sb, userId, e);
    else await sb.from("connections").update({ last_error: whoopErrorMessage(e) }).eq("user_id", userId).eq("provider", PROVIDER).eq("status", "connected");
    return { ok: false, error: whoopErrorMessage(e), retryAfter: e instanceof WhoopError ? e.retryAfter : null };
  }
}

async function windowFor(sb: SupabaseClient, userId: string, lastSyncAt: string | null, full = false) {
  const tz = await timeZoneOf(sb, userId);
  return { tz, w: syncWindow(localDate(new Date(), tz), lastSyncAt, new Date(), { full }) };
}

/** Reconciliation for everyone (webhooks can be missed). The first run of the day re-reads all 14 days. */
async function syncAll(sb: SupabaseClient, cfg: Config) {
  await removeExpiredPending(sb, cfg).catch((e) => console.error("whoop cleanup failed:", errCode(e)));
  const { data, error } = await sb.from("connections").select("user_id, last_sync_at").eq("provider", PROVIDER).eq("status", "connected");
  if (error) throw error;
  const full = new Date().getUTCHours() < 3;
  let synced = 0;
  let failed = 0;
  for (const c of data ?? []) {
    const { tz, w } = await windowFor(sb, c.user_id, c.last_sync_at, full);
    const r = await syncAndRecord(sb, cfg, c.user_id, w, tz);
    if (r.ok) synced++;
    else failed++;
    if (!r.ok && r.retryAfter) break; // rate limited: the next run continues
  }
  return { synced, failed, total: data?.length ?? 0 };
}

// ---------- routes for the app ----------

async function start(sb: SupabaseClient, cfg: Config, userId: string) {
  // one pending login per person; expired states of everyone go too
  await sb.from("whoop_oauth_states").delete().lt("created_at", new Date(Date.now() - STATE_TTL_MS).toISOString());
  await check(sb.from("whoop_oauth_states").delete().eq("user_id", userId));
  for (let i = 0; i < 5; i++) {
    const state = randomState();
    const { error } = await sb.from("whoop_oauth_states").insert({ state, user_id: userId });
    if (!error) return { url: authorizeUrl({ clientId: cfg.clientId, redirectUri: cfg.redirectUri, state }) };
    if ((error as { code?: string }).code !== "23505") throw error; // taken: draw again
  }
  throw new Error("state");
}

async function status(sb: SupabaseClient, cfg: Config | null, userId: string) {
  const { data: conn, error } = await sb
    .from("connections")
    .select("status, consent_ai, connected_at, last_sync_at, last_error")
    .eq("user_id", userId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (error) throw error;
  let days: unknown[] = [];
  let pending = false;
  if (conn) {
    const today = localDate(new Date(), await timeZoneOf(sb, userId));
    const res = await sb.from("whoop_days").select(DAY_COLS).eq("user_id", userId).gte("day", keepFrom(today)).order("day", { ascending: false }).limit(14);
    if (res.error) throw res.error;
    days = res.data ?? [];
  } else {
    // back from WHOOP, not confirmed yet (a grant waiting for her app never shows any values)
    const { data: p } = await sb.from("whoop_pending").select("user_id").eq("user_id", userId).maybeSingle();
    pending = !!p;
  }
  return {
    available: !!cfg,
    connected: conn?.status === "connected",
    status: conn?.status ?? (pending ? "pending" : null),
    consent_ai: conn?.consent_ai ?? false,
    connected_at: conn?.connected_at ?? null,
    last_sync_at: conn?.last_sync_at ?? null,
    last_error: conn?.last_error ?? null,
    attribution: WHOOP_ATTRIBUTION,
    days,
  };
}

async function syncNow(sb: SupabaseClient, cfg: Config, userId: string) {
  const { data: conn } = await sb.from("connections").select("status, last_sync_at").eq("user_id", userId).eq("provider", PROVIDER).maybeSingle();
  if (!conn) return { ok: false, connected: false };
  if (conn.status !== "connected") return { ok: false, connected: false, status: conn.status };
  const recent = { ok: true, connected: true, skipped: "recent", last_sync_at: conn.last_sync_at };
  if (conn.last_sync_at && Date.now() - Date.parse(conn.last_sync_at) < MANUAL_MIN_GAP_MS) return recent;
  // at most once a minute, claimed in ONE conditional update: two taps (or two devices) at the same
  // moment can't both pass a read-then-write check
  const cutoff = new Date(Date.now() - MANUAL_MIN_GAP_MS).toISOString();
  const { data: claimed, error } = await sb
    .from("connections")
    .update({ manual_sync_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("provider", PROVIDER)
    .eq("status", "connected")
    .or(`manual_sync_at.is.null,manual_sync_at.lt."${cutoff}"`)
    .select("user_id");
  if (error) throw error;
  if (!claimed?.length) return recent;
  const { tz, w } = await windowFor(sb, userId, conn.last_sync_at);
  const r = await syncAndRecord(sb, cfg, userId, w, tz);
  return { connected: true, ...r, retryAfter: undefined };
}

// ---------- link confirmation ----------
// A grant back from WHOOP waits in whoop_pending until the person confirms it in her app. Nothing syncs,
// refreshes or matches webhooks with it, and it never touches a link that is connected: only her own
// confirmation moves it into connections and whoop_tokens.

/** A WHOOP account that a confirmed link (of anyone but `except`) uses. */
async function linkedElsewhere(sb: SupabaseClient, externalId: string | null, except: string): Promise<boolean> {
  if (!externalId) return false;
  const { data } = await sb.from("connections").select("user_id").eq("provider", PROVIDER).eq("external_user_id", externalId).neq("user_id", except).limit(1);
  return !!data?.length;
}

/**
 * A revoke would end someone's access: the WHOOP account is linked for real (by anyone, `owner` too) or
 * someone other than `owner` is linking it right now. When unsure (a read failed), it counts as in use.
 */
async function inUse(sb: SupabaseClient, externalId: string, owner: string): Promise<boolean> {
  const linked = await sb.from("connections").select("user_id").eq("provider", PROVIDER).eq("external_user_id", externalId).limit(1);
  if (linked.error || linked.data?.length) return true;
  const other = await sb.from("whoop_pending").select("user_id").eq("external_user_id", externalId).neq("user_id", owner).limit(1);
  return !!other.error || !!other.data?.length;
}

interface PendingGrant {
  external_user_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  scope: string | null;
  confirm_hash: string;
  confirm_until: string;
}
const GRANT_COLS = "external_user_id, access_token, refresh_token, expires_at, scope, confirm_hash, confirm_until";

/**
 * Ends an unconfirmed grant at WHOOP with its own tokens. Access tokens live an hour, so one that ran
 * out is refreshed first (and once more after a 401): a revoke with a dead token would reach nothing.
 */
async function revokeGrant(cfg: Config, userId: string, g: PendingGrant): Promise<boolean> {
  let refreshed = false;
  const refresh = async (): Promise<string | null> => {
    if (refreshed || !g.refresh_token) return null;
    refreshed = true;
    const refreshToken = await openStoredToken(g.refresh_token, cfg.tokenKey, ctx(userId, "refresh"));
    const t = await exchange(tokenRequestBody({ grant: "refresh_token", refreshToken, clientId: cfg.clientId, clientSecret: cfg.clientSecret }));
    return t.access_token;
  };
  let access = await openStoredToken(g.access_token, cfg.tokenKey, ctx(userId, "access"));
  if (Date.parse(g.expires_at) - TOKEN_SKEW_MS <= Date.now()) access = (await refresh()) ?? access;
  return whoopClient({ fetch, token: () => Promise.resolve(access), onUnauthorized: refresh, maxWaitSec: 0 }).revoke();
}

/**
 * Removes this person's unconfirmed grant (never a confirmed link): revokes it at WHOOP as far as
 * possible (not while that WHOOP account is in use, see inUse), then deletes it. True when revoked.
 */
async function removePending(sb: SupabaseClient, cfg: Config | null, userId: string, opts: { revoke?: boolean } = {}): Promise<boolean> {
  const { data: g, error } = await sb.from("whoop_pending").select(GRANT_COLS).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!g) return false;
  const grant = g as PendingGrant;
  let revoked = false;
  if (cfg && opts.revoke !== false && !(await inUse(sb, grant.external_user_id, userId))) {
    try {
      revoked = await revokeGrant(cfg, userId, grant);
    } catch (e) {
      console.error("whoop revoke (pending) failed:", errCode(e));
    }
  }
  // only the grant read above: a newer one that came back from WHOOP meanwhile stays
  await check(sb.from("whoop_pending").delete().eq("user_id", userId).eq("confirm_hash", grant.confirm_hash));
  return revoked;
}

/** Unconfirmed grants whose code ran out (reconciliation run; the daily purge is the backstop). */
async function removeExpiredPending(sb: SupabaseClient, cfg: Config) {
  const { data } = await sb.from("whoop_pending").select("user_id").lt("confirm_until", new Date().toISOString()).limit(CLEANUP_MAX);
  for (const r of (data ?? []) as { user_id: string }[]) await removePending(sb, cfg, r.user_id).catch((e) => console.error("whoop cleanup failed:", errCode(e)));
}

/** The first 14 days right after the link, with a bounded wait (the reconciliation catches up otherwise). */
async function firstSync(sb: SupabaseClient, cfg: Config, userId: string) {
  const tz = await timeZoneOf(sb, userId);
  const first = syncAndRecord(sb, cfg, userId, syncWindow(localDate(new Date(), tz), null, new Date(), { full: true }), tz);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = await Promise.race([first.then(() => true), new Promise<boolean>((r) => (timer = setTimeout(() => r(false), CONFIRM_SYNC_MS)))]);
  clearTimeout(timer);
  if (!done) background(first);
}

/**
 * The app confirms the grant with the code from the callback, with the person's login. Only her own
 * grant becomes her link; a wrong or foreign code removes the grant it points to.
 */
async function confirm(sb: SupabaseClient, cfg: Config, userId: string, code: unknown) {
  const ownPending = async () => {
    const { data } = await sb.from("whoop_pending").select("user_id").eq("user_id", userId).maybeSingle();
    return !!data;
  };
  if (typeof code !== "string" || !CONFIRM_CODE_RE.test(code)) {
    await removePending(sb, cfg, userId);
    return { ok: false, reason: "mismatch" };
  }
  const hash = await hashConfirmCode(code);
  // the grant this code belongs to, else the link it already confirmed (a repeated request)
  const { data: p, error } = await sb.from("whoop_pending").select("user_id, confirm_until").eq("confirm_hash", hash).maybeSingle();
  if (error) throw error;
  let found: PendingLink | null = p ? { user_id: p.user_id, status: "pending", confirm_until: p.confirm_until } : null;
  if (!found) {
    const { data: t, error: tError } = await sb.from("whoop_tokens").select("user_id, confirm_until").eq("confirm_hash", hash).maybeSingle();
    if (tError) throw tError;
    if (t) {
      const { data: c } = await sb.from("connections").select("status").eq("user_id", t.user_id).eq("provider", PROVIDER).maybeSingle();
      found = { user_id: t.user_id, status: c?.status ?? "missing", confirm_until: t.confirm_until };
    }
  }
  const decision = confirmOutcome(found, userId, !found || found.user_id !== userId ? await ownPending() : false, Date.now());
  if (decision.outcome === "mismatch" || decision.outcome === "expired") {
    if (found && found.user_id !== userId) console.error("whoop confirm: code of another member"); // no ids in the logs
    if (decision.remove) await removePending(sb, cfg, decision.remove);
    return { ok: false, reason: decision.outcome };
  }
  if (decision.outcome === "already") return { ok: true, ...(await status(sb, cfg, userId)) };

  // claim it in one statement: only her own grant with this code, while the code is valid (a parallel
  // confirmation, or a newer grant arriving now, can't be mixed into it)
  const now = new Date().toISOString();
  const claim = async () => {
    const { data, error: claimError } = await sb.from("whoop_pending").delete().eq("user_id", userId).eq("confirm_hash", hash).gt("confirm_until", now).select(GRANT_COLS);
    if (claimError) throw claimError;
    return (data?.[0] as PendingGrant | undefined) ?? null;
  };
  const g = await claim();
  if (!g) {
    // a parallel request of hers got it first: answer like it, once it has written the link
    for (let i = 0; i < 3; i++) {
      const { data: t } = await sb.from("whoop_tokens").select("confirm_hash").eq("user_id", userId).maybeSingle();
      if (t?.confirm_hash === hash) return { ok: true, ...(await status(sb, cfg, userId)) };
      await sleep(400);
    }
    return { ok: false, reason: "mismatch" };
  }
  // that WHOOP account got linked to another member in the meantime: no revoke (the access is theirs)
  if (await linkedElsewhere(sb, g.external_user_id, userId)) return { ok: false, reason: "taken" };

  const { data: prev } = await sb.from("connections").select("external_user_id").eq("user_id", userId).eq("provider", PROVIDER).maybeSingle();
  // consent_ai is not part of it: a new link starts with false, a reconnect keeps her choice
  const { error: upError } = await sb
    .from("connections")
    .upsert({ user_id: userId, provider: PROVIDER, status: "connected", external_user_id: g.external_user_id, connected_at: now, last_error: null }, { onConflict: "user_id,provider" });
  if (upError) {
    if ((upError as { code?: string }).code === "23505") return { ok: false, reason: "taken" }; // linked elsewhere just now
    throw upError;
  }
  // the grant's tokens (sealed for her already) replace the link's; the code's hash stays as a marker
  await check(
    sb.from("whoop_tokens").upsert(
      {
        user_id: userId,
        provider: PROVIDER,
        access_token: g.access_token,
        refresh_token: g.refresh_token,
        expires_at: g.expires_at,
        scope: g.scope,
        refresh_lock: null,
        refresh_lock_until: null,
        confirm_hash: hash,
        confirm_until: g.confirm_until,
        updated_at: now,
      },
      { onConflict: "user_id" },
    ),
  );
  if (prev?.external_user_id && prev.external_user_id !== g.external_user_id) {
    await check(sb.from("whoop_days").delete().eq("user_id", userId)); // another WHOOP account: start afresh
  }
  // other members' grants for the same WHOOP account (e.g. a forged consent link): removed without a
  // revoke, which would end the link just confirmed
  const { data: others } = await sb.from("whoop_pending").select("user_id").eq("external_user_id", g.external_user_id).neq("user_id", userId).limit(CLEANUP_MAX);
  for (const o of (others ?? []) as { user_id: string }[]) await removePending(sb, cfg, o.user_id, { revoke: false });
  await firstSync(sb, cfg, userId);
  return { ok: true, ...(await status(sb, cfg, userId)) };
}

/** Revoke at WHOOP (as far as possible), then delete everything WHOOP-related of this person. */
async function disconnect(sb: SupabaseClient, cfg: Config | null, userId: string) {
  let revoked = false;
  const { data: conn } = await sb.from("connections").select("status").eq("user_id", userId).eq("provider", PROVIDER).maybeSingle();
  if (cfg && conn) {
    try {
      revoked = await apiFor(sb, cfg, userId).revoke();
    } catch (e) {
      console.error("whoop revoke failed:", errCode(e));
    }
  }
  // a grant never confirmed: revoked only when no one (her own link included) uses that WHOOP account
  revoked = (await removePending(sb, cfg, userId).catch((e) => (console.error("whoop pending removal failed:", errCode(e)), false))) || revoked;
  // the connection first: tokens and days hang on it (on delete cascade), so a sync still running
  // cannot write anything back; the explicit deletes below only make sure
  await check(sb.from("connections").delete().eq("user_id", userId).eq("provider", PROVIDER));
  await check(sb.from("whoop_tokens").delete().eq("user_id", userId));
  await check(sb.from("whoop_days").delete().eq("user_id", userId));
  await check(sb.from("whoop_pending").delete().eq("user_id", userId));
  await check(sb.from("whoop_oauth_states").delete().eq("user_id", userId));
  // what the coach said with WHOOP values in mind goes too
  await clearWhoopMessages(sb, userId);
  return { ok: true, revoked };
}

/**
 * For the function "account": before an account is deleted, WHOOP access is revoked as far as possible
 * and every WHOOP row deleted (the cascade would delete the rows, but not end the access at WHOOP).
 * An unconfirmed grant is only revoked when no one else has that WHOOP account linked.
 */
export async function disconnectWhoopForAccount(userId: string): Promise<{ revoked: boolean }> {
  const sb = admin();
  const cfg = config();
  const { data: conn } = await sb.from("connections").select("status").eq("user_id", userId).eq("provider", PROVIDER).maybeSingle();
  const { data: grant } = await sb.from("whoop_pending").select("user_id").eq("user_id", userId).maybeSingle();
  if (!conn && !grant) return { revoked: false };
  return { revoked: (await disconnect(sb, cfg, userId)).revoked };
}

export async function handleApp(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const cfg = config();
  try {
    const sb = admin();
    if (req.method === "GET") {
      if (new URL(req.url).searchParams.get("action") !== "status") return json({ error: "unknown action" }, 400);
      const uid = await loggedInUser(sb, req);
      if (!uid) return json({ error: "unauthorized" }, 401);
      return json(await status(sb, cfg, uid));
    }
    if (req.method !== "POST") return json({ error: "method" }, 405);
    let body: { action?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "bad request" }, 400);
    }

    const cron = req.headers.get("x-cron-secret");
    if (cron !== null) {
      if (!cronAllowed(cron)) return json({ error: "unauthorized" }, 401);
      if (body.action !== "sync") return json({ error: "unknown action" }, 400);
      if (!cfg) return json({ ok: false, reason: "not_configured" });
      const run = syncAll(sb, cfg);
      if (background(run)) return json({ ok: true, queued: true }, 202);
      return json({ ok: true, ...(await run) });
    }

    const uid = await loggedInUser(sb, req);
    if (!uid) return json({ error: "unauthorized" }, 401);
    if (body.action === "disconnect") return json(await disconnect(sb, cfg, uid));
    if (!cfg) return json({ ok: false, reason: "not_configured" });
    if (body.action === "start") return json(await start(sb, cfg, uid));
    if (body.action === "confirm") return json(await confirm(sb, cfg, uid, (body as { code?: unknown }).code));
    if (body.action === "sync") return json(await syncNow(sb, cfg, uid));
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("whoop function failed:", errCode(e));
    return json({ error: "internal" }, 500);
  }
}

// ---------- OAuth callback ----------

export async function handleCallback(req: Request): Promise<Response> {
  const cfg = config();
  // never "connected" from here: the browser that comes back may not be the person who started (CSRF)
  const back = (result: "confirm" | "error" | "denied" | "taken", code?: string) =>
    new Response(null, {
      status: 302,
      headers: {
        Location: appReturnUrl(cfg?.appUrl ?? DEFAULT_APP_URL, result, code),
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  if (!cfg) return back("error");
  const params = new URL(req.url).searchParams;
  const state = params.get("state") ?? "";
  const code = params.get("code");
  if (!STATE_RE.test(state)) return back(params.get("error") === "access_denied" ? "denied" : "error");

  try {
    const sb = admin();
    // single use: the state is deleted as it is read
    const { data: claimed, error } = await sb.from("whoop_oauth_states").delete().eq("state", state).select("user_id, created_at");
    if (error) throw error;
    const st = claimed?.[0] as { user_id: string; created_at: string } | undefined;
    if (params.get("error")) return back(params.get("error") === "access_denied" ? "denied" : "error"); // declined at WHOOP
    if (!st || Date.now() - Date.parse(st.created_at) > STATE_TTL_MS) return back("error");
    if (!code || code.length > 2000) return back("error");
    const userId = st.user_id;

    const tok = await exchange(tokenRequestBody({ grant: "authorization_code", code, redirectUri: cfg.redirectUri, clientId: cfg.clientId, clientSecret: cfg.clientSecret }));
    if (!tok.refresh_token) console.error("whoop callback: no refresh token (offline scope missing?)");

    // who this is at WHOOP: only the numeric id is kept (to match webhooks), not name or e-mail
    const prof = await fetch(`${WHOOP_API}/v2/user/profile/basic`, {
      headers: { Authorization: `Bearer ${tok.access_token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!prof.ok) {
      console.error("whoop callback: profile", prof.status);
      await prof.body?.cancel();
      return back("error");
    }
    const externalId = extractUserId(await prof.text());
    if (!externalId) return back("error");

    // one WHOOP account belongs to one member (webhooks name the WHOOP user only); no revoke here: the
    // access is the other member's. The app says so ("taken").
    if (await linkedElsewhere(sb, externalId, userId)) {
      console.error("whoop callback: account already linked to another member");
      return back("taken");
    }

    // The grant waits apart (whoop_pending) until the person confirms it in her app: nothing syncs with
    // it, webhooks don't reach it, and a link she has now stays exactly as it is. An earlier grant of a
    // different WHOOP account that she never confirmed is ended first; a newer one replaces it.
    const { data: earlier } = await sb.from("whoop_pending").select("external_user_id").eq("user_id", userId).maybeSingle();
    if (earlier && earlier.external_user_id !== externalId) await removePending(sb, cfg, userId);
    const confirmCode = randomConfirmCode();
    const sealed = await tokenRow(cfg, userId, tok, "new");
    await check(
      sb.from("whoop_pending").upsert(
        {
          user_id: userId,
          external_user_id: externalId,
          access_token: sealed.access_token,
          refresh_token: sealed.refresh_token ?? null,
          expires_at: tok.expires_at,
          scope: tok.scope,
          confirm_hash: await hashConfirmCode(confirmCode),
          confirm_until: new Date(Date.now() + CONFIRM_TTL_MS).toISOString(),
          created_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      ),
    );
    return back("confirm", confirmCode);
  } catch (e) {
    console.error("whoop callback failed:", errCode(e));
    return back("error");
  }
}

// ---------- webhooks ----------

async function processEvent(sb: SupabaseClient, cfg: Config, userId: string, ev: WhoopWebhookEvent) {
  const tz = await timeZoneOf(sb, userId);
  const now = new Date();
  const today = localDate(now, tz);
  let w: SyncWindow | null = null;
  if (ev.type.endsWith(".deleted")) {
    w = syncWindow(today, null, now, { full: true }); // the record is gone, its day unknown: recompute all kept days
  } else {
    const kind = ev.type.startsWith("workout") ? "workout" : "sleep"; // recovery events carry the sleep's id
    try {
      const rec = await apiFor(sb, cfg, userId).get<WhoopSleep | WhoopWorkout>(
        kind === "workout" ? `/v2/activity/workout/${encodeURIComponent(ev.id)}` : `/v2/activity/sleep/${encodeURIComponent(ev.id)}`,
      );
      const day = recordDay(kind, rec, tz);
      w = rec ? (day ? dayWindow(day, today, now) : null) : syncWindow(today, null, now, { full: true });
      if (!w) return; // older than what is kept
    } catch (e) {
      console.error("whoop webhook fetch failed:", errCode(e));
      if (needsReconnect(e) && !tokenMissing(e)) await markNeedsReconnect(sb, userId, e);
      return;
    }
  }
  await syncAndRecord(sb, cfg, userId, w, tz);
}

export async function handleWebhook(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const cfg = config();
  if (!cfg) return new Response("Not configured", { status: 503 });
  const raw = await req.text();
  if (raw.length > 10_000) return new Response("Too large", { status: 413 });
  const valid = await verifyWhoopSignature(raw, req.headers.get("X-WHOOP-Signature-Timestamp"), req.headers.get("X-WHOOP-Signature"), cfg.clientSecret);
  if (!valid) return new Response("Invalid signature", { status: 401 });
  const ev = parseWebhookEvent(raw);
  if (!ev) return new Response(null, { status: 204 }); // a type this app does not use

  try {
    const sb = admin();
    // dedupe by trace_id (WHOOP may deliver twice); a missed follow-up is caught by the reconciliation
    const { data: fresh, error } = await sb.from("whoop_webhook_seen").upsert({ trace_id: ev.traceId }, { onConflict: "trace_id", ignoreDuplicates: true }).select("trace_id");
    if (error) throw error;
    if (!fresh?.length) return new Response(null, { status: 204 });
    const { data: conn } = await sb.from("connections").select("user_id, status").eq("provider", PROVIDER).eq("external_user_id", ev.userId).maybeSingle();
    if (!conn || conn.status !== "connected") return new Response(null, { status: 204 });
    const work = processEvent(sb, cfg, conn.user_id, ev);
    if (!background(work)) await work.catch((e) => console.error("whoop webhook failed:", errCode(e)));
    return new Response(null, { status: 204 });
  } catch (e) {
    console.error("whoop webhook failed:", errCode(e));
    return new Response("Error", { status: 500 }); // WHOOP retries
  }
}
