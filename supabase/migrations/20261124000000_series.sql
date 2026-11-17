-- Fester Wochenrhythmus: fixed weekly blocks that repeat («Dienstag und Donnerstag um 18 Uhr, je eine Stunde»).
-- A rhythm is a row in public.series. Its days are materialised as normal calendar entries (events with
-- series_id and series_day, the local day the entry belongs to) up to 8 weeks ahead, so every view, the
-- iCalendar feed, the notifications, the answers (goal_time) and honest counting work per day as before.
-- - One idempotent, DST-correct fill (series_fill): each day's start is that day's local time in the rhythm's
--   time zone; the end is the start plus the length (the same minutes on the days the clocks change). Only
--   coming days, never one twice (unique series_id + series_day), never a day she let fall away.
-- - A change of the rhythm (the row) changes only COMING days nobody answered (series_sync, from the trigger):
--   days that no longer belong go, the rest follow the new time, title, place, reminder; never a past day,
--   never one she answered, never one she changed on its own (series_exception), except when the rhythm ends.
-- - One day on its own: changing that entry marks it as her exception (it keeps its day, so it never comes back
--   twice); deleting a coming one adds its day to skip_days (the skip marker), so the next fill leaves it out.
-- - A rhythm rests with its goal: when the goal is no longer active, the rhythm pauses and its coming days go;
--   without an end of its own it ends the day before the goal's target date. Deleting it removes its coming days.
-- - Filled up by the coach on every conversation (extend_series()) and once a day by pg_cron (extend_series(14)):
--   the daily job only for people who were here in the last 14 days (a conversation or an answered block), so a
--   calendar never keeps filling for someone who stopped using the app.
-- - goals.rhythm_asked_at: the coach offered a rhythm for the goal once (note_offer rhythmus, or a rhythm was
--   created for it); series.lapse_asked_at: it offered once to change or pause a rhythm that rarely works.
-- Changes from the rhythm's own functions run inside triggers (pg_trigger_depth() > 1): only a direct change of an
-- entry (the app, the coach) is an exception or a skip. Row Level Security like the other tables; the functions run
-- as the caller (security invoker), so a person only ever touches her own rhythms; search_path pinned.
-- Written to run again without harm.

-- ---------- the rhythm ----------
create table if not exists public.series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal_id uuid references public.goals (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  -- ISO weekdays, 1 = Monday … 7 = Sunday
  weekdays smallint[] not null check (cardinality(weekdays) between 1 and 7 and weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]),
  start_time time not null,                                   -- local time in time_zone
  duration_minutes integer not null check (duration_minutes between 5 and 720),
  location text check (location is null or length(location) <= 200),
  reminder_minutes integer check (reminder_minutes is null or reminder_minutes between 0 and 10080),
  time_zone text not null default 'Europe/Zurich' check (length(time_zone) between 1 and 64),
  start_date date not null default current_date,
  until_date date,                                            -- last day (inclusive); null: until the goal's target date
  active boolean not null default true,                       -- false: it rests (paused), its coming days are gone
  skip_days date[] not null default '{}',                     -- coming days she let fall away (never filled again)
  lapse_asked_at timestamptz,
  source text not null default 'coach' check (source in ('person', 'coach')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint series_until_check check (until_date is null or until_date >= start_date)
);
create index if not exists series_user_idx on public.series (user_id);
create index if not exists series_goal_idx on public.series (goal_id);
alter table public.series enable row level security;
drop policy if exists "own series" on public.series;
create policy "own series" on public.series for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- its days in the calendar ----------
alter table public.events
  add column if not exists series_id uuid references public.series (id) on delete set null,
  add column if not exists series_day date,
  add column if not exists series_exception boolean not null default false;
