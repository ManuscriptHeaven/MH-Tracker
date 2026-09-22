-- SaaS boundary foundation.
-- Adds a tenant root, membership model, restrictive root-object RLS guards,
-- append-only event outbox, API-client identities and outbound webhook outbox.
-- Existing Phase 6 authorization remains authoritative inside each workspace.

begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  status text not null default 'active' check (status in ('active','suspended','archived')),
  created_by uuid null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$')
);

create unique index if not exists idx_workspaces_slug_lower
  on public.workspaces(lower(slug));

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner','admin','member','client')),
  status text not null default 'active' check (status in ('active','invited','suspended')),
  joined_at timestamptz not null default now(),
  primary key(workspace_id,user_id)
);

create index if not exists idx_workspace_members_user_active
  on public.workspace_members(user_id,workspace_id)
  where status='active';

create or replace function private.tenant_is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path=pg_catalog,pg_temp
as $fn$
  select public.phase6_auth_uid() is not null
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id=p_workspace_id
        and wm.user_id=public.phase6_auth_uid()
        and wm.status='active'
    )
$fn$;

create or replace function private.tenant_workspace_role(p_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path=pg_catalog,pg_temp
as $fn$
  select wm.role
  from public.workspace_members wm
  where wm.workspace_id=p_workspace_id
    and wm.user_id=public.phase6_auth_uid()
    and wm.status='active'
  limit 1
$fn$;

create or replace function private.tenant_default_workspace()
returns uuid
language sql
stable
security definer
set search_path=pg_catalog,pg_temp
as $fn$
  select min(wm.workspace_id)
  from public.workspace_members wm
  where wm.user_id=public.phase6_auth_uid()
    and wm.status='active'
  having count(*)=1
$fn$;

revoke all on function private.tenant_is_workspace_member(uuid) from public, anon;
revoke all on function private.tenant_workspace_role(uuid) from public, anon;
revoke all on function private.tenant_default_workspace() from public, anon;
grant execute on function private.tenant_is_workspace_member(uuid) to authenticated;
grant execute on function private.tenant_workspace_role(uuid) to authenticated;
grant execute on function private.tenant_default_workspace() to authenticated;

-- Deterministic bootstrap workspace for the existing single-workspace deployment.
insert into public.workspaces(id,slug,name,status,created_by)
select
  '6d68092e-a29b-4ce5-9f6c-5fe0a5d67a01'::uuid,
  'manuscript-heaven',
  'Manuscript Heaven',
  'active',
  (select p.id from public.profiles p where p.role::text='admin' order by p.created_at nulls last,p.id limit 1)
where not exists (
  select 1 from public.workspaces
  where id='6d68092e-a29b-4ce5-9f6c-5fe0a5d67a01'::uuid
);

insert into public.workspace_members(workspace_id,user_id,role,status)
select
  '6d68092e-a29b-4ce5-9f6c-5fe0a5d67a01'::uuid,
  p.id,
  case p.role::text
    when 'admin' then 'owner'
    when 'project_manager' then 'admin'
    when 'manager' then 'admin'
    when 'client' then 'client'
    else 'member'
  end,
  case when p.status='active' then 'active' else 'suspended' end
from public.profiles p
on conflict(workspace_id,user_id) do update
set role=excluded.role,status=excluded.status;

alter table public.projects add column if not exists workspace_id uuid null;
update public.projects
set workspace_id='6d68092e-a29b-4ce5-9f6c-5fe0a5d67a01'::uuid
where workspace_id is null;

alter table public.tasks add column if not exists workspace_id uuid null;
update public.tasks t
set workspace_id=coalesce(
  (select p.workspace_id from public.projects p where p.id=t.project_id),
  '6d68092e-a29b-4ce5-9f6c-5fe0a5d67a01'::uuid
)
where t.workspace_id is null;

do $workspace_constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='projects_workspace_id_fkey'
      and conrelid='public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_workspace_id_fkey
      foreign key(workspace_id) references public.workspaces(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname='tasks_workspace_id_fkey'
      and conrelid='public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_workspace_id_fkey
      foreign key(workspace_id) references public.workspaces(id);
  end if;
end
$workspace_constraints$;

alter table public.projects
  alter column workspace_id set default private.tenant_default_workspace(),
  alter column workspace_id set not null;
alter table public.tasks
  alter column workspace_id set default private.tenant_default_workspace(),
  alter column workspace_id set not null;

create index if not exists idx_projects_workspace_created
  on public.projects(workspace_id,created_at desc);
create index if not exists idx_tasks_workspace_status
  on public.tasks(workspace_id,status,sort_order);

create or replace function private.tenant_sync_task_workspace()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,pg_temp
as $fn$
declare
  v_project_workspace uuid;
begin
  if new.project_id is not null then
    select p.workspace_id into v_project_workspace
    from public.projects p
    where p.id=new.project_id;

    if v_project_workspace is null then
      raise exception 'tenant_project_workspace_missing';
    end if;

    if new.workspace_id is null then
      new.workspace_id:=v_project_workspace;
    elsif new.workspace_id is distinct from v_project_workspace then
      raise exception 'tenant_task_project_workspace_mismatch';
    end if;
  elsif new.workspace_id is null then
    new.workspace_id:=private.tenant_default_workspace();
  end if;

  if new.workspace_id is null then
    raise exception 'tenant_workspace_required';
  end if;

  return new;
end
$fn$;

revoke all on function private.tenant_sync_task_workspace() from public,anon,authenticated;

drop trigger if exists tenant_sync_task_workspace_trigger on public.tasks;
create trigger tenant_sync_task_workspace_trigger
before insert or update of project_id,workspace_id on public.tasks
for each row execute function private.tenant_sync_task_workspace();

-- RESTRICTIVE policies are ANDed with the existing Phase 6 permissive policies.
drop policy if exists tenant_projects_workspace_guard on public.projects;
create policy tenant_projects_workspace_guard
on public.projects
as restrictive
for all
to authenticated
using (private.tenant_is_workspace_member(workspace_id))
with check (private.tenant_is_workspace_member(workspace_id));

drop policy if exists tenant_tasks_workspace_guard on public.tasks;
create policy tenant_tasks_workspace_guard
on public.tasks
as restrictive
for all
to authenticated
using (private.tenant_is_workspace_member(workspace_id))
with check (private.tenant_is_workspace_member(workspace_id));

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

revoke all on public.workspaces from anon;
revoke all on public.workspace_members from anon;
revoke all on public.workspaces from authenticated;
revoke all on public.workspace_members from authenticated;
grant select,update on public.workspaces to authenticated;
grant select,insert,update,delete on public.workspace_members to authenticated;

drop policy if exists workspaces_member_select on public.workspaces;
create policy workspaces_member_select
on public.workspaces for select to authenticated
using (private.tenant_is_workspace_member(id));

drop policy if exists workspaces_admin_update on public.workspaces;
create policy workspaces_admin_update
on public.workspaces for update to authenticated
using (private.tenant_workspace_role(id) in ('owner','admin'))
with check (private.tenant_workspace_role(id) in ('owner','admin'));

drop policy if exists workspace_members_member_select on public.workspace_members;
create policy workspace_members_member_select
on public.workspace_members for select to authenticated
using (private.tenant_is_workspace_member(workspace_id));

drop policy if exists workspace_members_admin_insert on public.workspace_members;
create policy workspace_members_admin_insert
on public.workspace_members for insert to authenticated
with check (private.tenant_workspace_role(workspace_id) in ('owner','admin'));

drop policy if exists workspace_members_admin_update on public.workspace_members;
create policy workspace_members_admin_update
on public.workspace_members for update to authenticated
using (private.tenant_workspace_role(workspace_id) in ('owner','admin'))
with check (private.tenant_workspace_role(workspace_id) in ('owner','admin'));

drop policy if exists workspace_members_admin_delete on public.workspace_members;
create policy workspace_members_admin_delete
on public.workspace_members for delete to authenticated
using (
  private.tenant_workspace_role(workspace_id)='owner'
  and role<>'owner'
);

-- Scope custom templates to a workspace. System templates remain global read-only seeds.
alter table public.project_templates add column if not exists workspace_id uuid null references public.workspaces(id);
create index if not exists idx_project_templates_workspace
  on public.project_templates(workspace_id,active)
  where workspace_id is not null;

drop policy if exists project_templates_select on public.project_templates;
create policy project_templates_select
on public.project_templates for select to authenticated
using (
  public.phase6_app_actor_class() in ('admin','project_manager')
  and (
    is_system
    or (workspace_id is not null and private.tenant_is_workspace_member(workspace_id))
  )
);

drop policy if exists project_templates_admin_insert on public.project_templates;
create policy project_templates_admin_insert
on public.project_templates for insert to authenticated
with check (
  public.phase6_app_actor_class()='admin'
  and is_system=false
  and workspace_id is not null
  and private.tenant_workspace_role(workspace_id) in ('owner','admin')
  and created_by=(select auth.uid())
);

drop policy if exists project_templates_admin_update on public.project_templates;
create policy project_templates_admin_update
on public.project_templates for update to authenticated
using (
  public.phase6_app_actor_class()='admin'
  and is_system=false
  and workspace_id is not null
  and private.tenant_workspace_role(workspace_id) in ('owner','admin')
)
with check (
  public.phase6_app_actor_class()='admin'
  and is_system=false
  and workspace_id is not null
  and private.tenant_workspace_role(workspace_id) in ('owner','admin')
);

drop policy if exists project_templates_admin_delete on public.project_templates;
create policy project_templates_admin_delete
on public.project_templates for delete to authenticated
using (
  public.phase6_app_actor_class()='admin'
  and is_system=false
  and workspace_id is not null
  and private.tenant_workspace_role(workspace_id) in ('owner','admin')
);

create table if not exists public.workspace_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  actor_id uuid null references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now()
);

create index if not exists idx_workspace_events_workspace_created
  on public.workspace_events(workspace_id,created_at desc);
create index if not exists idx_workspace_events_type_created
  on public.workspace_events(workspace_id,event_type,created_at desc);

create table if not exists public.workspace_api_clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  token_hash text not null,
  scopes text[] not null default '{}'::text[],
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz null,
  revoked_at timestamptz null,
  unique(workspace_id,name)
);

