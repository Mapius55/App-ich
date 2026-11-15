// Supabase Edge Function: Nolio (training platform) for the owner of this app only.
//   POST + header x-cron-secret       → sync (pg_cron job "i-am-nolio", every 3 hours at minute 17)
//   POST with the owner's login       → sync now (app: "Jetzt holen"); any other login gets
//                                       {connected:false, reason:"not_owner"}
//   GET  ?action=status (login)       → {available, connected, last_sync_at, last_error, running, counts}
//   GET  ?action=check (service role key as bearer)
//                                     → {ok, http_status, error_code, scopes, quota}: verifies the key
//                                       without returning any personal data
// Secrets: NOLIO_API_KEY (the owner's personal key nolio_sk_…; Nolio's terms allow it only for the key
// holder's own account, so it is never used for anyone else), NOLIO_OWNER_USER_ID (her app user id),
// PUSH_CRON_SECRET (shared with the notifications job) or NOLIO_CRON_SECRET.
// Deploy with --no-verify-jwt: every caller is checked here. Logs carry status codes only.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.119.0";
import { zonedToUtc } from "../_shared/ics.ts";
import {
  DEFAULT_TZ,
  diffEvents,
  diffGoalTime,
  type EventRow,
  type ExistingEvent,
  type ExistingGoalTime,
  type GoalForMapping,
  goalTimeFor,
  localDay,
  missingSports,
  NolioError,
  nolioClient,
  nolioErrorMessage,
  type NolioPlannedEvent,
  type NolioRealEvent,
  type NolioSport,
  parseRealEvent,
  plannedToEvent,
  safeEqual,
  sportIndex,
  syncWindow,
  type TrainingRow,
  validTimeZone,
} from "../_shared/nolio.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const admin = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCK_MINUTES = 5; // a run that started longer ago is considered dead
const MAX_SPORT_LOOKUPS = 8;

interface Config {
  key: string | null;
  owner: string | null;
}
function config(): Config {
  const key = (Deno.env.get("NOLIO_API_KEY") ?? "").trim();
  const owner = (Deno.env.get("NOLIO_OWNER_USER_ID") ?? "").trim().toLowerCase();
  return { key: key || null, owner: UUID_RE.test(owner) ? owner : null };
}

const bearer = (req: Request) => (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

async function loggedInUser(sb: SupabaseClient, req: Request): Promise<string | null> {
  const token = bearer(req);
  if (!token) return null;
  const { data, error } = await sb.auth.getUser(token);
  return error || !data.user ? null : data.user.id;
}

/** The service role key (legacy JWT) or one of the project's secret keys, if the runtime provides them. */
function isServiceRole(token: string): boolean {
  if (!token) return false;
  const keys = [Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")];
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys);
      if (parsed && typeof parsed === "object") keys.push(...Object.values(parsed).filter((v): v is string => typeof v === "string"));
    } catch {
      // not JSON: ignore
    }
  }
  return keys.some((k) => !!k && k.length >= 20 && safeEqual(token, k));
}

function cronAllowed(header: string): boolean {
  return [Deno.env.get("NOLIO_CRON_SECRET"), Deno.env.get("PUSH_CRON_SECRET")].some((s) => !!s && safeEqual(header, s));
}

const chunks = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** All rows of a query, page by page (PostgREST hands out at most 1000 at a time). */
async function pages<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>, size = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 100_000; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw error;
    const rows = (Array.isArray(data) ? data : []) as T[];
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

const check = async (r: PromiseLike<{ error: unknown }>) => {
  const { error } = await r;
  if (error) throw error;
};

interface Counts {
  trainings: number; // completed trainings/races read in this run
  assigned: number; // trainings that count toward a goal (all stored)
  planned: number; // planned entries in the calendar (from today on)
}

// ---------- the sync ----------

