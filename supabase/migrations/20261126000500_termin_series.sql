-- Round 3, «Feste Zeiten bleiben im Kalender» (NEXT.md #6, owner decision 4 «Jede Woche, zählt vorläufig»): what is
-- the same every week, a training on Thursday or the shop on Monday, stands in the calendar every week, not only for
-- the week she named it; and a fixed time that serves a goal (a training) counts for it like a block.
-- - series.kind ('block' | 'termin', default 'block'): a weekly rhythm of blocks (planned with the coach, as before)
--   or of termine (her fixed times: «immer», «jeden Donnerstag», «jede Woche»). series_fill, series_sync and
--   split_series (and so extend_series, which fills through series_fill) write it on its days. A termin rhythm has no
--   reminder unless she asked for one (then its days carry reminder_asked, so the reminder comes as a notification).
--   Fixed times are hers whatever happens to a goal: a termin rhythm never rests or ends with its goal; when the goal is
--   reached or dropped (or deleted) it only lets go of it (goal_id null, its coming days follow), it never goes.
-- - goal_minutes: a past termin with a goal (not all-day, not from Nolio) counts like a block: provisionally for 7
--   days after it ended unless she answered (Ja, Teilweise, Nein = 0). Same columns as before; the grandfathering of
--   20261122000000_honest_count.sql stays for blocks only (a termin never counted before, so none is kept).
-- - sync_block_answer: the answer of a termin with a goal follows it like a block's (it was deleted on every change).
-- - The Sunday ask for next week's shifts (an Anstoss «dienste»): profiles.shifts_asked_at (asked once),
--   profiles.shifts_weekly (after her first yes every Sunday); nudge_kind_ok knows «dienste».
-- Functions run as the caller (security invoker, RLS applies) with search_path pinned; a goal's deletion lets go of
-- its termin rhythms only for her own delete (role authenticated), so the account's removal (GoTrue, no rights on
-- public.series) never fails on it. Written to run again without harm.

-- ---------- series.kind ----------
alter table public.series
  add column if not exists kind text not null default 'block';
alter table public.series drop constraint if exists series_kind_check;
alter table public.series add constraint series_kind_check check (kind in ('block', 'termin'));

comment on column public.series.kind is
  'block: a rhythm of blocks planned with the coach (rests with its goal); termin: her fixed times every week (no reminder unless she asked, never ends with a goal).';

-- ---------- profiles: the Sunday ask for next week's shifts ----------
alter table public.profiles
  add column if not exists shifts_asked_at timestamptz,
  add column if not exists shifts_weekly boolean not null default false;

comment on column public.profiles.shifts_asked_at is
  'When the coach first asked on a Sunday for her shifts of the next week (note_offer dienste): without her yes never again.';
comment on column public.profiles.shifts_weekly is
  'She said yes to the Sunday ask for next week''s shifts: the coach asks every Sunday (until she does not want it any more).';

-- The kinds, as in plan.ts (NUDGE_KINDS): those of 20261126000200_daily_nudge.sql plus «dienste».
create or replace function public.nudge_kind_ok(k text) returns boolean language sql immutable set search_path = '' as $$
  select k in ('wochenblick', 'stunden', 'plan_b', 'etappen', 'rhythmus', 'traum', 'experiment', 'dienste')
$$;

-- ---------- fill, sync, split: they write the rhythm's kind ----------

-- As in 20261124000000_series.sql, with the kind: a termin rhythm fills without looking at a goal (her fixed times
-- stand whether a goal is active or not, up to its own end), carries reminder_asked when it has a reminder (she asked
-- for it), and leaves out a day that already has a single entry of hers for it: a termin at the same start or with the
-- same title at that time, or a block of its goal then (no double entry, no double count). A block rhythm as before.
create or replace function public.series_fill(s public.series, p_horizon_days integer default 56)
returns integer language plpgsql set search_path = '' as $$
declare
  termin boolean := s.kind = 'termin';
  target date;
  today date;
  last_day date;
  n integer;
