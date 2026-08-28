-- Time-Aware 8-Stage Production Timeline & Client Approval Workflow Schema
-- manuscript-heaven database migration

-- 1. Ensure projects table has clock fields, stage states, stage history, and workflow settings
alter table public.projects
add column if not exists stage_status text not null default 'ACTIVE',
add column if not exists stage_started_at timestamptz default now(),
add column if not exists stage_due_at timestamptz,
add column if not exists stage_completed_at timestamptz,
add column if not exists final_due_at timestamptz,
add column if not exists production_time_used numeric not null default 0,
add column if not exists client_wait_time numeric not null default 0,
add column if not exists revision_count integer not null default 0,
add column if not exists stage_states jsonb default '{}'::jsonb,
add column if not exists workflow_settings jsonb default '{"files_received_days": 2, "design_concept_days": 3, "design_concept_revision_days": 2, "print_version_days": 5, "print_version_revision_days": 2, "ebook_version_days": 5, "ebook_version_revision_days": 2, "final_delivery_days": 2, "exclude_weekends": true}'::jsonb;

-- 2. Stage history audit log table
create table if not exists public.project_stage_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  stage text not null,
  previous_stage text,
  status text not null,
  started_at timestamptz,
  paused_at timestamptz,
  resumed_at timestamptz,
  completed_at timestamptz,
  due_at timestamptz,
  active_seconds numeric default 0,
  client_wait_seconds numeric default 0,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  notes text,
  created_at timestamptz not null default now()
);

-- RLS policies for stage history
alter table public.project_stage_history enable row level security;

drop policy if exists "Authenticated users can read stage history" on public.project_stage_history;
create policy "Authenticated users can read stage history"
  on public.project_stage_history for select
  to authenticated using (true);

drop policy if exists "Authenticated users can insert stage history" on public.project_stage_history;
create policy "Authenticated users can insert stage history"
  on public.project_stage_history for insert
  to authenticated with check (true);

-- Indexes for performance
create index if not exists project_stage_history_project_id_idx on public.project_stage_history(project_id);
create index if not exists projects_stage_status_idx on public.projects(stage_status);

-- 3. Stored Procedure: Client Approves Project Milestone
create or replace function public.client_approve_project_milestone(project_id uuid, milestone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  project_row public.projects;
  next_stage text;
  days_alloc integer := 5;
begin
  select * into project_row
  from public.projects p
  where p.id = client_approve_project_milestone.project_id;

  if not found or not public.client_has_project_access(project_id, auth.uid()) then
    raise exception 'Project is not available for this client.';
  end if;

  if milestone = 'concept' then
    next_stage := 'Print Version';
    days_alloc := coalesce((project_row.workflow_settings->>'print_version_days')::integer, 5);
    update public.projects
    set design_concept_approval_date = current_date,
        current_stage = next_stage,
        stage_status = 'ACTIVE',
        waiting_on = 'Manuscript Heaven',
        timeline_status = 'Active',
        stage_started_at = now(),
        stage_due_at = current_date + days_alloc,
        client_action_required = null,
        updated_at = now()
    where id = project_id;
  elsif milestone = 'print' then
    next_stage := 'Ebook Version';
    days_alloc := coalesce((project_row.workflow_settings->>'ebook_version_days')::integer, 5);
    update public.projects
    set print_version_approval_date = current_date,
        current_stage = next_stage,
        stage_status = 'ACTIVE',
        waiting_on = 'Manuscript Heaven',
        timeline_status = 'Active',
        stage_started_at = now(),
        stage_due_at = current_date + days_alloc,
        client_action_required = null,
        updated_at = now()
    where id = project_id;
  elsif milestone = 'ebook' then
    next_stage := 'Final Delivery';
    days_alloc := coalesce((project_row.workflow_settings->>'final_delivery_days')::integer, 2);
    update public.projects
    set ebook_approval_date = current_date,
        current_stage = next_stage,
        stage_status = 'ACTIVE',
        waiting_on = 'Manuscript Heaven',
        timeline_status = 'Active',
        stage_started_at = now(),
        stage_due_at = current_date + days_alloc,
        client_action_required = null,
        updated_at = now()
    where id = project_id;
  end if;

  -- Log Stage History
  insert into public.project_stage_history(project_id, stage, status, started_at, actor_id, action, notes)
  values (project_id, next_stage, 'ACTIVE', now(), auth.uid(), 'Client approved ' || milestone || ' milestone', 'Activated ' || next_stage || ' (' || days_alloc || ' production days)');

  -- Send System Notification
  insert into public.notifications(recipient_id, project_id, type, title, message)
  select
    p.id,
    project_id,
    'milestone_approval',
    'Milestone Approved: ' || project_row.project_title,
    'Client approved the ' || milestone || ' milestone. ' || next_stage || ' is now active.'
  from public.profiles p
  where p.status = 'active'
    and (
      p.role::text in ('admin', 'manager', 'project_manager')
      or p.id = project_row.assigned_to
      or p.id = project_row.project_manager
    );
end;
$$;

grant execute on function public.client_approve_project_milestone(uuid, text) to authenticated;

-- 4. In-Flight Stage Skip Requests Table
create table if not exists public.project_stage_skips (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  stage text not null,
  requested_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  reason text not null,
  status text not null default 'PENDING',
  client_response_at timestamptz,
  client_notes text
);

alter table public.project_stage_skips enable row level security;

drop policy if exists "Authenticated users can read stage skip requests" on public.project_stage_skips;
create policy "Authenticated users can read stage skip requests"
  on public.project_stage_skips for select
  to authenticated using (true);

drop policy if exists "Authenticated users can insert/update stage skip requests" on public.project_stage_skips;
create policy "Authenticated users can insert/update stage skip requests"
  on public.project_stage_skips for all
  to authenticated using (true);

-- 5. Emergency Admin Workflow Overrides Audit Log Table
create table if not exists public.admin_workflow_overrides (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete set null,
  previous_stage text not null,
  new_stage text not null,
  reason text not null,
  explanation text not null,
  created_at timestamptz not null default now()
);

alter table public.admin_workflow_overrides enable row level security;

drop policy if exists "Authenticated users can read admin workflow overrides" on public.admin_workflow_overrides;
create policy "Authenticated users can read admin workflow overrides"
  on public.admin_workflow_overrides for select
  to authenticated using (true);

drop policy if exists "Admin users can insert admin workflow overrides" on public.admin_workflow_overrides;
create policy "Admin users can insert admin workflow overrides"
  on public.admin_workflow_overrides for insert
  to authenticated with check (true);

