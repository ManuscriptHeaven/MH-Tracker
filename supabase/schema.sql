create extension if not exists pgcrypto;

do $$
begin
  create type public.app_role as enum ('admin', 'project_manager', 'employee', 'junior_assistant');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.project_priority as enum ('Low', 'Normal', 'High', 'Urgent');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.project_status as enum (
    'New',
    'Waiting for Files',
    'Ready to Start',
    'In Progress',
    'Formatting',
    'Cover Design',
    'eBook Conversion',
    'First Proof Ready',
    'Sent to Client',
    'Client Review',
    'Revision Requested',
    'In Revision',
    'Final QA',
    'Ready for Delivery',
    'Delivered',
    'On Hold',
    'Cancelled'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.payment_status as enum (
    'Not Started',
    'Advance Paid',
    'Partially Paid',
    'Fully Paid',
    'Pending',
    'Refunded'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.revision_status as enum ('Pending', 'In Progress', 'Completed');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.note_type as enum ('general', 'internal', 'client_instruction', 'qa', 'delivery', 'work');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  role public.app_role not null default 'employee',
  avatar_url text,
  phone text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create sequence if not exists public.projects_project_number_seq start 1001;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  project_number text not null unique default ('MH-' || nextval('public.projects_project_number_seq'::regclass)),
  client_name text not null,
  client_email text,
  project_title text not null,
  service_type text not null,
  genre text,
  trim_size text,
  page_count integer not null default 0,
  word_count integer not null default 0,
  image_count integer not null default 0,
  platform text,
  assigned_to uuid references public.profiles(id) on delete set null,
  project_manager uuid references public.profiles(id) on delete set null,
  priority public.project_priority not null default 'Normal',
  start_date date,
  due_date date not null,
  internal_deadline date,
  delivery_date date,
  status public.project_status not null default 'New',
  general_notes text not null default '',
  internal_notes text not null default '',
  client_instructions text not null default '',
  qa_notes text not null default '',
  delivery_notes text not null default '',
  source_file_link text not null default '',
  drive_folder_link text not null default '',
  client_brief_link text not null default '',
  proof_pdf_link text not null default '',
  final_print_pdf_link text not null default '',
  final_ebook_link text not null default '',
  cover_file_link text not null default '',
  other_links text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_payments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  total_price numeric(10, 2) not null default 0,
  advance_paid numeric(10, 2) not null default 0,
  remaining_balance numeric(10, 2) generated always as (greatest(total_price - advance_paid, 0)) stored,
  payment_status public.payment_status not null default 'Not Started',
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.revision_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  revision_number integer not null,
  note text not null,
  status public.revision_status not null default 'Pending',
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  note_type public.note_type not null default 'work',
  note text not null,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  action text not null,
  old_value text,
  new_value text,
  user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  title text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null unique,
  role public.app_role not null default 'employee',
  phone text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists projects_assigned_to_idx on public.projects(assigned_to);
create index if not exists projects_project_manager_idx on public.projects(project_manager);
create index if not exists projects_due_date_idx on public.projects(due_date);
create index if not exists projects_status_idx on public.projects(status);
create index if not exists project_payments_project_id_idx on public.project_payments(project_id);
create index if not exists project_payments_payment_status_idx on public.project_payments(payment_status);
create index if not exists revision_notes_project_id_idx on public.revision_notes(project_id);
create index if not exists project_notes_project_id_idx on public.project_notes(project_id);
create index if not exists activity_logs_project_id_idx on public.activity_logs(project_id);
create index if not exists notifications_user_id_idx on public.notifications(user_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_projects_updated_at on public.projects;
create trigger touch_projects_updated_at
before update on public.projects
for each row execute function public.touch_updated_at();

drop trigger if exists touch_revision_notes_updated_at on public.revision_notes;
create trigger touch_revision_notes_updated_at
before update on public.revision_notes
for each row execute function public.touch_updated_at();

drop trigger if exists touch_project_payments_updated_at on public.project_payments;
create trigger touch_project_payments_updated_at
before update on public.project_payments
for each row execute function public.touch_updated_at();

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
    and status = 'active'
  limit 1;
$$;

create or replace function public.can_manage_all_projects()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin', 'project_manager');
$$;

create or replace function public.project_is_visible(project_row public.projects)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.can_manage_all_projects()
    or project_row.assigned_to = auth.uid()
    or project_row.project_manager = auth.uid();
$$;

create or replace function public.log_project_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    insert into public.activity_logs (project_id, action, old_value, new_value, user_id)
    values (new.id, 'Status changed', old.status::text, new.status::text, auth.uid());
  end if;

  if old.assigned_to is distinct from new.assigned_to then
    insert into public.activity_logs (project_id, action, old_value, new_value, user_id)
    values (new.id, 'Assigned to employee', old.assigned_to::text, new.assigned_to::text, auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists log_project_status_change on public.projects;
create trigger log_project_status_change
after update on public.projects
for each row execute function public.log_project_status_change();

create or replace function public.create_profile_for_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_team public.team_members%rowtype;
  profile_name text;
  profile_role public.app_role := 'employee';
begin
  if new.email is null then
    return new;
  end if;

  select *
  into matched_team
  from public.team_members
  where lower(email) = lower(new.email)
  limit 1;

  profile_name := coalesce(
    matched_team.full_name,
    new.raw_user_meta_data ->> 'full_name',
    split_part(new.email, '@', 1)
  );
  profile_role := coalesce(matched_team.role, 'employee'::public.app_role);

  insert into public.profiles (id, full_name, email, role, phone, status)
  values (new.id, profile_name, new.email, profile_role, matched_team.phone, 'active')
  on conflict (id) do update set
    full_name = excluded.full_name,
    email = excluded.email,
    role = excluded.role,
    phone = excluded.phone,
    status = excluded.status;

  return new;
end;
$$;

drop trigger if exists create_profile_after_auth_user_created on auth.users;
create trigger create_profile_after_auth_user_created
after insert on auth.users
for each row execute function public.create_profile_for_new_auth_user();

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_payments enable row level security;
alter table public.revision_notes enable row level security;
alter table public.project_notes enable row level security;
alter table public.activity_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.team_members enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.project_payments to authenticated;
grant select, insert, update, delete on public.revision_notes to authenticated;
grant select, insert, update, delete on public.project_notes to authenticated;
grant select, insert, update, delete on public.activity_logs to authenticated;
grant select, insert, update, delete on public.notifications to authenticated;
grant select, insert, update, delete on public.team_members to authenticated;

revoke all on public.profiles from anon;
revoke all on public.projects from anon;
revoke all on public.project_payments from anon;
revoke all on public.revision_notes from anon;
revoke all on public.project_notes from anon;
revoke all on public.activity_logs from anon;
revoke all on public.notifications from anon;
revoke all on public.team_members from anon;

revoke all on function public.current_user_role() from public;
revoke all on function public.can_manage_all_projects() from public;
revoke all on function public.project_is_visible(public.projects) from public;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.can_manage_all_projects() to authenticated;
grant execute on function public.project_is_visible(public.projects) to authenticated;

drop policy if exists "Profiles are visible to owner and managers" on public.profiles;
create policy "Profiles are visible to owner and managers"
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.can_manage_all_projects());

drop policy if exists "Admins can create profiles" on public.profiles;
create policy "Admins can create profiles"
on public.profiles
for insert
to authenticated
with check (public.current_user_role() = 'admin');

drop policy if exists "Admins can update profiles" on public.profiles;
create policy "Admins can update profiles"
on public.profiles
for update
to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

drop policy if exists "Admins can delete profiles" on public.profiles;
create policy "Admins can delete profiles"
on public.profiles
for delete
to authenticated
using (public.current_user_role() = 'admin');

drop policy if exists "Visible projects can be read" on public.projects;
create policy "Visible projects can be read"
on public.projects
for select
to authenticated
using (public.project_is_visible(projects));

drop policy if exists "Managers can create projects" on public.projects;
create policy "Managers can create projects"
on public.projects
for insert
to authenticated
with check (public.can_manage_all_projects() and created_by = auth.uid());

drop policy if exists "Managers and assigned users can update projects" on public.projects;
create policy "Managers and assigned users can update projects"
on public.projects
for update
to authenticated
using (public.can_manage_all_projects() or assigned_to = auth.uid() or project_manager = auth.uid())
with check (public.can_manage_all_projects() or assigned_to = auth.uid() or project_manager = auth.uid());

drop policy if exists "Admins can delete projects" on public.projects;
create policy "Admins can delete projects"
on public.projects
for delete
to authenticated
using (public.current_user_role() = 'admin');

drop policy if exists "Managers can read project payments" on public.project_payments;
create policy "Managers can read project payments"
on public.project_payments
for select
to authenticated
using (public.can_manage_all_projects());

drop policy if exists "Managers can create project payments" on public.project_payments;
create policy "Managers can create project payments"
on public.project_payments
for insert
to authenticated
with check (public.can_manage_all_projects());

drop policy if exists "Managers can update project payments" on public.project_payments;
create policy "Managers can update project payments"
on public.project_payments
for update
to authenticated
using (public.can_manage_all_projects())
with check (public.can_manage_all_projects());

drop policy if exists "Admins can delete project payments" on public.project_payments;
create policy "Admins can delete project payments"
on public.project_payments
for delete
to authenticated
using (public.current_user_role() = 'admin');

drop policy if exists "Visible project revisions can be read" on public.revision_notes;
create policy "Visible project revisions can be read"
on public.revision_notes
for select
to authenticated
using (
  exists (
    select 1
    from public.projects p
    where p.id = revision_notes.project_id
      and public.project_is_visible(p)
  )
);

drop policy if exists "Visible users can add revisions" on public.revision_notes;
create policy "Visible users can add revisions"
on public.revision_notes
for insert
to authenticated
with check (
  added_by = auth.uid()
  and exists (
    select 1
    from public.projects p
    where p.id = revision_notes.project_id
      and public.project_is_visible(p)
  )
);

drop policy if exists "Managers can update revisions" on public.revision_notes;
create policy "Managers can update revisions"
on public.revision_notes
for update
to authenticated
using (public.can_manage_all_projects() or added_by = auth.uid())
with check (public.can_manage_all_projects() or added_by = auth.uid());

drop policy if exists "Visible project notes can be read" on public.project_notes;
create policy "Visible project notes can be read"
on public.project_notes
for select
to authenticated
using (
  exists (
    select 1
    from public.projects p
    where p.id = project_notes.project_id
      and public.project_is_visible(p)
  )
);

drop policy if exists "Visible users can add notes" on public.project_notes;
create policy "Visible users can add notes"
on public.project_notes
for insert
to authenticated
with check (
  added_by = auth.uid()
  and exists (
    select 1
    from public.projects p
    where p.id = project_notes.project_id
      and public.project_is_visible(p)
  )
);

drop policy if exists "Visible activity can be read" on public.activity_logs;
create policy "Visible activity can be read"
on public.activity_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.projects p
    where p.id = activity_logs.project_id
      and public.project_is_visible(p)
  )
);

drop policy if exists "Visible users can add activity" on public.activity_logs;
create policy "Visible users can add activity"
on public.activity_logs
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.projects p
    where p.id = activity_logs.project_id
      and public.project_is_visible(p)
  )
);

