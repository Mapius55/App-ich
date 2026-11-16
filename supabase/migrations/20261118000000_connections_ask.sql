-- The coach asks ONCE which apps and devices it may read (coach tool request_connections), and its
-- context says what is connected. Both columns are nullable: existing members start with null
-- (never asked, calendar not seen yet).

alter table public.profiles
  -- set by the coach when it calls request_connections; null = never asked. The coach does not ask
  -- again afterwards unless the person brings it up.
  add column if not exists connections_asked_at timestamptz,
  -- the last time a calendar app fetched the private "I am" feed (Edge Function "calendar", at most
  -- every few hours); not null = the iPhone calendar is subscribed
  add column if not exists calendar_fetched_at timestamptz;