alter table public.events drop constraint if exists events_series_day_check;
alter table public.events add constraint events_series_day_check check (series_id is null or series_day is not null);
-- one entry per rhythm and day (plain unique index: NULLs stay distinct, the fill's ON CONFLICT targets it)
create unique index if not exists events_series_day_idx on public.events (series_id, series_day);

alter table public.goals add column if not exists rhythm_asked_at timestamptz;

-- ---------- fill, sync ----------

-- The rhythm's coming days up to `p_horizon_days` ahead that are not there yet: on its weekdays, from its start
-- (never before today, never a time that has passed) to its end (until_date, else the day before the goal's target
-- date), without the days she let fall away and without a day that already has a single block of hers for the same
-- goal at that time (no double entry). Only while it is active and its goal (if any) too. Returns how many it added.
create or replace function public.series_fill(s public.series, p_horizon_days integer default 56)
returns integer language plpgsql set search_path = '' as $$
declare
  target date;
  today date;
  last_day date;
  n integer;
begin
  if not s.active then return 0; end if;
  if s.goal_id is not null then
    select g.target_date into target from public.goals g where g.id = s.goal_id and g.status = 'active';
    if not found then return 0; end if;
  end if;
  today := (now() at time zone s.time_zone)::date;
  last_day := least(coalesce(s.until_date, target - 1, today + p_horizon_days), today + p_horizon_days);
  insert into public.events (user_id, title, starts_at, ends_at, all_day, location, reminder_minutes, source, kind, goal_id, series_id, series_day)
  select s.user_id, s.title, x.starts_at, x.starts_at + make_interval(mins => s.duration_minutes), false, s.location,
         s.reminder_minutes, s.source, 'block', s.goal_id, s.id, x.day
  from (
    select d::date as day, ((d::date + s.start_time) at time zone s.time_zone) as starts_at
    from generate_series(greatest(s.start_date, today)::timestamp, last_day::timestamp, interval '1 day') as d
  ) x
  where extract(isodow from x.day)::smallint = any (s.weekdays)
    and not (x.day = any (s.skip_days))
    and x.starts_at > now()
    and not exists (
      select 1 from public.events o
      where o.user_id = s.user_id and o.series_id is null and o.kind = 'block' and o.goal_id is not distinct from s.goal_id
        and o.starts_at < x.starts_at + make_interval(mins => s.duration_minutes) and coalesce(o.ends_at, o.starts_at) > x.starts_at
    )
  on conflict (series_id, series_day) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Brings a rhythm's coming days in line with the rhythm (after a change): days that no longer belong go (it rests
-- or ended, the day lies outside its dates, she let it fall away, or, unless she changed that day on its own, it is
-- no longer one of its weekdays); the others take its time, length, title, place, reminder and goal; then it fills.
-- Never a past day, never one she answered.
create or replace function public.series_sync(p_id uuid)
returns integer language plpgsql set search_path = '' as $$
declare
  s public.series;
  live boolean;
  target date;
  end_day date;
begin
  select * into s from public.series where id = p_id;
  if not found then return 0; end if;
  live := s.active;
  if s.goal_id is not null then
    select g.target_date into target from public.goals g where g.id = s.goal_id and g.status = 'active';
    if not found then live := false; end if;
  end if;
  end_day := coalesce(s.until_date, target - 1);
  delete from public.events e
  where e.series_id = s.id and e.starts_at > now()
    and not exists (select 1 from public.goal_time t where t.event_id = e.id)
    and (not live
      or e.series_day < s.start_date
      or (end_day is not null and e.series_day > end_day)
      or e.series_day = any (s.skip_days)
      or (not e.series_exception and not (extract(isodow from e.series_day)::smallint = any (s.weekdays))));
  if not live then return 0; end if;
  update public.events e
  set title = s.title, location = s.location, reminder_minutes = s.reminder_minutes, goal_id = s.goal_id, kind = 'block', all_day = false,
      starts_at = x.starts_at, ends_at = x.starts_at + make_interval(mins => s.duration_minutes)
  from (
    select ev.id, ((ev.series_day + s.start_time) at time zone s.time_zone) as starts_at
    from public.events ev
    where ev.series_id = s.id and not ev.series_exception and ev.starts_at > now()
  ) x
  where e.id = x.id and x.starts_at > now()
    and not exists (select 1 from public.goal_time t where t.event_id = e.id)
    and (e.title, e.location, e.reminder_minutes, e.goal_id, e.kind, e.all_day, e.starts_at, e.ends_at)
      is distinct from (s.title, s.location, s.reminder_minutes, s.goal_id, 'block'::text, false, x.starts_at, x.starts_at + make_interval(mins => s.duration_minutes));
  return public.series_fill(s);
end;
$$;

-- Fills every rhythm the caller may see (the coach: her own, on every conversation). With `p_quiet_days` (the daily
-- job) only for people who were here within that many days: a conversation, or an answered or logged block. Time
-- that a connection brings by itself (Nolio, WHOOP) is no sign she was here: it never keeps a calendar filling.
-- A rhythm that ended (its last day lies behind) has nothing left to fill.
create or replace function public.extend_series(p_quiet_days integer default null)
returns integer language plpgsql set search_path = '' as $$
declare
  s public.series;
  n integer := 0;
