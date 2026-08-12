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

create policy "Authenticated users can read stage history"
  on public.project_stage_history for select
  to authenticated using (true);

create policy "Authenticated users can insert stage history"
  on public.project_stage_history for insert
  to authenticated with check (true);

-- Indexes for performance
create index if not exists project_stage_history_project_id_idx on public.project_stage_history(project_id);
create index if not exists projects_stage_status_idx on public.projects(stage_status);