create table if not exists public.workspace_webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  url text not null check (url ~ '^https://'),
  event_types text[] not null default '{}'::text[],
  secret_ref text not null,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_workspace_webhooks_active
  on public.workspace_webhook_endpoints(workspace_id,active);

create table if not exists public.workspace_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references public.workspace_webhook_endpoints(id) on delete cascade,
  event_id uuid not null references public.workspace_events(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','sending','delivered','failed','dead_letter')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz null,
  response_status integer null,
  error_code text null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz null,
  unique(endpoint_id,event_id)
);

create index if not exists idx_workspace_webhook_delivery_queue
  on public.workspace_webhook_deliveries(status,next_attempt_at,created_at)
  where status in ('pending','failed');

alter table public.workspace_events enable row level security;
alter table public.workspace_api_clients enable row level security;
alter table public.workspace_webhook_endpoints enable row level security;
alter table public.workspace_webhook_deliveries enable row level security;

revoke all on public.workspace_events from anon,authenticated;
revoke all on public.workspace_api_clients from anon,authenticated;
revoke all on public.workspace_webhook_endpoints from anon,authenticated;
revoke all on public.workspace_webhook_deliveries from anon,authenticated;
grant select on public.workspace_events to authenticated;
grant select,insert,update on public.workspace_api_clients to authenticated;
grant select,insert,update,delete on public.workspace_webhook_endpoints to authenticated;
grant select on public.workspace_webhook_deliveries to authenticated;

