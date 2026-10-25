-- Synthetic, disposable PostgreSQL 17 environment ONLY.
-- This setup deliberately has no real employees, projects, or payroll records.
create extension if not exists pgcrypto;
do $$
begin
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable set search_path=''
as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;

create table public.profiles(
 id uuid primary key,
 role text not null,
 status text not null default 'active'
);
create table public.projects(id uuid primary key);
create table public.tasks(
 id uuid primary key,
 title text not null,
 project_id uuid references public.projects(id),
 assigned_to uuid references public.profiles(id),
 status text not null default 'To Do',
 archived_at timestamptz
);
create table public.employee_ledger(
 id uuid primary key default gen_random_uuid(),
 employee_id uuid not null references public.profiles(id),
 entry_type text not null,
 amount numeric(12,2) not null check(amount>=0),
 currency text not null default 'USD',
 salary_month date,
 payment_method text,
 project_id uuid references public.projects(id),
 notes text not null default '',
 paid_at date not null default current_date,
 reference text,
 status text not null default 'Pending',
 description text not null default '',
 created_at timestamptz not null default now()
);

-- Emulate the app's effective active-role database helper (not JWT user_metadata).
create or replace function public.phase6_app_actor_class() returns text
language sql stable security definer set search_path=''
as $$
 select case when p.status='active' then p.role else null end
 from public.profiles p where p.id=auth.uid() limit 1
$$;

alter table public.profiles enable row level security;
create policy ci_profiles_select on public.profiles for select to authenticated
 using (id=auth.uid() or public.phase6_app_actor_class()='admin');
alter table public.tasks enable row level security;
alter table public.employee_ledger enable row level security;
create policy ci_tasks_select on public.tasks for select to authenticated
 using (public.phase6_app_actor_class() in ('admin','project_manager')
  or assigned_to=auth.uid());
create policy ci_tasks_update on public.tasks for update to authenticated
 using (public.phase6_app_actor_class()='admin')
 with check (public.phase6_app_actor_class()='admin');
create policy ci_ledger_admin_select on public.employee_ledger for select to authenticated
 using (public.phase6_app_actor_class()='admin');
create policy ci_ledger_self_select on public.employee_ledger for select to authenticated
 using (public.phase6_app_actor_class()='employee' and employee_id=auth.uid());
create policy ci_ledger_admin_insert on public.employee_ledger for insert to authenticated
 with check (public.phase6_app_actor_class()='admin');
create policy ci_ledger_admin_delete on public.employee_ledger for delete to authenticated
 using (public.phase6_app_actor_class()='admin');

grant usage on schema public,auth to authenticated,anon;
grant execute on function auth.uid() to authenticated,anon;
grant execute on function public.phase6_app_actor_class() to authenticated,anon;
grant select on public.profiles to authenticated;
grant select,update on public.tasks to authenticated;
grant select,insert,delete on public.employee_ledger to authenticated;

insert into public.profiles(id,role,status) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','admin','active'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','project_manager','active'),
('cccccccc-cccc-4ccc-8ccc-cccccccccccc','employee','active'),
('dddddddd-dddd-4ddd-8ddd-dddddddddddd','employee','active'),
('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','client','active'),
('ffffffff-ffff-4fff-8fff-ffffffffffff','admin','inactive');
insert into public.projects(id) values('11111111-1111-4111-8111-111111111111');
insert into public.tasks(id,title,project_id,assigned_to,status) values
('22222222-2222-4222-8222-222222222222','Print layout','11111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc','To Do'),
('33333333-3333-4333-8333-333333333333','EPUB export','11111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc','Done'),
('44444444-4444-4444-8444-444444444444','Cover review','11111111-1111-4111-8111-111111111111','dddddddd-dddd-4ddd-8ddd-dddddddddddd','Done');
