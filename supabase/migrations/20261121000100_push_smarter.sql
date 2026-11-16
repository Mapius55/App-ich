-- Notifications from the coach, smarter (owner decision «Morgens und abends, schlauer»): the Edge
-- Function "push" decides once per person, day and slot (morning, evening) whether a message goes out
-- and which one, and keeps that here.
--   - «Already decided today» is reliable: two schedulers call the dispatch (pg_cron 'i-am-push' and
--     the GitHub workflow "push-cron"); the unique key lets only the first run send.
--   - The bodies rotate: no identical body within 7 days.
-- Privacy: never the text of a message. Only the template id (e.g. 'm.day.2'), a short fingerprint
-- of the body (8 hex digits, FNV-1a) and why a message stayed out. She can read her own rows (RLS);
-- only the service role (the Edge Function) writes. Rows older than 90 days are removed by the dispatch.
-- Written to run again without harm.

create table if not exists public.push_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,                                   -- her local calendar day
  slot text not null check (slot in ('morning', 'evening')),
  status text not null check (status in ('sent', 'skipped')),
  -- sent: which template; never the text
  template text check (template is null or template ~ '^[a-z0-9.]{1,40}$'),
  -- sent: the body's fingerprint, for «no identical body within 7 days»
  fingerprint text check (fingerprint is null or fingerprint ~ '^[0-9a-f]{8}$'),
  -- skipped: opened_today (morning, she was already there), talked_recently (evening, she talked in the
  -- last 3 hours), this_evening (evening, the app already greeted her this evening), paused (14 days
  -- without opening the app), repeat (nothing left that wasn't sent within 7 days)
  reason text check (reason is null or reason in ('opened_today', 'talked_recently', 'this_evening', 'paused', 'repeat')),
  devices smallint check (devices is null or devices between 0 and 100), -- how many of her devices it reached
  created_at timestamptz not null default now(),
  constraint push_log_once unique (user_id, day, slot)
);

alter table public.push_log enable row level security;
drop policy if exists "own push log: read" on public.push_log;
create policy "own push log: read" on public.push_log for select using (auth.uid() = user_id);
-- no insert, update or delete policy: the app can't write the log, only the service role can

-- «When did she last open the app?»: the dispatch reads her newest message row (any thread). The
-- existing index (user_id, thread, id) can't serve «newest across threads».
create index if not exists messages_user_id_idx on public.messages (user_id, id);