begin
  for s in
    select x.* from public.series x
    where x.active
      and (x.until_date is null or x.until_date >= current_date - 1)
      and (p_quiet_days is null
        or exists (select 1 from public.messages m where m.user_id = x.user_id
                     and m.thread between to_char(current_date - p_quiet_days, 'YYYY-MM-DD') and '9999-12-31')
        or exists (select 1 from public.goal_time t where t.user_id = x.user_id and t.source in ('person', 'coach', 'block')
                     and t.created_at > now() - make_interval(days => p_quiet_days)))
  loop
    n := n + public.series_fill(s);
  end loop;
  return n;
end;
$$;
comment on function public.extend_series(integer) is
  'Fills the coming days of the weekly rhythms (8 weeks ahead). The coach calls it on every conversation; the daily job with 14 (only people who were here lately).';

-- A change «ab Januar»: the rhythm splits at `p_from` (a coming day). The old one ends the day before; a copy from
-- `p_from` on takes over its days from then (same entries, same ids for the calendar), and the change goes to it.
-- Returns the rhythm to change: the copy, or the rhythm itself when nothing of it lies before `p_from`.
create or replace function public.split_series(p_id uuid, p_from date)
returns uuid language plpgsql set search_path = '' as $$
declare
  s public.series;
  nid uuid;
begin
  select * into s from public.series where id = p_id for update;
  if not found then raise exception 'Rhythmus nicht gefunden' using errcode = 'P0002'; end if;
  if p_from <= greatest(s.start_date, (now() at time zone s.time_zone)::date) then return p_id; end if;
  if s.until_date is not null and p_from > s.until_date then
    raise exception 'Der Rhythmus endet schon vorher' using errcode = '22023';
  end if;
  insert into public.series (user_id, goal_id, title, weekdays, start_time, duration_minutes, location, reminder_minutes, time_zone,
                             start_date, until_date, active, source, skip_days, lapse_asked_at)
  values (s.user_id, s.goal_id, s.title, s.weekdays, s.start_time, s.duration_minutes, s.location, s.reminder_minutes, s.time_zone,
          p_from, s.until_date, false, s.source, array(select d from unnest(s.skip_days) d where d >= p_from), s.lapse_asked_at)
  returning id into nid;
  update public.events set series_id = nid where series_id = p_id and series_day >= p_from;
  update public.series set until_date = p_from - 1 where id = p_id;
  update public.series set active = s.active where id = nid;
  return nid;
end;
$$;

-- ---------- triggers on the rhythm ----------

-- A readable time zone, weekdays once each in order, only coming skip days.
create or replace function public.series_check() returns trigger language plpgsql set search_path = '' as $$
begin
  begin
    perform now() at time zone new.time_zone;
  exception when others then
    raise exception 'Unbekannte Zeitzone: %', new.time_zone using errcode = '22023';
  end;
  new.weekdays := array(select distinct w from unnest(new.weekdays) w order by w);
  new.skip_days := array(select distinct d from unnest(new.skip_days) d where d >= current_date - 1 order by d);
  return new;
end;
$$;
drop trigger if exists series_check on public.series;
create trigger series_check before insert or update on public.series
  for each row execute function public.series_check();
drop trigger if exists series_goal_owner on public.series;
create trigger series_goal_owner before insert or update of goal_id on public.series
  for each row execute function public.check_goal_owner();
drop trigger if exists series_touch on public.series;
create trigger series_touch before update on public.series
  for each row execute function public.touch_updated_at();

-- After a new rhythm or a change of it: its coming days follow. A new rhythm for a goal counts as the one offer.
create or replace function public.series_changed() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.goal_id is not null then
    update public.goals set rhythm_asked_at = now() where id = new.goal_id and rhythm_asked_at is null;
  end if;
  perform public.series_sync(new.id);
  return null;
end;
$$;
drop trigger if exists series_changed on public.series;
create trigger series_changed after insert or update of goal_id, title, weekdays, start_time, duration_minutes, location, reminder_minutes,
  time_zone, start_date, until_date, active, skip_days on public.series
  for each row execute function public.series_changed();

-- A rhythm that goes takes its coming days along (past and answered ones stay, as plain blocks).
create or replace function public.series_removed() returns trigger language plpgsql set search_path = '' as $$
begin
  delete from public.events e
  where e.series_id = old.id and e.starts_at > now()
    and not exists (select 1 from public.goal_time t where t.event_id = e.id);
  return old;
end;
$$;
drop trigger if exists series_removed on public.series;
create trigger series_removed before delete on public.series
  for each row execute function public.series_removed();

