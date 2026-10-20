-- Disposable Postgres 17 fixture for attendance ledger integration tests.
-- No connection to production Supabase.
create extension if not exists pgcrypto;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
end $$;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

create table public.profiles(
  id uuid primary key,
  role text not null default 'employee'
);
create table public.attendance_sessions(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  clock_in timestamptz not null,
  clock_out timestamptz,
  status text not null,
  note text,
  verified_seconds bigint not null default 0,
  last_app_heartbeat_at timestamptz,
  presence_client_kind text,
  adjusted_by uuid,
  adjustment_reason text,
  updated_at timestamptz not null default now()
);
create table public.attendance_breaks(
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id),
  user_id uuid not null references public.profiles(id),
  started_at timestamptz not null,
  ended_at timestamptz
);

create or replace function public.phase6_app_actor_class() returns text
language sql stable security definer set search_path='' as $$
  select role from public.profiles where id = auth.uid()
$$;

insert into public.profiles(id,role) values
  ('11111111-1111-4111-8111-111111111111','employee'),
  ('22222222-2222-4222-8222-222222222222','employee'),
  ('33333333-3333-4333-8333-333333333333','client'),
  ('44444444-4444-4444-8444-444444444444','project_manager'),
  ('55555555-5555-4555-8555-555555555555','admin');

insert into public.attendance_sessions(id,user_id,clock_in,status,verified_seconds) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',
   clock_timestamp() - interval '1 hour','active',30),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222',
   clock_timestamp() - interval '1 hour','active',0),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','33333333-3333-4333-8333-333333333333',
   clock_timestamp() - interval '1 hour','active',0);

grant usage on schema public to authenticated, anon;
grant select on public.attendance_sessions to authenticated;
alter table public.attendance_sessions enable row level security;
create policy attendance_sessions_select on public.attendance_sessions
  for select to authenticated
  using (user_id = auth.uid() or public.phase6_app_actor_class() in ('admin','project_manager'));

-- Match the production attendance_breaks SELECT grant and row-level policy.
-- Authenticated users can view their own breaks; team managers/admins can
-- review employees without granting cross-user access to other team roles.
grant select on public.attendance_breaks to authenticated;
alter table public.attendance_breaks enable row level security;
create policy attendance_breaks_select on public.attendance_breaks
  for select to authenticated
  using (user_id = auth.uid() or public.phase6_app_actor_class() in ('admin','project_manager'));
