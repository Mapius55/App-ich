-- Ehrlich zählen: a past goal block nobody answered counts *provisionally* for 7 days after it ended, then it
-- quietly stops counting (never a miss). An answer is a row in goal_time as before: Ja (its planned length),
-- Teilweise (fewer minutes) or Nein (0 minutes, kept as data).
-- Grandfathering: blocks that ended, and were entered, before this migration first ran keep counting as they
-- always did, so nobody's numbers drop at the release. That moment is a constant, public.honest_count_from(),
-- written once by the first run (a second run keeps it).
-- goal_minutes keeps its columns and their sum (an older app adds logged + block and gets the honest total) and
-- adds provisional_minutes: the part of block_minutes that is only provisional (lighter in the bar, never said as
-- done). The app reads the moment through the same function (rpc) to count days the same way (shared plan.ts).
-- goals.pattern_asked_at: the coach offered once to adapt a goal's blocks from their pattern (at most once a week).
-- Written to run again without harm; Row Level Security as the tables have it (the view runs as the caller).

-- ---------- the moment honest counting began ----------
do $honest$
begin
  if to_regprocedure('public.honest_count_from()') is null then
    execute format(
      $f$create function public.honest_count_from() returns timestamptz language sql immutable parallel safe set search_path = '' as $b$ select %L::timestamptz $b$$f$,
      to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    );
  end if;
end
$honest$;
comment on function public.honest_count_from() is
  'When honest counting began (this migration''s first run): unanswered goal blocks that ended and were entered before it count as before.';
grant execute on function public.honest_count_from() to authenticated, service_role;

-- ---------- goal minutes: confirmed, still counting by themselves, of those provisional ----------
-- block_minutes: past blocks nobody answered that still count: from before honest counting, or ended within the
-- last 7 days. provisional_minutes: of those, the ones from after it (ended within the last 7 days).
-- A planned Nolio training is a plan (the completed one counts as goal time), as before.
create or replace view public.goal_minutes with (security_invoker = true) as
select g.id as goal_id,
  coalesce((select sum(t.minutes) from public.goal_time t where t.goal_id = g.id), 0)::integer as logged_minutes,
  coalesce((
    select sum(least(1440, extract(epoch from (e.ends_at - e.starts_at)) / 60))
    from public.events e
    where e.goal_id = g.id and e.kind = 'block' and not e.all_day and e.source <> 'nolio'
      and e.ends_at is not null and e.ends_at <= now()
      and ((e.ends_at < public.honest_count_from() and e.created_at < public.honest_count_from())
        or e.ends_at > now() - interval '7 days')
      and not exists (select 1 from public.goal_time t where t.event_id = e.id)
  ), 0)::integer as block_minutes,
  coalesce((
    select sum(least(1440, extract(epoch from (e.ends_at - e.starts_at)) / 60))
    from public.events e
    where e.goal_id = g.id and e.kind = 'block' and not e.all_day and e.source <> 'nolio'
      and e.ends_at is not null and e.ends_at <= now()
      and not (e.ends_at < public.honest_count_from() and e.created_at < public.honest_count_from())
      and e.ends_at > now() - interval '7 days'
      and not exists (select 1 from public.goal_time t where t.event_id = e.id)
  ), 0)::integer as provisional_minutes
from public.goals g;

-- ---------- goals.pattern_asked_at: «once a week» for adapting a goal's blocks ----------
alter table public.goals
  add column if not exists pattern_asked_at timestamptz;

-- Noting the offer is no change of the goal itself: like reminded_at and nudge_after, it keeps updated_at (which
-- the Bucket List reads as activity on a dream, «liegt lange»). Same function as in 20261121000000_coach_daily.sql
-- plus pattern_asked_at.
create or replace function public.goals_touch() returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - array['reminded_at', 'nudge_after', 'pattern_asked_at', 'updated_at'])
     = (to_jsonb(old) - array['reminded_at', 'nudge_after', 'pattern_asked_at', 'updated_at']) then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;