begin
  if not s.active then return 0; end if;
  if s.goal_id is not null and not termin then
    select g.target_date into target from public.goals g where g.id = s.goal_id and g.status = 'active';
    if not found then return 0; end if;
  end if;
  today := (now() at time zone s.time_zone)::date;
  last_day := least(coalesce(s.until_date, target - 1, today + p_horizon_days), today + p_horizon_days);
  insert into public.events (user_id, title, starts_at, ends_at, all_day, location, reminder_minutes, reminder_asked, source, kind, goal_id, series_id, series_day)
  select s.user_id, s.title, x.starts_at, x.starts_at + make_interval(mins => s.duration_minutes), false, s.location,
         s.reminder_minutes, termin and s.reminder_minutes is not null, s.source, s.kind, s.goal_id, s.id, x.day
  from (
    select d::date as day, ((d::date + s.start_time) at time zone s.time_zone) as starts_at
    from generate_series(greatest(s.start_date, today)::timestamp, last_day::timestamp, interval '1 day') as d
  ) x
  where extract(isodow from x.day)::smallint = any (s.weekdays)
    and not (x.day = any (s.skip_days))
    and x.starts_at > now()
    and not exists (
      select 1 from public.events o
      where o.user_id = s.user_id and o.series_id is null
        and o.starts_at < x.starts_at + make_interval(mins => s.duration_minutes)
        and (coalesce(o.ends_at, o.starts_at) > x.starts_at or o.starts_at = x.starts_at)
        and case when termin
              then (o.kind = 'termin' and not o.all_day and (o.starts_at = x.starts_at or lower(btrim(o.title)) = lower(btrim(s.title))))
                or (s.goal_id is not null and o.kind = 'block' and o.goal_id = s.goal_id)
              else o.kind = 'block' and o.goal_id is not distinct from s.goal_id
            end
    )
  on conflict (series_id, series_day) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- As in 20261124000000_series.sql, with the kind: the coming days take it (and a termin rhythm's reminder_asked);
-- a termin rhythm stays live and keeps its days whatever its goal does (only its own end, pause and skips count).
create or replace function public.series_sync(p_id uuid)
returns integer language plpgsql set search_path = '' as $$
declare
  s public.series;
  termin boolean;
  live boolean;
  target date;
  end_day date;
begin
  select * into s from public.series where id = p_id;
  if not found then return 0; end if;
  termin := s.kind = 'termin';
  live := s.active;
  if s.goal_id is not null and not termin then
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
  set title = s.title, location = s.location, reminder_minutes = s.reminder_minutes, reminder_asked = x.asked, goal_id = s.goal_id,
      kind = s.kind, all_day = false, starts_at = x.starts_at, ends_at = x.starts_at + make_interval(mins => s.duration_minutes)
  from (
    select ev.id, ((ev.series_day + s.start_time) at time zone s.time_zone) as starts_at,
           case when termin then s.reminder_minutes is not null else ev.reminder_asked end as asked
    from public.events ev
    where ev.series_id = s.id and not ev.series_exception and ev.starts_at > now()
  ) x
  where e.id = x.id and x.starts_at > now()
    and not exists (select 1 from public.goal_time t where t.event_id = e.id)
    and (e.title, e.location, e.reminder_minutes, e.reminder_asked, e.goal_id, e.kind, e.all_day, e.starts_at, e.ends_at)
      is distinct from (s.title, s.location, s.reminder_minutes, x.asked, s.goal_id, s.kind, false, x.starts_at, x.starts_at + make_interval(mins => s.duration_minutes));
  return public.series_fill(s);
end;
$$;

-- As in 20261124000000_series.sql; the copy from `p_from` on keeps the kind.
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
  insert into public.series (user_id, goal_id, kind, title, weekdays, start_time, duration_minutes, location, reminder_minutes, time_zone,
                             start_date, until_date, active, source, skip_days, lapse_asked_at)
  values (s.user_id, s.goal_id, s.kind, s.title, s.weekdays, s.start_time, s.duration_minutes, s.location, s.reminder_minutes, s.time_zone,
          p_from, s.until_date, false, s.source, array(select d from unnest(s.skip_days) d where d >= p_from), s.lapse_asked_at)
  returning id into nid;
  update public.events set series_id = nid where series_id = p_id and series_day >= p_from;
  update public.series set until_date = p_from - 1 where id = p_id;
  update public.series set active = s.active where id = nid;
  return nid;
end;
$$;

-- A change of the kind brings its coming days along too (same trigger function as in 20261124000000_series.sql).
drop trigger if exists series_changed on public.series;
create trigger series_changed after insert or update of goal_id, kind, title, weekdays, start_time, duration_minutes, location, reminder_minutes,
  time_zone, start_date, until_date, active, skip_days on public.series
  for each row execute function public.series_changed();

-- ---------- a goal's rhythms: blocks rest with it, fixed times are hers ----------

-- As in 20261124000000_series.sql for block rhythms. A termin rhythm stays: when its goal is reached or dropped it
-- lets go of it (its coming days then count for no goal); a pause or a new target date changes nothing for it.
create or replace function public.goals_series() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status and new.status <> 'active' then
    update public.series set active = false where goal_id = new.id and active and kind = 'block';
    if new.status in ('done', 'dropped') then
      update public.series set goal_id = null where goal_id = new.id and kind = 'termin';
    end if;
  elsif new.target_date is distinct from old.target_date then
    perform public.series_sync(s.id) from public.series s where s.goal_id = new.id and s.active and s.until_date is null and s.kind = 'block';
  end if;
  return null;
end;
$$;

-- Deleting a goal deletes its rhythms (series.goal_id on delete cascade); her fixed times let go of it first and stay.
-- Only her own delete (role authenticated: the app, the coach); the account's removal takes every rhythm anyway.
create or replace function public.goals_series_unlink() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    update public.series set goal_id = null where goal_id = old.id and kind = 'termin';
  end if;
  return old;
end;
$$;
drop trigger if exists goals_series_unlink on public.goals;
create trigger goals_series_unlink before delete on public.goals
  for each row execute function public.goals_series_unlink();

-- ---------- the answer of a termin with a goal follows it like a block's ----------
-- As in 20261115000000_goals_habits.sql, for a termin with a goal too (before, any change of one deleted its answer):
-- moved into the future, made all-day, without a goal or without an end, the answer goes; another time, it goes;
-- linked to another goal, it moves along.
create or replace function public.sync_block_answer() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.kind not in ('block', 'termin') or new.all_day or new.ends_at is null or new.ends_at > now() or new.goal_id is null then
    delete from public.goal_time where event_id = new.id;
  elsif new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at then
    delete from public.goal_time where event_id = new.id; -- the old answer was for another time
  elsif new.goal_id is distinct from old.goal_id then
    update public.goal_time set goal_id = new.goal_id where event_id = new.id;
  end if;
  return null;
end;
$$;

-- ---------- goal minutes: a past termin with a goal counts like a block ----------
-- As in 20261122000000_honest_count.sql (same columns, same sum), with termine that serve a goal: provisionally for 7
-- days after they ended unless answered. The entries kept from before honest counting are blocks only.
create or replace view public.goal_minutes with (security_invoker = true) as
select g.id as goal_id,
  coalesce((select sum(t.minutes) from public.goal_time t where t.goal_id = g.id), 0)::integer as logged_minutes,
  coalesce((
    select sum(least(1440, extract(epoch from (e.ends_at - e.starts_at)) / 60))
    from public.events e
    where e.goal_id = g.id and e.kind in ('block', 'termin') and not e.all_day and e.source <> 'nolio'
      and e.ends_at is not null and e.ends_at <= now()
      and ((e.kind = 'block' and e.ends_at < public.honest_count_from() and e.created_at < public.honest_count_from())
        or e.ends_at > now() - interval '7 days')
      and not exists (select 1 from public.goal_time t where t.event_id = e.id)
  ), 0)::integer as block_minutes,
  coalesce((
    select sum(least(1440, extract(epoch from (e.ends_at - e.starts_at)) / 60))
    from public.events e
    where e.goal_id = g.id and e.kind in ('block', 'termin') and not e.all_day and e.source <> 'nolio'
      and e.ends_at is not null and e.ends_at <= now()
      and not (e.kind = 'block' and e.ends_at < public.honest_count_from() and e.created_at < public.honest_count_from())
      and e.ends_at > now() - interval '7 days'
      and not exists (select 1 from public.goal_time t where t.event_id = e.id)
  ), 0)::integer as provisional_minutes
from public.goals g;
