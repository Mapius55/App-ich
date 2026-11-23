-- Round 3, D2 «A habit that serves a goal counts its minutes» (NEXT.md, small fixes): a tick counted 0 minutes
-- (Peter: «45 gezählt, rund 150 echt»).
-- - habits.minutes: how long one time takes, set when she names a length («10 Minuten dehnen», «Viertelstunde im
--   Bus»); null = the tick counts no time, as before.
-- - goal_time.source 'habit': a tick of a habit with a goal and minutes writes one row (the coach's log_habit and a tap
--   in the app, through habitTimeRow in supabase/functions/_shared/plan.ts), external_id «<habit id>:<day>», so the
--   existing unique index (user_id, source, external_id) blocks a second one; an untick removes it. When the tick is
--   the same thing as a block of that day without an answer, the row answers the block too (event_id), so the two
--   count once.
-- Row Level Security as the tables have it (each person reads and writes her own rows). Written to run again without harm.

alter table public.habits
  add column if not exists minutes integer;
alter table public.habits drop constraint if exists habits_minutes_check;
alter table public.habits add constraint habits_minutes_check check (minutes is null or minutes between 1 and 720);

comment on column public.habits.minutes is
  'How long one time takes (minutes), when she named a length: a tick then counts it for the habit''s goal (goal_time source habit).';

-- the sources as in 20261115000000_goals_habits.sql plus «habit»
alter table public.goal_time drop constraint if exists goal_time_source_check;
alter table public.goal_time add constraint goal_time_source_check
  check (source in ('person', 'coach', 'block', 'nolio', 'whoop', 'habit'));

-- a tick's row names its habit and day («<habit id>:YYYY-MM-DD»)
alter table public.goal_time drop constraint if exists goal_time_habit_key_check;
alter table public.goal_time add constraint goal_time_habit_key_check
  check (source <> 'habit' or (external_id is not null and external_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d{4}-\d{2}-\d{2}$'));