async function sync(sb: SupabaseClient, key: string, owner: string, lastSyncAt: string | null, now: Date, onTz: (tz: string) => void): Promise<Counts> {
  const api = nolioClient({ key });
  const me = await api.get<{ timezone?: unknown }>("/api/v2/me/");
  const tz = validTimeZone(me?.timezone);
  onTz(tz);
  const w = syncWindow(lastSyncAt, now, tz);

  const catalogue = await api.list<NolioSport>("/api/v2/sports/", {}, 10);
  const sports = sportIndex(catalogue.items);
  // Not filtered by duration etc.: restricted rows have those nulled and would silently drop out.
  const real = await api.list<NolioRealEvent>("/api/v2/real/trainings/", { date_from: w.from, date_to: w.to }, 20);
  const races = await api.list<NolioRealEvent>("/api/v2/real/competitions/", { date_from: w.from, date_to: w.to }, 5);
  const planned = await api.list<NolioPlannedEvent>("/api/v2/planned/trainings/", { date_from: w.today, date_to: w.planTo }, 10);
  const plannedRaces = await api.list<NolioPlannedEvent>("/api/v2/planned/competitions/", { date_from: w.today, date_to: w.competitionTo }, 5);

  // sports outside the listed catalogue (parent sports, old ids): a few single lookups
  const used = [...real.items, ...races.items, ...planned.items, ...plannedRaces.items].map((x) => x.sport);
  for (let round = 0, lookups = 0; round < 2 && lookups < MAX_SPORT_LOOKUPS; round++) {
    for (const id of missingSports(used, sports)) {
      if (lookups++ >= MAX_SPORT_LOOKUPS) break;
      try {
        const s = await api.get<NolioSport>(`/api/v2/sports/${id}/`);
        if (s && typeof s.id === "string") sports.set(s.id, s);
      } catch (e) {
        if (e instanceof NolioError && (e.status === 429 || e.status === 401)) throw e;
        sports.set(id, { id }); // unknown: don't ask again in this run
      }
    }
  }

  // 1. completed trainings and races
  const rows = new Map<string, TrainingRow>();
  for (const t of real.items) {
    const r = parseRealEvent(t, { tz, sports, kind: "training" });
    if (r) rows.set(r.id, r);
  }
  for (const t of races.items) {
    const r = parseRealEvent(t, { tz, sports, kind: "competition" });
    if (r) rows.set(r.id, r);
  }
  const syncedAt = new Date().toISOString();
  for (const part of chunks([...rows.values()], 500)) {
    await check(sb.from("nolio_trainings").upsert(part.map((r) => ({ ...r, user_id: owner, synced_at: syncedAt })), { onConflict: "user_id,id" }));
  }
  // deleted in Nolio: only where the list of that kind was read completely
  const complete: Record<string, boolean> = { training: !real.truncated, competition: !races.truncated };
  const inWindow = await pages<{ id: string; kind: string }>((a, b) =>
    sb.from("nolio_trainings").select("id, kind").eq("user_id", owner).gte("day", w.from).lte("day", w.to).order("id").range(a, b)
  );
  const gone = inWindow.filter((r) => !rows.has(r.id) && complete[r.kind]).map((r) => r.id);
  for (const part of chunks(gone, 200)) await check(sb.from("nolio_trainings").delete().eq("user_id", owner).in("id", part));

  // 2. time for goals, recomputed from every stored training (so changed goal sports apply to the past too)
  const goalRows = await pages<{ id: string; status: string; sports: unknown; effort_hours: unknown; target_date: string | null; created_at: string | null }>((a, b) =>
    sb.from("goals").select("id, status, sports, effort_hours, target_date, created_at").eq("user_id", owner).order("id").range(a, b)
  );
  const goals: GoalForMapping[] = goalRows.map((g) => ({
    id: g.id,
    status: g.status,
    sports: Array.isArray(g.sports) ? g.sports.filter((s): s is string => typeof s === "string") : null,
    effort_hours: g.effort_hours === null || g.effort_hours === undefined ? null : Number(g.effort_hours),
    target_date: g.target_date,
    created_day: g.created_at ? localDay(new Date(g.created_at), tz) : null,
  }));
  const stored = await pages<Pick<TrainingRow, "id" | "day" | "sport" | "sport_name" | "minutes" | "restricted">>((a, b) =>
    sb.from("nolio_trainings").select("id, day, sport, sport_name, minutes, restricted").eq("user_id", owner).order("id").range(a, b)
  );
  const existingTime = await pages<ExistingGoalTime>((a, b) =>
    sb.from("goal_time").select("id, external_id, goal_id, day, minutes").eq("user_id", owner).eq("source", "nolio").not("external_id", "is", null).order("id").range(a, b)
  );
  const desiredTime = goalTimeFor(stored, goals, sports);
  const time = diffGoalTime(existingTime, desiredTime, stored, new Map(goals.map((g) => [g.id, g.status])));
  for (const part of chunks(time.upserts, 500)) {
    await check(sb.from("goal_time").upsert(part.map((t) => ({ ...t, user_id: owner, source: "nolio" })), { onConflict: "user_id,source,external_id" }));
  }
  for (const part of chunks(time.deletes, 200)) await check(sb.from("goal_time").delete().eq("user_id", owner).in("id", part));

  // 3. the trainer's plan in the calendar
  const desired = [
    ...planned.items.map((p) => plannedToEvent(p, { tz, sports, goals, kind: "training" })),
    ...plannedRaces.items.map((p) => plannedToEvent(p, { tz, sports, goals, kind: "competition" })),
  ].filter((e): e is EventRow => e !== null);
  const fromIso = zonedToUtc(w.today, tz);
  const cols = "id, external_id, title, kind, starts_at, ends_at, all_day, notes, location, goal_id";
  const existing = await pages<ExistingEvent>((a, b) =>
    sb.from("events").select(cols).eq("user_id", owner).eq("source", "nolio").gte("starts_at", fromIso).order("id").range(a, b)
  );
  // entries still planned but stored with an earlier date (the trainer moved them forward)
  const known = new Set(existing.map((e) => e.external_id));
  const earlier = desired.map((d) => d.external_id).filter((id) => !known.has(id));
  for (const part of chunks(earlier, 100)) {
    const { data, error } = await sb.from("events").select(cols).eq("user_id", owner).eq("source", "nolio").in("external_id", part);
    if (error) throw error;
    existing.push(...((data ?? []) as ExistingEvent[]));
  }
  const ev = diffEvents(existing, desired, { block: !planned.truncated, termin: !plannedRaces.truncated }, fromIso);
  for (const part of chunks(ev.inserts, 200)) {
    // upsert: a second run at the same moment must not fail on the unique external id
    await check(sb.from("events").upsert(part.map((e) => ({ ...e, user_id: owner, source: "nolio" })), { onConflict: "user_id,source,external_id" }));
  }
  for (const u of ev.updates) await check(sb.from("events").update(u.patch).eq("id", u.id).eq("user_id", owner).eq("source", "nolio"));
  for (const part of chunks(ev.deletes, 200)) await check(sb.from("events").delete().eq("user_id", owner).eq("source", "nolio").in("id", part));

  return { trainings: rows.size, assigned: desiredTime.length, planned: desired.length };
}