drop policy if exists "Users can read own notifications" on public.notifications;
create policy "Users can read own notifications"
on public.notifications
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can update own notifications" on public.notifications;
create policy "Users can update own notifications"
on public.notifications
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Managers can create notifications" on public.notifications;
create policy "Managers can create notifications"
on public.notifications
for insert
to authenticated
with check (public.can_manage_all_projects());

drop policy if exists "Managers can read team members" on public.team_members;
create policy "Managers can read team members"
on public.team_members
for select
to authenticated
using (public.can_manage_all_projects());

drop policy if exists "Admins can manage team members" on public.team_members;
create policy "Admins can manage team members"
on public.team_members
for all
to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

-- Starter team rows. When a matching email is created in Supabase Auth, a profile row
-- is created automatically using the role below. Unknown emails default to employee.
insert into public.team_members (full_name, email, role, phone, status)
values
  ('Tahir', 'tahir@manuscriptheaven.com', 'admin', '', 'active'),
  ('Atia', 'atia@manuscriptheaven.com', 'project_manager', '', 'active'),
  ('Zain', 'zain@manuscriptheaven.com', 'employee', '', 'active'),
  ('Hamza', 'hamza@manuscriptheaven.com', 'employee', '', 'active'),
  ('Irfan', 'irfan@manuscriptheaven.com', 'junior_assistant', '', 'active')
on conflict (email) do nothing;
