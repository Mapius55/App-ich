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
