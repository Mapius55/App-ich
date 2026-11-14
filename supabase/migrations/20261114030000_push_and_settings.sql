-- Notifications from the coach (web push) and per-person settings.

alter table public.profiles
  add column timezone text,                 -- e.g. Europe/Zurich (kept up to date by the app)
  add column notify_morning time,           -- morning question, null = off
  add column notify_evening time,           -- evening look-back, null = off
  add column last_morning_push date,
  add column last_evening_push date;

-- One row per device that allowed notifications.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  app_url text,                             -- where the app lives (opened when tapping a notification)
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
create policy "own push subscriptions" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Server-only keys (e.g. the VAPID key pair for web push). RLS on and no
-- policies: nobody but the service role can read or write these.
create table public.app_keys (
  name text primary key,
  value text not null,
  created_at timestamptz not null default now()
);
alter table public.app_keys enable row level security;
