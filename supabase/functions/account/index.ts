// Supabase Edge Function: your own account.
//   POST {action:"export"} (login) → everything stored about you as JSON, read with your login (Row Level
//                                    Security): profile (with the birth year; without the token of the
//                                    calendar link, which would open the calendar), memories, conversations, days,
//                                    calendar (with the weekly rhythms), goals and the dreams of the Bucket List (kind, done_at, memory,
//                                    reminded_at: every column, "*"), habits, push subscriptions, and from the
//                                    connections: the connection rows (never tokens), WHOOP daily summaries
//                                    and the Nolio data, and the log of the coach's notifications (never a text).
//                                    The same tables as the app's own export (src/lib/supabaseBackend.ts).
//   POST {action:"delete"} (login) → first ends the WHOOP access at WHOOP (as far as possible), then deletes
//                                    the account. All tables reference auth.users with ON DELETE CASCADE, so
//                                    removing the auth user removes every row of the person.
// Deploy with --no-verify-jwt: the login is checked here.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.119.0";
import { disconnectWhoopForAccount } from "../_shared/whoop_server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const PAGE = 1000; // PostgREST hands out at most this many rows per request
const MAX_ROWS = 200_000;

/**
 * [table, columns, order]: what the export reads. Explicit columns where a table has server-only ones.
 * goals and profiles stay "*", so new columns (the Bucket List's kind, done_at, memory, birth_year) are in.
 */
const TABLES: [string, string, string[]][] = [
  ["memories", "*", ["id"]],
  ["events", "*", ["id"]],
  ["goals", "*", ["id"]],
  ["milestones", "*", ["id"]],
  ["goal_time", "*", ["id"]],
  ["habits", "*", ["id"]],
  ["habit_logs", "*", ["habit_id", "day"]],
  ["days", "*", ["day"]],
  ["messages", "*", ["id"]],
  ["push_subscriptions", "*", ["id"]],
];
/** From the connections, the notification log and the weekly rhythms (present once their migrations ran). Tokens live
 *  in a table nobody but the server can read. */
const CONNECTION_TABLES: [string, string, string[]][] = [
  ["connections", "provider, status, external_user_id, consent_ai, consent_ai_changed_at, connected_at, last_sync_at, last_error", ["provider"]],
  ["whoop_days", "*", ["day"]],
  ["nolio_trainings", "*", ["id"]],
  ["nolio_sync", "last_sync_at, last_error, status", ["user_id"]],
  // which notifications went out or stayed out (template ids and reasons, never a text)
  ["push_log", "*", ["id"]],
  // the weekly rhythms (their days are in events)
  ["series", "*", ["id"]],
];

/** All rows of a table, page by page; null when the table isn't there (migration not applied). */
async function readAll(sb: SupabaseClient, table: string, cols: string, order: string[]): Promise<unknown[] | null> {
  const rows: unknown[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    let q = sb.from(table).select(cols);
    for (const c of order) q = q.order(c, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) {
      // 42P01: no such table; PGRST205: not in the schema cache
      if (error.code === "42P01" || error.code === "PGRST205") return null;
      throw error;
    }
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function exportData(sb: SupabaseClient, userId: string) {
  const { data: row, error } = await sb.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  // never the calendar link's token: whoever holds the file could read the calendar with it
  const { calendar_token: _token, ...profile } = (row ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { exported_at: new Date().toISOString(), profile: row ? profile : null };
  for (const [table, cols, order] of TABLES) out[table] = (await readAll(sb, table, cols, order)) ?? [];
  for (const [table, cols, order] of CONNECTION_TABLES) {
    const rows = await readAll(sb, table, cols, order);
    if (rows) out[table] = rows;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return new Response("Unauthorized", { status: 401, headers: CORS });

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400, headers: CORS });
  }
  if (body.action !== "delete" && body.action !== "export") return new Response("Bad request", { status: 400, headers: CORS });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return new Response("Unauthorized", { status: 401, headers: CORS });
  const userId = data.user.id;

  if (body.action === "export") {
    // with the person's own login, so Row Level Security decides what is hers
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    try {
      return json(await exportData(sb, userId));
    } catch (e) {
      console.error("account export failed:", String((e as { code?: unknown })?.code ?? "internal"));
      return json({ error: "internal" }, 500);
    }
  }

  // WHOOP first: deleting the rows alone would leave the app's access open at WHOOP. A failure here
  // (WHOOP down, not set up) must not keep anyone from deleting the account.
  try {
    await disconnectWhoopForAccount(userId);
  } catch (e) {
    console.error("account: whoop disconnect failed:", String((e as { code?: unknown; name?: unknown })?.code ?? (e as { name?: unknown })?.name ?? "internal"));
  }
  const del = await admin.auth.admin.deleteUser(userId);
  if (del.error) return new Response("Could not delete", { status: 500, headers: CORS });
  return json({ ok: true });
});
