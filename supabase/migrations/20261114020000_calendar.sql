-- Calendar "I am": events the coach (or you) put in, served as a subscribable
-- iCalendar feed. The iPhone subscribes once to a private link; new events
-- then appear by themselves.

create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  location text,
  notes text,
  reminder_minutes integer check (reminder_minutes is null or reminder_minutes between 0 and 10080),
  source text not null default 'person' check (source in ('person', 'coach')),
  sequence integer not null default 0, -- bumped on every change so calendars pick it up
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index events_user_start_idx on public.events (user_id, starts_at);

alter table public.events enable row level security;
create policy "own events" on public.events for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create function public.bump_event() returns trigger language plpgsql as $$
begin new.updated_at = now(); new.sequence = old.sequence + 1; return new; end;
$$;
create trigger events_bump before update on public.events
  for each row execute function public.bump_event();

-- Private link for the calendar subscription (can be renewed in the app).
alter table public.profiles add column calendar_token uuid not null default gen_random_uuid() unique;
