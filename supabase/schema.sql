create extension if not exists pgcrypto;

do $$
begin
  create type public.app_role as enum ('admin', 'project_manager', 'employee', 'junior_assistant');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter type public.app_role add value if not exists 'manager';
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter type public.app_role add value if not exists 'client';
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
    'Archived',
    'Cancelled'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter type public.project_status add value if not exists 'Archived';
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
  due_date date,
  payment_month text,
  payment_year integer,
  payment_date date,
  notes text not null default '',
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_payments
add column if not exists due_date date,
add column if not exists payment_month text,
add column if not exists payment_year integer,
add column if not exists payment_date date,
add column if not exists notes text not null default '';

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
  recipient_id uuid references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  revision_request_id uuid,
  type text not null default 'general',
  title text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications
add column if not exists recipient_id uuid references public.profiles(id) on delete cascade,
add column if not exists project_id uuid references public.projects(id) on delete cascade,
add column if not exists revision_request_id uuid,
add column if not exists type text not null default 'general',
add column if not exists title text not null default 'Notification',
add column if not exists message text not null default '',
add column if not exists is_read boolean not null default false,
add column if not exists created_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notifications'
      and column_name = 'user_id'
  ) then
    update public.notifications
    set recipient_id = user_id
    where recipient_id is null;
  end if;
end $$;

delete from public.notifications
where recipient_id is null;

alter table public.notifications
alter column recipient_id set not null;

create table if not exists public.client_project_access (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (client_id, project_id)
);

create table if not exists public.revision_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  client_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text not null default '',
  instructions text not null default '',
  team_response text,
  priority text not null default 'Normal'
    check (priority in ('Normal', 'Important', 'Urgent')),
  status text not null default 'Submitted'
    check (status in (
      'Submitted',
      'Under Review',
      'Assigned',
      'In Progress',
      'Ready for Client Review',
      'Additional Revision Required',
      'Approved',
      'Completed'
    )),
  assigned_to uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.revision_requests
add column if not exists instructions text not null default '',
add column if not exists team_response text;

update public.revision_requests
set instructions = coalesce(nullif(instructions, ''), description, title)
where instructions = '';

