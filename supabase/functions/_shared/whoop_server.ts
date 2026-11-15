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
//   whoop-callback  GET from WHOOP (?code&state | ?error&state) → keeps the tokens as a PENDING link plus a
//                   single-use code (only its hash is stored, valid 10 minutes) and sends the browser back:
//                   302 <app>#du/verbindungen?whoop=confirm&code=… (whoop=error / whoop=denied)
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
  tokenRequestBody,
  type TokenSet,
  validAccessToken,
  validTimeZone,
  WHOOP_API,
  WHOOP_ATTRIBUTION,
  WHOOP_TOKEN_URL,
  type WhoopCycle,
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
      async save(_lock, t) {
        // access and the rotated refresh token in one statement, which also releases the lock
        const row = await tokenRow(cfg, userId, t, "refresh");
        delete row.user_id;
        for (let attempt = 0; ; attempt++) {
          const { error } = await sb.from("whoop_tokens").update(row).eq("user_id", userId);
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
  await sb.from("connections").update({ status: "needs_reconnect", last_error: whoopErrorMessage(e) }).eq("user_id", userId).eq("provider", PROVIDER);
}

// ---------- sync ----------

const DAY_COLS =
  "day, recovery_score, hrv_ms, resting_hr, spo2, skin_temp, sleep_minutes, sleep_performance, sleep_need_minutes, respiratory_rate, day_strain, kilojoule, steps, workout_count, workout_minutes";

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
    await sb.from("connections").update({ last_sync_at: started, last_error: null, status: "connected" }).eq("user_id", userId).eq("provider", PROVIDER);
    return { ok: true, days, last_sync_at: started };
  } catch (e) {
    console.error("whoop sync failed:", errCode(e));
    if (needsReconnect(e)) await markNeedsReconnect(sb, userId, e);
    else await sb.from("connections").update({ last_error: whoopErrorMessage(e) }).eq("user_id", userId).eq("provider", PROVIDER);
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
  // a pending link has nothing synced yet (and may not even be hers: see confirm)
  if (conn && conn.status !== "pending") {
    const today = localDate(new Date(), await timeZoneOf(sb, userId));
    const res = await sb.from("whoop_days").select(DAY_COLS).eq("user_id", userId).gte("day", keepFrom(today)).order("day", { ascending: false }).limit(14);
    if (res.error) throw res.error;
    days = res.data ?? [];
  }
  return {
    available: !!cfg,
    connected: conn?.status === "connected",
    status: conn?.status ?? null,
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

/** A WHOOP account that a confirmed link (of anyone but `except`) uses. */
async function linkedElsewhere(sb: SupabaseClient, externalId: string | null, except: string): Promise<boolean> {
  if (!externalId) return false;
  const { data } = await sb.from("connections").select("user_id").eq("provider", PROVIDER).eq("external_user_id", externalId).neq("user_id", except).limit(1);
  return !!data?.length;
}

/** Someone else links (or is linking) this WHOOP account: a revoke would end their access too. */
async function inUseElsewhere(sb: SupabaseClient, externalId: string | null, except: string): Promise<boolean> {
  if (!externalId) return false;
  if (await linkedElsewhere(sb, externalId, except)) return true;
  const { data } = await sb.from("whoop_tokens").select("user_id").eq("pending_external_user_id", externalId).neq("user_id", except).limit(1);
  return !!data?.length;
}

/**
 * Removes a PENDING link (never a confirmed one): revokes its access at WHOOP as far as possible (not
 * when that WHOOP account is linked to someone for real, a revoke would end that link), then deletes
 * the connection; tokens and summaries go with it (on delete cascade).
 */
async function removePending(sb: SupabaseClient, cfg: Config | null, userId: string, opts: { revoke?: boolean } = {}) {
  const { data: conn } = await sb.from("connections").select("status").eq("user_id", userId).eq("provider", PROVIDER).maybeSingle();
  if (conn?.status !== "pending") return;
  if (cfg && opts.revoke !== false) {
    const { data: tok } = await sb.from("whoop_tokens").select("access_token, pending_external_user_id").eq("user_id", userId).maybeSingle();
    if (tok?.access_token && !(await inUseElsewhere(sb, tok.pending_external_user_id ?? null, userId))) {
      try {
        const access = await openStoredToken(tok.access_token, cfg.tokenKey, ctx(userId, "access"));
        await whoopClient({ fetch, token: () => Promise.resolve(access), maxWaitSec: 0 }).revoke();
      } catch (e) {
        console.error("whoop revoke (pending) failed:", errCode(e));
      }
    }
  }
  await check(sb.from("connections").delete().eq("user_id", userId).eq("provider", PROVIDER).eq("status", "pending"));
}

/** Unconfirmed links whose code ran out (reconciliation run; the daily purge is the backstop). */
async function removeExpiredPending(sb: SupabaseClient, cfg: Config) {
  const { data } = await sb
    .from("whoop_tokens")
    .select("user_id, connections!inner(status)")
    .eq("connections.status", "pending")
    .lt("confirm_until", new Date().toISOString())
    .limit(CLEANUP_MAX);
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
 * The app confirms the link with the code from the callback, with the person's login. Only her own
 * pending link becomes connected; a wrong or foreign code removes the pending link it points to.
 */
async function confirm(sb: SupabaseClient, cfg: Config, userId: string, code: unknown) {
  const ownPending = async () => {
    const { data } = await sb.from("connections").select("status").eq("user_id", userId).eq("provider", PROVIDER).maybeSingle();
    return data?.status === "pending";
  };
  if (typeof code !== "string" || !CONFIRM_CODE_RE.test(code)) {
    if (await ownPending()) await removePending(sb, cfg, userId);
    return { ok: false, reason: "mismatch" };
  }
  const { data: tok, error } = await sb
    .from("whoop_tokens")
    .select("user_id, confirm_until, pending_external_user_id")
    .eq("confirm_hash", await hashConfirmCode(code))
    .maybeSingle();
  if (error) throw error;
  let found: { user_id: string; status: string; confirm_until: string | null } | null = null;
  if (tok) {
    const { data: c } = await sb.from("connections").select("status").eq("user_id", tok.user_id).eq("provider", PROVIDER).maybeSingle();
    found = { user_id: tok.user_id, status: c?.status ?? "missing", confirm_until: tok.confirm_until };
  }
  const decision = confirmOutcome(found, userId, !found || found.user_id !== userId ? await ownPending() : false, Date.now());
  if (decision.outcome === "mismatch" || decision.outcome === "expired") {
    if (found && found.user_id !== userId) console.error("whoop confirm: code of another member"); // no ids in the logs
    if (decision.remove) await removePending(sb, cfg, decision.remove);
    return { ok: false, reason: decision.outcome };
  }
  if (decision.outcome === "already") return { ok: true, ...(await status(sb, cfg, userId)) };

  // connect: only this person's pending link (a parallel confirm finds nothing left to update)
  const externalId = tok!.pending_external_user_id ?? null;
  const { data: updated, error: upError } = await sb
    .from("connections")
    .update({ status: "connected", external_user_id: externalId, connected_at: new Date().toISOString(), last_error: null })
    .eq("user_id", userId)
    .eq("provider", PROVIDER)
    .eq("status", "pending")
    .select("user_id");
  if (upError) {
    if ((upError as { code?: string }).code === "23505") {
      // that WHOOP account got linked to another member in the meantime: no revoke (it is theirs now)
      await removePending(sb, cfg, userId, { revoke: false });
      return { ok: false, reason: "taken" };
    }
    throw upError;
  }
  if (!updated?.length) {
    const st = await status(sb, cfg, userId);
    return st.connected ? { ok: true, ...st } : { ok: false, reason: "mismatch" };
  }
  await check(sb.from("whoop_tokens").update({ pending_external_user_id: null }).eq("user_id", userId));
  // other members' pending links to the same WHOOP account (e.g. a forged consent link): removed without
  // a revoke, which would end the link just confirmed
  if (externalId) {
    const { data: others } = await sb.from("whoop_tokens").select("user_id").eq("pending_external_user_id", externalId).neq("user_id", userId).limit(CLEANUP_MAX);
    for (const o of (others ?? []) as { user_id: string }[]) await removePending(sb, cfg, o.user_id, { revoke: false });
  }
  await firstSync(sb, cfg, userId);
  return { ok: true, ...(await status(sb, cfg, userId)) };
}

/** Revoke at WHOOP (as far as possible), then delete everything WHOOP-related of this person. */
async function disconnect(sb: SupabaseClient, cfg: Config | null, userId: string) {
  let revoked = false;
  const { data: conn } = await sb.from("connections").select("status").eq("user_id", userId).eq("provider", PROVIDER).maybeSingle();
  // a link never confirmed: revoked only when no one else links that WHOOP account (see removePending)
  if (conn?.status === "pending") await removePending(sb, cfg, userId);
  else if (cfg && conn) {
    try {
      revoked = await apiFor(sb, cfg, userId).revoke();
    } catch (e) {
      console.error("whoop revoke failed:", errCode(e));
    }
  }
  // the connection first: tokens and days hang on it (on delete cascade), so a sync still running
  // cannot write anything back; the explicit deletes below only make sure
  await check(sb.from("connections").delete().eq("user_id", userId).eq("provider", PROVIDER));
  await check(sb.from("whoop_tokens").delete().eq("user_id", userId));
  await check(sb.from("whoop_days").delete().eq("user_id", userId));
  await check(sb.from("whoop_oauth_states").delete().eq("user_id", userId));
  return { ok: true, revoked };
}

/**
 * For the function "account": before an account is deleted, WHOOP access is revoked as far as possible
 * and every WHOOP row deleted (the cascade would delete the rows, but not end the access at WHOOP).
 * A pending link is only revoked when no one else has that WHOOP account linked.
 */
export async function disconnectWhoopForAccount(userId: string): Promise<{ revoked: boolean }> {
  const sb = admin();
  const cfg = config();
  const { data: conn } = await sb.from("connections").select("status").eq("user_id", userId).eq("provider", PROVIDER).maybeSingle();
  if (!conn) return { revoked: false };
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
  const back = (result: "confirm" | "error" | "denied", code?: string) =>
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
    // access is the other member's
    if (await linkedElsewhere(sb, externalId, userId)) {
      console.error("whoop callback: account already linked to another member");
      return back("error");
    }
    const { data: prev } = await sb.from("connections").select("external_user_id").eq("user_id", userId).eq("provider", PROVIDER).maybeSingle();
    if (prev?.external_user_id && prev.external_user_id !== externalId) {
      await check(sb.from("whoop_days").delete().eq("user_id", userId)); // a different WHOOP account: start afresh
    }

    // a PENDING link: nothing is synced and webhooks don't reach it (external_user_id stays empty) until
    // the person confirms in the app. consent_ai is not part of the upsert: new links start with false,
    // a reconnect keeps the choice.
    const confirmCode = randomConfirmCode();
    await check(
      sb.from("connections").upsert(
        { user_id: userId, provider: PROVIDER, status: "pending", external_user_id: null, last_error: null },
        { onConflict: "user_id,provider" },
      ),
    );
    await check(
      sb.from("whoop_tokens").upsert(
        {
          ...(await tokenRow(cfg, userId, tok, "new")),
          pending_external_user_id: externalId,
          confirm_hash: await hashConfirmCode(confirmCode),
          confirm_until: new Date(Date.now() + CONFIRM_TTL_MS).toISOString(),
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
      if (needsReconnect(e)) await markNeedsReconnect(sb, userId, e);
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
