-- WHOOP (wearable, API v2) for every member: connection, encrypted tokens, daily summaries for at most
-- 14 days, webhook dedupe, reconciliation and daily purge.
-- The Edge Functions "whoop", "whoop-callback" and "whoop-webhook" (service role) write everything here.
-- The person reads her own connection and summaries ("what was collected") and may change ONLY her
-- consent for the coach (connections.consent_ai, default off).
--
-- Rules from WHOOP's API terms (Oct 2026) that shape this file:
-- - no copies of records: only minimal daily summaries, deleted after 14 days (job 'i-am-whoop-purge');
-- - tokens only in a service-role table (RLS on, no policies), sealed with AES-256-GCM in the function
--   (secret WHOOP_TOKEN_KEY, never stored in the database) on top of Supabase's encryption at rest;
-- - WHOOP data reaches the coach only with consent_ai = true, and then only as a short summary line;
-- - disconnecting revokes the access at WHOOP and deletes all WHOOP rows of the person (deleting the
--   account does the same first, in the function "account").
-- Linking is confirmed in the app (CSRF fix): the OAuth callback cannot tell who is in the browser, so it
-- keeps the new grant apart, in whoop_pending, plus a single-use code (only its SHA-256 is stored, valid
-- 10 minutes) and sends the browser back to the app; the app confirms the code with the person's login,
-- and only then does her own pending grant move into connections and whoop_tokens. Nothing reads or
-- syncs a pending grant, and it never touches a link that is already connected. Unconfirmed grants are
-- removed (and revoked) by the reconciliation run, at the latest by the daily purge.
-- Coach replies written while WHOOP values were in the coach's context are marked (messages.whoop): the
-- coach gets them back only while the person still allows WHOOP for the coach, and they are cleared when
-- she disconnects WHOOP and after 14 days (whoop_purge).
-- WHOOP workouts never become goal time (training hours come from Nolio): whoop_days keeps only a
-- daily workout count and minutes.

-- ---------- connections (one row per person and provider; only confirmed links) ----------
create table public.connections (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('whoop')),
  status text not null default 'connected' check (status in ('connected', 'needs_reconnect')),
  external_user_id text check (external_user_id is null or external_user_id ~ '^[0-9]{1,20}$'), -- WHOOP user id
  consent_ai boolean not null default false,       -- "Coach darf WHOOP-Daten sehen": off until the person turns it on
  consent_ai_changed_at timestamptz,               -- set by the trigger below
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 300), -- German message for the app
  manual_sync_at timestamptz,                      -- last "Jetzt holen" (at most once a minute, claimed atomically)
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);
-- webhooks name only the WHOOP user: one WHOOP account belongs to one member
create unique index connections_external_idx on public.connections (provider, external_user_id) where external_user_id is not null;

alter table public.connections enable row level security;
create policy "own connections: read" on public.connections for select using (auth.uid() = user_id);
create policy "own connections: consent" on public.connections for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- column privileges: the person can change consent_ai and nothing else; rows are created and deleted by the functions
revoke all on public.connections from anon, authenticated;
grant select on public.connections to authenticated;
grant update (consent_ai) on public.connections to authenticated;

create function public.connections_touch() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  if tg_op = 'INSERT' then
    new.consent_ai_changed_at = case when new.consent_ai then now() end;
  elsif new.consent_ai is distinct from old.consent_ai then
    new.consent_ai_changed_at = now();
  end if;
  return new;
end;
$$;
create trigger connections_touch before insert or update on public.connections
  for each row execute function public.connections_touch();

