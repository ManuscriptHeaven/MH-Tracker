begin;

-- Phase 6 Step 3D.1: workflow security boundary and client-safe projections.
-- This migration deliberately does not address the wider Step 3D.2 tables.

do $phase6$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname='phase6_workflow_rpc_owner') then
    create role phase6_workflow_rpc_owner
      nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$phase6$;

alter role phase6_workflow_rpc_owner
  nologin noinherit nocreatedb nocreaterole noreplication;
revoke phase6_workflow_rpc_owner from anon, authenticated;

do $phase6$
declare v_role pg_catalog.pg_roles%rowtype;
begin
  select * into v_role from pg_catalog.pg_roles
  where rolname='phase6_workflow_rpc_owner';
  if not found or v_role.rolsuper or v_role.rolbypassrls or v_role.rolcanlogin
     or v_role.rolinherit or v_role.rolcreatedb or v_role.rolcreaterole
     or v_role.rolreplication then
    raise exception 'phase6_workflow_rpc_owner_unsafe_attributes';
  end if;
end
$phase6$;

grant usage on schema public to phase6_workflow_rpc_owner;
grant execute on function public.phase6_auth_uid() to phase6_workflow_rpc_owner;

-- Request fingerprinting discovers pgcrypto's installed schema at runtime.
-- Grant only the schema lookup needed to resolve the qualified function and
-- the exact digest(text,text) overload used by _workflow_request_fingerprint.
do $phase6$
declare
  v_pgcrypto_oid oid;
  v_pgcrypto_schema text;
  v_digest_oid oid;
begin
  select e.oid,n.nspname into v_pgcrypto_oid,v_pgcrypto_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid=e.extnamespace
  where e.extname='pgcrypto';

  if v_pgcrypto_schema is null then
    raise exception 'workflow_pgcrypto_unavailable';
  end if;

  v_digest_oid := pg_catalog.to_regprocedure(
    pg_catalog.format('%I.digest(text,text)',v_pgcrypto_schema)
  );
  if v_digest_oid is null or not exists (
    select 1 from pg_catalog.pg_depend d
    where d.classid='pg_catalog.pg_proc'::regclass
      and d.objid=v_digest_oid
      and d.refclassid='pg_catalog.pg_extension'::regclass
      and d.refobjid=v_pgcrypto_oid
      and d.deptype='e'
  ) then
    raise exception 'workflow_pgcrypto_digest_unavailable';
  end if;

  execute pg_catalog.format(
    'grant usage on schema %I to phase6_workflow_rpc_owner',v_pgcrypto_schema
  );
  execute pg_catalog.format(
    'grant execute on function %I.digest(text,text) to phase6_workflow_rpc_owner',
    v_pgcrypto_schema
  );
end
$phase6$;

-- Retire competing legacy workflow triggers. Revoking direct EXECUTE from a
-- trigger function does not prevent PostgreSQL from firing an installed trigger.
drop trigger if exists apply_project_timeline_trigger on public.projects;
drop trigger if exists project_notifications_trigger on public.projects;
drop trigger if exists log_project_status_change on public.projects;
drop trigger if exists auto_link_client_project_access_trigger on public.projects;
drop trigger if exists touch_projects_updated_at on public.projects;
drop trigger if exists apply_revision_request_timeline_trigger on public.revision_requests;
drop trigger if exists revision_request_timeline_trigger on public.revision_requests;
drop trigger if exists mark_project_revision_requested_trigger on public.revision_requests;
drop trigger if exists revision_request_notifications_trigger on public.revision_requests;
drop trigger if exists set_revision_completed_at_trigger on public.revision_requests;
drop trigger if exists touch_revision_requests_updated_at on public.revision_requests;
drop trigger if exists revised_proof_uploaded_trigger on public.revision_attachments;

-- The dedicated RPC owner preserves the reviewed mutation timestamp, including
-- a later workflow_version-only UPDATE. Every ordinary metadata writer receives
-- a database timestamp and cannot preserve or supply an arbitrary updated_at.
create or replace function public.phase6_touch_project_metadata_updated_at()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if current_user='phase6_workflow_rpc_owner' then
    return new;
  end if;

  if new.client_profile_id is distinct from old.client_profile_id
     and public.phase6_current_actor_class() not in ('admin','project_manager') then
    raise exception 'workflow_project_client_access_denied' using errcode='42501';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end
$fn$;
revoke all on function public.phase6_touch_project_metadata_updated_at() from public, anon, authenticated;
create trigger phase6_touch_project_metadata_updated_at
before update on public.projects
for each row execute function public.phase6_touch_project_metadata_updated_at();

create or replace function public.phase6_touch_revision_metadata_updated_at()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if current_user='phase6_workflow_rpc_owner' then
    return new;
  end if;

  new.updated_at := clock_timestamp();
  return new;
end
$fn$;
revoke all on function public.phase6_touch_revision_metadata_updated_at() from public, anon, authenticated;
create trigger phase6_touch_revision_metadata_updated_at
before update on public.revision_requests
for each row execute function public.phase6_touch_revision_metadata_updated_at();

-- Exact active-profile role normalization used by workflow RLS. This helper
-- returns classification only and never accepts an actor identity.
create or replace function public.phase6_current_actor_class()
returns text
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select case p.role::text
    when 'admin' then 'admin'
    when 'project_manager' then 'project_manager'
    when 'manager' then 'project_manager'
    when 'employee' then 'employee'
    when 'junior_assistant' then 'employee'
    when 'client' then 'client'
    else null end
  from public.profiles p
  where p.id=public.phase6_auth_uid() and p.status='active'
  limit 1
