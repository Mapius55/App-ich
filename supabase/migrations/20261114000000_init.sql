-- App-ich: initial schema
-- Every table is protected by Row Level Security: each person sees only their own rows.

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9._-]{3,30}$'),
  display_name text,
  onboarded boolean not null default false,
  summary text,                 -- short summary the coach writes after getting to know you
  nature_palette jsonb,         -- { name, colors: [hex, ...] } from your favourite nature
  location_name text,
  lat double precision,         -- rounded to ~1 km
  lon double precision,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy "own profile: read" on public.profiles for select using (auth.uid() = id);
create policy "own profile: update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- Create the profile automatically when someone signs up.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, username)
  values (new.id, lower(new.raw_user_meta_data ->> 'username'));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- memories: what the coach knows about you (visible + editable) ----------
create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  content text not null check (length(content) between 1 and 2000),
  category text not null default 'anderes'
    check (category in ('person', 'arbeit', 'werte', 'rhythmus', 'ziel', 'termin', 'natur', 'anderes')),
  event_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index memories_user_idx on public.memories (user_id, created_at);

alter table public.memories enable row level security;
create policy "own memories" on public.memories for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger memories_touch before update on public.memories
  for each row execute function public.touch_updated_at();

-- ---------- messages: one thread for onboarding, one per day ----------
create table public.messages (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  thread text not null,         -- 'onboarding' or 'YYYY-MM-DD'
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  hidden boolean not null default false,  -- e.g. the silent "app opened" turn
  created_at timestamptz not null default now()
);
create index messages_thread_idx on public.messages (user_id, thread, id);

alter table public.messages enable row level security;
create policy "own messages" on public.messages for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- days: mood + focus per day (drives the orb colours) ----------
create table public.days (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  mood jsonb,                   -- { valence: -1..1, energy: 0..1, word }
  focus text,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.days enable row level security;
create policy "own days" on public.days for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