create table if not exists public.revision_items (
  id uuid primary key default gen_random_uuid(),
  revision_request_id uuid not null references public.revision_requests(id) on delete cascade,
  sort_order integer not null default 1,
  page_reference text not null default '',
  instruction text not null,
  status text not null default 'Open'
    check (status in ('Open', 'Under Review', 'In Progress', 'Completed')),
  client_attachment_url text,
  team_response text,
  internal_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.revision_attachments (
  id uuid primary key default gen_random_uuid(),
  revision_request_id uuid not null references public.revision_requests(id) on delete cascade,
  revision_item_id uuid references public.revision_items(id) on delete cascade,
  file_name text not null,
  file_url text not null,
  file_type text not null default 'client_attachment',
  uploaded_by uuid not null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.revision_activity (
  id uuid primary key default gen_random_uuid(),
  revision_request_id uuid not null references public.revision_requests(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  previous_value text,
  new_value text,
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
drop index if exists public.notifications_user_id_idx;
create index if not exists notifications_recipient_id_idx on public.notifications(recipient_id);
create index if not exists notifications_project_id_idx on public.notifications(project_id);
create index if not exists notifications_revision_request_id_idx on public.notifications(revision_request_id);
create index if not exists client_project_access_client_id_idx on public.client_project_access(client_id);
create index if not exists client_project_access_project_id_idx on public.client_project_access(project_id);
create index if not exists revision_requests_project_id_idx on public.revision_requests(project_id);
create index if not exists revision_requests_client_id_idx on public.revision_requests(client_id);
create index if not exists revision_requests_assigned_to_idx on public.revision_requests(assigned_to);
create index if not exists revision_requests_status_idx on public.revision_requests(status);
create index if not exists revision_items_request_id_idx on public.revision_items(revision_request_id);
create index if not exists revision_attachments_request_id_idx on public.revision_attachments(revision_request_id);
create index if not exists revision_activity_request_id_idx on public.revision_activity(revision_request_id);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
exception
  when insufficient_privilege then null;
end $$;

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

drop trigger if exists touch_revision_requests_updated_at on public.revision_requests;
create trigger touch_revision_requests_updated_at
before update on public.revision_requests
for each row execute function public.touch_updated_at();

drop trigger if exists touch_revision_items_updated_at on public.revision_items;
create trigger touch_revision_items_updated_at
before update on public.revision_items
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
  select public.current_user_role()::text in ('admin', 'manager', 'project_manager');
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

create or replace function public.current_user_is_client()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role()::text = 'client';
$$;

create or replace function public.client_has_project_access(project_id uuid, client_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.client_project_access access
    join public.profiles client on client.id = access.client_id
    where access.project_id = client_has_project_access.project_id
      and access.client_id = client_has_project_access.client_id
      and client.role::text = 'client'
      and client.status = 'active'
  );
$$;

create or replace function public.user_can_access_revision_request(request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.revision_requests request
    where request.id = user_can_access_revision_request.request_id
      and (
        public.can_manage_all_projects()
        or request.assigned_to = auth.uid()
        or request.client_id = auth.uid()
      )
  );
$$;

create or replace view public.client_project_summaries as
select
  project.id,
  project.project_number,
  project.project_title,
  project.client_name,
  project.client_email,
  project.service_type,
  project.due_date,
  project.status,
  project.proof_pdf_link,
  project.final_print_pdf_link,
  project.final_ebook_link,
  project.cover_file_link,
  project.updated_at
from public.projects project
where public.client_has_project_access(project.id, auth.uid());

create or replace view public.client_revision_requests as
select
  request.id,
  request.project_id,
  request.client_id,
  request.title,
  request.description,
  request.instructions,
  request.team_response,
  request.priority,
  request.status,
  request.submitted_at,
  request.completed_at,
  request.created_at,
  request.updated_at
from public.revision_requests request
where request.client_id = auth.uid();

create or replace view public.client_revision_items as
select
  item.id,
  item.revision_request_id,
  item.sort_order,
  item.page_reference,
  item.instruction,
  item.status,
  item.client_attachment_url,
  item.team_response,
  item.created_at,
  item.updated_at
from public.revision_items item
join public.revision_requests request on request.id = item.revision_request_id
where request.client_id = auth.uid();

create or replace view public.client_revision_attachments as
select
  attachment.id,
  attachment.revision_request_id,
  attachment.revision_item_id,
  attachment.file_name,
  attachment.file_url,
  attachment.file_type,
  attachment.uploaded_by,
  attachment.created_at
from public.revision_attachments attachment
join public.revision_requests request on request.id = attachment.revision_request_id
where request.client_id = auth.uid();

create or replace view public.client_revision_activity as
select
  activity.id,
  activity.revision_request_id,
  activity.user_id,
  activity.action,
  activity.previous_value,
  activity.new_value,
  activity.created_at
from public.revision_activity activity
join public.revision_requests request on request.id = activity.revision_request_id
where request.client_id = auth.uid();

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

create or replace function public.create_project_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  project_name text := coalesce(new.project_title, 'Untitled Project');
begin
  if tg_op = 'INSERT' then
    if new.assigned_to is not null then
      insert into public.notifications (
        recipient_id,
        project_id,
        type,
        title,
        message
      )
      values (
        new.assigned_to,
        new.id,
        'project_assigned',
        'New Project Assigned',
        'You have been assigned a new project: ' || project_name || '.'
      );
    end if;

    return new;
  end if;

  if new.assigned_to is not null
     and old.assigned_to is distinct from new.assigned_to then
    insert into public.notifications (
      recipient_id,
      project_id,
      type,
      title,
      message
    )
    values (
      new.assigned_to,
      new.id,
      'project_assigned',
      'New Project Assigned',
      'You have been assigned a new project: ' || project_name || '.'
    );
  end if;

  if old.assigned_to is not null
     and old.assigned_to is distinct from new.assigned_to then
    insert into public.notifications (
      recipient_id,
      project_id,
      type,
      title,
      message
    )
    values (
      old.assigned_to,
      new.id,
      'project_reassigned',
      'Project Reassigned',
      'Project ' || project_name || ' was reassigned to another employee.'
    );
  end if;

  if old.status is distinct from new.status then
    insert into public.notifications (
      recipient_id,
      project_id,
      type,
      title,
      message
    )
    select
      p.id,
      new.id,
      'status_changed',
      'Project Status Updated',
      'Project ' || project_name ||
      ' status changed from ' || coalesce(old.status::text, 'No Status') ||
      ' to ' || coalesce(new.status::text, 'No Status') || '.'
    from public.profiles p
    where p.status = 'active'
      and p.role::text in ('admin', 'manager', 'project_manager');
  end if;

  return new;
end;
$$;

drop trigger if exists project_notifications_trigger on public.projects;
create trigger project_notifications_trigger
after insert or update on public.projects
for each row execute function public.create_project_notifications();

create or replace function public.notify_revision_watchers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  project_name text;
  client_name text;
begin
  select project_title into project_name
  from public.projects
  where id = new.project_id;

  select full_name into client_name
  from public.profiles
  where id = new.client_id;

  if tg_op = 'INSERT' then
    insert into public.revision_activity (revision_request_id, user_id, action, previous_value, new_value)
    values (new.id, auth.uid(), 'Revision submitted', null, new.title);

    insert into public.notifications (
      recipient_id,
      project_id,
      revision_request_id,
      type,
      title,
      message
    )
    select
      profile.id,
      new.project_id,
      new.id,
      'revision_submitted',
      'Client Revision Submitted',
      coalesce(client_name, 'A client') || ' submitted a revision request for ' ||
        coalesce(project_name, 'a project') || ': ' || new.title || '.'
    from public.profiles profile
    where profile.status = 'active'
      and profile.role::text in ('admin', 'manager', 'project_manager');

    return new;
  end if;

  if old.assigned_to is distinct from new.assigned_to and new.assigned_to is not null then
    insert into public.revision_activity (revision_request_id, user_id, action, previous_value, new_value)
    values (new.id, auth.uid(), 'Assigned employee changed', old.assigned_to::text, new.assigned_to::text);

    insert into public.notifications (
      recipient_id,
      project_id,
      revision_request_id,
      type,
      title,
      message
    )
    values (
      new.assigned_to,
      new.project_id,
      new.id,
      'revision_assigned',
      'Revision Assigned',
      'You have been assigned a revision request for ' || coalesce(project_name, 'a project') || '.'
    );
  end if;

  if old.status is distinct from new.status then
    insert into public.revision_activity (revision_request_id, user_id, action, previous_value, new_value)
    values (new.id, auth.uid(), 'Revision status changed', old.status, new.status);

    insert into public.notifications (
      recipient_id,
      project_id,
      revision_request_id,
      type,
      title,
      message
    )
    values (
      new.client_id,
      new.project_id,
      new.id,
      'revision_status_changed',
      'Revision Status Updated',
      'Your revision request for ' || coalesce(project_name, 'a project') ||
        ' changed from ' || old.status || ' to ' || new.status || '.'
    );

    if new.status in ('Additional Revision Required', 'Approved') then
      insert into public.notifications (
        recipient_id,
        project_id,
        revision_request_id,
        type,
        title,
        message
      )
      select distinct
        profile.id,
        new.project_id,
        new.id,
        case when new.status = 'Approved' then 'revision_approved' else 'additional_revision_required' end,
        case when new.status = 'Approved' then 'Revision Approved' else 'Additional Revision Required' end,
        coalesce(client_name, 'The client') || ' marked revision "' || new.title || '" as ' || new.status || '.'
      from public.profiles profile
      where profile.status = 'active'
        and (
          profile.role::text in ('admin', 'manager', 'project_manager')
          or profile.id = new.assigned_to
        );
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.set_revision_completed_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('Approved', 'Completed') and old.status is distinct from new.status and new.completed_at is null then
    new.completed_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists set_revision_completed_at_trigger on public.revision_requests;
create trigger set_revision_completed_at_trigger
before update on public.revision_requests
for each row execute function public.set_revision_completed_at();

drop trigger if exists revision_request_notifications_trigger on public.revision_requests;
create trigger revision_request_notifications_trigger
after insert or update on public.revision_requests
for each row execute function public.notify_revision_watchers();

create or replace function public.mark_project_revision_requested()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.projects
  set
    status = 'Revision Requested',
    updated_at = now()
  where id = new.project_id
    and status is distinct from 'Revision Requested';

  return new;
end;
$$;

drop trigger if exists mark_project_revision_requested_trigger on public.revision_requests;
create trigger mark_project_revision_requested_trigger
after insert on public.revision_requests
for each row execute function public.mark_project_revision_requested();

create or replace function public.notify_revised_proof_uploaded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.revision_requests%rowtype;
  project_name text;
begin
  if new.file_type <> 'revised_proof' then
    return new;
  end if;

  select * into request_row
  from public.revision_requests
  where id = new.revision_request_id;

  select project_title into project_name
  from public.projects
  where id = request_row.project_id;

  insert into public.revision_activity (revision_request_id, user_id, action, previous_value, new_value)
  values (new.revision_request_id, new.uploaded_by, 'Revised proof uploaded', null, new.file_name);

  insert into public.notifications (
    recipient_id,
    project_id,
    revision_request_id,
    type,
    title,
    message
  )
  values (
    request_row.client_id,
    request_row.project_id,
    request_row.id,
    'revised_proof_uploaded',
    'Revised Proof Uploaded',
    'A revised proof was uploaded for ' || coalesce(project_name, 'your project') || '.'
  );

  return new;
end;
$$;

drop trigger if exists revised_proof_uploaded_trigger on public.revision_attachments;
create trigger revised_proof_uploaded_trigger
after insert on public.revision_attachments
for each row execute function public.notify_revised_proof_uploaded();

create or replace function public.client_respond_revision(request_id uuid, decision text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.revision_requests%rowtype;
  next_status text;
begin
  if decision not in ('Approved', 'Additional Revision Required') then
    raise exception 'Invalid revision decision.';
  end if;

  select * into request_row
  from public.revision_requests
  where id = request_id
    and client_id = auth.uid()
  for update;

  if not found then
    raise exception 'Revision request not found.';
  end if;

  if request_row.status <> 'Ready for Client Review' then
    raise exception 'This revision is not ready for client review yet.';
  end if;

  next_status := decision;

  update public.revision_requests
  set
    status = next_status,
    completed_at = case when next_status = 'Approved' then now() else completed_at end
  where id = request_id;
end;
$$;

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

create or replace function public.find_login_email(login_name text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with normalized as (
    select lower(trim(login_name)) as value
  )
  select p.email
  from public.profiles p
  cross join normalized n
  where p.status = 'active'
    and n.value <> ''
    and (
      lower(p.full_name) = n.value
      or lower(split_part(p.full_name, ' ', 1)) = n.value
      or lower(p.email) = n.value
    )
  order by
    case
      when lower(p.full_name) = n.value then 1
      when lower(split_part(p.full_name, ' ', 1)) = n.value then 2
      when lower(p.email) = n.value then 3
      else 4
    end,
    p.created_at
  limit 1;
$$;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_payments enable row level security;
alter table public.revision_notes enable row level security;
alter table public.project_notes enable row level security;
alter table public.activity_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.client_project_access enable row level security;
alter table public.revision_requests enable row level security;
alter table public.revision_items enable row level security;
alter table public.revision_attachments enable row level security;
alter table public.revision_activity enable row level security;
alter table public.team_members enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.project_payments to authenticated;
grant select, insert, update, delete on public.revision_notes to authenticated;
grant select, insert, update, delete on public.project_notes to authenticated;
grant select, insert, update, delete on public.activity_logs to authenticated;
grant select, insert, update, delete on public.notifications to authenticated;
grant select, insert, update, delete on public.client_project_access to authenticated;
grant select, insert, update, delete on public.revision_requests to authenticated;
grant select, insert, update, delete on public.revision_items to authenticated;
grant select, insert, update, delete on public.revision_attachments to authenticated;
grant select, insert, update, delete on public.revision_activity to authenticated;
grant select, insert, update, delete on public.team_members to authenticated;
grant select on public.client_project_summaries to authenticated;
grant select on public.client_revision_requests to authenticated;
grant select on public.client_revision_items to authenticated;
grant select on public.client_revision_attachments to authenticated;
grant select on public.client_revision_activity to authenticated;

revoke all on public.profiles from anon;
revoke all on public.projects from anon;
revoke all on public.project_payments from anon;
revoke all on public.revision_notes from anon;
revoke all on public.project_notes from anon;
revoke all on public.activity_logs from anon;
revoke all on public.notifications from anon;
revoke all on public.client_project_access from anon;
revoke all on public.revision_requests from anon;
revoke all on public.revision_items from anon;
revoke all on public.revision_attachments from anon;
revoke all on public.revision_activity from anon;
revoke all on public.team_members from anon;

revoke all on function public.current_user_role() from public;
revoke all on function public.can_manage_all_projects() from public;
revoke all on function public.project_is_visible(public.projects) from public;
revoke all on function public.current_user_is_client() from public;
revoke all on function public.client_has_project_access(uuid, uuid) from public;
revoke all on function public.user_can_access_revision_request(uuid) from public;
revoke all on function public.find_login_email(text) from public;
revoke all on function public.create_project_notifications() from public;
revoke all on function public.notify_revision_watchers() from public;
revoke all on function public.set_revision_completed_at() from public;
revoke all on function public.notify_revised_proof_uploaded() from public;
revoke all on function public.client_respond_revision(uuid, text) from public;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.can_manage_all_projects() to authenticated;
grant execute on function public.project_is_visible(public.projects) to authenticated;
grant execute on function public.current_user_is_client() to authenticated;
grant execute on function public.client_has_project_access(uuid, uuid) to authenticated;
grant execute on function public.user_can_access_revision_request(uuid) to authenticated;
grant execute on function public.find_login_email(text) to anon, authenticated;
grant execute on function public.client_respond_revision(uuid, text) to authenticated;

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
drop policy if exists "Users can view their own notifications" on public.notifications;
create policy "Users can view their own notifications"
on public.notifications
for select
to authenticated
using (recipient_id = auth.uid());

drop policy if exists "Users can update own notifications" on public.notifications;
drop policy if exists "Users can update their own notifications" on public.notifications;
create policy "Users can update their own notifications"
on public.notifications
for update
to authenticated
using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());

drop policy if exists "Managers can create notifications" on public.notifications;
drop policy if exists "Users can delete own notifications" on public.notifications;
drop policy if exists "Users can delete their own notifications" on public.notifications;
create policy "Users can delete their own notifications"
on public.notifications
for delete
to authenticated
using (recipient_id = auth.uid());

drop policy if exists "Managers can read client project access" on public.client_project_access;
create policy "Managers can read client project access"
on public.client_project_access
for select
to authenticated
using (public.can_manage_all_projects() or client_id = auth.uid());

drop policy if exists "Managers can create client project access" on public.client_project_access;
create policy "Managers can create client project access"
on public.client_project_access
for insert
to authenticated
with check (public.can_manage_all_projects());

drop policy if exists "Managers can update client project access" on public.client_project_access;
create policy "Managers can update client project access"
on public.client_project_access
for update
to authenticated
using (public.can_manage_all_projects())
with check (public.can_manage_all_projects());

drop policy if exists "Managers can delete client project access" on public.client_project_access;
create policy "Managers can delete client project access"
on public.client_project_access
for delete
to authenticated
using (public.can_manage_all_projects());

drop policy if exists "Team can read assigned revision requests" on public.revision_requests;
create policy "Team can read assigned revision requests"
on public.revision_requests
for select
to authenticated
using (public.can_manage_all_projects() or assigned_to = auth.uid());

drop policy if exists "Clients can read own revision requests" on public.revision_requests;
create policy "Clients can read own revision requests"
on public.revision_requests
for select
to authenticated
using (client_id = auth.uid());

drop policy if exists "Clients can submit assigned project revisions" on public.revision_requests;
create policy "Clients can submit assigned project revisions"
on public.revision_requests
for insert
to authenticated
with check (
  client_id = auth.uid()
  and assigned_to is null
  and status = 'Submitted'
  and public.client_has_project_access(project_id, auth.uid())
);

drop policy if exists "Managers can create revision requests" on public.revision_requests;
create policy "Managers can create revision requests"
on public.revision_requests
for insert
to authenticated
with check (public.can_manage_all_projects());

drop policy if exists "Team can update revision requests" on public.revision_requests;
create policy "Team can update revision requests"
on public.revision_requests
for update
to authenticated
using (public.can_manage_all_projects() or assigned_to = auth.uid())
with check (public.can_manage_all_projects() or assigned_to = auth.uid());

drop policy if exists "Admins can delete revision requests" on public.revision_requests;
create policy "Admins can delete revision requests"
on public.revision_requests
for delete
to authenticated
using (public.current_user_role() = 'admin');

drop policy if exists "Team can read revision items" on public.revision_items;
create policy "Team can read revision items"
on public.revision_items
for select
to authenticated
using (
  exists (
    select 1
    from public.revision_requests request
    where request.id = revision_items.revision_request_id
      and (public.can_manage_all_projects() or request.assigned_to = auth.uid())
  )
);

drop policy if exists "Clients can create revision items" on public.revision_items;
create policy "Clients can create revision items"
on public.revision_items
for insert
to authenticated
with check (
  status = 'Open'
  and coalesce(team_response, '') = ''
  and coalesce(internal_note, '') = ''
  and exists (
    select 1
    from public.revision_requests request
    where request.id = revision_items.revision_request_id
      and request.client_id = auth.uid()
      and request.status = 'Submitted'
  )
);

drop policy if exists "Team can create revision items" on public.revision_items;
create policy "Team can create revision items"
on public.revision_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.revision_requests request
    where request.id = revision_items.revision_request_id
      and (public.can_manage_all_projects() or request.assigned_to = auth.uid())
  )
);

drop policy if exists "Team can update revision items" on public.revision_items;
create policy "Team can update revision items"
on public.revision_items
for update
to authenticated
using (
  exists (
    select 1
    from public.revision_requests request
    where request.id = revision_items.revision_request_id
      and (public.can_manage_all_projects() or request.assigned_to = auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.revision_requests request
    where request.id = revision_items.revision_request_id
      and (public.can_manage_all_projects() or request.assigned_to = auth.uid())
  )
);

drop policy if exists "Admins can delete revision items" on public.revision_items;
create policy "Admins can delete revision items"
on public.revision_items
for delete
to authenticated
using (public.current_user_role() = 'admin');

drop policy if exists "Team can read revision attachments" on public.revision_attachments;
create policy "Team can read revision attachments"
on public.revision_attachments
for select
to authenticated
using (
  exists (
    select 1
    from public.revision_requests request
    where request.id = revision_attachments.revision_request_id
      and (public.can_manage_all_projects() or request.assigned_to = auth.uid())
  )
);

drop policy if exists "Clients can create revision attachments" on public.revision_attachments;
create policy "Clients can create revision attachments"
on public.revision_attachments
for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and exists (
    select 1
    from public.revision_requests request
    where request.id = revision_attachments.revision_request_id
      and request.client_id = auth.uid()
      and request.status = 'Submitted'
  )
);

drop policy if exists "Team can create revision attachments" on public.revision_attachments;
create policy "Team can create revision attachments"
on public.revision_attachments
for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and exists (
    select 1
    from public.revision_requests request
    where request.id = revision_attachments.revision_request_id
      and (public.can_manage_all_projects() or request.assigned_to = auth.uid())
  )
);

drop policy if exists "Team can read revision activity" on public.revision_activity;
create policy "Team can read revision activity"
on public.revision_activity
for select
to authenticated
using (
  exists (
    select 1
    from public.revision_requests request
    where request.id = revision_activity.revision_request_id
      and (public.can_manage_all_projects() or request.assigned_to = auth.uid())
  )
);

drop policy if exists "Clients can create own revision activity" on public.revision_activity;
create policy "Clients can create own revision activity"
on public.revision_activity
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.revision_requests request
    where request.id = revision_activity.revision_request_id
      and request.client_id = auth.uid()
  )
);