-- ---------- triggers on its days ----------

-- An entry may only belong to one's own rhythm.
create or replace function public.check_series_owner() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.series_id is not null and not exists (select 1 from public.series s where s.id = new.series_id and s.user_id = new.user_id) then
    raise exception 'series not found' using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists events_series_owner on public.events;
create trigger events_series_owner before insert or update of series_id on public.events
  for each row execute function public.check_series_owner();

-- One day changed on its own (the app, the coach: a direct change, not the rhythm's sync) is her exception:
-- the rhythm's later changes leave it as it is.
create or replace function public.events_series_exception() returns trigger language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() = 1 and new.series_id is not distinct from old.series_id
     and (new.title, new.starts_at, new.ends_at, new.all_day, new.location, new.reminder_minutes, new.kind, new.goal_id)
       is distinct from (old.title, old.starts_at, old.ends_at, old.all_day, old.location, old.reminder_minutes, old.kind, old.goal_id) then
    new.series_exception := true;
  end if;
  return new;
end;
$$;
drop trigger if exists events_series_exception on public.events;
create trigger events_series_exception before update on public.events
  for each row when (old.series_id is not null) execute function public.events_series_exception();

-- A coming day deleted on its own («Diesen Donnerstag fällt aus») never comes back: its day becomes a skip marker.
create or replace function public.events_series_skip() returns trigger language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() = 1 and old.series_day is not null and old.starts_at > now() then
    update public.series set skip_days = array_append(skip_days, old.series_day)
    where id = old.series_id and not (old.series_day = any (skip_days));
  end if;
  return null;
end;
$$;
drop trigger if exists events_series_skip on public.events;
create trigger events_series_skip after delete on public.events
  for each row when (old.series_id is not null) execute function public.events_series_skip();

-- ---------- the rhythm rests with its goal ----------
create or replace function public.goals_series() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status and new.status <> 'active' then
    update public.series set active = false where goal_id = new.id and active;
  elsif new.target_date is distinct from old.target_date then
    perform public.series_sync(s.id) from public.series s where s.goal_id = new.id and s.active and s.until_date is null;
  end if;
  return null;
end;
$$;
drop trigger if exists goals_series on public.goals;
create trigger goals_series after update of status, target_date on public.goals
  for each row execute function public.goals_series();

-- Noting the rhythm offer is no change of the goal itself: like reminded_at, nudge_after, pattern_asked_at and
-- plan_b_asked_at it keeps updated_at. Same function as in 20261123000000_plan_b.sql plus rhythm_asked_at.
create or replace function public.goals_touch() returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - array['reminded_at', 'nudge_after', 'pattern_asked_at', 'plan_b_asked_at', 'rhythm_asked_at', 'updated_at'])
     = (to_jsonb(old) - array['reminded_at', 'nudge_after', 'pattern_asked_at', 'plan_b_asked_at', 'rhythm_asked_at', 'updated_at']) then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- ---------- who may call what ----------
revoke execute on function public.series_fill(public.series, integer) from public, anon;
revoke execute on function public.series_sync(uuid) from public, anon;
revoke execute on function public.extend_series(integer) from public, anon;
revoke execute on function public.split_series(uuid, date) from public, anon;
grant execute on function public.series_fill(public.series, integer) to authenticated, service_role;
grant execute on function public.series_sync(uuid) to authenticated, service_role;
grant execute on function public.extend_series(integer) to authenticated, service_role;
grant execute on function public.split_series(uuid, date) to authenticated, service_role;

-- ---------- schedule: fill the rhythms daily at 03:23 UTC (plain SQL, needs only pg_cron) ----------
-- Fail-safe like the WHOOP purge: without pg_cron (or rights on the cron schema) only a notice; the coach still
-- fills on every conversation. By hand: select cron.schedule('i-am-series', '23 3 * * *', 'select public.extend_series(14)');
do $series$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'Wochenrhythmus: pg_cron fehlt, kein Zeitplan (der Coach füllt bei jedem Gespräch auf)';
    return;
  end if;
  execute $q$select cron.unschedule('i-am-series') where exists (select 1 from cron.job where jobname = 'i-am-series')$q$;
  execute $q$select cron.schedule('i-am-series', '23 3 * * *', 'select public.extend_series(14)')$q$;
exception when others then
  raise notice 'Wochenrhythmus: Zeitplan nicht eingerichtet (%): select public.extend_series(14) täglich von Hand planen', sqlerrm;
end
$series$;
