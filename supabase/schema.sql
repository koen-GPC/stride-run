-- Stride — groups & leaderboards. Paste this whole file into Supabase → SQL Editor → Run.
-- Only run *summaries* are shared (numbers, no GPS track). Everything is protected by row level security:
-- you can only see people and runs from groups you are a member of.

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  code text not null unique,
  owner uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  group_id uuid not null references public.groups on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.runs (
  id text primary key,                       -- the activity id from the phone
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  started_at timestamptz not null,
  type text not null default 'run',
  name text check (char_length(name) <= 80),
  distance real not null check (distance >= 0 and distance < 400000),   -- metres
  moving real not null check (moving >= 0 and moving < 172800),        -- seconds
  elev_gain real,
  best_1k real, best_5k real, best_10k real, best_half real, best_full real,  -- seconds
  created_at timestamptz not null default now()
);
create index if not exists runs_user_started on public.runs (user_id, started_at desc);

-- Is the current user in a group with this other user?
create or replace function public.shares_group(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from members a join members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

create or replace function public.is_member(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where group_id = g and user_id = auth.uid());
$$;

alter table public.profiles enable row level security;
alter table public.groups   enable row level security;
alter table public.members  enable row level security;
alter table public.runs     enable row level security;

drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select using (id = auth.uid() or public.shares_group(id));
drop policy if exists "profiles write own" on public.profiles;
create policy "profiles write own" on public.profiles for insert with check (id = auth.uid());
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update using (id = auth.uid());

drop policy if exists "groups read" on public.groups;
create policy "groups read" on public.groups for select using (public.is_member(id));
drop policy if exists "groups update owner" on public.groups;
create policy "groups update owner" on public.groups for update using (owner = auth.uid());
drop policy if exists "groups delete owner" on public.groups;
create policy "groups delete owner" on public.groups for delete using (owner = auth.uid());

drop policy if exists "members read" on public.members;
create policy "members read" on public.members for select using (public.is_member(group_id));
drop policy if exists "members leave" on public.members;
create policy "members leave" on public.members for delete using (user_id = auth.uid());

drop policy if exists "runs read" on public.runs;
create policy "runs read" on public.runs for select using (user_id = auth.uid() or public.shares_group(user_id));
drop policy if exists "runs insert own" on public.runs;
create policy "runs insert own" on public.runs for insert with check (user_id = auth.uid());
drop policy if exists "runs update own" on public.runs;
create policy "runs update own" on public.runs for update using (user_id = auth.uid());
drop policy if exists "runs delete own" on public.runs;
create policy "runs delete own" on public.runs for delete using (user_id = auth.uid());

-- Creating and joining groups goes through these functions (no direct inserts).
create or replace function public.create_group(group_name text) returns public.groups
language plpgsql security definer set search_path = public as $$
declare g public.groups; c text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  loop
    c := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from groups where code = c);
  end loop;
  insert into groups (name, code, owner) values (group_name, c, auth.uid()) returning * into g;
  insert into members (group_id, user_id) values (g.id, auth.uid());
  return g;
end $$;

create or replace function public.join_group(group_code text) returns public.groups
language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into g from groups where code = upper(trim(group_code));
  if g.id is null then raise exception 'group not found'; end if;
  if (select count(*) from members where group_id = g.id) >= 50 then raise exception 'group full'; end if;
  insert into members (group_id, user_id) values (g.id, auth.uid()) on conflict do nothing;
  return g;
end $$;

revoke all on function public.create_group(text) from anon;
revoke all on function public.join_group(text) from anon;
grant execute on function public.create_group(text) to authenticated;
grant execute on function public.join_group(text) to authenticated;