interface SyncResult {
  ok: boolean;
  last_sync_at?: string;
  counts?: Counts;
  error?: string | null;
  skipped?: "running" | "throttled";
}

async function runSync(sb: SupabaseClient, cfg: Config): Promise<SyncResult> {
  const owner = cfg.owner!;
  await check(sb.from("nolio_sync").upsert({ user_id: owner }, { onConflict: "user_id", ignoreDuplicates: true }));
  const { data: state, error } = await sb.from("nolio_sync").select("last_sync_at, last_error, blocked_until").eq("user_id", owner).single();
  if (error) throw error;
  if (state.blocked_until && Date.parse(state.blocked_until) > Date.now()) return { ok: false, skipped: "throttled", error: state.last_error };

  // one run at a time (cron and "Jetzt holen" may meet)
  const started = new Date();
  const stale = new Date(started.getTime() - LOCK_MINUTES * 60_000).toISOString();
  const { data: locked, error: lockError } = await sb
    .from("nolio_sync")
    .update({ status: "running", started_at: started.toISOString() })
    .eq("user_id", owner)
    .or(`status.neq.running,started_at.is.null,started_at.lt."${stale}"`)
    .select("user_id");
  if (lockError) throw lockError;
  if (!locked?.length) return { ok: false, skipped: "running" };

  let tz = DEFAULT_TZ;
  try {
    const counts = await sync(sb, cfg.key!, owner, state.last_sync_at, started, (z) => (tz = z));
    await check(sb.from("nolio_sync").update({ status: "ok", last_sync_at: started.toISOString(), last_error: null, blocked_until: null }).eq("user_id", owner));
    return { ok: true, last_sync_at: started.toISOString(), counts };
  } catch (e) {
    const message = nolioErrorMessage(e, tz);
    const blockedUntil = e instanceof NolioError && e.status === 429 ? new Date(Date.now() + (e.retryAfter ?? 60) * 1000).toISOString() : null;
    await sb.from("nolio_sync").update({ status: "error", last_error: message, blocked_until: blockedUntil }).eq("user_id", owner);
    // status and codes only: nothing personal in the logs
    console.error("nolio sync failed:", e instanceof NolioError ? `${e.status} ${e.code ?? ""}` : String((e as { code?: unknown })?.code ?? "internal"));
    return { ok: false, error: message };
  }
}

// ---------- status and key check ----------

