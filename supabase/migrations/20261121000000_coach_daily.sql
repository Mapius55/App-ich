-- The daily coach: what it needs to remember so that «once» really means once.
-- Only columns on existing tables (Row Level Security as they have it: each person reads and writes her own
-- rows; the export reads them with "*"). All nullable or with a default, so existing rows stay as they are.
-- Written to run again without harm.

-- ---------- days.opener: how the first greeting of the day opened ----------
-- Chosen in code (coach index.ts, chooseOpener), so the opener really changes from day to day and the
-- evening question comes at most three evenings a week. One short word, never text from the conversation.
alter table public.days
  add column if not exists opener text;
alter table public.days drop constraint if exists days_opener_check;
alter table public.days add constraint days_opener_check
  check (opener is null or opener in ('termin', 'gestern', 'ziel', 'schlaf', 'jahreszeit', 'neustart', 'wochenblick', 'abend', 'abend_frage'));

-- ---------- profiles: the Wochenblick and the rare offers ----------
alter table public.profiles
  -- the Monday of the week whose Wochenblick she did or declined (the coach's tool «wochenblick»)
  add column if not exists review_week date,
  -- declines in a row; after two the coach asks once whether she wants it at all
  add column if not exists review_declines smallint not null default 0,
  -- her answer to that question: null = never asked, false = no Wochenblick (never offered again), true = yes
  add column if not exists review_wanted boolean,
  -- the coach offered a small experiment (people without goals or dreams): at most once a week
  add column if not exists experiment_at timestamptz,
  -- the coach pointed once to people in her life or a professional (she leans on the coach in a heavy time)
  add column if not exists support_hint_at timestamptz;
alter table public.profiles drop constraint if exists profiles_review_declines_check;
alter table public.profiles add constraint profiles_review_declines_check check (review_declines between 0 and 20);

-- ---------- memories.followed_up_at: a dated note was asked about once ----------
alter table public.memories
  add column if not exists followed_up_at timestamptz;

-- ---------- milestones.overdue_asked_for: an overdue step was asked about once ----------
-- The due date it was asked about: a new date that passes again may be asked about again.
alter table public.milestones
  add column if not exists overdue_asked_for date;

-- ---------- goals.nudge_after: a dream rests after her «nicht jetzt» ----------
alter table public.goals
  add column if not exists nudge_after date;

-- A rest after «nicht jetzt» is no change of the dream itself: like a reminder (reminded_at), it keeps
-- updated_at, so «liegt lange» doesn't restart because of it. Same function as in 20261119000000_bucket_list.sql
-- plus nudge_after, now with a pinned search_path (to_jsonb lives in pg_catalog).
create or replace function public.goals_touch() returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - array['reminded_at', 'nudge_after', 'updated_at']) = (to_jsonb(old) - array['reminded_at', 'nudge_after', 'updated_at']) then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;
