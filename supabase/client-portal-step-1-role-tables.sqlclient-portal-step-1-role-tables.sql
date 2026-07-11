create extension if not exists pgcrypto;

do $$
begin
  alter type public.app_role add value if not exists 'client';
exception
  when duplicate_object then null;
end $$;

alter table public.notifications
add column if not exists revision_request_id uuid;

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

alter table public.client_project_access enable row level security;
alter table public.revision_requests enable row level security;
alter table public.revision_items enable row level security;
alter table public.revision_attachments enable row level security;
alter table public.revision_activity enable row level security;

grant select, insert, update, delete on public.client_project_access to authenticated;
grant select, insert, update, delete on public.revision_requests to authenticated;
grant select, insert, update, delete on public.revision_items to authenticated;
grant select, insert, update, delete on public.revision_attachments to authenticated;
grant select, insert, update, delete on public.revision_activity to authenticated;

revoke all on public.client_project_access from anon;
revoke all on public.revision_requests from anon;
revoke all on public.revision_items from anon;
revoke all on public.revision_attachments from anon;
revoke all on public.revision_activity from anon;
