-- Round 3, after the persona replay: a reminder she asked for on a weekly rhythm stays hers (owner decision 2 «every
-- reminder she asked for»). Mia asked to be reminded of her stretching every evening; as a rhythm of blocks its days
-- carried reminder_asked false (series_fill set it only for a termin rhythm), so after two days away the reminder
-- rested like any block's, and the coach had promised it.
-- - series.reminder_asked: she asked for the rhythm's reminder herself (coach create_series / update_series
--   «erinnern»). Its days carry it (events.reminder_asked): series_fill, series_sync and split_series as in
--   20261126000500_termin_series.sql, with a day's reminder_asked = a reminder is set and (a termin rhythm, whose
--   reminder is always one she asked for, or the rhythm's own mark). A change of the mark brings the coming days along
--   (the trigger series_changed watches the column too).
-- - events_series_exception as in 20261124000000_series.sql, with reminder_asked among the fields: a reminder asked
--   for (or taken back) on one day of a rhythm makes that day her exception, like a changed reminder_minutes, so the
--   rhythm's own mark never overwrites it.
-- Functions run as the caller (security invoker, RLS applies) with search_path pinned. Written to run again without harm.

alter table public.series
  add column if not exists reminder_asked boolean not null default false;

comment on column public.series.reminder_asked is
  'She asked for this rhythm''s reminder herself (coach «erinnern»): its days carry events.reminder_asked, so the reminder comes as she asked (also after a few days away).';

-- As in 20261126000500_termin_series.sql; a day's reminder_asked from the rhythm's mark as well.
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
         s.reminder_minutes, s.reminder_minutes is not null and (termin or s.reminder_asked), s.source, s.kind, s.goal_id, s.id, x.day
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

-- As in 20261126000500_termin_series.sql; the coming days that follow the rhythm take its reminder_asked as well
-- (a day she changed on its own is her exception and keeps hers).
create or replace function public.series_sync(p_id uuid)
returns integer language plpgsql set search_path = '' as $$
declare
  s public.series;
  termin boolean;
  live boolean;
  target date;
  end_day date;
  asked boolean;
begin
  select * into s from public.series where id = p_id;
  if not found then return 0; end if;
  termin := s.kind = 'termin';
  asked := s.reminder_minutes is not null and (termin or s.reminder_asked);
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
  set title = s.title, location = s.location, reminder_minutes = s.reminder_minutes, reminder_asked = asked, goal_id = s.goal_id,
      kind = s.kind, all_day = false, starts_at = x.starts_at, ends_at = x.starts_at + make_interval(mins => s.duration_minutes)
  from (
    select ev.id, ((ev.series_day + s.start_time) at time zone s.time_zone) as starts_at
    from public.events ev
    where ev.series_id = s.id and not ev.series_exception and ev.starts_at > now()
  ) x
  where e.id = x.id and x.starts_at > now()
    and not exists (select 1 from public.goal_time t where t.event_id = e.id)
    and (e.title, e.location, e.reminder_minutes, e.reminder_asked, e.goal_id, e.kind, e.all_day, e.starts_at, e.ends_at)
      is distinct from (s.title, s.location, s.reminder_minutes, asked, s.goal_id, s.kind, false, x.starts_at, x.starts_at + make_interval(mins => s.duration_minutes));
  return public.series_fill(s);
end;
$$;

-- As in 20261126000500_termin_series.sql; the copy from `p_from` on keeps the reminder she asked for.
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
  insert into public.series (user_id, goal_id, kind, title, weekdays, start_time, duration_minutes, location, reminder_minutes, reminder_asked,
                             time_zone, start_date, until_date, active, source, skip_days, lapse_asked_at)
  values (s.user_id, s.goal_id, s.kind, s.title, s.weekdays, s.start_time, s.duration_minutes, s.location, s.reminder_minutes, s.reminder_asked,
          s.time_zone, p_from, s.until_date, false, s.source, array(select d from unnest(s.skip_days) d where d >= p_from), s.lapse_asked_at)
  returning id into nid;
  update public.events set series_id = nid where series_id = p_id and series_day >= p_from;
  update public.series set until_date = p_from - 1 where id = p_id;
  update public.series set active = s.active where id = nid;
  return nid;
end;
$$;

-- A change of the mark brings its coming days along too (same trigger function as in 20261124000000_series.sql).
drop trigger if exists series_changed on public.series;
create trigger series_changed after insert or update of goal_id, kind, title, weekdays, start_time, duration_minutes, location, reminder_minutes,
  reminder_asked, time_zone, start_date, until_date, active, skip_days on public.series
  for each row execute function public.series_changed();

-- As in 20261124000000_series.sql, with reminder_asked: one day changed on its own (the app, the coach: a direct
-- change, not the rhythm's sync) is her exception, also when she asked for (or took back) its reminder.
create or replace function public.events_series_exception() returns trigger language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() = 1 and new.series_id is not distinct from old.series_id
     and (new.title, new.starts_at, new.ends_at, new.all_day, new.location, new.reminder_minutes, new.reminder_asked, new.kind, new.goal_id)
       is distinct from (old.title, old.starts_at, old.ends_at, old.all_day, old.location, old.reminder_minutes, old.reminder_asked, old.kind, old.goal_id) then
    new.series_exception := true;
  end if;
  return new;
end;
$$;