-- The app's switch: supabase.rpc('set_whoop_consent', { p_consent: true }). Returns false when not connected.
create function public.set_whoop_consent(p_consent boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.' using errcode = 'insufficient_privilege';
  end if;
  update public.connections set consent_ai = coalesce(p_consent, false)
  where user_id = auth.uid() and provider = 'whoop';
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke execute on function public.set_whoop_consent(boolean) from public, anon;
grant execute on function public.set_whoop_consent(boolean) to authenticated;

-- ---------- tokens: service role only (RLS on, no policies) ----------
create table public.whoop_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  provider text not null default 'whoop' check (provider = 'whoop'),
  access_token text not null check (access_token like 'v1.%'),                       -- sealed, never plain
  refresh_token text check (refresh_token is null or refresh_token like 'v1.%'),     -- sealed; rotates on every refresh
  expires_at timestamptz not null,
  scope text check (scope is null or length(scope) <= 500),
  refresh_lock uuid,                -- single-flight refresh: who is refreshing right now …
  refresh_lock_until timestamptz,   -- … and until when the lease holds
  -- the SHA-256 (base64url) of the code this link was confirmed with, and until when that code was
  -- valid: only a marker, so that a repeated confirmation of the same person answers the status
  confirm_hash text check (confirm_hash is null or confirm_hash ~ '^[A-Za-z0-9_-]{43}$'),
  confirm_until timestamptz,
  updated_at timestamptz not null default now(),
  -- no tokens without a connection; deleting the connection (disconnect) deletes them
  foreign key (user_id, provider) references public.connections (user_id, provider) on delete cascade
);
create unique index whoop_tokens_confirm_idx on public.whoop_tokens (confirm_hash) where confirm_hash is not null;
alter table public.whoop_tokens enable row level security;
revoke all on public.whoop_tokens from anon, authenticated;

-- ---------- grants back from WHOOP, not yet confirmed in the app: service role only ----------
-- Kept apart from connections and whoop_tokens, so that no sync, refresh or webhook ever uses a grant
-- nobody confirmed (a forged consent link), and a link that is connected stays as it is until its owner
-- confirms the new one. One per person: a newer grant replaces it. Confirming claims it in one statement
-- (delete … returning, only her own row with that code, while it is valid) and moves it into whoop_tokens
-- (the tokens are sealed for this person already).
create table public.whoop_pending (
  user_id uuid primary key references auth.users (id) on delete cascade,
  external_user_id text not null check (external_user_id ~ '^[0-9]{1,20}$'),   -- the WHOOP user of this grant
  access_token text not null check (access_token like 'v1.%'),                 -- sealed, never plain
  refresh_token text check (refresh_token is null or refresh_token like 'v1.%'), -- sealed
  expires_at timestamptz not null,
  scope text check (scope is null or length(scope) <= 500),
  confirm_hash text not null check (confirm_hash ~ '^[A-Za-z0-9_-]{43}$'),     -- SHA-256 of the single-use code
  confirm_until timestamptz not null,                                          -- the code is valid 10 minutes
  created_at timestamptz not null default now()
);
create unique index whoop_pending_confirm_idx on public.whoop_pending (confirm_hash);
create index whoop_pending_external_idx on public.whoop_pending (external_user_id);
create index whoop_pending_until_idx on public.whoop_pending (confirm_until);
alter table public.whoop_pending enable row level security;
revoke all on public.whoop_pending from anon, authenticated;

-- Single-flight refresh. WHOOP's refresh tokens rotate and a second concurrent refresh fails, so exactly
-- one caller may refresh at a time: the row is locked (select … for update), a short lease is written and
-- the sealed refresh token handed out in the same step. The holder then calls WHOOP and writes the new
-- access + refresh token in ONE update that also clears the lease (whoop_server.ts); everyone else
-- ('busy') waits for that result instead of spending the old refresh token a second time.
-- The claim also hands out the access token stored at that moment (and its expiry): if another worker
-- refreshed between the caller's read and this claim, the caller uses that new token and releases the
-- lease instead of refreshing once more.
create function public.whoop_claim_refresh(p_user uuid, p_lease_seconds integer default 30)
returns table (state text, lock_id uuid, sealed_refresh text, sealed_access text, access_expires_at timestamptz)
language plpgsql set search_path = '' as $$
declare
  r public.whoop_tokens%rowtype;
  v_lock uuid := gen_random_uuid();
