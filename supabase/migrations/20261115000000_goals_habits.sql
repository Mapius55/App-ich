-- Goals, milestones and habits ("Plan"), and planned time blocks in the calendar.
-- Every table is protected by Row Level Security: each person sees only their own rows.

-- ---------- goals: something to work toward, often with a date (race, exam, project) ----------
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  why text check (why is null or length(why) <= 1000),        -- why it matters to the person
  target_date date,                                           -- e.g. race day; null = open-ended
  status text not null default 'active' check (status in ('active', 'done', 'paused', 'dropped')),
  source text not null default 'person' check (source in ('person', 'coach')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index goals_user_idx on public.goals (user_id, status, target_date);
alter table public.goals enable row level security;
create policy "own goals" on public.goals for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger goals_touch before update on public.goals
  for each row execute function public.touch_updated_at();

-- ---------- milestones: the steps (Etappen) of a goal ----------
create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal_id uuid not null references public.goals (id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  due_date date,
  done_at timestamptz,                                        -- null = open
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index milestones_goal_idx on public.milestones (goal_id, position);
alter table public.milestones enable row level security;
create policy "own milestones" on public.milestones for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger milestones_touch before update on public.milestones
  for each row execute function public.touch_updated_at();

-- ---------- habits: small recurring goals ("3x per week running") ----------
create table public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  per_week integer not null default 7 check (per_week between 1 and 7), -- 7 = every day
  goal_id uuid references public.goals (id) on delete set null,          -- optional: serves a goal
  active boolean not null default true,
  source text not null default 'person' check (source in ('person', 'coach')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index habits_user_idx on public.habits (user_id, active);
alter table public.habits enable row level security;
create policy "own habits" on public.habits for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger habits_touch before update on public.habits
  for each row execute function public.touch_updated_at();

-- one row per habit and day it was done
create table public.habit_logs (
  habit_id uuid not null references public.habits (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now(),
  primary key (habit_id, day)
);
create index habit_logs_user_day_idx on public.habit_logs (user_id, day);
alter table public.habit_logs enable row level security;
create policy "own habit logs" on public.habit_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- calendar: planned time blocks and the goal an entry serves ----------
-- kind 'termin' = an appointment the person has; 'block' = time the coach planned with them
-- (focus time, a training session for a goal).
alter table public.events
  add column kind text not null default 'termin' check (kind in ('termin', 'block')),
  add column goal_id uuid references public.goals (id) on delete set null;
create index events_goal_idx on public.events (goal_id);

-- A milestone, habit or calendar entry may only point to one's own goal.
create function public.check_goal_owner() returns trigger language plpgsql as $$
begin
  if new.goal_id is not null and not exists (
    select 1 from public.goals g where g.id = new.goal_id and g.user_id = new.user_id
  ) then
    raise exception 'goal not found' using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;
create trigger milestones_goal_owner before insert or update of goal_id on public.milestones
  for each row execute function public.check_goal_owner();
create trigger habits_goal_owner before insert or update of goal_id on public.habits
  for each row execute function public.check_goal_owner();
create trigger events_goal_owner before insert or update of goal_id on public.events
  for each row execute function public.check_goal_owner();

-- Likewise a habit log only for one's own habit.
create function public.check_habit_owner() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.habits h where h.id = new.habit_id and h.user_id = new.user_id) then
    raise exception 'habit not found' using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;
create trigger habit_logs_owner before insert or update on public.habit_logs
  for each row execute function public.check_habit_owner();

-- ---------- review fixes ----------
-- All-day entries remind "at 08:00 that day" (-480) or "18:00 the day before"; allow negative offsets.
alter table public.events drop constraint if exists events_reminder_minutes_check;
alter table public.events add constraint events_reminder_minutes_check
  check (reminder_minutes is null or reminder_minutes between -1440 and 10080);
create index habits_goal_idx on public.habits (goal_id);
create index milestones_user_idx on public.milestones (user_id);

-- ---------- effort: how big a goal is and how much time went into it ----------
alter table public.goals
  add column effort_hours numeric(8, 1) check (effort_hours is null or effort_hours between 0 and 100000), -- estimated total
  add column weekly_hours numeric(5, 1) check (weekly_hours is null or weekly_hours between 0 and 168),    -- time she can invest per week
  add column prior_hours numeric(8, 1) not null default 0 check (prior_hours between 0 and 100000);         -- already invested before the app

-- Time that went into a goal. Past planned blocks count by themselves; a row here with
-- the block's event_id replaces that (actual minutes, or 0 when it didn't happen).
create table public.goal_time (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal_id uuid not null references public.goals (id) on delete cascade,
  day date not null,
  minutes integer not null check (minutes between 0 and 1440),
  source text not null default 'person' check (source in ('person', 'coach', 'block', 'nolio', 'whoop')),
  event_id uuid references public.events (id) on delete set null, -- the planned block this confirms
  external_id text,                                               -- e.g. the Nolio workout id (no double counting)
  note text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now()
);
-- plain (not partial) unique indexes, so upserts can target them; NULLs stay distinct
create unique index goal_time_event_idx on public.goal_time (event_id);
create unique index goal_time_external_idx on public.goal_time (user_id, source, external_id);
create index goal_time_goal_idx on public.goal_time (goal_id, day);
create index goal_time_user_idx on public.goal_time (user_id);
alter table public.goal_time enable row level security;
create policy "own goal time" on public.goal_time for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger goal_time_goal_owner before insert or update of goal_id on public.goal_time
  for each row execute function public.check_goal_owner();

-- Minutes per goal: logged time, plus past blocks for the goal that nobody confirmed or corrected yet.
-- security_invoker: the view runs with the caller's rights, so RLS applies as on the tables.
create view public.goal_minutes with (security_invoker = true) as
select g.id as goal_id,
  coalesce((select sum(t.minutes) from public.goal_time t where t.goal_id = g.id), 0)::integer as logged_minutes,
  coalesce((
    select sum(least(1440, extract(epoch from (e.ends_at - e.starts_at)) / 60))
    from public.events e
    where e.goal_id = g.id and e.kind = 'block' and not e.all_day
      and e.ends_at is not null and e.ends_at <= now()
      and not exists (select 1 from public.goal_time t where t.event_id = e.id)
  ), 0)::integer as block_minutes
from public.goals g;

-- A time entry may only confirm one's own calendar entry.
create function public.check_event_owner() returns trigger language plpgsql as $$
begin
  if new.event_id is not null and not exists (
    select 1 from public.events e where e.id = new.event_id and e.user_id = new.user_id
  ) then
    raise exception 'event not found' using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;
create trigger goal_time_event_owner before insert or update of event_id on public.goal_time
  for each row execute function public.check_event_owner();

-- When a planned block changes, its answer must follow: moved into the future, made all-day or
-- no longer a block -> the answer goes; linked to another goal -> the answer moves along.
create function public.sync_block_answer() returns trigger language plpgsql as $$
begin
  if new.kind <> 'block' or new.all_day or new.ends_at is null or new.ends_at > now() or new.goal_id is null then
    delete from public.goal_time where event_id = new.id;
  elsif new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at then
    delete from public.goal_time where event_id = new.id; -- the old answer was for another time
  elsif new.goal_id is distinct from old.goal_id then
    update public.goal_time set goal_id = new.goal_id where event_id = new.id;
  end if;
  return null;
end;
$$;
create trigger events_block_answer after update of starts_at, ends_at, all_day, kind, goal_id on public.events
  for each row execute function public.sync_block_answer();