drop policy if exists "Team can create revision activity" on public.revision_activity;
create policy "Team can create revision activity"
on public.revision_activity
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.revision_requests request
    where request.id = revision_activity.revision_request_id
      and (public.can_manage_all_projects() or request.assigned_to = auth.uid())
  )
);

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

insert into storage.buckets (id, name, public)
values ('revision-files', 'revision-files', false)
on conflict (id) do nothing;

drop policy if exists "Clients can read own revision files" on storage.objects;
create policy "Clients can read own revision files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'revision-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Team can read assigned revision files" on storage.objects;
create policy "Team can read assigned revision files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'revision-files'
  and (
    public.can_manage_all_projects()
    or exists (
      select 1
      from public.revision_requests request
      where request.id::text = (storage.foldername(name))[3]
        and request.assigned_to = auth.uid()
    )
  )
);

drop policy if exists "Clients can upload own revision files" on storage.objects;
create policy "Clients can upload own revision files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'revision-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Team can upload assigned revision files" on storage.objects;
create policy "Team can upload assigned revision files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'revision-files'
  and (
    public.can_manage_all_projects()
    or exists (
      select 1
      from public.revision_requests request
      where request.id::text = (storage.foldername(name))[3]
        and request.assigned_to = auth.uid()
    )
  )
);

drop policy if exists "Admins can delete revision files" on storage.objects;
create policy "Admins can delete revision files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'revision-files'
  and public.current_user_role() = 'admin'
);

-- Starter team rows. When a matching email is created in Supabase Auth, a profile row
-- is created automatically using the role below. Unknown emails default to employee.
insert into public.team_members (full_name, email, role, phone, status)
values
  ('Tahir', 'tahir@manuscriptheaven.com', 'admin', '', 'active'),
  ('Atia', 'atia@manuscriptheaven.com', 'project_manager', '', 'active'),
  ('Amelia Carter', 'amelia@example.com', 'client', '', 'active'),
  ('Zain', 'hafizainali313@gmail.com', 'employee', '', 'active'),
  ('Hamza', 'hamza@manuscriptheaven.com', 'employee', '', 'active'),
  ('Irfan', 'irfan@manuscriptheaven.com', 'junior_assistant', '', 'active')
on conflict (email) do update set
  full_name = excluded.full_name,
  role = excluded.role,
  phone = excluded.phone,
  status = excluded.status;

update public.profiles p
set
  full_name = t.full_name,
  role = t.role,
  phone = t.phone,
  status = t.status
from public.team_members t
where lower(p.email) = lower(t.email);
