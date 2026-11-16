-- Bucket List hygiene: no fulfilled date in the future, no birth year in the future.
-- Written to run again without harm (or replace, drop ... if exists).

-- ---------- goals.done_at: never later than now ----------
-- As before (20261119000000_bucket_list.sql): set when it becomes 'done' (unless given), kept while it
-- stays 'done', cleared when it leaves 'done'. New: a date later than now() becomes now(), so a direct
-- REST call can't mark a goal or a dream as reached in the future. The trigger itself stays as it is.
-- Both functions here pin an empty search_path like the repo's other trigger functions (only pg_catalog).
create or replace function public.goals_done_at() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'done' then
    new.done_at := least(coalesce(new.done_at, now()), now());
  else
    new.done_at := null;
  end if;
  return new;
end;
$$;

-- ---------- profiles.birth_year: up to this year ----------
-- The check (1900..2100) stays: a check constraint must not depend on the clock. This trigger refuses a
-- year after the current one when the birth year is set or changed, so rows written earlier still take
-- other updates. "Current" is the year anywhere on earth (UTC+14), so a phone that already has the new
-- year is never refused. The app offers years up to this one; the coach checks the same before saving.
create or replace function public.profiles_birth_year() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.birth_year is not null
    and (tg_op = 'INSERT' or new.birth_year is distinct from old.birth_year)
    and new.birth_year > extract(year from (now() at time zone 'UTC') + interval '14 hours') then
    raise exception 'Das Geburtsjahr kann nicht in der Zukunft liegen.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_birth_year on public.profiles;
create trigger profiles_birth_year before insert or update of birth_year on public.profiles
  for each row execute function public.profiles_birth_year();
