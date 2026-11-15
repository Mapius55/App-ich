-- Nolio (training platform) for the owner of this app only.
-- The personal Nolio key (Supabase secret NOLIO_API_KEY) may only be used for the key holder's own
-- account, so everything here belongs to one user: the secret NOLIO_OWNER_USER_ID. The Edge Function
-- "nolio" fetches completed trainings (-> time for goals) and the trainer's plan (-> calendar).
-- Only the service role writes Nolio data; the person (and the coach, who acts with her login) reads it.

-- ---------- calendar entries from Nolio ----------
alter table public.events drop constraint if exists events_source_check;
alter table public.events add constraint events_source_check check (source in ('person', 'coach', 'nolio'));
-- id of the entry at the source (Nolio: ptrn_… / pcmp_…); plain unique index so upserts can target it
alter table public.events add column external_id text check (external_id is null or length(external_id) <= 100);
create unique index events_external_idx on public.events (user_id, source, external_id);

-- ---------- which Nolio sports count toward a goal ----------
-- Nolio sport ids (spt_…) or names/slugs ("Course à pied", "course-a-pied"); null = not assigned.
alter table public.goals
  add column sports text[] check (sports is null or cardinality(sports) <= 30);

-- ---------- completed trainings and races, as Nolio has them ----------
-- Rows recorded through Strava or WHOOP (and anything Nolio marks with a `restriction`) are kept only
-- as a flagged stub (restricted = true, no name or measurements): they never count toward goal hours
-- and must never be passed to the AI.
-- Garmin data must be shown with the attribution "Garmin <model>": keep source + device_name for the UI.
create table public.nolio_trainings (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null check (length(id) <= 100),                 -- trn_… (training) or cmp_… (competition)
  kind text not null default 'training' check (kind in ('training', 'competition')),
  day date not null,                                          -- local day (Nolio's date_start)
  started_at timestamptz,                                     -- null when Nolio has no start time
  sport text,                                                 -- spt_…
  sport_name text,
  minutes integer check (minutes is null or minutes >= 0),    -- whole workout (total_duration)
  distance_km numeric(9, 3),
  load numeric(8, 1),                                         -- Coggan TSS, else Foster load
  rpe integer check (rpe is null or rpe between 1 and 10),
  feeling integer check (feeling is null or feeling between 1 and 5),
  source text,                                                -- connector: garmin, manual, …
  device_name text,                                           -- e.g. edge_520_plus (attribution)
  restricted boolean not null default false,
  raw_name text,                                              -- the training's name in Nolio
  planned_id text,                                            -- the planned event it fulfils (ptrn_…/pcmp_…)
  synced_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index nolio_trainings_user_day_idx on public.nolio_trainings (user_id, day);
alter table public.nolio_trainings enable row level security;
create policy "own nolio trainings: read" on public.nolio_trainings for select using (auth.uid() = user_id);

-- ---------- state of the sync ----------
create table public.nolio_sync (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_sync_at timestamptz,                                   -- start of the last complete sync
  last_error text,                                            -- German message for the app, null = fine
  status text not null default 'idle' check (status in ('idle', 'running', 'ok', 'error')),
  started_at timestamptz,                                     -- when the current/last run began (lock)
  blocked_until timestamptz,                                  -- Nolio said "too many requests" until then
  updated_at timestamptz not null default now()
);
alter table public.nolio_sync enable row level security;
create policy "own nolio sync: read" on public.nolio_sync for select using (auth.uid() = user_id);
create trigger nolio_sync_touch before update on public.nolio_sync
  for each row execute function public.touch_updated_at();

-- ---------- Nolio rows belong to the sync ----------
-- The trainer plans in Nolio; neither the person nor the coach (who acts with her login) may rewrite,
-- replace or delete those entries here: the next sync would bring them back anyway. Only the listed
-- columns (trigger arguments) stay editable, e.g. the reminder of a calendar entry.
-- The service role (sync), the table owner (cascades: deleting a goal or the account) and migrations pass.
create function public.guard_nolio_rows() returns trigger language plpgsql as $$
declare
  free text[] := coalesce(tg_argv::text[], '{}') || array['updated_at', 'sequence'];
begin
  if current_user not in ('authenticated', 'anon') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.source = 'nolio' then
      raise exception 'Einträge aus Nolio legt nur der Abgleich an.' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  if old.source = 'nolio' then
    if tg_op = 'DELETE' or (to_jsonb(new) - free) is distinct from (to_jsonb(old) - free) then
      if tg_table_name = 'events' then
        raise exception 'Dieser Eintrag kommt aus Nolio (vom Trainer geplant) und lässt sich nur dort ändern.'
          using errcode = 'insufficient_privilege';
      end if;
      raise exception 'Diese Zeit kommt aus Nolio und wird von dort abgeglichen.' using errcode = 'insufficient_privilege';
    end if;
  elsif tg_op = 'UPDATE' and new.source = 'nolio' then
    raise exception 'Einträge aus Nolio legt nur der Abgleich an.' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger events_nolio_guard before insert or update or delete on public.events
  for each row execute function public.guard_nolio_rows('reminder_minutes');
create trigger goal_time_nolio_guard before insert or update or delete on public.goal_time
  for each row execute function public.guard_nolio_rows();

-- ---------- goal minutes: Nolio plans are plans, the completed training is what counts ----------
-- A past planned Nolio training would otherwise count as a block AND again as the completed training.
create or replace view public.goal_minutes with (security_invoker = true) as
select g.id as goal_id,
  coalesce((select sum(t.minutes) from public.goal_time t where t.goal_id = g.id), 0)::integer as logged_minutes,
  coalesce((
    select sum(least(1440, extract(epoch from (e.ends_at - e.starts_at)) / 60))
    from public.events e
    where e.goal_id = g.id and e.kind = 'block' and not e.all_day and e.source <> 'nolio'
      and e.ends_at is not null and e.ends_at <= now()
      and not exists (select 1 from public.goal_time t where t.event_id = e.id)
  ), 0)::integer as block_minutes
from public.goals g;

-- ---------- schedule: sync every 3 hours (minute 17) ----------
-- Same mechanism as the notifications job 'i-am-push' (scripts/setup-supabase.sh): pg_cron + pg_net
-- POST with the x-cron-secret header. The project URL and the secret (PUSH_CRON_SECRET) are taken from
-- that job, so no secret is written into this file. Without that job nothing is scheduled here
-- (see the deploy notes: schedule it by hand with a NOLIO_CRON_SECRET).
do $cron$
declare
  push_cmd text;
  base_url text;
  secret text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'Nolio: pg_cron/pg_net fehlen, kein Zeitplan eingerichtet';
    return;
  end if;
  execute $q$select command from cron.job where jobname = 'i-am-push' limit 1$q$ into push_cmd;
  base_url := substring(push_cmd from 'url := ''(https://[^'']+)/functions/v1/push''');
  secret := substring(push_cmd from '"x-cron-secret":\s*"([^"]+)"');
  if base_url is null or secret is null then
    raise notice 'Nolio: Zeitplan ''i-am-push'' nicht gefunden, kein Zeitplan eingerichtet';
    return;
  end if;
  execute $q$select cron.unschedule('i-am-nolio') where exists (select 1 from cron.job where jobname = 'i-am-nolio')$q$;
  execute format(
    $q$select cron.schedule('i-am-nolio', '17 */3 * * *', %L)$q$,
    format(
      $c$ select net.http_post(
       url := %L,
       headers := %L::jsonb,
       body := '{"action": "sync"}'::jsonb,
       timeout_milliseconds := 60000
     ) $c$,
      base_url || '/functions/v1/nolio',
      jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret)::text
    )
  );
end
$cron$;