async function status(sb: SupabaseClient, userId: string, cfg: Config) {
  const none = { available: false, connected: false, last_sync_at: null, last_error: null, running: false, counts: null };
  if (!cfg.owner || userId !== cfg.owner || !cfg.key) return none;
  const head = { count: "exact" as const, head: true };
  const [st, trainings, assigned, planned] = await Promise.all([
    sb.from("nolio_sync").select("last_sync_at, last_error, status").eq("user_id", userId).maybeSingle(),
    sb.from("nolio_trainings").select("id", head).eq("user_id", userId).eq("restricted", false),
    sb.from("goal_time").select("id", head).eq("user_id", userId).eq("source", "nolio"),
    sb.from("events").select("id", head).eq("user_id", userId).eq("source", "nolio").gte("starts_at", zonedToUtc(localDay(new Date(), DEFAULT_TZ), DEFAULT_TZ)),
  ]);
  return {
    available: true,
    connected: !!st.data?.last_sync_at,
    last_sync_at: st.data?.last_sync_at ?? null,
    last_error: st.data?.last_error ?? null,
    running: st.data?.status === "running",
    counts: { trainings: trainings.count ?? 0, assigned: assigned.count ?? 0, planned: planned.count ?? 0 },
  };
}

const NEEDED_SCOPES = ["real:read", "planned:read"];

async function checkKey(cfg: Config) {
  const out = { ok: false, http_status: null as number | null, error_code: null as string | null, scopes: null as string[] | null, quota: null as Record<string, number> | null };
  if (!cfg.key) return { ...out, error_code: "no_key" };
  const api = nolioClient({ key: cfg.key, maxWaitSec: 0 });
  try {
    const app = await api.get<{ scopes?: unknown; quota?: Record<string, unknown> | null }>("/api/v2/app/");
    out.scopes = Array.isArray(app?.scopes) ? app.scopes.filter((s): s is string => typeof s === "string").slice(0, 50) : null;
    if (app?.quota && typeof app.quota === "object") {
      const quota: Record<string, number> = {};
      for (const k of ["hourly_limit", "hourly_remaining", "daily_limit", "daily_remaining"]) {
        const v = app.quota[k];
        if (typeof v === "number") quota[k] = v;
      }
      out.quota = quota;
    }
    // reachability only: the bodies are dropped, nothing personal leaves this function
    await api.get("/api/v2/me/");
    await api.get("/api/v2/real/trainings/", { limit: 1, fields: "id" });
    await api.get("/api/v2/planned/trainings/", { limit: 1, fields: "id" });
    out.http_status = 200;
  } catch (e) {
    if (!(e instanceof NolioError)) throw e;
    return { ...out, http_status: e.status, error_code: e.code };
  }
  if (out.scopes && NEEDED_SCOPES.some((s) => !out.scopes!.includes(s))) return { ...out, error_code: "missing_scope" };
  if (!cfg.owner) return { ...out, error_code: "owner_not_set" };
  const owner = await admin().auth.admin.getUserById(cfg.owner);
  if (owner.error || !owner.data.user) return { ...out, error_code: "owner_not_found" };
  return { ...out, ok: true };
}

// ---------- entry ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const cfg = config();
  try {
    if (req.method === "GET") {
      const action = new URL(req.url).searchParams.get("action");
      if (action === "check") {
        if (!isServiceRole(bearer(req))) return json({ error: "unauthorized" }, 401);
        return json(await checkKey(cfg));
      }
      if (action === "status") {
        const sb = admin();
        const uid = await loggedInUser(sb, req);
        if (!uid) return json({ error: "unauthorized" }, 401);
        return json(await status(sb, uid, cfg));
      }
      return json({ error: "unknown action" }, 400);
    }
    if (req.method !== "POST") return json({ error: "method" }, 405);

    const sb = admin();
    const cron = req.headers.get("x-cron-secret");
    if (cron !== null) {
      if (!cronAllowed(cron)) return json({ error: "unauthorized" }, 401);
      if (!cfg.key || !cfg.owner) return json({ connected: false, reason: "not_configured" });
      return json({ connected: true, ...(await runSync(sb, cfg)) });
    }

    const uid = await loggedInUser(sb, req);
    if (!uid) return json({ error: "unauthorized" }, 401);
    if (!cfg.owner || uid !== cfg.owner) return json({ connected: false, reason: "not_owner" });
    if (!cfg.key) return json({ connected: false, reason: "not_configured" });
    return json({ connected: true, ...(await runSync(sb, cfg)) });
  } catch (e) {
    console.error("nolio function failed:", String((e as { code?: unknown })?.code ?? "internal"));
    return json({ error: "internal" }, 500);
  }
});