begin
  select * into r from public.whoop_tokens t where t.user_id = p_user for update;
  if not found then
    return query select 'missing'::text, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;
  if r.refresh_token is null then
    return query select 'no_refresh'::text, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;
  if r.refresh_lock_until is not null and r.refresh_lock_until > now() then
    return query select 'busy'::text, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;
  update public.whoop_tokens t
    set refresh_lock = v_lock,
        refresh_lock_until = now() + make_interval(secs => greatest(5, least(coalesce(p_lease_seconds, 30), 120)))
    where t.user_id = p_user;
  return query select 'claimed'::text, v_lock, r.refresh_token, r.access_token, r.expires_at;
end;
$$;
revoke execute on function public.whoop_claim_refresh(uuid, integer) from public, anon, authenticated;
grant execute on function public.whoop_claim_refresh(uuid, integer) to service_role;

-- ---------- OAuth state (exactly 8 URL-safe characters, single use, valid 10 minutes) ----------
create table public.whoop_oauth_states (
  state text primary key check (state ~ '^[A-Za-z0-9_-]{8}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index whoop_oauth_states_user_idx on public.whoop_oauth_states (user_id);
alter table public.whoop_oauth_states enable row level security;
revoke all on public.whoop_oauth_states from anon, authenticated;

-- ---------- daily summaries (the person's local day), at most 14 days ----------
-- Only what the app shows (Du › Verbindungen) or the coach reads (with consent): nothing else is stored.
create table public.whoop_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null default 'whoop' check (provider = 'whoop'),
  day date not null,
  recovery_score smallint check (recovery_score between 0 and 100),         -- %
  hrv_ms numeric(4, 1) check (hrv_ms between 0 and 999),                    -- HRV (RMSSD), ms
  resting_hr smallint check (resting_hr between 20 and 250),                -- bpm
  sleep_minutes smallint check (sleep_minutes between 0 and 1440),          -- asleep (light + deep + REM), naps excluded
  sleep_performance smallint check (sleep_performance between 0 and 100),   -- %
  day_strain numeric(3, 1) check (day_strain between 0 and 21),
  workout_count smallint not null default 0 check (workout_count between 0 and 100),
  workout_minutes smallint not null default 0 check (workout_minutes between 0 and 1440),
  updated_at timestamptz not null default now(),
  primary key (user_id, day),
  -- no summaries without a connection: a sync still running when the person disconnects cannot write
  -- them back, and deleting the connection deletes them
  foreign key (user_id, provider) references public.connections (user_id, provider) on delete cascade
);
alter table public.whoop_days enable row level security;
create policy "own whoop days: read" on public.whoop_days for select using (auth.uid() = user_id);
revoke all on public.whoop_days from anon, authenticated;
grant select on public.whoop_days to authenticated;

-- ---------- webhook dedupe (trace ids, kept 2 days) ----------
create table public.whoop_webhook_seen (
  trace_id text primary key check (length(trace_id) between 1 and 200),
  seen_at timestamptz not null default now()
);
create index whoop_webhook_seen_at_idx on public.whoop_webhook_seen (seen_at);
alter table public.whoop_webhook_seen enable row level security;
revoke all on public.whoop_webhook_seen from anon, authenticated;

-- ---------- coach replies that had WHOOP values in their context ----------
-- Set by the function "coach" on its reply while the WHOOP line was in the context. Such a reply goes
-- back to the coach only while she allows WHOOP for the coach; disconnecting WHOOP and the daily purge
-- (after 14 days) replace its text with WHOOP_CLEARED_TEXT and clear the mark.
alter table public.messages add column whoop boolean not null default false;
create index messages_whoop_idx on public.messages (user_id) where whoop;

-- ---------- daily purge ----------
-- Summaries older than 14 days (today and the 13 days before stay), trace ids older than 2 days,
-- OAuth states older than 10 minutes, grants never confirmed in the app (the reconciliation run normally
-- removes them sooner and revokes them at WHOOP first), and the text of coach replies with WHOOP values
-- older than 14 days. The cleared text is the same as WHOOP_CLEARED_TEXT in _shared/whoop.ts.
create function public.whoop_purge() returns void language sql set search_path = '' as $$
  delete from public.whoop_days where day < current_date - 13;
  delete from public.whoop_webhook_seen where seen_at < now() - interval '2 days';
  delete from public.whoop_oauth_states where created_at < now() - interval '10 minutes';
  delete from public.whoop_pending where created_at < now() - interval '1 day';
  update public.messages set content = 'Diese Antwort enthielt Werte von WHOOP und wurde gelöscht.', whoop = false
    where whoop and created_at < now() - interval '14 days';
$$;
revoke execute on function public.whoop_purge() from public, anon, authenticated;

-- ---------- schedules ----------
-- 1. purge, daily at 02:07 UTC (plain SQL, needs only pg_cron)
-- 2. reconciliation (webhooks can be missed), every 3 hours at minute 41: the same mechanism as the
--    notifications job 'i-am-push' (scripts/setup-supabase.sh) and 'i-am-nolio': pg_cron + pg_net POST
--    with the x-cron-secret header. Project URL and secret (PUSH_CRON_SECRET) are taken from 'i-am-push',
--    so no secret is written into this file. Without that job the reconciliation is not scheduled here
--    (see the deploy notes: schedule it by hand with a WHOOP_CRON_SECRET).
-- Fail-safe: whatever goes wrong here (no pg_cron, no 'i-am-push', no rights on the cron schema) only
-- raises a notice; the tables above stay. Schedule by hand then (deploy notes).
do $purge$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'WHOOP: pg_cron fehlt, keine Zeitpläne eingerichtet (Löschung: select public.whoop_purge() täglich von Hand planen)';
    return;
  end if;
  execute $q$select cron.unschedule('i-am-whoop-purge') where exists (select 1 from cron.job where jobname = 'i-am-whoop-purge')$q$;
  execute $q$select cron.schedule('i-am-whoop-purge', '7 2 * * *', 'select public.whoop_purge()')$q$;
exception when others then
  raise notice 'WHOOP: Löschung nicht geplant (%): select public.whoop_purge() täglich von Hand planen', sqlerrm;
end
$purge$;

do $cron$
declare
  push_cmd text;
  base_url text;
  secret text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'WHOOP: pg_cron/pg_net fehlen, kein Abgleich-Zeitplan eingerichtet';
    return;
  end if;
  execute $q$select command from cron.job where jobname = 'i-am-push' limit 1$q$ into push_cmd;
  base_url := substring(push_cmd from 'url := ''(https://[^'']+)/functions/v1/push''');
  secret := substring(push_cmd from '"x-cron-secret":\s*"([^"]+)"');
  if base_url is null or secret is null then
    raise notice 'WHOOP: Zeitplan ''i-am-push'' nicht gefunden, kein Abgleich-Zeitplan eingerichtet';
    return;
  end if;
  execute $q$select cron.unschedule('i-am-whoop') where exists (select 1 from cron.job where jobname = 'i-am-whoop')$q$;
  execute format(
    $q$select cron.schedule('i-am-whoop', '41 */3 * * *', %L)$q$,
    format(
      $c$ select net.http_post(
       url := %L,
       headers := %L::jsonb,
       body := '{"action": "sync"}'::jsonb,
       timeout_milliseconds := 60000
     ) $c$,
      base_url || '/functions/v1/whoop',
      jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret)::text
    )
  );
exception when others then
  raise notice 'WHOOP: Abgleich-Zeitplan nicht eingerichtet (%): bitte von Hand planen', sqlerrm;
end
$cron$;