drop policy if exists workspace_events_admin_select on public.workspace_events;
create policy workspace_events_admin_select
on public.workspace_events for select to authenticated
using (private.tenant_workspace_role(workspace_id) in ('owner','admin'));

drop policy if exists workspace_api_clients_admin_all on public.workspace_api_clients;
create policy workspace_api_clients_admin_all
on public.workspace_api_clients for all to authenticated
using (private.tenant_workspace_role(workspace_id) in ('owner','admin'))
with check (
  private.tenant_workspace_role(workspace_id) in ('owner','admin')
  and created_by=(select auth.uid())
);

drop policy if exists workspace_webhook_endpoints_admin_all on public.workspace_webhook_endpoints;
create policy workspace_webhook_endpoints_admin_all
on public.workspace_webhook_endpoints for all to authenticated
using (private.tenant_workspace_role(workspace_id) in ('owner','admin'))
with check (
  private.tenant_workspace_role(workspace_id) in ('owner','admin')
  and created_by=(select auth.uid())
);

drop policy if exists workspace_webhook_deliveries_admin_select on public.workspace_webhook_deliveries;
create policy workspace_webhook_deliveries_admin_select
on public.workspace_webhook_deliveries for select to authenticated
using (
  exists (
    select 1
    from public.workspace_webhook_endpoints e
    where e.id=workspace_webhook_deliveries.endpoint_id
      and private.tenant_workspace_role(e.workspace_id) in ('owner','admin')
  )
);

create or replace function private.capture_workspace_event()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,pg_temp
as $fn$
declare
  v_workspace_id uuid;
  v_aggregate_id uuid;
  v_event_id uuid;
  v_event_type text;
begin
  if tg_op='DELETE' then
    v_workspace_id:=old.workspace_id;
    v_aggregate_id:=old.id;
  else
    v_workspace_id:=new.workspace_id;
    v_aggregate_id:=new.id;
  end if;

  if v_workspace_id is null or v_aggregate_id is null then
    return coalesce(new,old);
  end if;

  v_event_type:=tg_table_name || '.' || lower(tg_op);

  insert into public.workspace_events(
    workspace_id,event_type,aggregate_type,aggregate_id,actor_id,metadata
  )
  values (
    v_workspace_id,
    v_event_type,
    tg_table_name,
    v_aggregate_id,
    public.phase6_auth_uid(),
    jsonb_build_object('operation',lower(tg_op))
  )
  returning id into v_event_id;

  insert into public.workspace_webhook_deliveries(endpoint_id,event_id,status)
  select e.id,v_event_id,'pending'
  from public.workspace_webhook_endpoints e
  where e.workspace_id=v_workspace_id
    and e.active
    and (cardinality(e.event_types)=0 or v_event_type=any(e.event_types))
  on conflict(endpoint_id,event_id) do nothing;

  return coalesce(new,old);
end
$fn$;

revoke all on function private.capture_workspace_event() from public,anon,authenticated;

drop trigger if exists workspace_project_event_trigger on public.projects;
create trigger workspace_project_event_trigger
after insert or update or delete on public.projects
for each row execute function private.capture_workspace_event();

drop trigger if exists workspace_task_event_trigger on public.tasks;
create trigger workspace_task_event_trigger
after insert or update or delete on public.tasks
for each row execute function private.capture_workspace_event();

notify pgrst, 'reload schema';

commit;
