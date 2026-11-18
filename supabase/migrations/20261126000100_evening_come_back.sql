-- Round 3, «Der Abend nimmt den Tag auf» (NEXT.md #4): when she says something important about her life in the
-- evening, the coach asks whether it should come back to it; after her yes (the coach's tool come_back) the next
-- morning's greeting comes back to it exactly once (the opener «zurueck»).
-- Only columns on an existing table (public.days, Row Level Security as it has it: each person reads and writes her
-- own rows; the export reads them with "*", the account's deletion cascades). Nullable, so existing rows stay as they
-- are. No functions. Written to run again without harm.

-- ---------- days.come_back: what she asked the coach to come back to, on the day she said it ----------
alter table public.days
  -- in her words, short (the coach's summary of it); null = nothing to come back to
  add column if not exists come_back text,
  -- when the coach brought it up (the greeting that opened with it): from then on never again
  add column if not exists come_back_at timestamptz;
alter table public.days drop constraint if exists days_come_back_check;
alter table public.days add constraint days_come_back_check
  check (come_back is null or char_length(come_back) between 1 and 300);

comment on column public.days.come_back is
  'What she asked the coach (after its question in the evening) to come back to, short and in her words. The next morning''s greeting brings it up once.';
comment on column public.days.come_back_at is
  'When the coach brought days.come_back up (the opener «zurueck»); set once, never again after.';

-- ---------- days.opener: the new opener «zurueck» ----------
-- Same list as in 20261121000000_coach_daily.sql plus «zurueck» (coach index.ts, chooseOpener).
alter table public.days drop constraint if exists days_opener_check;
alter table public.days add constraint days_opener_check
  check (opener is null or opener in ('termin', 'gestern', 'ziel', 'schlaf', 'jahreszeit', 'neustart', 'wochenblick', 'abend', 'abend_frage', 'zurueck'));
