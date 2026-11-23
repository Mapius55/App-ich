-- Round 3, «Erinnerungen, die wirklich kommen» (NEXT.md #2, owner decision 2 «Blöcke und Wunsch») and «Mitteilungen
-- nur mit Eigenem» (NEXT.md #3, owner decision 3 «Nichts, nach Pause eine Zeile»). The Edge Function "push" gets a
-- third kind next to the morning and the evening: a reminder at starts_at − reminder_minutes, for every block after her
-- yes and every entry she asked a reminder for, only for people with a push subscription whose iPhone calendar is not
-- subscribed (profiles.calendar_fetched_at older than 3 days or null: no double alarm), never for Nolio entries, at
-- most 3 a day, never late (sent when its moment falls in the next 15 minutes), once per entry and day.
-- - push_log: slot 'reminder' with the entry it was for (event_id; no foreign key, the log outlives a deleted entry
--   and names no text), the new reasons a morning or evening stays out (empty: nothing of her own to say; busy: one
--   of her entries runs through the slot's hour; late_night: after a late entry the morning would come after 11:00),
--   and `named`: fingerprints (8 hex digits, like `fingerprint`) of the labels of her entries a body named, so an
--   entry of every day is named at most twice a week. One row per person, day, slot and entry: the unique key
--   push_log_once (user_id, day, slot) becomes (user_id, day, slot, event_id) with NULLS NOT DISTINCT, so the morning
--   and the evening stay once a day and the reminders once per entry and day.
--   Deploy the push function of this round right after this migration: the older dispatch's upsert names the old
--   key and gets an error until then; it then sends as before (its claim() treats an error as «go», and
--   profiles.last_*_push still guards the day), only two runs in the same minute could both send.
-- - profiles.notify_reminders: the row «Erinnerungen an Einträge» under Du › Benachrichtigungen, on by default (it
--   only does something once notifications are allowed on a device).
-- - profiles.notifications_asked_at: the coach offered once to switch on notifications (request_notifications), when
--   reminders come nowhere; not again unless she brings it up.
-- - events.reminder_asked: she asked for a reminder of this entry herself (coach create_event/update_event
--   «erinnern»); blocks get one without it.
-- Privacy as before: the log keeps no text. Row Level Security as the tables have it (push_log: she reads her own
-- rows, only the service role writes; profiles and events: her own rows). Written to run again without harm.

-- ---------- push_log: reminders, the new reasons, the labels named ----------
alter table public.push_log
  add column if not exists event_id uuid,
  add column if not exists named text[];

alter table public.push_log drop constraint if exists push_log_slot_check;
alter table public.push_log add constraint push_log_slot_check check (slot in ('morning', 'evening', 'reminder'));

-- a reminder names its entry, the morning and the evening none
alter table public.push_log drop constraint if exists push_log_event_check;
alter table public.push_log add constraint push_log_event_check check ((slot = 'reminder') = (event_id is not null));

alter table public.push_log drop constraint if exists push_log_reason_check;
alter table public.push_log add constraint push_log_reason_check
  check (reason is null or reason in ('opened_today', 'talked_recently', 'this_evening', 'paused', 'repeat', 'empty', 'busy', 'late_night'));

-- at most four labels, each a fingerprint (never the text)
alter table public.push_log drop constraint if exists push_log_named_check;
alter table public.push_log add constraint push_log_named_check
  check (named is null or (cardinality(named) between 1 and 4 and array_to_string(named, ',') ~ '^[0-9a-f]{8}(,[0-9a-f]{8})*$'));

-- once per person, day, slot and entry (the morning and the evening: event_id null, still once a day)
alter table public.push_log drop constraint if exists push_log_once;
do $once$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'push_log_once_per_entry' and conrelid = 'public.push_log'::regclass) then
    alter table public.push_log add constraint push_log_once_per_entry unique nulls not distinct (user_id, day, slot, event_id);
  end if;
end
$once$;

comment on column public.push_log.event_id is
  'slot reminder: the calendar entry it reminded of (no foreign key: the log keeps no text and outlives the entry).';
comment on column public.push_log.named is
  'Fingerprints (FNV-1a, 8 hex digits) of the labels of her entries the body named: an entry of every day is named at most twice in 7 days.';

-- ---------- profiles: the reminders switch, and the offer to switch notifications on ----------
alter table public.profiles
  add column if not exists notify_reminders boolean not null default true,
  add column if not exists notifications_asked_at timestamptz;

comment on column public.profiles.notify_reminders is
  'Du › Benachrichtigungen › «Erinnerungen an Einträge»: reminders as notifications (blocks, and entries she asked a reminder for), when her iPhone calendar is not subscribed. On by default.';
comment on column public.profiles.notifications_asked_at is
  'When the coach offered once to switch on notifications (request_notifications), because reminders came nowhere.';

-- ---------- events: a reminder she asked for ----------
alter table public.events
  add column if not exists reminder_asked boolean not null default false;

comment on column public.events.reminder_asked is
  'She asked for a reminder of this entry herself: it comes as a notification (blocks get one anyway), and may show her own title, a dream step too.';

-- the dispatch looks for the coming entries with a reminder, across everyone, every 15 minutes
create index if not exists events_reminder_idx on public.events (starts_at) where reminder_minutes is not null and not all_day;
