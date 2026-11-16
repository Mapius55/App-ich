-- Bucket List: life dreams next to concrete goals, when a dream was fulfilled and how it was,
-- when the coach last brought it up; the birth year for «Leben» (life in weeks).
-- Written to run again without harm (if not exists, or replace, drop ... if exists).

-- ---------- goals: dreams, fulfilled with a date and a memory ----------
alter table public.goals
  -- 'dream': something to experience in one's life (the Bucket List); 'goal': something concrete to work toward
  add column if not exists kind text not null default 'goal' check (kind in ('dream', 'goal')),
  -- when it was reached or the dream came true; kept by the trigger below, null unless status is 'done'
  add column if not exists done_at timestamptz,
  -- how it was, in the person's words (fulfilled dreams)
  add column if not exists memory text check (memory is null or length(memory) <= 1000),
  -- when the coach last brought the dream up in a conversation (its reminders), null = never
  add column if not exists reminded_at timestamptz;

-- done_at follows status: set when it becomes 'done' (unless given), kept while it stays 'done',
-- cleared when it leaves 'done'. So a done goal always has a date, and only a done goal has one.
create or replace function public.goals_done_at() returns trigger language plpgsql as $$
begin
  if new.status = 'done' then
    new.done_at := coalesce(new.done_at, now());
  else
    new.done_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists goals_done_at on public.goals;
create trigger goals_done_at before insert or update of status, done_at on public.goals
  for each row execute function public.goals_done_at();

-- reminded_at is the server's clock: whatever the client sends, a new value becomes now()
-- (the coach calls update_goal with reminded: true after mentioning a dream). Clearing it stays possible.
create or replace function public.goals_reminded_at() returns trigger language plpgsql as $$
begin
  if new.reminded_at is not null and (tg_op = 'INSERT' or new.reminded_at is distinct from old.reminded_at) then
    new.reminded_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists goals_reminded_at on public.goals;
create trigger goals_reminded_at before insert or update of reminded_at on public.goals
  for each row execute function public.goals_reminded_at();

-- updated_at as before (touch_updated_at), except that the coach noting a reminder is no change of the
-- dream itself: «liegt lange» (no update for 60 days) must not restart because the coach mentioned it.
-- Trigger names fire in alphabetical order: goals_done_at, goals_reminded_at, then goals_touch.
create or replace function public.goals_touch() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - array['reminded_at', 'updated_at']) = (to_jsonb(old) - array['reminded_at', 'updated_at']) then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists goals_touch on public.goals;
create trigger goals_touch before update on public.goals
  for each row execute function public.goals_touch();

-- Goals reached before this migration: their last change is the best date there is. Without the
-- touch trigger, so updated_at (the dream's «last update») stays as it was.
alter table public.goals disable trigger goals_touch;
update public.goals set done_at = updated_at where status = 'done' and done_at is null;
alter table public.goals enable trigger goals_touch;

-- ---------- profiles: the birth year for «Leben» ----------
-- Only the year, nothing more. The app offers 1920 up to this year; the coach saves it only when the
-- person says it (update_profile birth_year) and never asks for it.
alter table public.profiles
  add column if not exists birth_year smallint check (birth_year is null or birth_year between 1900 and 2100);