$fn$;

-- Replace every historical fuzzy/caller-selectable definition with exact
-- caller identity, active Client role, direct FK or explicit access membership.
create or replace function public.client_has_project_access(
  project_id uuid, client_id uuid default auth.uid()
) returns boolean
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select client_id is not distinct from public.phase6_auth_uid()
    and public.phase6_current_actor_class()='client'
    and exists (
      select 1 from public.projects p
      where p.id=project_id and (
        p.client_profile_id=public.phase6_auth_uid()
        or exists (
          select 1 from public.client_project_access a
          where a.project_id=p.id and a.client_id=public.phase6_auth_uid()
        )
      )
    )
$fn$;

-- Repository-compatible revision/storage predicate with exact current access.
create or replace function public.user_can_access_revision_request(request_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select exists (
    select 1 from public.revision_requests r
    join public.projects p on p.id=r.project_id
    where r.id=request_id and (
      (public.phase6_current_actor_class() in ('admin','project_manager'))
      or (public.phase6_current_actor_class()='employee' and p.assigned_to=public.phase6_auth_uid())
      or (r.client_id=public.phase6_auth_uid()
        and public.client_has_project_access(r.project_id,public.phase6_auth_uid()))
    )
  )
$fn$;

create or replace function public.phase6_client_can_submit_revision_content(request_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select public.phase6_current_actor_class()='client' and exists (
    select 1 from public.revision_requests r
    where r.id=request_id and r.client_id=public.phase6_auth_uid()
      and r.canonical_status='submitted'
      and public.client_has_project_access(r.project_id,public.phase6_auth_uid())
  )
$fn$;

-- Client project output is fixed. It contains no raw row expansion and no
-- internal notes, staff identities, accounting, settings, or resolver evidence.
create or replace function public.get_client_project_summaries()
returns table (
  id uuid,
  project_number text,
  project_title text,
  client_name text,
  service_type text,
  genre text,
  priority public.project_priority,
  project_status public.project_lifecycle_status,
  workflow_stage_key public.workflow_stage,
  workflow_stage_status_key public.workflow_stage_status,
  workflow_waiting_on_key public.workflow_waiting_on,
  workflow_version bigint,
  status public.project_status,
  current_stage text,
  stage_status text,
  waiting_on text,
  timeline_status text,
  progress_percentage integer,
  client_action_required text,
  start_date date,
  due_date date,
  stage_started_at timestamptz,
  stage_due_at timestamptz,
  stage_completed_at timestamptz,
  final_due_at timestamptz,
  delivered_at timestamptz,
  files_received_date date,
  design_concept_due_date date,
  design_concept_submitted_date date,
  design_concept_approval_date date,
  concept_revision_due_date date,
  print_version_due_date date,
  print_version_submitted_date date,
  print_version_approval_date date,
  print_revision_due_date date,
  ebook_due_date date,
  ebook_submitted_date date,
  ebook_approval_date date,
  final_delivery_date date,
  delivery_date date,
  revision_count integer,
  source_file_link text,
  proof_pdf_link text,
  final_print_pdf_link text,
  final_ebook_link text,
  cover_file_link text,
  client_brief_link text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select
    p.id,p.project_number,p.project_title,p.client_name,p.service_type,p.genre,p.priority,
    p.project_status,p.workflow_stage_key,p.workflow_stage_status_key,p.workflow_waiting_on_key,
    p.workflow_version,
    p.status,p.current_stage,p.stage_status,p.waiting_on,p.timeline_status,p.progress_percentage,
    p.client_action_required,p.start_date,p.due_date,p.stage_started_at,p.stage_due_at,
    p.stage_completed_at,p.final_due_at,p.delivered_at,p.files_received_date,
    p.design_concept_due_date,p.design_concept_submitted_date,p.design_concept_approval_date,
    p.concept_revision_due_date,p.print_version_due_date,p.print_version_submitted_date,
    p.print_version_approval_date,p.print_revision_due_date,p.ebook_due_date,
    p.ebook_submitted_date,p.ebook_approval_date,p.final_delivery_date,p.delivery_date,
    p.revision_count,p.source_file_link,p.proof_pdf_link,p.final_print_pdf_link,
    p.final_ebook_link,p.cover_file_link,p.client_brief_link,p.created_at,p.updated_at
  from public.projects p
  where public.client_has_project_access(p.id,public.phase6_auth_uid())
$fn$;

create or replace function public.get_client_revision_requests()
returns table (
  id uuid, project_id uuid, client_id uuid, title text, description text,
  instructions text, team_response text, priority text, status text,
  stage_key public.workflow_stage, canonical_status public.workflow_revision_status,
  revision_round integer, parent_revision_request_id uuid, submitted_at timestamptz,
  due_at timestamptz, completed_at timestamptz, created_at timestamptz, updated_at timestamptz
)
language sql stable security definer set search_path = pg_catalog, pg_temp
as $fn$
  select r.id,r.project_id,r.client_id,r.title,r.description,r.instructions,r.team_response,
    r.priority,r.status,r.stage_key,r.canonical_status,r.revision_round,
    r.parent_revision_request_id,r.submitted_at,r.due_at,r.completed_at,r.created_at,r.updated_at
  from public.revision_requests r
  where r.client_id=public.phase6_auth_uid()
    and public.client_has_project_access(r.project_id,public.phase6_auth_uid())
$fn$;

create or replace function public.get_client_revision_items()
returns table (
  id uuid, revision_request_id uuid, sort_order integer, page_reference text,
  instruction text, status text, client_attachment_url text, team_response text,
  created_at timestamptz, updated_at timestamptz
)
language sql stable security definer set search_path = pg_catalog, pg_temp
as $fn$
  select i.id,i.revision_request_id,i.sort_order,i.page_reference,i.instruction,
    i.status,i.client_attachment_url,i.team_response,i.created_at,i.updated_at
  from public.revision_items i
  join public.revision_requests r on r.id=i.revision_request_id
  where r.client_id=public.phase6_auth_uid()
    and public.client_has_project_access(r.project_id,public.phase6_auth_uid())
$fn$;

create or replace function public.get_client_revision_attachments()
returns table (
  id uuid, revision_request_id uuid, revision_item_id uuid, file_name text,
  file_url text, file_type text, created_at timestamptz
)
language sql stable security definer set search_path = pg_catalog, pg_temp
as $fn$
  select a.id,a.revision_request_id,a.revision_item_id,a.file_name,a.file_url,a.file_type,a.created_at
  from public.revision_attachments a
  join public.revision_requests r on r.id=a.revision_request_id
  where r.client_id=public.phase6_auth_uid()
    and public.client_has_project_access(r.project_id,public.phase6_auth_uid())
$fn$;

create or replace function public.get_client_revision_activity()
returns table (
  id uuid, revision_request_id uuid, action text, created_at timestamptz
)
language sql stable security definer set search_path = pg_catalog, pg_temp
as $fn$
  select a.id,a.revision_request_id,a.action,a.created_at
  from public.revision_activity a
  join public.revision_requests r on r.id=a.revision_request_id
  where r.client_id=public.phase6_auth_uid()
    and public.client_has_project_access(r.project_id,public.phase6_auth_uid())
$fn$;

create or replace function public.get_client_stage_skips()
returns table (
  id uuid, project_id uuid, stage text, stage_key public.workflow_stage,
  reason text, status text, canonical_status public.workflow_skip_status,
  requested_at timestamptz, client_response_at timestamptz, response_note text,
  created_at timestamptz, updated_at timestamptz
)
language sql stable security definer set search_path = pg_catalog, pg_temp
as $fn$
  select s.id,s.project_id,s.stage,s.stage_key,s.reason,s.status,s.canonical_status,
    s.requested_at,s.client_response_at,s.response_note,s.created_at,s.updated_at
  from public.project_stage_skips s
  where public.client_has_project_access(s.project_id,public.phase6_auth_uid())
$fn$;

-- Definer ownership and explicit callable surface for security/projection helpers.
grant phase6_workflow_rpc_owner to postgres;
grant create on schema public to phase6_workflow_rpc_owner;

alter function public.phase6_current_actor_class() owner to phase6_workflow_rpc_owner;
alter function public.client_has_project_access(uuid,uuid) owner to phase6_workflow_rpc_owner;
alter function public.user_can_access_revision_request(uuid) owner to phase6_workflow_rpc_owner;
alter function public.phase6_client_can_submit_revision_content(uuid) owner to phase6_workflow_rpc_owner;
alter function public.get_client_project_summaries() owner to phase6_workflow_rpc_owner;
alter function public.get_client_revision_requests() owner to phase6_workflow_rpc_owner;
alter function public.get_client_revision_items() owner to phase6_workflow_rpc_owner;
alter function public.get_client_revision_attachments() owner to phase6_workflow_rpc_owner;
alter function public.get_client_revision_activity() owner to phase6_workflow_rpc_owner;
alter function public.get_client_stage_skips() owner to phase6_workflow_rpc_owner;

revoke all on function public.phase6_current_actor_class() from public, anon, authenticated;
grant execute on function public.phase6_current_actor_class() to authenticated;
revoke all on function public.client_has_project_access(uuid,uuid) from public, anon, authenticated;
grant execute on function public.client_has_project_access(uuid,uuid) to authenticated;
revoke all on function public.user_can_access_revision_request(uuid) from public, anon, authenticated;
grant execute on function public.user_can_access_revision_request(uuid) to authenticated;
revoke all on function public.phase6_client_can_submit_revision_content(uuid) from public, anon, authenticated;
grant execute on function public.phase6_client_can_submit_revision_content(uuid) to authenticated;
revoke all on function public.get_client_project_summaries() from public, anon, authenticated;
grant execute on function public.get_client_project_summaries() to authenticated;
revoke all on function public.get_client_revision_requests() from public, anon, authenticated;
grant execute on function public.get_client_revision_requests() to authenticated;
revoke all on function public.get_client_revision_items() from public, anon, authenticated;
grant execute on function public.get_client_revision_items() to authenticated;
revoke all on function public.get_client_revision_attachments() from public, anon, authenticated;
grant execute on function public.get_client_revision_attachments() to authenticated;
revoke all on function public.get_client_revision_activity() from public, anon, authenticated;
grant execute on function public.get_client_revision_activity() to authenticated;
revoke all on function public.get_client_stage_skips() from public, anon, authenticated;
grant execute on function public.get_client_stage_skips() to authenticated;

-- Compatibility views preserve current PostgREST relation names while routing
-- through the fixed security-definer projections. They can be retired after the
-- frontend calls the get_client_* RPCs directly.
drop view if exists public.client_project_summaries;
create view public.client_project_summaries with (security_invoker=true) as
select c.id,c.project_number,c.project_title,c.client_name,c.service_type,c.genre,c.priority,
  c.project_status,c.workflow_stage_key,c.workflow_stage_status_key,c.workflow_waiting_on_key,
  c.workflow_version,
  c.status,c.current_stage,c.stage_status,c.waiting_on,c.timeline_status,c.progress_percentage,
  c.client_action_required,c.start_date,c.due_date,c.stage_started_at,c.stage_due_at,
  c.stage_completed_at,c.final_due_at,c.delivered_at,c.files_received_date,
  c.design_concept_due_date,c.design_concept_submitted_date,c.design_concept_approval_date,
  c.concept_revision_due_date,c.print_version_due_date,c.print_version_submitted_date,
  c.print_version_approval_date,c.print_revision_due_date,c.ebook_due_date,
  c.ebook_submitted_date,c.ebook_approval_date,c.final_delivery_date,c.delivery_date,
  c.revision_count,c.source_file_link,c.proof_pdf_link,c.final_print_pdf_link,
  c.final_ebook_link,c.cover_file_link,c.client_brief_link,c.created_at,c.updated_at
from public.get_client_project_summaries() c;

drop view if exists public.client_revision_requests;
create view public.client_revision_requests with (security_invoker=true) as
select c.id,c.project_id,c.client_id,c.title,c.description,c.instructions,c.team_response,
  c.priority,c.status,c.stage_key,c.canonical_status,c.revision_round,
  c.parent_revision_request_id,c.submitted_at,c.due_at,c.completed_at,c.created_at,c.updated_at
from public.get_client_revision_requests() c;

drop view if exists public.client_revision_items;
create view public.client_revision_items with (security_invoker=true) as
select c.id,c.revision_request_id,c.sort_order,c.page_reference,c.instruction,c.status,
  c.client_attachment_url,c.team_response,c.created_at,c.updated_at
from public.get_client_revision_items() c;

drop view if exists public.client_revision_attachments;
create view public.client_revision_attachments with (security_invoker=true) as
select c.id,c.revision_request_id,c.revision_item_id,c.file_name,c.file_url,c.file_type,c.created_at
from public.get_client_revision_attachments() c;

drop view if exists public.client_revision_activity;
create view public.client_revision_activity with (security_invoker=true) as
select c.id,c.revision_request_id,c.action,c.created_at
from public.get_client_revision_activity() c;

revoke all on public.client_project_summaries,public.client_revision_requests,
  public.client_revision_items,public.client_revision_attachments,public.client_revision_activity
  from public, anon, authenticated;
grant select on public.client_project_summaries,public.client_revision_requests,
  public.client_revision_items,public.client_revision_attachments,public.client_revision_activity
  to authenticated;

-- Table privileges: workflow ledgers are RPC-only for mutation. The owner gets
-- only the operations required by the reviewed functions.
revoke all on public.project_stage_history,public.project_stage_skips,
  public.revision_requests,public.admin_workflow_overrides,
  public.workflow_idempotency_receipts from public, anon, authenticated;
grant select on public.project_stage_history,public.project_stage_skips,
  public.revision_requests,public.admin_workflow_overrides to authenticated;
grant update (assigned_to,priority,team_response) on public.revision_requests to authenticated;
revoke all on public.revision_items,public.revision_attachments,public.revision_activity from public, anon;
grant select,insert,update,delete on public.revision_items to authenticated;
grant select,insert,delete on public.revision_attachments to authenticated;
grant select,insert on public.revision_activity to authenticated;
revoke all on public.projects from public, anon;
grant select,insert,delete on public.projects to authenticated;
grant usage,select on sequence public.projects_project_number_seq to authenticated;
revoke all on public.client_project_access from public, anon;
grant select,insert,update,delete on public.client_project_access to authenticated;

grant select,update on public.projects to phase6_workflow_rpc_owner;
grant select,insert on public.project_stage_history to phase6_workflow_rpc_owner;
grant select,insert,update on public.project_stage_skips to phase6_workflow_rpc_owner;
grant select,insert,update on public.revision_requests to phase6_workflow_rpc_owner;
grant select,insert on public.admin_workflow_overrides to phase6_workflow_rpc_owner;
grant select,insert on public.workflow_idempotency_receipts to phase6_workflow_rpc_owner;
grant select,insert on public.notifications to phase6_workflow_rpc_owner;
grant select on public.profiles,public.client_project_access,
  public.workflow_stage_definitions,public.workflow_calendar_exceptions,
  public.revision_items,public.revision_attachments,public.revision_activity
  to phase6_workflow_rpc_owner;

-- Keep team CRM/file editing through PostgREST, but remove direct UPDATE of all
-- canonical and compatibility workflow columns. PostgreSQL checks column ACLs
-- even when a caller assigns a protected column its existing value.
revoke update on public.projects from public, anon, authenticated;
grant update (
  client_name,client_email,client_profile_id,project_title,service_type,genre,
  trim_size,page_count,word_count,image_count,platform,assigned_to,project_manager,
  priority,start_date,due_date,internal_deadline,general_notes,internal_notes,
  client_instructions,qa_notes,delivery_notes,source_file_link,drive_folder_link,
  client_brief_link,proof_pdf_link,final_print_pdf_link,final_ebook_link,
  cover_file_link,other_links,invoiced,invoice_id,invoiced_at,updated_at
) on public.projects to authenticated;

-- Replace all policies on the Step 3D.1 workflow boundary. Dynamic identifier
-- quoting handles historical policy-name variants without broadening scope.
do $phase6$
declare r record;
begin
  for r in
    select n.nspname,c.relname,p.polname
    from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid=p.polrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in (
      'projects','project_stage_history','project_stage_skips','revision_requests',
      'admin_workflow_overrides','workflow_idempotency_receipts','client_project_access'
    )
  loop
    execute format('drop policy %I on %I.%I',r.polname,r.nspname,r.relname);
  end loop;
end
$phase6$;

drop policy if exists "Clients can create revision items" on public.revision_items;
create policy phase6_clients_create_revision_items on public.revision_items for insert to authenticated
with check (
  public.phase6_client_can_submit_revision_content(revision_request_id)
  and status='Open' and coalesce(team_response,'')='' and coalesce(internal_note,'')=''
);
drop policy if exists "Clients can create revision attachments" on public.revision_attachments;
create policy phase6_clients_create_revision_attachments on public.revision_attachments for insert to authenticated
with check (
  uploaded_by=auth.uid()
  and public.phase6_client_can_submit_revision_content(revision_request_id)
);
drop policy if exists "Clients can create own revision activity" on public.revision_activity;
create policy phase6_clients_create_revision_activity on public.revision_activity for insert to authenticated
with check (
  user_id=auth.uid()
  and public.phase6_client_can_submit_revision_content(revision_request_id)
);

-- Child revision uploads/items keep their existing mutation policies. Replace
-- SELECT only so Clients cannot bypass the fixed projections and see internal
-- item notes, uploader identities, or raw activity actor/value fields.
do $phase6$
declare r record;
begin
  for r in
    select n.nspname,c.relname,p.polname
    from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid=p.polrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname in ('revision_items','revision_attachments','revision_activity')
      and p.polcmd='r'
  loop
    execute format('drop policy %I on %I.%I',r.polname,r.nspname,r.relname);
  end loop;
end
$phase6$;

alter table public.projects enable row level security;
alter table public.project_stage_history enable row level security;
alter table public.project_stage_skips enable row level security;
alter table public.revision_requests enable row level security;
alter table public.admin_workflow_overrides enable row level security;
alter table public.workflow_idempotency_receipts enable row level security;
alter table public.client_project_access enable row level security;
alter table public.revision_items enable row level security;
alter table public.revision_attachments enable row level security;
alter table public.revision_activity enable row level security;

create policy phase6_projects_team_select on public.projects for select to authenticated
using (
  public.phase6_current_actor_class() in ('admin','project_manager')
  or (public.phase6_current_actor_class()='employee' and assigned_to=auth.uid())
);
create policy phase6_projects_team_insert on public.projects for insert to authenticated
with check (
  public.phase6_current_actor_class() in ('admin','project_manager')
  and created_by=auth.uid()
);
create policy phase6_projects_team_update on public.projects for update to authenticated
using (
  public.phase6_current_actor_class() in ('admin','project_manager')
  or (public.phase6_current_actor_class()='employee' and assigned_to=auth.uid())
)
with check (
  public.phase6_current_actor_class() in ('admin','project_manager')
  or (public.phase6_current_actor_class()='employee' and assigned_to=auth.uid())
);
create policy phase6_projects_admin_delete on public.projects for delete to authenticated
using (public.phase6_current_actor_class()='admin');
create policy phase6_projects_rpc_owner_select on public.projects for select to phase6_workflow_rpc_owner
using (current_user='phase6_workflow_rpc_owner');
create policy phase6_projects_rpc_owner_update on public.projects for update to phase6_workflow_rpc_owner
using (current_user='phase6_workflow_rpc_owner')
with check (current_user='phase6_workflow_rpc_owner');

create policy phase6_history_team_select on public.project_stage_history for select to authenticated
using (exists (
  select 1 from public.projects p where p.id=project_id and (
    public.phase6_current_actor_class() in ('admin','project_manager')
    or (public.phase6_current_actor_class()='employee' and p.assigned_to=auth.uid())
  )
));
create policy phase6_history_rpc_owner_select on public.project_stage_history for select to phase6_workflow_rpc_owner
using (current_user='phase6_workflow_rpc_owner');
create policy phase6_history_rpc_owner_insert on public.project_stage_history for insert to phase6_workflow_rpc_owner
with check (current_user='phase6_workflow_rpc_owner');

create policy phase6_skips_team_select on public.project_stage_skips for select to authenticated
using (exists (
  select 1 from public.projects p where p.id=project_id and (
    public.phase6_current_actor_class() in ('admin','project_manager')
    or (public.phase6_current_actor_class()='employee' and p.assigned_to=auth.uid())
  )
));
create policy phase6_skips_rpc_owner_select on public.project_stage_skips for select to phase6_workflow_rpc_owner
using (current_user='phase6_workflow_rpc_owner');
create policy phase6_skips_rpc_owner_insert on public.project_stage_skips for insert to phase6_workflow_rpc_owner
with check (current_user='phase6_workflow_rpc_owner');
create policy phase6_skips_rpc_owner_update on public.project_stage_skips for update to phase6_workflow_rpc_owner
using (current_user='phase6_workflow_rpc_owner')
with check (current_user='phase6_workflow_rpc_owner');

create policy phase6_revisions_team_select on public.revision_requests for select to authenticated
using (exists (
  select 1 from public.projects p where p.id=project_id and (
    public.phase6_current_actor_class() in ('admin','project_manager')
    or (public.phase6_current_actor_class()='employee' and p.assigned_to=auth.uid())
  )
));
create policy phase6_revisions_team_metadata_update on public.revision_requests for update to authenticated
using (exists (
  select 1 from public.projects p where p.id=project_id and (
    public.phase6_current_actor_class() in ('admin','project_manager')
    or (public.phase6_current_actor_class()='employee' and p.assigned_to=auth.uid())
  )
))
with check (exists (
  select 1 from public.projects p where p.id=project_id and (
    public.phase6_current_actor_class() in ('admin','project_manager')
    or (public.phase6_current_actor_class()='employee' and p.assigned_to=auth.uid())
  )
));
create policy phase6_revisions_rpc_owner_select on public.revision_requests for select to phase6_workflow_rpc_owner
using (current_user='phase6_workflow_rpc_owner');
create policy phase6_revisions_rpc_owner_insert on public.revision_requests for insert to phase6_workflow_rpc_owner
with check (current_user='phase6_workflow_rpc_owner');
create policy phase6_revisions_rpc_owner_update on public.revision_requests for update to phase6_workflow_rpc_owner
using (current_user='phase6_workflow_rpc_owner')
with check (current_user='phase6_workflow_rpc_owner');

create policy phase6_revision_items_team_select on public.revision_items for select to authenticated
using (exists (
  select 1 from public.revision_requests r join public.projects p on p.id=r.project_id
  where r.id=revision_request_id and (
    public.phase6_current_actor_class() in ('admin','project_manager')
    or (public.phase6_current_actor_class()='employee' and p.assigned_to=auth.uid())
  )
));
create policy phase6_revision_attachments_team_select on public.revision_attachments for select to authenticated
using (exists (
  select 1 from public.revision_requests r join public.projects p on p.id=r.project_id
  where r.id=revision_request_id and (
    public.phase6_current_actor_class() in ('admin','project_manager')
    or (public.phase6_current_actor_class()='employee' and p.assigned_to=auth.uid())
  )
));
create policy phase6_revision_activity_team_select on public.revision_activity for select to authenticated
using (exists (
  select 1 from public.revision_requests r join public.projects p on p.id=r.project_id
  where r.id=revision_request_id and (
    public.phase6_current_actor_class() in ('admin','project_manager')
    or (public.phase6_current_actor_class()='employee' and p.assigned_to=auth.uid())
  )
));
create policy phase6_revision_items_team_insert on public.revision_items for insert to authenticated
with check (
  public.phase6_current_actor_class()<>'client'
  and public.user_can_access_revision_request(revision_request_id)
);
create policy phase6_revision_items_team_update on public.revision_items for update to authenticated
using (
  public.phase6_current_actor_class()<>'client'
  and public.user_can_access_revision_request(revision_request_id)
)
with check (
  public.phase6_current_actor_class()<>'client'
  and public.user_can_access_revision_request(revision_request_id)
);
create policy phase6_revision_items_admin_delete on public.revision_items for delete to authenticated
using (public.phase6_current_actor_class()='admin');
create policy phase6_revision_attachments_team_insert on public.revision_attachments for insert to authenticated
with check (
  uploaded_by=auth.uid() and public.phase6_current_actor_class()<>'client'
  and public.user_can_access_revision_request(revision_request_id)
);
create policy phase6_revision_attachments_admin_delete on public.revision_attachments for delete to authenticated
using (public.phase6_current_actor_class()='admin');
create policy phase6_revision_activity_team_insert on public.revision_activity for insert to authenticated
with check (
  user_id=auth.uid() and public.phase6_current_actor_class()<>'client'
  and public.user_can_access_revision_request(revision_request_id)
);

create policy phase6_overrides_admin_select on public.admin_workflow_overrides for select to authenticated
using (
  public.phase6_current_actor_class()='admin'
  and exists (select 1 from public.projects p where p.id=project_id)
);
create policy phase6_overrides_rpc_owner_select on public.admin_workflow_overrides for select to phase6_workflow_rpc_owner
using (current_user='phase6_workflow_rpc_owner');
create policy phase6_overrides_rpc_owner_insert on public.admin_workflow_overrides for insert to phase6_workflow_rpc_owner
with check (current_user='phase6_workflow_rpc_owner');

create policy phase6_receipts_rpc_owner_select on public.workflow_idempotency_receipts for select to phase6_workflow_rpc_owner
using (current_user='phase6_workflow_rpc_owner');
create policy phase6_receipts_rpc_owner_insert on public.workflow_idempotency_receipts for insert to phase6_workflow_rpc_owner
with check (current_user='phase6_workflow_rpc_owner');

create policy phase6_access_management_select on public.client_project_access for select to authenticated
using (
  public.phase6_current_actor_class() in ('admin','project_manager')
  or (public.phase6_current_actor_class()='client' and client_id=auth.uid())
);
create policy phase6_access_management_insert on public.client_project_access for insert to authenticated
with check (public.phase6_current_actor_class() in ('admin','project_manager'));
create policy phase6_access_management_update on public.client_project_access for update to authenticated
using (public.phase6_current_actor_class() in ('admin','project_manager'))
with check (public.phase6_current_actor_class() in ('admin','project_manager'));
create policy phase6_access_management_delete on public.client_project_access for delete to authenticated
using (public.phase6_current_actor_class() in ('admin','project_manager'));
create policy phase6_access_rpc_owner_select on public.client_project_access for select to phase6_workflow_rpc_owner
using (current_user='phase6_workflow_rpc_owner');

-- The role must be able to read active actor/access evidence despite existing
-- profile/notification RLS, which Step 3D.2 otherwise leaves unchanged.
drop policy if exists phase6_profiles_rpc_owner_select on public.profiles;
create policy phase6_profiles_rpc_owner_select on public.profiles for select to phase6_workflow_rpc_owner
using (current_user='phase6_workflow_rpc_owner');
drop policy if exists phase6_notifications_rpc_owner_select on public.notifications;
create policy phase6_notifications_rpc_owner_select on public.notifications for select to phase6_workflow_rpc_owner
using (current_user='phase6_workflow_rpc_owner');
drop policy if exists phase6_notifications_rpc_owner_insert on public.notifications;
create policy phase6_notifications_rpc_owner_insert on public.notifications for insert to phase6_workflow_rpc_owner
with check (current_user='phase6_workflow_rpc_owner');
drop policy if exists phase6_stage_definitions_rpc_owner_select on public.workflow_stage_definitions;
create policy phase6_stage_definitions_rpc_owner_select on public.workflow_stage_definitions for select to phase6_workflow_rpc_owner
using (current_user='phase6_workflow_rpc_owner');
drop policy if exists phase6_calendar_rpc_owner_select on public.workflow_calendar_exceptions;
create policy phase6_calendar_rpc_owner_select on public.workflow_calendar_exceptions for select to phase6_workflow_rpc_owner
using (current_user='phase6_workflow_rpc_owner');
drop policy if exists phase6_revision_items_rpc_owner_select on public.revision_items;
create policy phase6_revision_items_rpc_owner_select on public.revision_items for select to phase6_workflow_rpc_owner
using (current_user='phase6_workflow_rpc_owner');
drop policy if exists phase6_revision_attachments_rpc_owner_select on public.revision_attachments;
create policy phase6_revision_attachments_rpc_owner_select on public.revision_attachments for select to phase6_workflow_rpc_owner
using (current_user='phase6_workflow_rpc_owner');
drop policy if exists phase6_revision_activity_rpc_owner_select on public.revision_activity;
create policy phase6_revision_activity_rpc_owner_select on public.revision_activity for select to phase6_workflow_rpc_owner
using (current_user='phase6_workflow_rpc_owner');

-- Legacy workflow mutation entry points remain installed for migration
-- compatibility but have no application EXECUTE privilege.
do $phase6$
declare r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array[
      'client_approve_project_milestone','submit_client_revision','submit_revised_proof',
      'client_respond_revision','apply_revision_request_timeline',
      'mark_project_revision_requested','apply_project_timeline',
      'create_timeline_deadline_notifications','create_project_notifications',
      'notify_revision_watchers','set_revision_completed_at',
      'notify_revised_proof_uploaded','log_project_status_change',
      'auto_link_client_project_access'
    ])
  loop
    execute format('revoke all on function %s from public, anon, authenticated',r.signature);
  end loop;
end
$phase6$;

-- Exactly eleven reviewed mutation RPCs move to the dedicated owner.
alter function public.workflow_advance_stage(uuid,bigint,uuid,text) owner to phase6_workflow_rpc_owner;
alter function public.workflow_submit_stage_for_approval(uuid,bigint,uuid,text) owner to phase6_workflow_rpc_owner;
alter function public.workflow_client_approve_stage(uuid,bigint,uuid,text) owner to phase6_workflow_rpc_owner;
alter function public.workflow_submit_client_revision(uuid,bigint,uuid,text,text,text,text) owner to phase6_workflow_rpc_owner;
alter function public.workflow_submit_revised_proof(uuid,bigint,uuid,uuid,text) owner to phase6_workflow_rpc_owner;
alter function public.workflow_request_stage_skip(uuid,bigint,uuid,public.workflow_stage,text) owner to phase6_workflow_rpc_owner;
alter function public.workflow_respond_stage_skip(uuid,bigint,uuid,uuid,text,text) owner to phase6_workflow_rpc_owner;
alter function public.workflow_admin_override(uuid,bigint,uuid,public.project_lifecycle_status,public.workflow_stage,public.workflow_stage_status,public.workflow_waiting_on,text,text) owner to phase6_workflow_rpc_owner;
alter function public.workflow_complete_final_delivery(uuid,bigint,uuid,text) owner to phase6_workflow_rpc_owner;
alter function public.workflow_set_project_lifecycle(uuid,bigint,uuid,public.project_lifecycle_status,text) owner to phase6_workflow_rpc_owner;
alter function public.workflow_update_project_configuration(uuid,bigint,uuid,boolean,boolean,jsonb) owner to phase6_workflow_rpc_owner;

-- RPC callable ACLs are restated after ownership transfer.
revoke all on function public.workflow_advance_stage(uuid,bigint,uuid,text) from public, anon, authenticated;
grant execute on function public.workflow_advance_stage(uuid,bigint,uuid,text) to authenticated;
revoke all on function public.workflow_submit_stage_for_approval(uuid,bigint,uuid,text) from public, anon, authenticated;
grant execute on function public.workflow_submit_stage_for_approval(uuid,bigint,uuid,text) to authenticated;
revoke all on function public.workflow_client_approve_stage(uuid,bigint,uuid,text) from public, anon, authenticated;
grant execute on function public.workflow_client_approve_stage(uuid,bigint,uuid,text) to authenticated;
revoke all on function public.workflow_submit_client_revision(uuid,bigint,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.workflow_submit_client_revision(uuid,bigint,uuid,text,text,text,text) to authenticated;
revoke all on function public.workflow_submit_revised_proof(uuid,bigint,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.workflow_submit_revised_proof(uuid,bigint,uuid,uuid,text) to authenticated;
revoke all on function public.workflow_request_stage_skip(uuid,bigint,uuid,public.workflow_stage,text) from public, anon, authenticated;
grant execute on function public.workflow_request_stage_skip(uuid,bigint,uuid,public.workflow_stage,text) to authenticated;
revoke all on function public.workflow_respond_stage_skip(uuid,bigint,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.workflow_respond_stage_skip(uuid,bigint,uuid,uuid,text,text) to authenticated;
revoke all on function public.workflow_admin_override(uuid,bigint,uuid,public.project_lifecycle_status,public.workflow_stage,public.workflow_stage_status,public.workflow_waiting_on,text,text) from public, anon, authenticated;
grant execute on function public.workflow_admin_override(uuid,bigint,uuid,public.project_lifecycle_status,public.workflow_stage,public.workflow_stage_status,public.workflow_waiting_on,text,text) to authenticated;
revoke all on function public.workflow_complete_final_delivery(uuid,bigint,uuid,text) from public, anon, authenticated;
grant execute on function public.workflow_complete_final_delivery(uuid,bigint,uuid,text) to authenticated;
revoke all on function public.workflow_set_project_lifecycle(uuid,bigint,uuid,public.project_lifecycle_status,text) from public, anon, authenticated;
grant execute on function public.workflow_set_project_lifecycle(uuid,bigint,uuid,public.project_lifecycle_status,text) to authenticated;
revoke all on function public.workflow_update_project_configuration(uuid,bigint,uuid,boolean,boolean,jsonb) from public, anon, authenticated;
grant execute on function public.workflow_update_project_configuration(uuid,bigint,uuid,boolean,boolean,jsonb) to authenticated;

-- Internal engine execution is granted explicitly to the reviewed RPC owner.
-- PUBLIC/anon/authenticated revocations from migration 3 remain in force.
revoke all on function public._workflow_format_evidence(public.projects,text) from public, anon, authenticated;
grant execute on function public._workflow_validate_calendar(timestamptz,boolean,text) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_is_production_date(date,boolean) to phase6_workflow_rpc_owner;
grant execute on function public.workflow_add_production_days(timestamptz,integer,boolean,text) to phase6_workflow_rpc_owner;
grant execute on function public.workflow_production_seconds_between(timestamptz,timestamptz,boolean,text) to phase6_workflow_rpc_owner;
grant execute on function public.workflow_production_days_between(timestamptz,timestamptz,boolean,text) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_add_production_seconds(timestamptz,bigint,boolean,text) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_validate_settings(jsonb) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_stage_duration_days(public.workflow_stage,jsonb) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_revision_duration_days(jsonb) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_exclude_weekends(jsonb) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_current_actor() to phase6_workflow_rpc_owner;
grant execute on function public._workflow_is_admin() to phase6_workflow_rpc_owner;
grant execute on function public._workflow_is_manager() to phase6_workflow_rpc_owner;
grant execute on function public._workflow_can_team_work(uuid) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_can_client_access(uuid) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_lock_project(uuid) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_project_snapshot(public.projects) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_make_result(uuid,jsonb,uuid[]) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_request_fingerprint(text,uuid,jsonb) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_retry_result(jsonb,text,text) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_receipt_lookup(text,uuid,uuid,text) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_check_version(bigint,bigint) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_receipt_store(text,uuid,uuid,text,public.workflow_mutation_result,timestamptz) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_compatibility_projection(public.project_lifecycle_status,public.workflow_stage,public.workflow_stage_status,public.workflow_waiting_on) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_assert_project_projection(public.projects) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_append_history(uuid,public.workflow_event_type,public.workflow_stage,public.workflow_stage,public.workflow_stage_status,public.workflow_stage_status,public.workflow_waiting_on,public.workflow_waiting_on,uuid,public.app_role,uuid,uuid,uuid,bigint,bigint,text,jsonb,timestamptz,timestamptz,uuid) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_accounting_baseline(uuid) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_accounting_totals(uuid) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_effective_clock_start(uuid,timestamptz) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_interval_delta(uuid,public.workflow_stage_status,timestamptz,timestamptz,jsonb) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_reconcile(uuid) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_stage_required(public.workflow_stage,boolean,boolean,public.service_capability_status) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_paired_approval(public.workflow_stage) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_skip_pair_root(public.workflow_stage) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_approved_manual_skips(uuid) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_has_approved_manual_skip(uuid,public.workflow_stage) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_validate_manual_skips(public.workflow_stage[]) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_next_stage(public.workflow_stage,boolean,boolean,public.service_capability_status,public.workflow_stage[],boolean) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_route_project(uuid,boolean) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_capability_resume_route(public.project_lifecycle_status,public.workflow_stage,public.workflow_stage_status,public.workflow_waiting_on,boolean,boolean,public.service_capability_status,public.workflow_stage[]) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_estimate_remaining_production(public.projects,timestamptz,public.workflow_stage[],timestamptz) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_estimate_final_due(uuid,timestamptz) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_lock_mutation_rows(uuid) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_validate_tuple(public.projects) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_operational_leaf(uuid,public.workflow_stage) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_checked_manual_skips(uuid) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_enter_production(public.projects,public.workflow_stage,timestamptz) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_event(public.workflow_event_type,public.projects,public.projects,jsonb,jsonb) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_route_events(public.projects,public.workflow_stage[],text[]) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_write_project(public.projects) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_assert_milestones(public.projects) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_emit_events(uuid,jsonb,bigint,bigint,text,timestamptz,uuid,integer) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_notify(public.projects,text,text,uuid,timestamptz) to phase6_workflow_rpc_owner;
grant execute on function public._workflow_format_evidence(public.projects,text) to phase6_workflow_rpc_owner;

revoke create on schema public from phase6_workflow_rpc_owner;
revoke phase6_workflow_rpc_owner from postgres;

notify pgrst, 'reload schema';
commit;
