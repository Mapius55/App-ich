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
-- - disconnecting revokes the access at WHOOP and deletes all WHOOP rows of the person.
-- WHOOP workouts never become goal time (training hours come from Nolio): whoop_days keeps only a
-- daily workout count and minutes.

-- ---------- connections (one row per person and provider) ----------
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
  access_token text not null check (access_token like 'v1.%'),                       -- sealed, never plain
  refresh_token text check (refresh_token is null or refresh_token like 'v1.%'),     -- sealed; rotates on every refresh
  expires_at timestamptz not null,
  scope text check (scope is null or length(scope) <= 500),
  refresh_lock uuid,                -- single-flight refresh: who is refreshing right now …
  refresh_lock_until timestamptz,   -- … and until when the lease holds
  updated_at timestamptz not null default now()
);
alter table public.whoop_tokens enable row level security;
revoke all on public.whoop_tokens from anon, authenticated;

-- Single-flight refresh. WHOOP's refresh tokens rotate and a second concurrent refresh fails, so exactly
-- one caller may refresh at a time: the row is locked (select … for update), a short lease is written and
-- the sealed refresh token handed out in the same step. The holder then calls WHOOP and writes the new
-- access + refresh token in ONE update that also clears the lease (whoop_server.ts); everyone else
-- ('busy') waits for that result instead of spending the old refresh token a second time.
create function public.whoop_claim_refresh(p_user uuid, p_lease_seconds integer default 30)
returns table (state text, lock_id uuid, sealed_refresh text)
language plpgsql set search_path = '' as $$
declare
  r public.whoop_tokens%rowtype;
  v_lock uuid := gen_random_uuid();
begin
  select * into r from public.whoop_tokens t where t.user_id = p_user for update;
  if not found then
    return query select 'missing'::text, null::uuid, null::text;
    return;
  end if;
  if r.refresh_token is null then
    return query select 'no_refresh'::text, null::uuid, null::text;
    return;
  end if;
  if r.refresh_lock_until is not null and r.refresh_lock_until > now() then
    return query select 'busy'::text, null::uuid, null::text;
    return;
  end if;
  update public.whoop_tokens t
    set refresh_lock = v_lock,
        refresh_lock_until = now() + make_interval(secs => greatest(5, least(coalesce(p_lease_seconds, 30), 120)))
    where t.user_id = p_user;
  return query select 'claimed'::text, v_lock, r.refresh_token;
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
create table public.whoop_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  recovery_score smallint check (recovery_score between 0 and 100),         -- %
  hrv_ms numeric(4, 1) check (hrv_ms between 0 and 999),                    -- HRV (RMSSD), ms
  resting_hr smallint check (resting_hr between 20 and 250),                -- bpm
  spo2 numeric(4, 1) check (spo2 between 50 and 100),                       -- %, WHOOP 4.0 and newer
  skin_temp numeric(3, 1) check (skin_temp between 20 and 45),              -- °C, WHOOP 4.0 and newer
  sleep_minutes smallint check (sleep_minutes between 0 and 1440),          -- asleep (light + deep + REM), naps excluded
  sleep_performance smallint check (sleep_performance between 0 and 100),   -- %
  sleep_need_minutes smallint check (sleep_need_minutes between 0 and 1440),
  respiratory_rate numeric(3, 1) check (respiratory_rate between 1 and 60), -- breaths per minute
  day_strain numeric(3, 1) check (day_strain between 0 and 21),
  kilojoule integer check (kilojoule between 0 and 100000),
  steps integer check (steps between 0 and 200000),
  workout_count smallint not null default 0 check (workout_count between 0 and 100),
  workout_minutes smallint not null default 0 check (workout_minutes between 0 and 1440),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
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

-- ---------- daily purge ----------
-- Summaries older than 14 days (today and the 13 days before stay), trace ids older than 2 days,
-- OAuth states older than 10 minutes.
create function public.whoop_purge() returns void language sql set search_path = '' as $$
  delete from public.whoop_days where day < current_date - 13;
  delete from public.whoop_webhook_seen where seen_at < now() - interval '2 days';
  delete from public.whoop_oauth_states where created_at < now() - interval '10 minutes';
$$;
revoke execute on function public.whoop_purge() from public, anon, authenticated;

-- ---------- schedules ----------
-- 1. purge, daily at 02:07 UTC (plain SQL, needs only pg_cron)
-- 2. reconciliation (webhooks can be missed), every 3 hours at minute 41: the same mechanism as the
--    notifications job 'i-am-push' (scripts/setup-supabase.sh) and 'i-am-nolio': pg_cron + pg_net POST
--    with the x-cron-secret header. Project URL and secret (PUSH_CRON_SECRET) are taken from 'i-am-push',
--    so no secret is written into this file. Without that job the reconciliation is not scheduled here
--    (see the deploy notes: schedule it by hand with a WHOOP_CRON_SECRET).
do $cron$
declare
  push_cmd text;
  base_url text;
  secret text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'WHOOP: pg_cron fehlt, keine Zeitpläne eingerichtet (Löschung: select public.whoop_purge() täglich von Hand planen)';
    return;
  end if;
  execute $q$select cron.unschedule('i-am-whoop-purge') where exists (select 1 from cron.job where jobname = 'i-am-whoop-purge')$q$;
  execute $q$select cron.schedule('i-am-whoop-purge', '7 2 * * *', 'select public.whoop_purge()')$q$;

  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'WHOOP: pg_net fehlt, kein Abgleich-Zeitplan eingerichtet';
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
end
$cron$;
