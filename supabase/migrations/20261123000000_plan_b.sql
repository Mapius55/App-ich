-- Plan B: one if-then plan per serious goal (a target date ahead and hours per week or blocks). The coach asks
-- once what could get in the way and stores her answer in her words: the obstacle (short, for the coach) and the
-- plan as one sentence, «Wenn es regnet, laufe ich auf dem Laufband.» She sees and edits the plan in the goal's detail.
-- plan_b_asked_at: the coach asked once (note_offer plan_b), so it never asks again for this goal, whatever she said.
-- Only columns on goals (Row Level Security as the table has it; the export reads goals with "*").
-- Written to run again without harm.

alter table public.goals
  add column if not exists obstacle text,
  add column if not exists plan_b text,
  add column if not exists plan_b_asked_at timestamptz;
alter table public.goals drop constraint if exists goals_obstacle_check;
alter table public.goals add constraint goals_obstacle_check check (obstacle is null or length(btrim(obstacle)) between 1 and 160);
alter table public.goals drop constraint if exists goals_plan_b_check;
alter table public.goals add constraint goals_plan_b_check check (plan_b is null or length(btrim(plan_b)) between 1 and 200);

-- A Plan B or an obstacle on the goal (from the coach, or written by her in the detail) means it was asked: the
-- coach never asks again, also after she clears it. The server's clock, like reminded_at.
create or replace function public.goals_plan_b_asked() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.plan_b_asked_at is null and (new.plan_b is not null or new.obstacle is not null) then
    new.plan_b_asked_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists goals_plan_b_asked on public.goals;
create trigger goals_plan_b_asked before insert or update of plan_b, obstacle, plan_b_asked_at on public.goals
  for each row execute function public.goals_plan_b_asked();

-- Noting the question is no change of the goal itself: like reminded_at, nudge_after and pattern_asked_at it keeps
-- updated_at. A new Plan B or obstacle is a change (it touches updated_at). Same function as in
-- 20261122000000_honest_count.sql plus plan_b_asked_at. Trigger names fire in alphabetical order: goals_done_at,
-- goals_plan_b_asked, goals_reminded_at, then goals_touch (which sees the final row).
create or replace function public.goals_touch() returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - array['reminded_at', 'nudge_after', 'pattern_asked_at', 'plan_b_asked_at', 'updated_at'])
     = (to_jsonb(old) - array['reminded_at', 'nudge_after', 'pattern_asked_at', 'plan_b_asked_at', 'updated_at']) then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;
