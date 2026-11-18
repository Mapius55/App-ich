-- Round 3, «Ein Anstoss am Tag» (NEXT.md #1 with #5, owner decision 1): the coach starts at most one thing a day by
-- itself (dailyNudge in supabase/functions/_shared/plan.ts), right after her yes, a tick or something done in the
-- conversation; after three days without one, in the greeting. What it needs to remember so that «once» really means
-- once, and so that her «Nein» is respected:
-- - goals.hours_asked_at, goals.steps_asked_at: the coach asked once for a goal's weekly hours / proposed its steps
--   (note_offer stunden, etappen), so that item never comes again for this goal, whatever she said;
-- - profiles.nudge_day, profiles.nudge_kind: the last day an Anstoss came and what it was (no second one that day; the
--   greeting carries it only after three days without one);
-- - profiles.nudge_no: her «Nein» per kind ({"stunden": "2026-11-18", …}): that kind rests 14 days;
-- - days.opener «anstoss»: a greeting that opens with the day's Anstoss as its one question;
-- - public.note_nudge(): notes the day's Anstoss (and her «Nein») for her own profile in one write.
-- Columns on existing tables (Row Level Security as they have it: each person reads and writes her own rows; the export
-- reads them with "*"; the account's deletion cascades), nullable or with a default, so existing rows stay as they are.
-- The function runs as the caller (RLS applies), search_path pinned. Written to run again without harm.

-- ---------- goals: weekly hours and steps asked once ----------
alter table public.goals
  add column if not exists hours_asked_at timestamptz,
  add column if not exists steps_asked_at timestamptz;

comment on column public.goals.hours_asked_at is
  'When the coach asked once, as the day''s Anstoss, how many hours a week she has for this goal (note_offer stunden); never again after.';
comment on column public.goals.steps_asked_at is
  'When the coach proposed steps once, as the day''s Anstoss, for this goal (note_offer etappen); never again after.';

-- Noting a question is no change of the goal itself: like reminded_at, nudge_after, pattern_asked_at, plan_b_asked_at
-- and rhythm_asked_at it keeps updated_at (which the Bucket List reads as activity: «liegt lange»). Same function as in
-- 20261124000000_series.sql plus hours_asked_at and steps_asked_at.
create or replace function public.goals_touch() returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - array['reminded_at', 'nudge_after', 'pattern_asked_at', 'plan_b_asked_at', 'rhythm_asked_at', 'hours_asked_at', 'steps_asked_at', 'updated_at'])
     = (to_jsonb(old) - array['reminded_at', 'nudge_after', 'pattern_asked_at', 'plan_b_asked_at', 'rhythm_asked_at', 'hours_asked_at', 'steps_asked_at', 'updated_at']) then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- ---------- profiles: the day's Anstoss and her «Nein» per kind ----------
alter table public.profiles
  add column if not exists nudge_day date,
  add column if not exists nudge_kind text,
  add column if not exists nudge_no jsonb not null default '{}'::jsonb;

-- The kinds, as in plan.ts (NUDGE_KINDS).
create or replace function public.nudge_kind_ok(k text) returns boolean language sql immutable set search_path = '' as $$
  select k in ('wochenblick', 'stunden', 'plan_b', 'etappen', 'rhythmus', 'traum', 'experiment')
$$;

-- nudge_no: an object of kind → day ("YYYY-MM-DD"), nothing else.
create or replace function public.nudge_no_ok(j jsonb) returns boolean language sql immutable set search_path = '' as $$
  select pg_catalog.jsonb_typeof(j) = 'object'
     and not exists (
       select 1 from pg_catalog.jsonb_each(j) e
       where not public.nudge_kind_ok(e.key)
          or pg_catalog.jsonb_typeof(e.value) <> 'string'
          or (e.value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$'
     )
$$;

alter table public.profiles drop constraint if exists profiles_nudge_kind_check;
alter table public.profiles add constraint profiles_nudge_kind_check check (nudge_kind is null or public.nudge_kind_ok(nudge_kind));
alter table public.profiles drop constraint if exists profiles_nudge_no_check;
alter table public.profiles add constraint profiles_nudge_no_check check (public.nudge_no_ok(nudge_no));

comment on column public.profiles.nudge_day is
  'Her local day of the last Anstoss the coach brought up by itself (at most one a day; the greeting carries one only after three days without).';
comment on column public.profiles.nudge_kind is
  'The kind of that Anstoss: wochenblick, stunden, plan_b, etappen, rhythmus, traum or experiment.';
comment on column public.profiles.nudge_no is
  'Her «Nein» per kind of Anstoss: kind → her local day; that kind rests 14 days.';

-- ---------- note_nudge: the day's Anstoss came (and with p_no her «Nein» to its kind) ----------
-- Her own profile only (auth.uid(), and RLS as the caller). p_day is her local day (the coach's thread).
create or replace function public.note_nudge(p_day date, p_kind text, p_no boolean default false) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if p_day is null or not public.nudge_kind_ok(p_kind) then
    raise exception 'invalid nudge' using errcode = '22023';
  end if;
  update public.profiles
  set nudge_day = p_day,
      nudge_kind = p_kind,
      nudge_no = case when coalesce(p_no, false) then nudge_no || pg_catalog.jsonb_build_object(p_kind, pg_catalog.to_char(p_day, 'YYYY-MM-DD')) else nudge_no end
  where id = auth.uid();
end;
$$;
revoke all on function public.note_nudge(date, text, boolean) from public, anon;
grant execute on function public.note_nudge(date, text, boolean) to authenticated, service_role;
comment on function public.note_nudge(date, text, boolean) is
  'The coach brought up the day''s Anstoss (profiles.nudge_day, nudge_kind); with p_no her «Nein» to that kind (nudge_no).';

-- ---------- days.opener: the new opener «anstoss» ----------
-- Same list as in 20261126000100_evening_come_back.sql plus «anstoss» (coach index.ts, chooseOpener).
alter table public.days drop constraint if exists days_opener_check;
alter table public.days add constraint days_opener_check
  check (opener is null or opener in ('termin', 'gestern', 'ziel', 'schlaf', 'jahreszeit', 'neustart', 'wochenblick', 'abend', 'abend_frage', 'zurueck', 'anstoss'));
