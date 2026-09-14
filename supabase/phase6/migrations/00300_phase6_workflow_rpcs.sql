-- Phase 6 Step 3C.1 engine and Step 3C.2 transactional mutation RPCs.
-- Step 3C.2 extends THIS migration. Migrations 1/2 are unchanged.
-- All helpers are SECURITY INVOKER and are revoked from ordinary callers below.
-- The future, authorized RPC owner supplies privileges; Step 3D owns that role
-- and final RLS/grants. No BYPASSRLS role, legacy trigger change, or deployment.
-- Mutation writes: authenticate -> lock project -> receipt/retry -> version check
-- -> mutate -> increment version -> receipt, all in one transaction.

begin;

create type public.workflow_mutation_result as (
  project_id uuid,
  workflow_version bigint,
  project_snapshot jsonb,
  affected_entity_ids jsonb,
  history_event_ids uuid[],
  already_applied boolean
);

create table public.workflow_idempotency_receipts (
  id uuid primary key default gen_random_uuid(),
  rpc_name text not null check (length(btrim(rpc_name)) > 0),
  project_id uuid not null references public.projects(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  idempotency_key uuid not null,
  request_fingerprint text not null,
  result_payload jsonb not null check (jsonb_typeof(result_payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rpc_name, project_id, actor_id, idempotency_key)
);
alter table public.workflow_idempotency_receipts enable row level security;
revoke all on table public.workflow_idempotency_receipts from public, anon, authenticated;

-- 1. Calendar: eligible local dates, actual elapsed time, never staff work hours.
create function public._workflow_validate_calendar(
  p_start_at timestamptz, p_exclude_weekends boolean, p_timezone text
) returns void
language plpgsql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
begin
  if p_start_at is null or not isfinite(p_start_at)
     or p_exclude_weekends is null or p_timezone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone) then
    raise exception using message = 'workflow_invalid_calendar_input', errcode = '22023';
  end if;
end;
$fn$;

create function public._workflow_is_production_date(p_date date, p_exclude_weekends boolean)
returns boolean language plpgsql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_override boolean;
begin
  if p_date is null or not isfinite(p_date) or p_exclude_weekends is null then
    raise exception using message = 'workflow_invalid_calendar_input', errcode = '22023';
  end if;
  select c.is_working_day into v_override
  from public.workflow_calendar_exceptions c where c.calendar_date = p_date;
  if found then return v_override; end if;
  return not p_exclude_weekends or extract(isodow from p_date) < 6;
end;
$fn$;

create function public.workflow_add_production_days(
  p_start_at timestamptz, p_days integer,
  p_exclude_weekends boolean default true, p_timezone text default 'Asia/Karachi'
) returns timestamptz
language plpgsql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_local timestamp; v_day date; v_added integer := 0; v_result timestamptz;
begin
  perform public._workflow_validate_calendar(p_start_at, p_exclude_weekends, p_timezone);
  if p_days is null or p_days < 0 then
    raise exception using message = 'workflow_invalid_production_days', errcode = '22023';
  end if;
  if p_days = 0 then return p_start_at; end if;
  v_local := p_start_at at time zone p_timezone;
  v_day := v_local::date;
  while v_added < p_days loop
    v_day := v_day + 1; -- Start date deliberately never counted.
    if public._workflow_is_production_date(v_day, p_exclude_weekends) then
      v_added := v_added + 1;
    end if;
  end loop;
  v_result := (v_day + v_local::time) at time zone p_timezone;
  -- Do not silently change the requested wall clock in a DST gap/skipped date.
  if (v_result at time zone p_timezone) is distinct from (v_day + v_local::time) then
    raise exception using message = 'workflow_local_time_unrepresentable', errcode = '22023';
  end if;
  return v_result;
end;
$fn$;

create function public.workflow_production_seconds_between(
  p_start_at timestamptz, p_end_at timestamptz,
  p_exclude_weekends boolean default true, p_timezone text default 'Asia/Karachi'
) returns bigint
language plpgsql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_day date; v_left timestamptz; v_right timestamptz; v_total numeric := 0;
begin
  perform public._workflow_validate_calendar(p_start_at, p_exclude_weekends, p_timezone);
  if p_end_at is null or not isfinite(p_end_at) or p_end_at < p_start_at then
    raise exception using message = 'workflow_invalid_interval', errcode = '22023';
  end if;
  v_day := (p_start_at at time zone p_timezone)::date;
  while v_day <= (p_end_at at time zone p_timezone)::date loop
    v_left := greatest(p_start_at, v_day::timestamp at time zone p_timezone);
    v_right := least(p_end_at, (v_day + 1)::timestamp at time zone p_timezone);
    if v_right > v_left and public._workflow_is_production_date(v_day, p_exclude_weekends) then
      v_total := v_total + extract(epoch from (v_right - v_left));
    end if;
    v_day := v_day + 1;
  end loop;
  -- Floor ONCE after summing partial dates; never round up future seconds.
  return floor(v_total)::bigint;
end;
$fn$;

create function public.workflow_production_days_between(
  p_start_at timestamptz, p_end_at timestamptz,
  p_exclude_weekends boolean default true, p_timezone text default 'Asia/Karachi'
) returns numeric
language sql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
  select public.workflow_production_seconds_between(
    p_start_at, p_end_at, p_exclude_weekends, p_timezone
  )::numeric / 86400::numeric
$fn$;

comment on function public.workflow_production_days_between(timestamptz,timestamptz,boolean,text) is
  'Eligible whole elapsed seconds / 86400: fractional 24-hour-equivalent days, not inclusive date count, not 8-hour shifts, not an inverse of add_production_days. Subseconds floor once in seconds_between; DST dates may contribute 23/24/25 hours.';

create function public._workflow_add_production_seconds(
  p_start_at timestamptz, p_seconds bigint, p_exclude_weekends boolean, p_timezone text
) returns timestamptz
language plpgsql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_day date; v_cursor timestamptz; v_end timestamptz;
  v_available numeric; v_remaining numeric := p_seconds;
begin
  perform public._workflow_validate_calendar(p_start_at, p_exclude_weekends, p_timezone);
  if p_seconds is null or p_seconds < 0 then
    raise exception using message = 'workflow_invalid_production_seconds', errcode = '22023';
  end if;
  if p_seconds = 0 then return p_start_at; end if;
  v_cursor := p_start_at;
  v_day := (p_start_at at time zone p_timezone)::date;
  loop
    v_end := (v_day + 1)::timestamp at time zone p_timezone;
    if v_end > v_cursor and public._workflow_is_production_date(v_day, p_exclude_weekends) then
      v_available := extract(epoch from (v_end - v_cursor));
      if v_remaining <= v_available then
        return v_cursor + v_remaining * interval '1 second';
      end if;
      v_remaining := v_remaining - v_available;
    end if;
    v_cursor := greatest(v_cursor, v_end);
    v_day := v_day + 1;
  end loop;
end;
$fn$;

-- 2. Settings: canonical keys only; unknown compatibility keys are tolerated.
create function public._workflow_validate_settings(p_settings jsonb)
returns jsonb language plpgsql immutable security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_settings jsonb := coalesce(p_settings, '{}'::jsonb); v_key text; v_n numeric;
begin
  if jsonb_typeof(v_settings) <> 'object' then
    raise exception using message = 'workflow_invalid_settings', errcode = '22023';
  end if;
  if v_settings ? 'exclude_weekends' and jsonb_typeof(v_settings -> 'exclude_weekends') <> 'boolean' then
    raise exception using message = 'workflow_invalid_settings', errcode = '22023';
  end if;
  foreach v_key in array array['files_received_days', 'design_concept_days',
      'print_version_days', 'ebook_version_days', 'final_delivery_days', 'revision_days'] loop
    if v_settings ? v_key then
      if jsonb_typeof(v_settings -> v_key) <> 'number' then
        raise exception using message = 'workflow_invalid_settings', errcode = '22023';
      end if;
      v_n := (v_settings ->> v_key)::numeric;
      if v_n < 0 or v_n > 365 or trunc(v_n) <> v_n then
        raise exception using message = 'workflow_invalid_settings', errcode = '22023';
      end if;
    end if;
  end loop;
  return v_settings;
end;
$fn$;

create function public._workflow_stage_duration_days(p_stage public.workflow_stage, p_settings jsonb)
returns integer language plpgsql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_settings jsonb; v_definition public.workflow_stage_definitions%rowtype;
begin
  v_settings := public._workflow_validate_settings(p_settings);
  select d.* into v_definition from public.workflow_stage_definitions d where d.stage_key = p_stage;
  if not found then raise exception 'workflow_stage_unresolved'; end if;
  if v_definition.client_controlled then return 0; end if;
  return coalesce((v_settings ->> (p_stage::text || '_days'))::numeric::integer,
    v_definition.default_production_days::integer);
end;
$fn$;

create function public._workflow_revision_duration_days(p_settings jsonb)
returns integer language sql immutable security invoker set search_path = pg_catalog, pg_temp
as $fn$
  select coalesce((public._workflow_validate_settings(p_settings) ->> 'revision_days')::numeric::integer, 2)
$fn$;

create function public._workflow_exclude_weekends(p_settings jsonb)
returns boolean language sql immutable security invoker set search_path = pg_catalog, pg_temp
as $fn$
  select coalesce((public._workflow_validate_settings(p_settings) ->> 'exclude_weekends')::boolean, true)
$fn$;

-- Managed Supabase protects the auth schema from grants to application-owned
-- roles. This postgres-owned bridge exposes only the current request identity.
create function public.phase6_auth_uid()
returns uuid language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select auth.uid()
$fn$;
revoke all on function public.phase6_auth_uid() from public, anon, authenticated;

-- 3. Identity starts at the fixed auth bridge; supplied IDs never authorize a caller.
create function public._workflow_current_actor()
returns table(actor_id uuid, actor_role public.app_role, normalized_role text)
language plpgsql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_actor_id uuid := public.phase6_auth_uid();
begin
  if v_actor_id is null then raise exception 'workflow_unauthenticated'; end if;
  return query select p.id, p.role, case p.role::text
    when 'admin' then 'Admin'
    when 'project_manager' then 'Project Manager'
    when 'manager' then 'Project Manager'
    when 'employee' then 'Employee'
    when 'junior_assistant' then 'Employee'
    when 'client' then 'Client' end
  from public.profiles p where p.id = v_actor_id and p.status = 'active'
    and p.role::text in ('admin','project_manager','manager','employee','junior_assistant','client');
  if not found then raise exception 'workflow_actor_inactive_or_invalid'; end if;
end;
$fn$;

create function public._workflow_is_admin()
returns boolean language sql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
  select a.actor_role::text = 'admin' from public._workflow_current_actor() a
$fn$;

create function public._workflow_is_manager()
returns boolean language sql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
  select a.normalized_role in ('Admin','Project Manager') from public._workflow_current_actor() a
$fn$;

create function public._workflow_can_team_work(p_project_id uuid)
returns boolean language sql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
  select exists (
    select 1 from public._workflow_current_actor() a
    join public.projects p on p.id = p_project_id
    where a.normalized_role in ('Admin','Project Manager')
      or (a.normalized_role = 'Employee' and p.assigned_to = a.actor_id)
  )
$fn$;

create function public._workflow_can_client_access(p_project_id uuid)
returns boolean language sql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
  select exists (
    select 1 from public._workflow_current_actor() a
    join public.projects p on p.id = p_project_id
    where a.normalized_role = 'Client' and (
      p.client_profile_id = a.actor_id or exists (
        select 1 from public.client_project_access c
        where c.project_id = p.id and c.client_id = a.actor_id
      )
    )
  )
$fn$;

create function public._workflow_lock_project(p_project_id uuid)
returns public.projects
language plpgsql volatile security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_project public.projects%rowtype;
begin
  perform public._workflow_current_actor();
  select p.* into v_project from public.projects p where p.id = p_project_id for update;
  if not found then raise exception 'workflow_project_not_found'; end if;
  if not (public._workflow_can_team_work(p_project_id) or public._workflow_can_client_access(p_project_id)) then
    raise exception 'workflow_forbidden';
  end if;
  -- Specific RPC role checks remain mandatory in Step 3C.2.
  return v_project;
end;
$fn$;

-- 4. Least-privilege result shared by team AND client mutations. Internal
-- accounting/settings stay in protected helpers, never in this generic snapshot.
create function public._workflow_project_snapshot(p_project public.projects)
returns jsonb language sql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
  select jsonb_build_object(
    'id', p_project.id, 'project_status', p_project.project_status,
    'workflow_stage_key', p_project.workflow_stage_key,
    'workflow_stage_status_key', p_project.workflow_stage_status_key,
    'workflow_waiting_on_key', p_project.workflow_waiting_on_key,
    'workflow_version', p_project.workflow_version,
    'requires_print', p_project.requires_print, 'requires_ebook', p_project.requires_ebook,
    'service_capability_status', p_project.service_capability_status,
    'stage_started_at', p_project.stage_started_at, 'stage_due_at', p_project.stage_due_at,
    'stage_completed_at', p_project.stage_completed_at, 'final_due_at', p_project.final_due_at,
    'revision_count', p_project.revision_count, 'delivered_at', p_project.delivered_at,
    'status', p_project.status, 'current_stage', p_project.current_stage,
    'stage_status', p_project.stage_status, 'waiting_on', p_project.waiting_on,
    'timeline_status', p_project.timeline_status
  )
$fn$;

create function public._workflow_make_result(
  p_project_id uuid, p_affected_entity_ids jsonb, p_history_event_ids uuid[]
) returns public.workflow_mutation_result
language plpgsql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_project public.projects%rowtype;
begin
  if p_affected_entity_ids is null or jsonb_typeof(p_affected_entity_ids) <> 'object'
     or p_history_event_ids is null or array_position(p_history_event_ids, null) is not null then
    raise exception 'workflow_invalid_result';
  end if;
  select p.* into v_project from public.projects p where p.id = p_project_id;
  if not found then raise exception 'workflow_project_not_found'; end if;
  return row(v_project.id, v_project.workflow_version,
    public._workflow_project_snapshot(v_project), p_affected_entity_ids, p_history_event_ids, false)
    ::public.workflow_mutation_result;
end;
$fn$;

create function public._workflow_request_fingerprint(p_rpc_name text, p_project_id uuid, p_parameters jsonb)
returns text language plpgsql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_crypto_schema text; v_canonical_text text; v_fingerprint text;
begin
  if p_rpc_name is null or btrim(p_rpc_name) = '' or p_project_id is null
     or p_parameters is null or jsonb_typeof(p_parameters) <> 'object' then
    raise exception 'workflow_invalid_idempotency_input';
  end if;
  -- JSONB gives deterministic object-key ordering (including nested objects).
  -- Retain only SHA-256 hex, not duplicated notes/instructions/file references.
  -- C.2 MUST supply ALL behavior-changing parameters, including expected version,
  -- explicit defaults/NULLs, revision IDs, notes, decisions, files and settings.
  v_canonical_text := jsonb_build_object('contract', 'phase6-v1', 'rpc', p_rpc_name,
    'project_id', p_project_id, 'parameters', p_parameters)::text;
  -- Migration 1 uses CREATE EXTENSION IF NOT EXISTS pgcrypto without SCHEMA.
  -- Discover its actual schema (including relocated/pre-existing installations).
  -- Catalog access makes this helper STABLE rather than IMMUTABLE.
  select n.nspname into v_crypto_schema from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace where e.extname = 'pgcrypto';
  if v_crypto_schema is null then raise exception 'workflow_pgcrypto_unavailable'; end if;
  -- Identifier quoting and bound, explicitly typed values avoid search_path or
  -- overload ambiguity. The canonical request is transient, never persisted.
  execute pg_catalog.format(
    'select pg_catalog.encode(%I.digest($1::text, ''sha256''::text), ''hex''::text)', v_crypto_schema
  ) into v_fingerprint using v_canonical_text;
  return v_fingerprint;
end;
$fn$;

create function public._workflow_retry_result(
  p_payload jsonb, p_stored_fingerprint text, p_request_fingerprint text
) returns public.workflow_mutation_result
language plpgsql immutable security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_result public.workflow_mutation_result;
begin
  if p_stored_fingerprint is null or p_request_fingerprint is null
     or p_stored_fingerprint <> p_request_fingerprint then
    raise exception 'idempotency_key_reused';
  end if;
  select r.* into v_result from jsonb_populate_record(null::public.workflow_mutation_result, p_payload) r;
  if v_result.project_id is null or v_result.workflow_version is null
     or v_result.project_snapshot is null or v_result.affected_entity_ids is null
     or v_result.history_event_ids is null then raise exception 'workflow_receipt_corrupt'; end if;
  v_result.already_applied := true;
  return v_result;
end;
$fn$;

create function public._workflow_receipt_lookup(
  p_rpc_name text, p_project_id uuid, p_idempotency_key uuid, p_request_fingerprint text
) returns public.workflow_mutation_result
language plpgsql volatile security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_actor record; v_receipt public.workflow_idempotency_receipts%rowtype;
begin
  select * into v_actor from public._workflow_current_actor();
  if p_idempotency_key is null or p_request_fingerprint is null
     or p_rpc_name is null or btrim(p_rpc_name) = '' or p_project_id is null then
    raise exception 'workflow_invalid_idempotency_input';
  end if;
  -- Caller already holds the project FOR UPDATE lock. Deliberately no version check.
  select r.* into v_receipt from public.workflow_idempotency_receipts r
  where r.rpc_name = p_rpc_name and r.project_id = p_project_id
    and r.actor_id = v_actor.actor_id and r.idempotency_key = p_idempotency_key;
  if not found then return null; end if;
  return public._workflow_retry_result(v_receipt.result_payload,
    v_receipt.request_fingerprint, p_request_fingerprint);
end;
$fn$;

create function public._workflow_check_version(p_actual bigint, p_expected bigint)
returns void language plpgsql immutable security invoker set search_path = pg_catalog, pg_temp
as $fn$
begin
  -- NEW requests only: never call this before checking the receipt.
  if p_expected is null or p_actual is null or p_expected < 0 or p_expected <> p_actual then
    raise exception 'workflow_stale_version';
  end if;
end;
$fn$;

create function public._workflow_receipt_store(
  p_rpc_name text, p_project_id uuid, p_idempotency_key uuid,
  p_request_fingerprint text, p_result public.workflow_mutation_result, p_mutation_at timestamptz
) returns void language plpgsql volatile security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_actor record; v_previous public.workflow_mutation_result; v_project public.projects%rowtype;
begin
  select * into v_actor from public._workflow_current_actor();
  if p_mutation_at is null or not isfinite(p_mutation_at)
     or p_result.project_id is distinct from p_project_id
     or p_result.workflow_version is null or p_result.workflow_version < 0
     or p_result.already_applied is distinct from false
     or p_result.project_snapshot is null or jsonb_typeof(p_result.project_snapshot) <> 'object'
     or p_result.affected_entity_ids is null or jsonb_typeof(p_result.affected_entity_ids) <> 'object'
     or p_result.history_event_ids is null or array_position(p_result.history_event_ids, null) is not null then
    raise exception 'workflow_invalid_result';
  end if;
  v_previous := public._workflow_receipt_lookup(p_rpc_name, p_project_id, p_idempotency_key, p_request_fingerprint);
  if v_previous.project_id is not null then
    v_previous.already_applied := false;
    if to_jsonb(v_previous) is distinct from to_jsonb(p_result) then
      raise exception 'workflow_receipt_result_conflict';
    end if;
    return; -- Receipts are immutable; never overwrite a committed response.
  end if;
  select p.* into v_project from public.projects p where p.id = p_project_id;
  if not found then raise exception 'workflow_project_not_found'; end if;
  if p_result.workflow_version is distinct from v_project.workflow_version
     or p_result.project_snapshot is distinct from public._workflow_project_snapshot(v_project) then
    raise exception 'workflow_invalid_result';
  end if;
  insert into public.workflow_idempotency_receipts(
    rpc_name, project_id, actor_id, idempotency_key, request_fingerprint,
    result_payload, created_at, updated_at
  ) values (p_rpc_name, p_project_id, v_actor.actor_id, p_idempotency_key,
    p_request_fingerprint, to_jsonb(p_result), p_mutation_at, p_mutation_at);
end;
$fn$;

-- 5. Compatibility: exact values accepted by types.ts AND historical SQL checks.
create function public._workflow_compatibility_projection(
  p_lifecycle public.project_lifecycle_status, p_stage public.workflow_stage,
  p_status public.workflow_stage_status, p_waiting public.workflow_waiting_on
) returns jsonb language sql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
  select jsonb_build_object(
    'status', case
      when p_lifecycle = 'completed' then 'Completed'
      when p_lifecycle = 'on_hold' then 'On Hold'
      when p_lifecycle = 'cancelled' then 'Cancelled'
      when p_lifecycle = 'archived' then 'Archived'
      when p_lifecycle is null then null
      when p_status = 'awaiting_client' then 'Awaiting Client Approval'
      when p_status = 'revision_active' then 'In Revision'
      when p_stage = 'final_delivery' and p_status = 'active' then 'Final Delivery'
      else 'Active' end,
    'current_stage', (select d.display_name from public.workflow_stage_definitions d where d.stage_key = p_stage),
    'stage_status', case p_status
      when 'active' then 'ACTIVE' when 'revision_active' then 'REVISION_ACTIVE'
      when 'awaiting_client' then 'PAUSED_CLIENT_REVIEW' when 'pending' then 'PENDING'
      when 'skipped' then 'SKIPPED' when 'completed' then 'COMPLETED'
      when 'paused' then 'COMPLETED' end,
    'waiting_on', case p_waiting when 'team' then 'Manuscript Heaven'
      when 'client' then 'Client' when 'none' then 'None' end,
    'timeline_status', case
      when p_lifecycle = 'completed' then 'Completed'
      when p_lifecycle = 'on_hold' then 'On Hold'
      when p_lifecycle = 'cancelled' then 'Cancelled'
      when p_lifecycle = 'archived' then 'Paused'
      when p_status in ('active','revision_active') then 'Active'
      when p_status is not null then 'Paused' end
  )
$fn$;

-- Call AFTER UPDATE has finished, under the same project lock. VOLATILE is
-- intentional: a fresh command snapshot must see that UPDATE/its triggers.
create function public._workflow_assert_project_projection(p_expected public.projects)
returns void language plpgsql volatile security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_actual public.projects%rowtype; v_projection jsonb;
begin
  select p.* into v_actual from public.projects p where p.id = p_expected.id;
  if not found then raise exception 'workflow_project_not_found'; end if;
  v_projection := public._workflow_compatibility_projection(p_expected.project_status,
    p_expected.workflow_stage_key, p_expected.workflow_stage_status_key, p_expected.workflow_waiting_on_key);
  if public._workflow_project_snapshot(v_actual) is distinct from
       (public._workflow_project_snapshot(p_expected) || v_projection)
     -- Preserve internal conflict coverage without exposing these in the result.
     or v_actual.production_seconds_total is distinct from p_expected.production_seconds_total
     or v_actual.client_wait_seconds_total is distinct from p_expected.client_wait_seconds_total
     or v_actual.workflow_settings is distinct from p_expected.workflow_settings
     or v_actual.capabilities_resolved_by is distinct from p_expected.capabilities_resolved_by
     or v_actual.capabilities_resolved_at is distinct from p_expected.capabilities_resolved_at then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;
  -- No flag disables old triggers. C.2 must also validate its action-specific
  -- milestone/file fields and all related-row effects, not only this core projection.
end;
$fn$;

-- 6. Immutable append. CALLER MUST ALREADY HOLD projects FOR UPDATE and close
-- each open interval only once per mutation, even if it emits several events.
create function public._workflow_append_history(
  p_project_id uuid, p_event_type public.workflow_event_type,
  p_from_stage public.workflow_stage, p_to_stage public.workflow_stage,
  p_from_status public.workflow_stage_status, p_to_status public.workflow_stage_status,
  p_from_waiting public.workflow_waiting_on, p_to_waiting public.workflow_waiting_on,
  p_actor_id uuid, p_actor_role public.app_role,
  p_revision_request_id uuid, p_stage_skip_id uuid, p_admin_override_id uuid,
  p_production_delta bigint, p_client_wait_delta bigint,
  p_reason text, p_metadata jsonb, p_mutation_at timestamptz,
  p_due_at timestamptz default null, p_idempotency_key uuid default null
) returns uuid language plpgsql volatile security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_actor record; v_id uuid; v_sequence bigint; v_last_at timestamptz; v_projection jsonb;
begin
  select * into v_actor from public._workflow_current_actor();
  -- Actor inputs are audit snapshots ONLY, verified against auth.uid()/profile.
  if p_actor_id is distinct from v_actor.actor_id or p_actor_role is distinct from v_actor.actor_role then
    raise exception 'workflow_actor_mismatch';
  end if;
  if p_event_type is null or p_event_type = 'legacy_snapshot_imported'
     or p_to_status is null or p_mutation_at is null or not isfinite(p_mutation_at)
     or p_production_delta is null or p_client_wait_delta is null
     or p_production_delta < 0 or p_client_wait_delta < 0
     or p_metadata is null or jsonb_typeof(p_metadata) <> 'object'
     or (p_due_at is not null and not isfinite(p_due_at)) then
    raise exception 'workflow_invalid_history_event';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'workflow_project_not_found';
  end if;
  if (p_revision_request_id is not null and not exists (
      select 1 from public.revision_requests r where r.id = p_revision_request_id and r.project_id = p_project_id))
     or (p_stage_skip_id is not null and not exists (
      select 1 from public.project_stage_skips s where s.id = p_stage_skip_id and s.project_id = p_project_id))
     or (p_admin_override_id is not null and not exists (
      select 1 from public.admin_workflow_overrides o where o.id = p_admin_override_id and o.project_id = p_project_id)) then
    raise exception 'workflow_history_link_mismatch';
  end if;
  select coalesce(max(h.sequence_no), 0) + 1,
    max(h.occurred_at) filter (where h.event_type is not null)
  into v_sequence, v_last_at from public.project_stage_history h where h.project_id = p_project_id;
  if p_mutation_at < v_last_at then raise exception 'workflow_invalid_interval'; end if;
  v_projection := public._workflow_compatibility_projection(null, p_to_stage, p_to_status, p_to_waiting);
  insert into public.project_stage_history(
    project_id, sequence_no, event_type, from_stage, to_stage,
    from_stage_status, to_stage_status, from_waiting_on, to_waiting_on,
    occurred_at, due_at, production_seconds_delta, client_wait_seconds_delta,
    actor_id, actor_role, revision_request_id, stage_skip_id, admin_override_id,
    reason, metadata, idempotency_key, created_at,
    stage, previous_stage, status, action, active_seconds, client_wait_seconds
  ) values (
    p_project_id, v_sequence, p_event_type, p_from_stage, p_to_stage,
    p_from_status, p_to_status, p_from_waiting, p_to_waiting,
    p_mutation_at, p_due_at, p_production_delta, p_client_wait_delta,
    v_actor.actor_id, v_actor.actor_role, p_revision_request_id, p_stage_skip_id, p_admin_override_id,
    p_reason, p_metadata, p_idempotency_key, p_mutation_at,
    v_projection ->> 'current_stage',
    (select d.display_name from public.workflow_stage_definitions d where d.stage_key = p_from_stage),
    v_projection ->> 'stage_status', p_event_type::text, p_production_delta, p_client_wait_delta
  ) returning id into v_id;
  return v_id;
end;
$fn$;

-- 7. Accounting: the imported snapshot is a BASELINE BOUNDARY, not a delta.
create function public._workflow_accounting_baseline(p_project_id uuid)
returns table(snapshot_sequence bigint, snapshot_at timestamptz,
  production_baseline bigint, client_wait_baseline bigint)
language plpgsql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_snapshot public.project_stage_history%rowtype; v_json jsonb; v_key text; v_value numeric;
begin
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'workflow_project_not_found';
  end if;
  if (select count(*) from public.project_stage_history h where h.project_id = p_project_id
      and h.event_type = 'legacy_snapshot_imported') > 1 then raise exception 'workflow_accounting_corrupt'; end if;
  select h.* into v_snapshot from public.project_stage_history h
  where h.project_id = p_project_id and h.event_type = 'legacy_snapshot_imported';
  if not found then
    return query select null::bigint, null::timestamptz, 0::bigint, 0::bigint;
    return;
  end if;
  v_json := v_snapshot.metadata -> 'canonical_snapshot';
  if v_snapshot.sequence_no is null or v_snapshot.occurred_at is null
     or not isfinite(v_snapshot.occurred_at) or jsonb_typeof(v_json) is distinct from 'object' then
    raise exception 'workflow_accounting_corrupt';
  end if;
  foreach v_key in array array['production_seconds_total','client_wait_seconds_total'] loop
    if jsonb_typeof(v_json -> v_key) is distinct from 'number' then
      raise exception 'workflow_accounting_corrupt';
    end if;
    v_value := (v_json ->> v_key)::numeric;
    if v_value < 0 or v_value <> trunc(v_value) or v_value > 9223372036854775807::numeric then
      raise exception 'workflow_accounting_corrupt';
    end if;
  end loop;
  return query select v_snapshot.sequence_no, v_snapshot.occurred_at,
    (v_json ->> 'production_seconds_total')::numeric::bigint,
    (v_json ->> 'client_wait_seconds_total')::numeric::bigint;
end;
$fn$;

create function public._workflow_accounting_totals(p_project_id uuid)
returns table(production_seconds_total bigint, client_wait_seconds_total bigint)
language plpgsql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_baseline record;
begin
  select * into v_baseline from public._workflow_accounting_baseline(p_project_id);
  if exists (
    select 1 from public.project_stage_history h where h.project_id = p_project_id
      and h.event_type is not null and h.event_type <> 'legacy_snapshot_imported'
      and (h.sequence_no is null or (
        (v_baseline.snapshot_sequence is null or h.sequence_no > v_baseline.snapshot_sequence)
        and (h.production_seconds_delta is null or h.client_wait_seconds_delta is null
          or h.production_seconds_delta < 0 or h.client_wait_seconds_delta < 0)
      ))
  ) then raise exception 'workflow_accounting_corrupt'; end if;
  return query select
    (v_baseline.production_baseline + coalesce(sum(h.production_seconds_delta), 0))::bigint,
    (v_baseline.client_wait_baseline + coalesce(sum(h.client_wait_seconds_delta), 0))::bigint
  from public.project_stage_history h where h.project_id = p_project_id
    and h.event_type is not null and h.event_type <> 'legacy_snapshot_imported'
    and (v_baseline.snapshot_sequence is null or h.sequence_no > v_baseline.snapshot_sequence);
end;
$fn$;

create function public._workflow_effective_clock_start(p_project_id uuid, p_stage_started_at timestamptz)
returns timestamptz language plpgsql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_baseline record;
begin
  if p_stage_started_at is not null and not isfinite(p_stage_started_at) then
    raise exception 'workflow_invalid_interval';
  end if;
  select * into v_baseline from public._workflow_accounting_baseline(p_project_id);
  if v_baseline.snapshot_at is not null then return greatest(p_stage_started_at, v_baseline.snapshot_at); end if;
  return p_stage_started_at;
end;
$fn$;

create function public._workflow_interval_delta(
  p_project_id uuid, p_status public.workflow_stage_status, p_stage_started_at timestamptz,
  p_mutation_at timestamptz, p_settings jsonb
) returns table(production_seconds_delta bigint, client_wait_seconds_delta bigint)
language plpgsql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_start timestamptz; v_exclude boolean;
begin
  if p_status is null or p_mutation_at is null or not isfinite(p_mutation_at) then
    raise exception 'workflow_invalid_interval';
  end if;
  v_start := public._workflow_effective_clock_start(p_project_id, p_stage_started_at);
  if v_start > p_mutation_at then raise exception 'workflow_invalid_interval'; end if;
  v_exclude := public._workflow_exclude_weekends(p_settings);
  if v_start is null or p_status in ('pending','paused','completed','skipped') then
    return query select 0::bigint, 0::bigint;
  elsif p_status = 'awaiting_client' then
    return query select 0::bigint, floor(extract(epoch from (p_mutation_at - v_start)))::bigint;
  else
    return query select public.workflow_production_seconds_between(v_start, p_mutation_at,
      v_exclude, 'Asia/Karachi'), 0::bigint;
  end if;
end;
$fn$;

create function public._workflow_reconcile(p_project_id uuid)
returns table(project_id uuid, stored_production_seconds_total bigint,
  calculated_production_seconds_total bigint, stored_client_wait_seconds_total bigint,
  calculated_client_wait_seconds_total bigint, production_difference numeric, client_difference numeric)
language sql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
  select p.id, p.production_seconds_total, t.production_seconds_total,
    p.client_wait_seconds_total, t.client_wait_seconds_total,
    p.production_seconds_total::numeric - t.production_seconds_total,
    p.client_wait_seconds_total::numeric - t.client_wait_seconds_total
  from public._workflow_accounting_totals(p_project_id) t
  join public.projects p on p.id = p_project_id
$fn$;

-- 8. Routing is read-only: no stage/history mutation and no service-name parsing.
create function public._workflow_stage_required(
  p_stage public.workflow_stage, p_requires_print boolean, p_requires_ebook boolean,
  p_capability_status public.service_capability_status
) returns boolean language plpgsql immutable security invoker set search_path = pg_catalog, pg_temp
as $fn$
begin
  if p_requires_print is null or p_requires_ebook is null
     or p_capability_status is null or p_capability_status = 'needs_review' then
    raise exception 'service_capabilities_unresolved';
  end if;
  if not (p_requires_print or p_requires_ebook) then raise exception 'workflow_invalid_capabilities'; end if;
  if p_stage is null then raise exception 'workflow_stage_unresolved'; end if;
  if p_stage in ('print_version','print_approval') then return p_requires_print; end if;
  if p_stage in ('ebook_version','ebook_approval') then return p_requires_ebook; end if;
  return true;
end;
$fn$;

create function public._workflow_paired_approval(p_stage public.workflow_stage)
returns public.workflow_stage language sql immutable security invoker set search_path = pg_catalog, pg_temp
as $fn$
  select case p_stage
    when 'design_concept' then 'concept_approval'::public.workflow_stage
    when 'print_version' then 'print_approval'::public.workflow_stage
    when 'ebook_version' then 'ebook_approval'::public.workflow_stage end
$fn$;

create function public._workflow_skip_pair_root(p_stage public.workflow_stage)
returns public.workflow_stage language sql immutable security invoker set search_path = pg_catalog, pg_temp
as $fn$
  select case p_stage
    when 'concept_approval' then 'design_concept'::public.workflow_stage
    when 'print_approval' then 'print_version'::public.workflow_stage
    when 'ebook_approval' then 'ebook_version'::public.workflow_stage
    when 'design_concept' then p_stage when 'print_version' then p_stage when 'ebook_version' then p_stage end
$fn$;

create function public._workflow_approved_manual_skips(p_project_id uuid)
returns public.workflow_stage[] language sql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
  select coalesce(array_agg(distinct s.stage_key order by s.stage_key), '{}'::public.workflow_stage[])
  from public.project_stage_skips s
  where s.project_id = p_project_id and s.canonical_status = 'approved'
    and s.stage_key in ('design_concept','print_version','ebook_version')
  -- Legacy SERVICE_TYPE_PRESET and standalone approval rows never grant a skip.
$fn$;

create function public._workflow_has_approved_manual_skip(p_project_id uuid, p_stage public.workflow_stage)
returns boolean language sql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
  select coalesce(p_stage = any(public._workflow_approved_manual_skips(p_project_id)), false)
$fn$;

create function public._workflow_validate_manual_skips(p_manual_skips public.workflow_stage[])
returns void language plpgsql immutable security invoker set search_path = pg_catalog, pg_temp
as $fn$
begin
  if p_manual_skips is null or exists (
    select 1 from unnest(p_manual_skips) s(stage)
    where s.stage is null or s.stage not in ('design_concept','print_version','ebook_version')
  ) then raise exception 'workflow_invalid_manual_skips'; end if;
end;
$fn$;

create function public._workflow_next_stage(
  p_after_stage public.workflow_stage, p_requires_print boolean, p_requires_ebook boolean,
  p_capability_status public.service_capability_status,
  p_manual_skips public.workflow_stage[] default '{}'::public.workflow_stage[],
  p_include_current boolean default false
) returns table(next_stage public.workflow_stage, skipped_stages public.workflow_stage[], skip_reasons text[])
language plpgsql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_order smallint; v_stage record; v_reason text;
begin
  perform public._workflow_stage_required(p_after_stage, p_requires_print, p_requires_ebook, p_capability_status);
  perform public._workflow_validate_manual_skips(p_manual_skips);
  if p_include_current is null then raise exception 'workflow_invalid_routing_input'; end if;
  select d.stage_order into v_order from public.workflow_stage_definitions d where d.stage_key = p_after_stage;
  if not found then raise exception 'workflow_stage_unresolved'; end if;
  next_stage := null; skipped_stages := '{}'; skip_reasons := '{}';
  for v_stage in select d.stage_key, d.stage_order from public.workflow_stage_definitions d
    where d.stage_order > v_order or (p_include_current and d.stage_order = v_order)
    order by d.stage_order loop
    v_reason := null;
    if not public._workflow_stage_required(v_stage.stage_key, p_requires_print, p_requires_ebook, p_capability_status) then
      v_reason := 'capability_disabled';
    elsif public._workflow_skip_pair_root(v_stage.stage_key) = any(p_manual_skips) then
      v_reason := 'approved_manual_skip';
    end if;
    if v_reason is not null then
      skipped_stages := array_append(skipped_stages, v_stage.stage_key);
      skip_reasons := array_append(skip_reasons, v_reason);
    else
      next_stage := v_stage.stage_key;
      exit;
    end if;
  end loop;
  return next;
end;
$fn$;

create function public._workflow_route_project(p_project_id uuid, p_include_current boolean default false)
returns table(next_stage public.workflow_stage, skipped_stages public.workflow_stage[], skip_reasons text[])
language plpgsql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_project public.projects%rowtype;
begin
  select p.* into v_project from public.projects p where p.id = p_project_id;
  if not found then raise exception 'workflow_project_not_found'; end if;
  return query select r.* from public._workflow_next_stage(v_project.workflow_stage_key,
    v_project.requires_print, v_project.requires_ebook, v_project.service_capability_status,
    public._workflow_approved_manual_skips(p_project_id), p_include_current) r;
end;
$fn$;

create function public._workflow_capability_resume_route(
  p_lifecycle public.project_lifecycle_status, p_stage public.workflow_stage,
  p_status public.workflow_stage_status, p_waiting public.workflow_waiting_on,
  p_requires_print boolean, p_requires_ebook boolean,
  p_capability_status public.service_capability_status,
  p_manual_skips public.workflow_stage[] default '{}'::public.workflow_stage[]
) returns table(next_stage public.workflow_stage, skipped_stages public.workflow_stage[], skip_reasons text[])
language plpgsql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
begin
  if p_lifecycle is distinct from 'active'::public.project_lifecycle_status
     or p_status is distinct from 'completed'::public.workflow_stage_status
     or p_waiting is distinct from 'none'::public.workflow_waiting_on
     or p_stage is null or p_stage not in ('concept_approval','print_approval')
     or p_capability_status is distinct from 'confirmed'::public.service_capability_status then
    raise exception 'workflow_invalid_capability_resume';
  end if;
  return query select r.* from public._workflow_next_stage(p_stage, p_requires_print,
    p_requires_ebook, p_capability_status, p_manual_skips, false) r;
end;
$fn$;

-- 9. Remaining PRODUCTION estimate. Approval waiting is not forecast.
-- This pure-state core also permits isolated tests without Auth user fixtures.
create function public._workflow_estimate_remaining_production(
  p_project public.projects, p_as_of timestamptz,
  p_manual_skips public.workflow_stage[], p_revision_due_at timestamptz default null
) returns timestamptz
language plpgsql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_cursor timestamptz := p_as_of; v_current_order smallint;
  v_stage record; v_exclude boolean; v_due timestamptz;
begin
  if p_as_of is null or not isfinite(p_as_of) then raise exception 'workflow_invalid_interval'; end if;
  if p_project.project_status = 'completed' then return p_project.delivered_at; end if;
  if p_project.project_status is distinct from 'active'::public.project_lifecycle_status
     or p_project.workflow_stage_key is null or p_project.workflow_stage_status_key is null
     or p_project.workflow_waiting_on_key is null
     or p_project.requires_print is null or p_project.requires_ebook is null
     or p_project.service_capability_status is null or p_project.service_capability_status = 'needs_review'
     or not (p_project.requires_print or p_project.requires_ebook)
     or p_project.workflow_stage_status_key = 'paused' then return null; end if;
  perform public._workflow_validate_manual_skips(p_manual_skips);
  v_exclude := public._workflow_exclude_weekends(p_project.workflow_settings);
  select d.stage_order into v_current_order from public.workflow_stage_definitions d
  where d.stage_key = p_project.workflow_stage_key;
  if not found then return null; end if;
  if not public._workflow_stage_required(p_project.workflow_stage_key, p_project.requires_print,
      p_project.requires_ebook, p_project.service_capability_status) then return null; end if;
  -- Reject contradictory running-state ownership/control rather than guess work.
  if (p_project.workflow_stage_status_key in ('active','revision_active') and p_project.workflow_waiting_on_key <> 'team')
     or (p_project.workflow_stage_status_key = 'awaiting_client' and
       (p_project.workflow_waiting_on_key <> 'client' or v_current_order not in (3,5,7)))
     or (p_project.workflow_stage_status_key = 'revision_active' and v_current_order not in (3,5,7))
     or (p_project.workflow_stage_status_key = 'active' and v_current_order in (3,5,7)) then return null; end if;
  for v_stage in select d.* from public.workflow_stage_definitions d
    where d.stage_order >= v_current_order order by d.stage_order loop
    if not public._workflow_stage_required(v_stage.stage_key, p_project.requires_print,
        p_project.requires_ebook, p_project.service_capability_status)
       or public._workflow_skip_pair_root(v_stage.stage_key) = any(p_manual_skips) then continue; end if;
    if v_stage.stage_order = v_current_order then
      if p_project.workflow_stage_status_key in ('completed','skipped') then continue; end if;
      if p_project.workflow_stage_status_key in ('active','revision_active') then
        v_due := case when p_project.workflow_stage_status_key = 'revision_active'
          then coalesce(p_revision_due_at, p_project.stage_due_at) else p_project.stage_due_at end;
        if v_due is null then return null; end if;
        if not isfinite(v_due) then raise exception 'workflow_invalid_interval'; end if;
        -- An overdue running clock has unknown remaining effort: do not pretend
        -- that its deadline proves completion or arbitrarily allocate more days.
        if v_due < p_as_of then return null; end if;
        v_cursor := v_due;
        continue;
      end if;
    end if;
    if not v_stage.client_controlled then
      v_cursor := public.workflow_add_production_days(v_cursor,
        public._workflow_stage_duration_days(v_stage.stage_key, p_project.workflow_settings),
        v_exclude, 'Asia/Karachi');
    end if;
  end loop;
  return v_cursor;
end;
$fn$;

create function public._workflow_estimate_final_due(p_project_id uuid, p_as_of timestamptz)
returns timestamptz language plpgsql stable security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_project public.projects%rowtype; v_count bigint;
begin
  select p.* into v_project from public.projects p where p.id = p_project_id;
  if not found then raise exception 'workflow_project_not_found'; end if;
  if v_project.workflow_stage_status_key = 'revision_active' then
    -- The revision row retains its original/audit due. The project snapshot is
    -- the current operational deadline and may move after pause/resume.
    select count(*) into v_count from public.revision_requests r
    where r.project_id = p_project_id and r.stage_key = v_project.workflow_stage_key
      and r.canonical_status in ('submitted','under_review','in_progress','changes_requested')
      and not exists (select 1 from public.revision_requests child where child.parent_revision_request_id = r.id);
    if v_count <> 1 or v_project.stage_due_at is null then return null; end if;
  end if;
  return public._workflow_estimate_remaining_production(v_project, p_as_of,
    public._workflow_approved_manual_skips(p_project_id),
    case when v_project.workflow_stage_status_key = 'revision_active'
      then v_project.stage_due_at else null end);
end;
$fn$;

-- EXECUTE grants for exactly the helpers created in this migration follow.
revoke all on function public._workflow_validate_calendar(timestamptz,boolean,text) from public, anon, authenticated;
revoke all on function public._workflow_is_production_date(date,boolean) from public, anon, authenticated;
revoke all on function public.workflow_add_production_days(timestamptz,integer,boolean,text) from public, anon, authenticated;
revoke all on function public.workflow_production_seconds_between(timestamptz,timestamptz,boolean,text) from public, anon, authenticated;
revoke all on function public.workflow_production_days_between(timestamptz,timestamptz,boolean,text) from public, anon, authenticated;
revoke all on function public._workflow_add_production_seconds(timestamptz,bigint,boolean,text) from public, anon, authenticated;
revoke all on function public._workflow_validate_settings(jsonb) from public, anon, authenticated;
revoke all on function public._workflow_stage_duration_days(public.workflow_stage,jsonb) from public, anon, authenticated;
revoke all on function public._workflow_revision_duration_days(jsonb) from public, anon, authenticated;
revoke all on function public._workflow_exclude_weekends(jsonb) from public, anon, authenticated;
revoke all on function public.phase6_auth_uid() from public, anon, authenticated;
revoke all on function public._workflow_current_actor() from public, anon, authenticated;
revoke all on function public._workflow_is_admin() from public, anon, authenticated;
revoke all on function public._workflow_is_manager() from public, anon, authenticated;
revoke all on function public._workflow_can_team_work(uuid) from public, anon, authenticated;
revoke all on function public._workflow_can_client_access(uuid) from public, anon, authenticated;
revoke all on function public._workflow_lock_project(uuid) from public, anon, authenticated;
revoke all on function public._workflow_project_snapshot(public.projects) from public, anon, authenticated;
revoke all on function public._workflow_make_result(uuid,jsonb,uuid[]) from public, anon, authenticated;
revoke all on function public._workflow_request_fingerprint(text,uuid,jsonb) from public, anon, authenticated;
revoke all on function public._workflow_retry_result(jsonb,text,text) from public, anon, authenticated;
revoke all on function public._workflow_receipt_lookup(text,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public._workflow_check_version(bigint,bigint) from public, anon, authenticated;
revoke all on function public._workflow_receipt_store(text,uuid,uuid,text,public.workflow_mutation_result,timestamptz) from public, anon, authenticated;
revoke all on function public._workflow_compatibility_projection(public.project_lifecycle_status,public.workflow_stage,public.workflow_stage_status,public.workflow_waiting_on) from public, anon, authenticated;
revoke all on function public._workflow_assert_project_projection(public.projects) from public, anon, authenticated;
revoke all on function public._workflow_append_history(uuid,public.workflow_event_type,public.workflow_stage,public.workflow_stage,public.workflow_stage_status,public.workflow_stage_status,public.workflow_waiting_on,public.workflow_waiting_on,uuid,public.app_role,uuid,uuid,uuid,bigint,bigint,text,jsonb,timestamptz,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public._workflow_accounting_baseline(uuid) from public, anon, authenticated;
revoke all on function public._workflow_accounting_totals(uuid) from public, anon, authenticated;
revoke all on function public._workflow_effective_clock_start(uuid,timestamptz) from public, anon, authenticated;
revoke all on function public._workflow_interval_delta(uuid,public.workflow_stage_status,timestamptz,timestamptz,jsonb) from public, anon, authenticated;
revoke all on function public._workflow_reconcile(uuid) from public, anon, authenticated;
revoke all on function public._workflow_stage_required(public.workflow_stage,boolean,boolean,public.service_capability_status) from public, anon, authenticated;
revoke all on function public._workflow_paired_approval(public.workflow_stage) from public, anon, authenticated;
revoke all on function public._workflow_skip_pair_root(public.workflow_stage) from public, anon, authenticated;
revoke all on function public._workflow_approved_manual_skips(uuid) from public, anon, authenticated;
revoke all on function public._workflow_has_approved_manual_skip(uuid,public.workflow_stage) from public, anon, authenticated;
revoke all on function public._workflow_validate_manual_skips(public.workflow_stage[]) from public, anon, authenticated;
revoke all on function public._workflow_next_stage(public.workflow_stage,boolean,boolean,public.service_capability_status,public.workflow_stage[],boolean) from public, anon, authenticated;
revoke all on function public._workflow_route_project(uuid,boolean) from public, anon, authenticated;
revoke all on function public._workflow_capability_resume_route(public.project_lifecycle_status,public.workflow_stage,public.workflow_stage_status,public.workflow_waiting_on,boolean,boolean,public.service_capability_status,public.workflow_stage[]) from public, anon, authenticated;
revoke all on function public._workflow_estimate_remaining_production(public.projects,timestamptz,public.workflow_stage[],timestamptz) from public, anon, authenticated;
revoke all on function public._workflow_estimate_final_due(uuid,timestamptz) from public, anon, authenticated;

-- Calendar helpers remain private. Step 3D owns final owner/RLS posture.

-- Step 3C.2: internal mutation helpers and exactly eleven public RPCs.
create function public._workflow_lock_mutation_rows(
  p_project_id uuid
) returns void
language plpgsql volatile security invoker set search_path = pg_catalog, pg_temp
as $fn$
begin

  -- Project lock MUST precede these locks. Every canonical writer uses this order.
  perform r.id from public.revision_requests r where r.project_id = p_project_id order by r.id for update;
  perform s.id from public.project_stage_skips s where s.project_id = p_project_id order by s.id for update;
end;
$fn$;

create function public._workflow_validate_tuple(
  p_project public.projects
) returns void
language plpgsql volatile security invoker set search_path = pg_catalog, pg_temp
as $fn$
begin

  if p_project.project_status is null or p_project.workflow_stage_key is null
     or p_project.workflow_stage_status_key is null or p_project.workflow_waiting_on_key is null then
    raise exception 'workflow_invalid_state';
  end if;
  if p_project.project_status = 'completed' then
    if p_project.workflow_stage_key <> 'final_delivery' or p_project.workflow_stage_status_key <> 'completed'
       or p_project.workflow_waiting_on_key <> 'none' or p_project.delivered_at is null then
      raise exception 'workflow_invalid_state';
    end if;
  elsif p_project.project_status in ('on_hold','cancelled','archived') then
    if p_project.workflow_stage_status_key <> 'paused' or p_project.workflow_waiting_on_key <> 'none' then
      raise exception 'workflow_invalid_state';
    end if;
  elsif not (
    (p_project.workflow_stage_status_key = 'active' and p_project.workflow_waiting_on_key = 'team'
      and p_project.workflow_stage_key in ('files_received','design_concept','print_version','ebook_version','final_delivery'))
    or (p_project.workflow_stage_status_key = 'revision_active' and p_project.workflow_waiting_on_key = 'team'
      and p_project.workflow_stage_key in ('concept_approval','print_approval','ebook_approval'))
    or (p_project.workflow_stage_status_key = 'awaiting_client' and p_project.workflow_waiting_on_key = 'client'
      and p_project.workflow_stage_key in ('concept_approval','print_approval','ebook_approval'))
    or (p_project.workflow_stage_status_key = 'pending' and p_project.workflow_stage_key = 'files_received'
      and p_project.workflow_waiting_on_key in ('none','client'))
    or (p_project.workflow_stage_status_key = 'completed' and p_project.workflow_waiting_on_key = 'none'
      and p_project.workflow_stage_key in ('concept_approval','print_approval'))
  ) then raise exception 'workflow_invalid_state'; end if;
end;
$fn$;

create function public._workflow_operational_leaf(
  p_project_id uuid, p_stage public.workflow_stage
) returns public.revision_requests
language plpgsql volatile security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_count bigint; v_leaf public.revision_requests%rowtype;
begin

  -- Called under the project and related-row locks. Unknown evidence is not absence.
  if exists (select 1 from public.revision_requests r where r.project_id = p_project_id
      and (r.stage_key is null or (r.stage_key = p_stage and (r.canonical_status is null
        or r.revision_round is null or r.revision_round < 1)))) then
    raise exception 'workflow_revision_ambiguous';
  end if;
  if exists (select 1 from public.revision_requests r where r.project_id = p_project_id and r.stage_key = p_stage
      group by r.revision_round having count(*) > 1)
     or exists (select 1 from public.revision_requests r join public.revision_requests c
       on c.parent_revision_request_id = r.id where r.project_id = p_project_id and r.stage_key = p_stage
       and (c.project_id <> r.project_id or c.stage_key is distinct from r.stage_key
         or c.revision_round is null or c.revision_round <> r.revision_round + 1)) then
    raise exception 'workflow_revision_ambiguous';
  end if;
  select count(*) into v_count from public.revision_requests r
    where r.project_id = p_project_id and r.stage_key = p_stage
      and r.canonical_status not in ('approved','cancelled')
      and not exists (select 1 from public.revision_requests c where c.parent_revision_request_id = r.id);
  if v_count > 1 then raise exception 'workflow_revision_ambiguous'; end if;
  select r.* into v_leaf from public.revision_requests r
    where r.project_id = p_project_id and r.stage_key = p_stage
      and r.canonical_status not in ('approved','cancelled')
      and not exists (select 1 from public.revision_requests c where c.parent_revision_request_id = r.id);
  return v_leaf;
end;
$fn$;

create function public._workflow_checked_manual_skips(
  p_project_id uuid
) returns public.workflow_stage[]
language plpgsql volatile security invoker set search_path = pg_catalog, pg_temp
as $fn$
begin

  if exists (select 1 from public.project_stage_skips s where s.project_id = p_project_id
      and s.canonical_status = 'approved' and s.stage_key in ('design_concept','print_version','ebook_version')
      group by s.stage_key having count(*) > 1) then raise exception 'workflow_skip_ambiguous'; end if;
  if exists (select 1 from public.project_stage_skips s where s.project_id = p_project_id
      and s.status <> 'SERVICE_TYPE_PRESET' and (s.stage_key is null or s.canonical_status is null)) then
    raise exception 'workflow_skip_ambiguous';
  end if;
  return public._workflow_approved_manual_skips(p_project_id);
end;
$fn$;

create function public._workflow_enter_production(
  p_project public.projects, p_stage public.workflow_stage, p_mutation_at timestamptz
) returns public.projects
language plpgsql volatile security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_next public.projects := p_project;
begin

  if p_stage is null or p_stage not in ('files_received','design_concept','print_version','ebook_version','final_delivery') then
    raise exception 'workflow_invalid_state';
  end if;
  v_next.workflow_stage_key := p_stage;
  v_next.workflow_stage_status_key := 'active'; v_next.workflow_waiting_on_key := 'team';
  v_next.stage_started_at := p_mutation_at; v_next.stage_completed_at := null;
  v_next.stage_due_at := public.workflow_add_production_days(p_mutation_at,
    public._workflow_stage_duration_days(p_stage, v_next.workflow_settings),
    public._workflow_exclude_weekends(v_next.workflow_settings), 'Asia/Karachi');
  return v_next;
end;
$fn$;

create function public._workflow_event(
  p_event public.workflow_event_type, p_before public.projects, p_after public.projects, p_link jsonb, p_metadata jsonb
) returns jsonb
language plpgsql volatile security invoker set search_path = pg_catalog, pg_temp
as $fn$
begin

  return jsonb_build_array(jsonb_build_object('event', p_event,
    'from_stage', p_before.workflow_stage_key, 'to_stage', p_after.workflow_stage_key,
    'from_status', p_before.workflow_stage_status_key, 'to_status', p_after.workflow_stage_status_key,
    'from_waiting', p_before.workflow_waiting_on_key, 'to_waiting', p_after.workflow_waiting_on_key,
    'due_at', p_after.stage_due_at, 'links', p_link, 'metadata', p_metadata));
end;
$fn$;

create function public._workflow_route_events(
  p_project public.projects, p_stages public.workflow_stage[], p_reasons text[]
) returns jsonb
language plpgsql volatile security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_i integer; v_skip_id uuid; v_state public.projects := p_project; v_events jsonb := '[]';
begin

  if cardinality(p_stages) is distinct from cardinality(p_reasons) then raise exception 'workflow_invalid_state'; end if;
  for v_i in 1..coalesce(cardinality(p_stages),0) loop
    v_skip_id := null;
    if p_reasons[v_i] = 'approved_manual_skip' then
      select s.id into v_skip_id from public.project_stage_skips s where s.project_id = p_project.id
        and s.stage_key = public._workflow_skip_pair_root(p_stages[v_i]) and s.canonical_status = 'approved';
      if not found then raise exception 'workflow_skip_ambiguous'; end if;
      if exists (select 1 from public.project_stage_history h where h.project_id = p_project.id
          and h.stage_skip_id = v_skip_id and h.event_type = 'stage_skipped' and h.to_stage = p_stages[v_i]) then
        continue;
      end if;
    end if;
    v_state.workflow_stage_key := p_stages[v_i];
    v_state.workflow_stage_status_key := 'skipped'; v_state.workflow_waiting_on_key := 'none'; v_state.stage_due_at := null;
    v_events := v_events || public._workflow_event('stage_skipped',p_project,v_state,
      jsonb_build_object('stage_skip_id',v_skip_id),jsonb_build_object('skip_reason',p_reasons[v_i],'effective','routing'));
  end loop;
  return v_events;
end;
$fn$;

create function public._workflow_write_project(
  p_expected public.projects
) returns void
language plpgsql volatile security invoker set search_path = pg_catalog, pg_temp
as $fn$
begin

  -- Expected is built BEFORE UPDATE; RETURNING is never the source of truth.
  update public.projects set
    project_status = p_expected.project_status,
    workflow_stage_key = p_expected.workflow_stage_key,
    workflow_stage_status_key = p_expected.workflow_stage_status_key,
    workflow_waiting_on_key = p_expected.workflow_waiting_on_key,
    requires_print = p_expected.requires_print,
    requires_ebook = p_expected.requires_ebook,
    service_capability_status = p_expected.service_capability_status,
    capabilities_resolved_by = p_expected.capabilities_resolved_by,
    capabilities_resolved_at = p_expected.capabilities_resolved_at,
    workflow_settings = p_expected.workflow_settings,
    stage_started_at = p_expected.stage_started_at,
    stage_due_at = p_expected.stage_due_at,
    stage_completed_at = p_expected.stage_completed_at,
    delivered_at = p_expected.delivered_at,
    final_due_at = p_expected.final_due_at,
    revision_count = p_expected.revision_count,
    production_seconds_total = p_expected.production_seconds_total,
    client_wait_seconds_total = p_expected.client_wait_seconds_total,
    status = p_expected.status,
    current_stage = p_expected.current_stage,
    stage_status = p_expected.stage_status,
    waiting_on = p_expected.waiting_on,
    timeline_status = p_expected.timeline_status,
    files_received_date = p_expected.files_received_date,
    design_concept_submitted_date = p_expected.design_concept_submitted_date,
    design_concept_approval_date = p_expected.design_concept_approval_date,
    print_version_submitted_date = p_expected.print_version_submitted_date,
    print_version_approval_date = p_expected.print_version_approval_date,
    ebook_submitted_date = p_expected.ebook_submitted_date,
    ebook_approval_date = p_expected.ebook_approval_date,
    concept_revision_due_date = p_expected.concept_revision_due_date,
    print_revision_due_date = p_expected.print_revision_due_date,
    final_delivery_date = p_expected.final_delivery_date,
    delivery_date = p_expected.delivery_date,
    updated_at = p_expected.updated_at
  where id = p_expected.id;
  perform public._workflow_assert_project_projection(p_expected);
  perform public._workflow_assert_milestones(p_expected);
end;
$fn$;

create function public._workflow_assert_milestones(
  p_expected public.projects
) returns void
language plpgsql volatile security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_actual public.projects%rowtype;
begin

  select p.* into v_actual from public.projects p where p.id = p_expected.id;
  if not found or v_actual.files_received_date is distinct from p_expected.files_received_date
    or v_actual.design_concept_submitted_date is distinct from p_expected.design_concept_submitted_date
    or v_actual.design_concept_approval_date is distinct from p_expected.design_concept_approval_date
    or v_actual.print_version_submitted_date is distinct from p_expected.print_version_submitted_date
    or v_actual.print_version_approval_date is distinct from p_expected.print_version_approval_date
    or v_actual.ebook_submitted_date is distinct from p_expected.ebook_submitted_date
    or v_actual.ebook_approval_date is distinct from p_expected.ebook_approval_date
    or v_actual.concept_revision_due_date is distinct from p_expected.concept_revision_due_date
    or v_actual.print_revision_due_date is distinct from p_expected.print_revision_due_date
    or v_actual.final_delivery_date is distinct from p_expected.final_delivery_date
    or v_actual.delivery_date is distinct from p_expected.delivery_date
    or v_actual.updated_at is distinct from p_expected.updated_at then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;
end;
$fn$;

create function public._workflow_emit_events(
  p_project_id uuid, p_events jsonb, p_production_delta bigint, p_client_delta bigint, p_reason text, p_mutation_at timestamptz, p_idempotency_key uuid, p_primary_event_index integer default 1
) returns uuid[]
language plpgsql volatile security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_actor record; v_event jsonb; v_ids uuid[] := '{}';
begin

  select * into v_actor from public._workflow_current_actor();
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) = 0 then raise exception 'workflow_invalid_history_event'; end if;
  if p_primary_event_index is null or p_primary_event_index < 1 or p_primary_event_index > jsonb_array_length(p_events)
    then raise exception 'workflow_invalid_history_event'; end if;
  for v_event in select e.value from jsonb_array_elements(p_events) with ordinality e(value,ord) order by e.ord loop
    v_ids := array_append(v_ids,public._workflow_append_history(p_project_id,
      (v_event->>'event')::public.workflow_event_type,
      (v_event->>'from_stage')::public.workflow_stage,(v_event->>'to_stage')::public.workflow_stage,
      (v_event->>'from_status')::public.workflow_stage_status,(v_event->>'to_status')::public.workflow_stage_status,
      (v_event->>'from_waiting')::public.workflow_waiting_on,(v_event->>'to_waiting')::public.workflow_waiting_on,
      v_actor.actor_id,v_actor.actor_role,(v_event->'links'->>'revision_request_id')::uuid,
      (v_event->'links'->>'stage_skip_id')::uuid,(v_event->'links'->>'admin_override_id')::uuid,
      case when cardinality(v_ids)+1=p_primary_event_index then p_production_delta else 0 end,
      case when cardinality(v_ids)+1=p_primary_event_index then p_client_delta else 0 end,
      p_reason,v_event->'metadata',p_mutation_at,(v_event->>'due_at')::timestamptz,p_idempotency_key));
  end loop;
  return v_ids;
end;
$fn$;

create function public._workflow_notify(
  p_project public.projects, p_audience text, p_type text, p_revision_id uuid, p_mutation_at timestamptz
) returns uuid[]
language plpgsql volatile security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_recipient uuid; v_id uuid; v_ids uuid[] := '{}';
  v_title text := 'Project workflow updated'; v_message text;
begin

  if p_project.id is null or p_project.project_title is null or p_type is null or btrim(p_type) = ''
     or p_mutation_at is null or not isfinite(p_mutation_at)
     or p_audience not in ('clients','team') then raise exception 'workflow_invalid_notification'; end if;
  v_message := p_project.project_title || ': ' || replace(p_type,'_',' ');
  for v_recipient in select distinct a.id from public.profiles a where a.status = 'active' and (
    (p_audience = 'clients' and a.role::text = 'client' and (a.id = p_project.client_profile_id or exists
      (select 1 from public.client_project_access c where c.project_id = p_project.id and c.client_id = a.id)))
    or (p_audience = 'team' and a.role::text in ('admin','project_manager','manager','employee','junior_assistant')
      and a.id in (p_project.project_manager,p_project.assigned_to))) order by a.id loop
    insert into public.notifications(recipient_id,project_id,revision_request_id,type,title,message,is_read,created_at)
      values (v_recipient,p_project.id,p_revision_id,p_type,v_title,v_message,false,p_mutation_at)
      returning id into v_id;
    if v_id is null or v_id = any(v_ids) or not exists (
      select 1 from public.notifications n
      where n.id = v_id and n.project_id = p_project.id
        and n.recipient_id = v_recipient and n.type = p_type
        and n.revision_request_id is not distinct from p_revision_id
        and n.created_at = p_mutation_at and n.title = v_title
        and n.message = v_message and n.is_read is false
    ) then raise exception 'legacy_workflow_trigger_conflict'; end if;
    v_ids := array_append(v_ids,v_id);
  end loop;
  if array_position(v_ids,null) is not null
     or cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x)
     or cardinality(v_ids) <> (select count(*) from public.notifications n where n.id = any(v_ids)
       and n.project_id = p_project.id and n.type = p_type
       and n.revision_request_id is not distinct from p_revision_id
       and n.created_at = p_mutation_at and n.title = v_title and n.message = v_message
       and n.is_read is false)
    then raise exception 'legacy_workflow_trigger_conflict'; end if;
  return v_ids;
end;
$fn$;

create function public.workflow_advance_stage(
  p_project_id uuid, p_expected_workflow_version bigint, p_idempotency_key uuid, p_note text default null
) returns public.workflow_mutation_result
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp
as $fn$
declare v_actor record; v_before public.projects%rowtype; v_after public.projects%rowtype;
  v_intermediate public.projects%rowtype; v_fingerprint text; v_result public.workflow_mutation_result;
  v_mutation_at timestamptz; v_local_date date; v_production bigint := 0; v_client bigint := 0;
  v_events jsonb := '[]'; v_affected jsonb := '{}'; v_history uuid[]; v_notifications uuid[];
  v_manual public.workflow_stage[]; v_route record; v_leaf public.revision_requests%rowtype;
  v_revision public.revision_requests%rowtype; v_revision_id uuid; v_round integer;
  v_skip public.project_stage_skips%rowtype; v_skip_expected public.project_stage_skips%rowtype;
  v_override public.admin_workflow_overrides%rowtype; v_metadata jsonb; v_event public.workflow_event_type;
  v_saved public.project_stage_history%rowtype; v_settings jsonb; v_changed boolean; v_resume boolean;
  v_history_before bigint;
  v_target public.workflow_stage; v_key text; v_order integer; v_target_order integer;
begin

  select * into v_actor from public._workflow_current_actor();
  if not exists (select 1 from public.projects p where p.id = p_project_id) then raise exception 'workflow_project_not_found'; end if;
  if not public._workflow_can_team_work(p_project_id) then raise exception 'workflow_forbidden'; end if;
  v_before := public._workflow_lock_project(p_project_id);
  -- Recheck action access against the locked project, including reassignment.
  if not public._workflow_can_team_work(p_project_id) then raise exception 'workflow_forbidden'; end if;
  v_fingerprint := public._workflow_request_fingerprint('workflow_advance_stage',p_project_id,
    jsonb_build_object('expected_workflow_version',p_expected_workflow_version,'note',p_note));
  v_result := public._workflow_receipt_lookup('workflow_advance_stage',p_project_id,p_idempotency_key,v_fingerprint);
  if v_result.project_id is not null then return v_result; end if;
  perform public._workflow_check_version(v_before.workflow_version,p_expected_workflow_version);
  perform public._workflow_validate_tuple(v_before);
  if v_before.project_status is distinct from 'active'::public.project_lifecycle_status then raise exception 'workflow_invalid_state'; end if;
  
  if v_before.workflow_stage_key <> 'files_received' or v_before.workflow_stage_status_key not in ('pending','active')
    then raise exception 'workflow_invalid_state'; end if; if not public._workflow_stage_required(v_before.workflow_stage_key,v_before.requires_print,
    v_before.requires_ebook,v_before.service_capability_status) then raise exception 'workflow_invalid_state'; end if;
  perform public._workflow_lock_mutation_rows(p_project_id);
  v_after := v_before;
  v_manual := public._workflow_checked_manual_skips(p_project_id);
  select count(*) into v_history_before from public.project_stage_history h where h.project_id=p_project_id;
  v_mutation_at := clock_timestamp();
  v_local_date := (v_mutation_at at time zone 'Asia/Karachi')::date;
  select d.production_seconds_delta,d.client_wait_seconds_delta into v_production,v_client
    from public._workflow_interval_delta(p_project_id,v_before.workflow_stage_status_key,
      v_before.stage_started_at,v_mutation_at,v_before.workflow_settings) d;
  
  if v_before.workflow_stage_status_key = 'pending' then
    v_after := public._workflow_enter_production(v_after,'files_received',v_mutation_at);
  else
    -- Normally Files -> Design. An already client-approved future Design skip
    -- becomes effective here; it must not leave the project running a skipped pair.
    select * into v_route from public._workflow_next_stage(v_before.workflow_stage_key,
      v_before.requires_print,v_before.requires_ebook,v_before.service_capability_status,v_manual,false);
    v_events := public._workflow_route_events(v_before,v_route.skipped_stages,v_route.skip_reasons);
    v_after := public._workflow_enter_production(v_after,v_route.next_stage,v_mutation_at);
  end if;
  v_after.files_received_date := coalesce(v_before.files_received_date,v_local_date);
  v_events := v_events || public._workflow_event('stage_entered',v_before,v_after,'{}','{}');
  -- Related-table legacy triggers must not secretly mutate the project before
  -- our planned UPDATE overwrites the evidence of their divergence.
  if (select to_jsonb(p) from public.projects p where p.id=p_project_id) is distinct from to_jsonb(v_before) then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;
  v_after.production_seconds_total := v_before.production_seconds_total + v_production;
  v_after.client_wait_seconds_total := v_before.client_wait_seconds_total + v_client;
  v_after.updated_at := v_mutation_at;
  v_after := jsonb_populate_record(v_after,public._workflow_compatibility_projection(v_after.project_status,
    v_after.workflow_stage_key,v_after.workflow_stage_status_key,v_after.workflow_waiting_on_key));
  v_after.final_due_at := public._workflow_estimate_remaining_production(v_after,v_mutation_at,v_manual,
    case when v_after.workflow_stage_status_key = 'revision_active' then v_after.stage_due_at else null end);
  perform public._workflow_validate_tuple(v_after);
  perform public._workflow_write_project(v_after);
  perform public._workflow_assert_project_projection(v_after);
  perform public._workflow_assert_milestones(v_after);
  v_history := public._workflow_emit_events(p_project_id,v_events,v_production,v_client,p_note,v_mutation_at,p_idempotency_key,jsonb_array_length(v_events));
  v_notifications := public._workflow_notify(v_after,'team','advance_stage',v_revision_id,v_mutation_at);
  v_affected := v_affected || jsonb_build_object('notification_ids',v_notifications);
  -- One version increment per NEW request, after history and notifications.
  v_after.workflow_version := v_before.workflow_version + 1;
  update public.projects set workflow_version = v_after.workflow_version where id = p_project_id;
  perform public._workflow_assert_project_projection(v_after);
  perform public._workflow_assert_milestones(v_after);
  if (select count(*) from public.project_stage_history h where h.project_id=p_project_id) <> v_history_before + cardinality(v_history) then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;
  v_result := public._workflow_make_result(p_project_id,v_affected,v_history);
  perform public._workflow_receipt_store('workflow_advance_stage',p_project_id,p_idempotency_key,v_fingerprint,v_result,v_mutation_at);
  return v_result;
end;
$fn$;

create function public.workflow_submit_stage_for_approval(
  p_project_id uuid, p_expected_workflow_version bigint, p_idempotency_key uuid, p_note text default null
) returns public.workflow_mutation_result
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp
as $fn$
declare v_actor record; v_before public.projects%rowtype; v_after public.projects%rowtype;
  v_intermediate public.projects%rowtype; v_fingerprint text; v_result public.workflow_mutation_result;
  v_mutation_at timestamptz; v_local_date date; v_production bigint := 0; v_client bigint := 0;
  v_events jsonb := '[]'; v_affected jsonb := '{}'; v_history uuid[]; v_notifications uuid[];
  v_manual public.workflow_stage[]; v_route record; v_leaf public.revision_requests%rowtype;
  v_revision public.revision_requests%rowtype; v_revision_id uuid; v_round integer;
  v_skip public.project_stage_skips%rowtype; v_skip_expected public.project_stage_skips%rowtype;
  v_override public.admin_workflow_overrides%rowtype; v_metadata jsonb; v_event public.workflow_event_type;
  v_saved public.project_stage_history%rowtype; v_settings jsonb; v_changed boolean; v_resume boolean;
  v_history_before bigint;
  v_target public.workflow_stage; v_key text; v_order integer; v_target_order integer;
begin

  select * into v_actor from public._workflow_current_actor();
  if not exists (select 1 from public.projects p where p.id = p_project_id) then raise exception 'workflow_project_not_found'; end if;
  if not public._workflow_can_team_work(p_project_id) then raise exception 'workflow_forbidden'; end if;
  v_before := public._workflow_lock_project(p_project_id);
  -- Recheck action access against the locked project, including reassignment.
  if not public._workflow_can_team_work(p_project_id) then raise exception 'workflow_forbidden'; end if;
  v_fingerprint := public._workflow_request_fingerprint('workflow_submit_stage_for_approval',p_project_id,
    jsonb_build_object('expected_workflow_version',p_expected_workflow_version,'note',p_note));
  v_result := public._workflow_receipt_lookup('workflow_submit_stage_for_approval',p_project_id,p_idempotency_key,v_fingerprint);
  if v_result.project_id is not null then return v_result; end if;
  perform public._workflow_check_version(v_before.workflow_version,p_expected_workflow_version);
  perform public._workflow_validate_tuple(v_before);
  if v_before.project_status is distinct from 'active'::public.project_lifecycle_status then raise exception 'workflow_invalid_state'; end if;
  
  if v_before.workflow_stage_key not in ('design_concept','print_version','ebook_version')
    or v_before.workflow_stage_status_key <> 'active' or v_before.workflow_waiting_on_key <> 'team'
    then raise exception 'workflow_invalid_state'; end if; if not public._workflow_stage_required(v_before.workflow_stage_key,v_before.requires_print,
    v_before.requires_ebook,v_before.service_capability_status) then raise exception 'workflow_invalid_state'; end if;
  perform public._workflow_lock_mutation_rows(p_project_id);
  v_after := v_before;
  v_manual := public._workflow_checked_manual_skips(p_project_id);
  select count(*) into v_history_before from public.project_stage_history h where h.project_id=p_project_id;
  v_mutation_at := clock_timestamp();
  v_local_date := (v_mutation_at at time zone 'Asia/Karachi')::date;
  select d.production_seconds_delta,d.client_wait_seconds_delta into v_production,v_client
    from public._workflow_interval_delta(p_project_id,v_before.workflow_stage_status_key,
      v_before.stage_started_at,v_mutation_at,v_before.workflow_settings) d;
  
  v_after.workflow_stage_key := public._workflow_paired_approval(v_before.workflow_stage_key);
  v_after.workflow_stage_status_key := 'awaiting_client'; v_after.workflow_waiting_on_key := 'client';
  v_after.stage_started_at := v_mutation_at; v_after.stage_due_at := null; v_after.stage_completed_at := null;
  case v_before.workflow_stage_key
    when 'design_concept' then v_after.design_concept_submitted_date := v_local_date;
    when 'print_version' then v_after.print_version_submitted_date := v_local_date;
    when 'ebook_version' then v_after.ebook_submitted_date := v_local_date;
    else raise exception 'workflow_invalid_state'; end case;
  v_events := public._workflow_event('stage_submitted',v_before,v_after,'{}','{}');
  -- Related-table legacy triggers must not secretly mutate the project before
  -- our planned UPDATE overwrites the evidence of their divergence.
  if (select to_jsonb(p) from public.projects p where p.id=p_project_id) is distinct from to_jsonb(v_before) then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;
  v_after.production_seconds_total := v_before.production_seconds_total + v_production;
  v_after.client_wait_seconds_total := v_before.client_wait_seconds_total + v_client;
  v_after.updated_at := v_mutation_at;
  v_after := jsonb_populate_record(v_after,public._workflow_compatibility_projection(v_after.project_status,
    v_after.workflow_stage_key,v_after.workflow_stage_status_key,v_after.workflow_waiting_on_key));
  v_after.final_due_at := public._workflow_estimate_remaining_production(v_after,v_mutation_at,v_manual,
    case when v_after.workflow_stage_status_key = 'revision_active' then v_after.stage_due_at else null end);
  perform public._workflow_validate_tuple(v_after);
  perform public._workflow_write_project(v_after);
  perform public._workflow_assert_project_projection(v_after);
  perform public._workflow_assert_milestones(v_after);
  v_history := public._workflow_emit_events(p_project_id,v_events,v_production,v_client,p_note,v_mutation_at,p_idempotency_key);
  v_notifications := public._workflow_notify(v_after,'clients','milestone_submitted',v_revision_id,v_mutation_at);
  v_affected := v_affected || jsonb_build_object('notification_ids',v_notifications);
  -- One version increment per NEW request, after history and notifications.
  v_after.workflow_version := v_before.workflow_version + 1;
  update public.projects set workflow_version = v_after.workflow_version where id = p_project_id;
  perform public._workflow_assert_project_projection(v_after);
  perform public._workflow_assert_milestones(v_after);
  if (select count(*) from public.project_stage_history h where h.project_id=p_project_id) <> v_history_before + cardinality(v_history) then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;
  v_result := public._workflow_make_result(p_project_id,v_affected,v_history);
  perform public._workflow_receipt_store('workflow_submit_stage_for_approval',p_project_id,p_idempotency_key,v_fingerprint,v_result,v_mutation_at);
  return v_result;
end;
$fn$;

create function public.workflow_client_approve_stage(
  p_project_id uuid, p_expected_workflow_version bigint, p_idempotency_key uuid, p_note text default null
) returns public.workflow_mutation_result
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp
as $fn$
declare v_actor record; v_before public.projects%rowtype; v_after public.projects%rowtype;
  v_intermediate public.projects%rowtype; v_fingerprint text; v_result public.workflow_mutation_result;
  v_mutation_at timestamptz; v_local_date date; v_production bigint := 0; v_client bigint := 0;
  v_events jsonb := '[]'; v_affected jsonb := '{}'; v_history uuid[]; v_notifications uuid[];
  v_manual public.workflow_stage[]; v_route record; v_leaf public.revision_requests%rowtype;
  v_revision public.revision_requests%rowtype; v_revision_id uuid; v_round integer;
  v_skip public.project_stage_skips%rowtype; v_skip_expected public.project_stage_skips%rowtype;
  v_override public.admin_workflow_overrides%rowtype; v_metadata jsonb; v_event public.workflow_event_type;
  v_saved public.project_stage_history%rowtype; v_settings jsonb; v_changed boolean; v_resume boolean;
  v_history_before bigint;
  v_target public.workflow_stage; v_key text; v_order integer; v_target_order integer;
begin

  select * into v_actor from public._workflow_current_actor();
  if not exists (select 1 from public.projects p where p.id = p_project_id) then raise exception 'workflow_project_not_found'; end if;
  if not public._workflow_can_client_access(p_project_id) then raise exception 'workflow_forbidden'; end if;
  v_before := public._workflow_lock_project(p_project_id);
  -- Recheck action access against the locked project, including reassignment.
  if not public._workflow_can_client_access(p_project_id) then raise exception 'workflow_forbidden'; end if;
  v_fingerprint := public._workflow_request_fingerprint('workflow_client_approve_stage',p_project_id,
    jsonb_build_object('expected_workflow_version',p_expected_workflow_version,'note',p_note));
  v_result := public._workflow_receipt_lookup('workflow_client_approve_stage',p_project_id,p_idempotency_key,v_fingerprint);
  if v_result.project_id is not null then return v_result; end if;
  perform public._workflow_check_version(v_before.workflow_version,p_expected_workflow_version);
  perform public._workflow_validate_tuple(v_before);
  if v_before.project_status is distinct from 'active'::public.project_lifecycle_status then raise exception 'workflow_invalid_state'; end if;
  if v_before.workflow_stage_key not in ('concept_approval','print_approval','ebook_approval')
    or v_before.workflow_stage_status_key <> 'awaiting_client' or v_before.workflow_waiting_on_key <> 'client'
    then raise exception 'workflow_invalid_state'; end if; if not public._workflow_stage_required(v_before.workflow_stage_key,v_before.requires_print,
    v_before.requires_ebook,v_before.service_capability_status) then raise exception 'workflow_invalid_state'; end if;
  perform public._workflow_lock_mutation_rows(p_project_id);
  v_after := v_before;
  v_manual := public._workflow_checked_manual_skips(p_project_id);
  select count(*) into v_history_before from public.project_stage_history h where h.project_id=p_project_id;
  v_mutation_at := clock_timestamp();
  v_local_date := (v_mutation_at at time zone 'Asia/Karachi')::date;
  select d.production_seconds_delta,d.client_wait_seconds_delta into v_production,v_client
    from public._workflow_interval_delta(p_project_id,v_before.workflow_stage_status_key,
      v_before.stage_started_at,v_mutation_at,v_before.workflow_settings) d;
  
  v_leaf := public._workflow_operational_leaf(p_project_id,v_before.workflow_stage_key);
  if v_leaf.id is not null then
    if v_leaf.canonical_status <> 'ready_for_client_review' then raise exception 'workflow_revision_not_ready'; end if;
    v_revision_id := v_leaf.id;
    v_leaf.canonical_status := 'approved'; v_leaf.status := 'Approved';
    v_leaf.completed_at := v_mutation_at; v_leaf.updated_at := v_mutation_at;
    update public.revision_requests set canonical_status=v_leaf.canonical_status,status=v_leaf.status,
      completed_at=v_leaf.completed_at,updated_at=v_leaf.updated_at where id=v_leaf.id;
    if (select to_jsonb(r) from public.revision_requests r where r.id=v_leaf.id) is distinct from to_jsonb(v_leaf)
      then raise exception 'legacy_workflow_trigger_conflict'; end if;
    v_affected := jsonb_build_object('revision_request_id',v_leaf.id);
  end if;
  case v_before.workflow_stage_key
    when 'concept_approval' then v_after.design_concept_approval_date := v_local_date;
    when 'print_approval' then v_after.print_version_approval_date := v_local_date;
    when 'ebook_approval' then v_after.ebook_approval_date := v_local_date;
    else raise exception 'workflow_invalid_state'; end case;
  v_intermediate := v_after; v_intermediate.workflow_stage_status_key := 'completed';
  v_intermediate.workflow_waiting_on_key := 'none'; v_intermediate.stage_due_at := null;
  v_events := public._workflow_event('stage_approved',v_before,v_intermediate,'{}','{}');
  if v_leaf.id is not null then v_events := v_events || public._workflow_event('revision_approved',v_intermediate,v_intermediate,jsonb_build_object('revision_request_id',v_leaf.id),'{}'); end if;
  select * into v_route from public._workflow_next_stage(v_before.workflow_stage_key,
    v_after.requires_print,v_after.requires_ebook,v_after.service_capability_status,v_manual,false);
  v_after := public._workflow_enter_production(v_after,v_route.next_stage,v_mutation_at);
  v_events := v_events || public._workflow_route_events(v_intermediate,v_route.skipped_stages,v_route.skip_reasons)
    || public._workflow_event('stage_entered',v_intermediate,v_after,'{}','{}');
  -- Related-table legacy triggers must not secretly mutate the project before
  -- our planned UPDATE overwrites the evidence of their divergence.
  if (select to_jsonb(p) from public.projects p where p.id=p_project_id) is distinct from to_jsonb(v_before) then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;
  v_after.production_seconds_total := v_before.production_seconds_total + v_production;
  v_after.client_wait_seconds_total := v_before.client_wait_seconds_total + v_client;
  v_after.updated_at := v_mutation_at;
  v_after := jsonb_populate_record(v_after,public._workflow_compatibility_projection(v_after.project_status,
    v_after.workflow_stage_key,v_after.workflow_stage_status_key,v_after.workflow_waiting_on_key));
  v_after.final_due_at := public._workflow_estimate_remaining_production(v_after,v_mutation_at,v_manual,
    case when v_after.workflow_stage_status_key = 'revision_active' then v_after.stage_due_at else null end);
  perform public._workflow_validate_tuple(v_after);
  perform public._workflow_write_project(v_after);
  perform public._workflow_assert_project_projection(v_after);
  perform public._workflow_assert_milestones(v_after);
  v_history := public._workflow_emit_events(p_project_id,v_events,v_production,v_client,p_note,v_mutation_at,p_idempotency_key);
  v_notifications := public._workflow_notify(v_after,'team','client_approve_stage',v_revision_id,v_mutation_at);
  v_affected := v_affected || jsonb_build_object('notification_ids',v_notifications);
  -- One version increment per NEW request, after history and notifications.
  v_after.workflow_version := v_before.workflow_version + 1;
  update public.projects set workflow_version = v_after.workflow_version where id = p_project_id;
  perform public._workflow_assert_project_projection(v_after);
  perform public._workflow_assert_milestones(v_after);
  if (select count(*) from public.project_stage_history h where h.project_id=p_project_id) <> v_history_before + cardinality(v_history) then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;
  v_result := public._workflow_make_result(p_project_id,v_affected,v_history);
  perform public._workflow_receipt_store('workflow_client_approve_stage',p_project_id,p_idempotency_key,v_fingerprint,v_result,v_mutation_at);
  return v_result;
end;
$fn$;

create function public.workflow_submit_client_revision(
  p_project_id uuid, p_expected_workflow_version bigint, p_idempotency_key uuid, p_title text, p_instructions text, p_description text default '', p_priority text default 'Normal'
) returns public.workflow_mutation_result
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp
as $fn$
declare v_actor record; v_before public.projects%rowtype; v_after public.projects%rowtype;
  v_intermediate public.projects%rowtype; v_fingerprint text; v_result public.workflow_mutation_result;
  v_mutation_at timestamptz; v_local_date date; v_production bigint := 0; v_client bigint := 0;
  v_events jsonb := '[]'; v_affected jsonb := '{}'; v_history uuid[]; v_notifications uuid[];
  v_manual public.workflow_stage[]; v_route record; v_leaf public.revision_requests%rowtype;
  v_revision public.revision_requests%rowtype; v_revision_id uuid; v_round integer;
  v_skip public.project_stage_skips%rowtype; v_skip_expected public.project_stage_skips%rowtype;
  v_override public.admin_workflow_overrides%rowtype; v_metadata jsonb; v_event public.workflow_event_type;
  v_saved public.project_stage_history%rowtype; v_settings jsonb; v_changed boolean; v_resume boolean;
  v_history_before bigint;
  v_target public.workflow_stage; v_key text; v_order integer; v_target_order integer;
begin

  select * into v_actor from public._workflow_current_actor();
  if not exists (select 1 from public.projects p where p.id = p_project_id) then raise exception 'workflow_project_not_found'; end if;
  if not public._workflow_can_client_access(p_project_id) then raise exception 'workflow_forbidden'; end if;
  v_before := public._workflow_lock_project(p_project_id);
  -- Recheck action access against the locked project, including reassignment.
  if not public._workflow_can_client_access(p_project_id) then raise exception 'workflow_forbidden'; end if;
  v_fingerprint := public._workflow_request_fingerprint('workflow_submit_client_revision',p_project_id,
    jsonb_build_object('expected_workflow_version',p_expected_workflow_version,'title',p_title,'instructions',p_instructions,'description',p_description,'priority',p_priority));
  v_result := public._workflow_receipt_lookup('workflow_submit_client_revision',p_project_id,p_idempotency_key,v_fingerprint);
  if v_result.project_id is not null then return v_result; end if;
  perform public._workflow_check_version(v_before.workflow_version,p_expected_workflow_version);
  perform public._workflow_validate_tuple(v_before);
  if v_before.project_status is distinct from 'active'::public.project_lifecycle_status then raise exception 'workflow_invalid_state'; end if;
  if v_before.workflow_stage_key not in ('concept_approval','print_approval','ebook_approval')
    or v_before.workflow_stage_status_key <> 'awaiting_client' or v_before.workflow_waiting_on_key <> 'client'
    then raise exception 'workflow_invalid_state'; end if; if not public._workflow_stage_required(v_before.workflow_stage_key,v_before.requires_print,
    v_before.requires_ebook,v_before.service_capability_status) then raise exception 'workflow_invalid_state'; end if;
  if p_title is null or p_instructions is null or btrim(p_instructions) = '' or p_description is null
    or p_priority is null or p_priority not in ('Normal','Important','Urgent') then raise exception 'workflow_invalid_revision_input'; end if;
  perform public._workflow_lock_mutation_rows(p_project_id);
  v_after := v_before;
  v_manual := public._workflow_checked_manual_skips(p_project_id);
  select count(*) into v_history_before from public.project_stage_history h where h.project_id=p_project_id;
  v_mutation_at := clock_timestamp();
  v_local_date := (v_mutation_at at time zone 'Asia/Karachi')::date;
  select d.production_seconds_delta,d.client_wait_seconds_delta into v_production,v_client
    from public._workflow_interval_delta(p_project_id,v_before.workflow_stage_status_key,
      v_before.stage_started_at,v_mutation_at,v_before.workflow_settings) d;
  
  v_leaf := public._workflow_operational_leaf(p_project_id,v_before.workflow_stage_key);
  select coalesce(max(r.revision_round),0)+1 into v_round from public.revision_requests r
    where r.project_id=p_project_id and r.stage_key=v_before.workflow_stage_key;
  if v_leaf.id is not null then
    if v_leaf.canonical_status <> 'ready_for_client_review' then raise exception 'workflow_revision_not_ready'; end if;
    if v_round <> v_leaf.revision_round+1 then raise exception 'workflow_revision_ambiguous'; end if;
    v_leaf.canonical_status := 'changes_requested'; v_leaf.status := 'Additional Revision Required';
    v_leaf.updated_at := v_mutation_at;
    update public.revision_requests set canonical_status=v_leaf.canonical_status,status=v_leaf.status,
      updated_at=v_leaf.updated_at where id=v_leaf.id;
    if (select to_jsonb(r) from public.revision_requests r where r.id=v_leaf.id) is distinct from to_jsonb(v_leaf)
      then raise exception 'legacy_workflow_trigger_conflict'; end if;
  end if;
  v_after.workflow_stage_status_key := 'revision_active'; v_after.workflow_waiting_on_key := 'team';
  v_after.stage_started_at := v_mutation_at; v_after.stage_completed_at := null;
  v_after.stage_due_at := public.workflow_add_production_days(v_mutation_at,
    public._workflow_revision_duration_days(v_before.workflow_settings),
    public._workflow_exclude_weekends(v_before.workflow_settings),'Asia/Karachi');
  v_after.revision_count := coalesce(v_before.revision_count,0)+1;
  if v_before.workflow_stage_key='concept_approval' then
    v_after.concept_revision_due_date := (v_after.stage_due_at at time zone 'Asia/Karachi')::date;
  elsif v_before.workflow_stage_key='print_approval' then
    v_after.print_revision_due_date := (v_after.stage_due_at at time zone 'Asia/Karachi')::date;
  end if;
  v_revision_id := gen_random_uuid();
  insert into public.revision_requests(id,project_id,client_id,title,description,instructions,priority,
    stage_key,canonical_status,status,revision_round,parent_revision_request_id,assigned_to,
    submitted_at,due_at,created_at,updated_at,completed_at,team_response)
  values(v_revision_id,p_project_id,v_actor.actor_id,p_title,p_description,p_instructions,p_priority,
    v_before.workflow_stage_key,'submitted','Submitted',v_round,v_leaf.id,v_before.assigned_to,
    v_mutation_at,v_after.stage_due_at,v_mutation_at,v_mutation_at,null,null);
  select r.* into v_revision from public.revision_requests r where r.id=v_revision_id;
  if v_revision.id is null or v_revision.canonical_status is distinct from 'submitted'::public.workflow_revision_status
    or v_revision.status is distinct from 'Submitted' or v_revision.stage_key is distinct from v_before.workflow_stage_key
    or v_revision.project_id is distinct from p_project_id or v_revision.client_id is distinct from v_actor.actor_id
    or v_revision.revision_round is distinct from v_round or v_revision.parent_revision_request_id is distinct from v_leaf.id
    or v_revision.title is distinct from p_title or v_revision.description is distinct from p_description
    or v_revision.instructions is distinct from p_instructions or v_revision.priority is distinct from p_priority
    or v_revision.assigned_to is distinct from v_before.assigned_to or v_revision.team_response is not null
    or v_revision.submitted_at is distinct from v_mutation_at or v_revision.created_at is distinct from v_mutation_at
    or v_revision.updated_at is distinct from v_mutation_at or v_revision.due_at is distinct from v_after.stage_due_at
    or v_revision.completed_at is not null then raise exception 'legacy_workflow_trigger_conflict'; end if;
  if v_leaf.id is not null then
    v_events := public._workflow_event('revision_changes_requested',v_before,v_after,jsonb_build_object('revision_request_id',v_leaf.id),'{}');
  end if;
  v_events := v_events || public._workflow_event('revision_requested',v_before,v_after,jsonb_build_object('revision_request_id',v_revision_id),jsonb_build_object('revision_round',v_round,'parent_revision_request_id',v_leaf.id));
  v_affected := jsonb_build_object('revision_request_id',v_revision_id,'previous_revision_request_id',v_leaf.id);
  v_revision := public._workflow_operational_leaf(p_project_id,v_before.workflow_stage_key);
  if v_revision.id is distinct from v_revision_id then raise exception 'workflow_revision_ambiguous'; end if;
  -- Related-table legacy triggers must not secretly mutate the project before
  -- our planned UPDATE overwrites the evidence of their divergence.
  if (select to_jsonb(p) from public.projects p where p.id=p_project_id) is distinct from to_jsonb(v_before) then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;
  v_after.production_seconds_total := v_before.production_seconds_total + v_production;
  v_after.client_wait_seconds_total := v_before.client_wait_seconds_total + v_client;
  v_after.updated_at := v_mutation_at;
  v_after := jsonb_populate_record(v_after,public._workflow_compatibility_projection(v_after.project_status,
    v_after.workflow_stage_key,v_after.workflow_stage_status_key,v_after.workflow_waiting_on_key));
  v_after.final_due_at := public._workflow_estimate_remaining_production(v_after,v_mutation_at,v_manual,
    case when v_after.workflow_stage_status_key = 'revision_active' then v_after.stage_due_at else null end);
  perform public._workflow_validate_tuple(v_after);
  perform public._workflow_write_project(v_after);
  perform public._workflow_assert_project_projection(v_after);
  perform public._workflow_assert_milestones(v_after);
  v_history := public._workflow_emit_events(p_project_id,v_events,v_production,v_client,null,v_mutation_at,p_idempotency_key);
  v_notifications := public._workflow_notify(v_after,'team','revision_requested',v_revision_id,v_mutation_at);
  v_affected := v_affected || jsonb_build_object('notification_ids',v_notifications);
  -- One version increment per NEW request, after history and notifications.
  v_after.workflow_version := v_before.workflow_version + 1;
  update public.projects set workflow_version = v_after.workflow_version where id = p_project_id;
  perform public._workflow_assert_project_projection(v_after);
  perform public._workflow_assert_milestones(v_after);
  if (select count(*) from public.project_stage_history h where h.project_id=p_project_id) <> v_history_before + cardinality(v_history) then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;
  v_result := public._workflow_make_result(p_project_id,v_affected,v_history);
  perform public._workflow_receipt_store('workflow_submit_client_revision',p_project_id,p_idempotency_key,v_fingerprint,v_result,v_mutation_at);
  return v_result;
end;
$fn$;

create function public.workflow_submit_revised_proof(
  p_project_id uuid, p_expected_workflow_version bigint, p_idempotency_key uuid, p_revision_request_id uuid, p_team_response text default null
) returns public.workflow_mutation_result
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp
as $fn$
declare v_actor record; v_before public.projects%rowtype; v_after public.projects%rowtype;
  v_intermediate public.projects%rowtype; v_fingerprint text; v_result public.workflow_mutation_result;
  v_mutation_at timestamptz; v_local_date date; v_production bigint := 0; v_client bigint := 0;
  v_events jsonb := '[]'; v_affected jsonb := '{}'; v_history uuid[]; v_notifications uuid[];
  v_manual public.workflow_stage[]; v_route record; v_leaf public.revision_requests%rowtype;
  v_revision public.revision_requests%rowtype; v_revision_id uuid; v_round integer;
  v_skip public.project_stage_skips%rowtype; v_skip_expected public.project_stage_skips%rowtype;
  v_override public.admin_workflow_overrides%rowtype; v_metadata jsonb; v_event public.workflow_event_type;
  v_saved public.project_stage_history%rowtype; v_settings jsonb; v_changed boolean; v_resume boolean;
  v_history_before bigint;
  v_target public.workflow_stage; v_key text; v_order integer; v_target_order integer;
begin

  select * into v_actor from public._workflow_current_actor();
  if not exists (select 1 from public.projects p where p.id = p_project_id) then raise exception 'workflow_project_not_found'; end if;
  if not public._workflow_can_team_work(p_project_id) then raise exception 'workflow_forbidden'; end if;
  v_before := public._workflow_lock_project(p_project_id);
  -- Recheck action access against the locked project, including reassignment.
  if not public._workflow_can_team_work(p_project_id) then raise exception 'workflow_forbidden'; end if;
  v_fingerprint := public._workflow_request_fingerprint('workflow_submit_revised_proof',p_project_id,
    jsonb_build_object('expected_workflow_version',p_expected_workflow_version,'revision_request_id',p_revision_request_id,'team_response',p_team_response));
  v_result := public._workflow_receipt_lookup('workflow_submit_revised_proof',p_project_id,p_idempotency_key,v_fingerprint);
  if v_result.project_id is not null then return v_result; end if;
  perform public._workflow_check_version(v_before.workflow_version,p_expected_workflow_version);
  perform public._workflow_validate_tuple(v_before);
  if v_before.project_status is distinct from 'active'::public.project_lifecycle_status then raise exception 'workflow_invalid_state'; end if;
  
  if v_before.workflow_stage_key not in ('concept_approval','print_approval','ebook_approval')
    or v_before.workflow_stage_status_key <> 'revision_active' or v_before.workflow_waiting_on_key <> 'team'
    then raise exception 'workflow_invalid_state'; end if; if not public._workflow_stage_required(v_before.workflow_stage_key,v_before.requires_print,
    v_before.requires_ebook,v_before.service_capability_status) then raise exception 'workflow_invalid_state'; end if;
  perform public._workflow_lock_mutation_rows(p_project_id);
  v_after := v_before;
  v_manual := public._workflow_checked_manual_skips(p_project_id);
  select count(*) into v_history_before from public.project_stage_history h where h.project_id=p_project_id;
  v_mutation_at := clock_timestamp();
  v_local_date := (v_mutation_at at time zone 'Asia/Karachi')::date;
  select d.production_seconds_delta,d.client_wait_seconds_delta into v_production,v_client
    from public._workflow_interval_delta(p_project_id,v_before.workflow_stage_status_key,
      v_before.stage_started_at,v_mutation_at,v_before.workflow_settings) d;
  
  v_leaf := public._workflow_operational_leaf(p_project_id,v_before.workflow_stage_key);
  if p_revision_request_id is null or v_leaf.id is distinct from p_revision_request_id then
    raise exception 'workflow_revision_not_found'; end if;
  if v_leaf.canonical_status not in ('submitted','under_review','in_progress','changes_requested') then
    raise exception 'workflow_revision_not_ready'; end if;
  v_leaf.canonical_status := 'ready_for_client_review'; v_leaf.status := 'Ready for Client Review';
  v_leaf.team_response := coalesce(p_team_response,v_leaf.team_response); v_leaf.updated_at := v_mutation_at;
  update public.revision_requests set canonical_status=v_leaf.canonical_status,status=v_leaf.status,
    team_response=v_leaf.team_response,updated_at=v_leaf.updated_at where id=v_leaf.id;
  if (select to_jsonb(r) from public.revision_requests r where r.id=v_leaf.id) is distinct from to_jsonb(v_leaf)
    then raise exception 'legacy_workflow_trigger_conflict'; end if;
  v_after.workflow_stage_status_key := 'awaiting_client'; v_after.workflow_waiting_on_key := 'client';
  v_after.stage_started_at := v_mutation_at; v_after.stage_due_at := null; v_after.stage_completed_at := null;
  v_revision_id := v_leaf.id; v_affected := jsonb_build_object('revision_request_id',v_leaf.id);
  v_events := public._workflow_event('revised_proof_submitted',v_before,v_after,jsonb_build_object('revision_request_id',v_leaf.id),'{}');
  -- Related-table legacy triggers must not secretly mutate the project before
  -- our planned UPDATE overwrites the evidence of their divergence.
  if (select to_jsonb(p) from public.projects p where p.id=p_project_id) is distinct from to_jsonb(v_before) then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;
  v_after.production_seconds_total := v_before.production_seconds_total + v_production;
  v_after.client_wait_seconds_total := v_before.client_wait_seconds_total + v_client;
  v_after.updated_at := v_mutation_at;
  v_after := jsonb_populate_record(v_after,public._workflow_compatibility_projection(v_after.project_status,
    v_after.workflow_stage_key,v_after.workflow_stage_status_key,v_after.workflow_waiting_on_key));
  v_after.final_due_at := public._workflow_estimate_remaining_production(v_after,v_mutation_at,v_manual,
    case when v_after.workflow_stage_status_key = 'revision_active' then v_after.stage_due_at else null end);
  perform public._workflow_validate_tuple(v_after);
  perform public._workflow_write_project(v_after);
  perform public._workflow_assert_project_projection(v_after);
  perform public._workflow_assert_milestones(v_after);
  v_history := public._workflow_emit_events(p_project_id,v_events,v_production,v_client,null,v_mutation_at,p_idempotency_key);
  v_notifications := public._workflow_notify(v_after,'clients','revision_submitted',v_revision_id,v_mutation_at);
  v_affected := v_affected || jsonb_build_object('notification_ids',v_notifications);
  -- One version increment per NEW request, after history and notifications.
  v_after.workflow_version := v_before.workflow_version + 1;
  update public.projects set workflow_version = v_after.workflow_version where id = p_project_id;
  perform public._workflow_assert_project_projection(v_after);
  perform public._workflow_assert_milestones(v_after);
  if (select count(*) from public.project_stage_history h where h.project_id=p_project_id) <> v_history_before + cardinality(v_history) then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;
  v_result := public._workflow_make_result(p_project_id,v_affected,v_history);
  perform public._workflow_receipt_store('workflow_submit_revised_proof',p_project_id,p_idempotency_key,v_fingerprint,v_result,v_mutation_at);
  return v_result;
end;
$fn$;

create function public.workflow_request_stage_skip(
  p_project_id uuid, p_expected_workflow_version bigint, p_idempotency_key uuid, p_stage public.workflow_stage, p_reason text
) returns public.workflow_mutation_result
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp
as $fn$
declare v_actor record; v_before public.projects%rowtype; v_after public.projects%rowtype;
  v_intermediate public.projects%rowtype; v_fingerprint text; v_result public.workflow_mutation_result;
  v_mutation_at timestamptz; v_local_date date; v_production bigint := 0; v_client bigint := 0;
  v_events jsonb := '[]'; v_affected jsonb := '{}'; v_history uuid[]; v_notifications uuid[];
  v_manual public.workflow_stage[]; v_route record; v_leaf public.revision_requests%rowtype;
  v_revision public.revision_requests%rowtype; v_revision_id uuid; v_round integer;
  v_skip public.project_stage_skips%rowtype; v_skip_expected public.project_stage_skips%rowtype;
  v_override public.admin_workflow_overrides%rowtype; v_metadata jsonb; v_event public.workflow_event_type;
  v_saved public.project_stage_history%rowtype; v_settings jsonb; v_changed boolean; v_resume boolean;
  v_history_before bigint;
  v_target public.workflow_stage; v_key text; v_order integer; v_target_order integer;
begin

  select * into v_actor from public._workflow_current_actor();
  if not exists (select 1 from public.projects p where p.id = p_project_id) then raise exception 'workflow_project_not_found'; end if;
  if not public._workflow_can_team_work(p_project_id) then raise exception 'workflow_forbidden'; end if;
  v_before := public._workflow_lock_project(p_project_id);
  -- Recheck action access against the locked project, including reassignment.
  if not public._workflow_can_team_work(p_project_id) then raise exception 'workflow_forbidden'; end if;
  v_fingerprint := public._workflow_request_fingerprint('workflow_request_stage_skip',p_project_id,
    jsonb_build_object('expected_workflow_version',p_expected_workflow_version,'stage',p_stage,'reason',p_reason));
  v_result := public._workflow_receipt_lookup('workflow_request_stage_skip',p_project_id,p_idempotency_key,v_fingerprint);
  if v_result.project_id is not null then return v_result; end if;
  perform public._workflow_check_version(v_before.workflow_version,p_expected_workflow_version);
  perform public._workflow_validate_tuple(v_before);
  if v_before.project_status is distinct from 'active'::public.project_lifecycle_status then raise exception 'workflow_invalid_state'; end if;
  
  if not public._workflow_stage_required(v_before.workflow_stage_key,v_before.requires_print,
    v_before.requires_ebook,v_before.service_capability_status) then raise exception 'workflow_invalid_state'; end if;
  if p_stage is null or p_stage not in ('design_concept','print_version','ebook_version')
    or p_reason is null or btrim(p_reason)='' then raise exception 'workflow_invalid_skip_target'; end if;
  if not public._workflow_stage_required(p_stage,v_before.requires_print,v_before.requires_ebook,v_before.service_capability_status)
    then raise exception 'workflow_invalid_skip_target'; end if;
  select d.stage_order into v_order from public.workflow_stage_definitions d where d.stage_key=v_before.workflow_stage_key;
  select d.stage_order into v_target_order from public.workflow_stage_definitions d where d.stage_key=p_stage;
  if v_target_order<v_order then raise exception 'workflow_invalid_skip_target'; end if;
  perform public._workflow_lock_mutation_rows(p_project_id);
  v_after := v_before;
  v_manual := public._workflow_checked_manual_skips(p_project_id);
  select count(*) into v_history_before from public.project_stage_history h where h.project_id=p_project_id;
  v_mutation_at := clock_timestamp();
  v_local_date := (v_mutation_at at time zone 'Asia/Karachi')::date;
  
  
  if exists (select 1 from public.project_stage_skips s where s.project_id=p_project_id and s.stage_key=p_stage
    and s.canonical_status in ('pending','approved')) then raise exception 'workflow_skip_already_requested'; end if;
  v_skip.id := gen_random_uuid(); v_skip.project_id := p_project_id; v_skip.stage_key := p_stage;
  select d.display_name into v_skip.stage from public.workflow_stage_definitions d where d.stage_key=p_stage;
  v_skip.requester_id := v_actor.actor_id; v_skip.requested_by := v_actor.actor_id;
  v_skip.reason := p_reason; v_skip.canonical_status := 'pending'; v_skip.status := 'PENDING';
  v_skip.requested_at := v_mutation_at; v_skip.created_at := v_mutation_at; v_skip.updated_at := v_mutation_at;
  v_skip.idempotency_key := p_idempotency_key;
  insert into public.project_stage_skips select (v_skip).*;
  if (select to_jsonb(s) from public.project_stage_skips s where s.id=v_skip.id) is distinct from to_jsonb(v_skip)
    then raise exception 'legacy_workflow_trigger_conflict'; end if;
  v_events := public._workflow_event('stage_skip_requested',v_before,v_after,jsonb_build_object('stage_skip_id',v_skip.id),jsonb_build_object('requested_stage',p_stage));
  v_affected := jsonb_build_object('stage_skip_id',v_skip.id);
  -- Related-table legacy triggers must not secretly mutate the project before
  -- our planned UPDATE overwrites the evidence of their divergence.
  if (select to_jsonb(p) from public.projects p where p.id=p_project_id) is distinct from to_jsonb(v_before) then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;
  v_after.production_seconds_total := v_before.production_seconds_total + v_production;
  v_after.client_wait_seconds_total := v_before.client_wait_seconds_total + v_client;
  v_after.updated_at := v_mutation_at;
  v_after := jsonb_populate_record(v_after,public._workflow_compatibility_projection(v_after.project_status,
    v_after.workflow_stage_key,v_after.workflow_stage_status_key,v_after.workflow_waiting_on_key));
  
  perform public._workflow_validate_tuple(v_after);
  perform public._workflow_write_project(v_after);
  perform public._workflow_assert_project_projection(v_after);
  perform public._workflow_assert_milestones(v_after);
  v_history := public._workflow_emit_events(p_project_id,v_events,v_production,v_client,p_reason,v_mutation_at,p_idempotency_key);
  v_notifications := public._workflow_notify(v_after,'clients','skip_requested',v_revision_id,v_mutation_at);
  v_affected := v_affected || jsonb_build_object('notification_ids',v_notifications);
  -- One version increment per NEW request, after history and notifications.
  v_after.workflow_version := v_before.workflow_version + 1;
  update public.projects set workflow_version = v_after.workflow_version where id = p_project_id;
  perform public._workflow_assert_project_projection(v_after);
  perform public._workflow_assert_milestones(v_after);
  if (select count(*) from public.project_stage_history h where h.project_id=p_project_id) <> v_history_before + cardinality(v_history) then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;
  v_result := public._workflow_make_result(p_project_id,v_affected,v_history);
  perform public._workflow_receipt_store('workflow_request_stage_skip',p_project_id,p_idempotency_key,v_fingerprint,v_result,v_mutation_at);
  return v_result;
end;
$fn$;

create function public.workflow_respond_stage_skip(
  p_project_id uuid, p_expected_workflow_version bigint, p_idempotency_key uuid, p_stage_skip_id uuid, p_decision text, p_response_note text default null
) returns public.workflow_mutation_result
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp
as $fn$
declare v_actor record; v_before public.projects%rowtype; v_after public.projects%rowtype;
  v_intermediate public.projects%rowtype; v_fingerprint text; v_result public.workflow_mutation_result;
  v_mutation_at timestamptz; v_local_date date; v_production bigint := 0; v_client bigint := 0;
  v_events jsonb := '[]'; v_affected jsonb := '{}'; v_history uuid[]; v_notifications uuid[];
  v_manual public.workflow_stage[]; v_route record; v_leaf public.revision_requests%rowtype;
  v_revision public.revision_requests%rowtype; v_revision_id uuid; v_round integer;
  v_skip public.project_stage_skips%rowtype; v_skip_expected public.project_stage_skips%rowtype;
  v_override public.admin_workflow_overrides%rowtype; v_metadata jsonb; v_event public.workflow_event_type;
  v_saved public.project_stage_history%rowtype; v_settings jsonb; v_changed boolean; v_resume boolean;
  v_history_before bigint;
  v_target public.workflow_stage; v_key text; v_order integer; v_target_order integer;
begin

  select * into v_actor from public._workflow_current_actor();
  if not exists (select 1 from public.projects p where p.id = p_project_id) then raise exception 'workflow_project_not_found'; end if;
  if not public._workflow_can_client_access(p_project_id) then raise exception 'workflow_forbidden'; end if;
  v_before := public._workflow_lock_project(p_project_id);
  -- Recheck action access against the locked project, including reassignment.
  if not public._workflow_can_client_access(p_project_id) then raise exception 'workflow_forbidden'; end if;
  v_fingerprint := public._workflow_request_fingerprint('workflow_respond_stage_skip',p_project_id,
    jsonb_build_object('expected_workflow_version',p_expected_workflow_version,'stage_skip_id',p_stage_skip_id,'decision',p_decision,'response_note',p_response_note));
  v_result := public._workflow_receipt_lookup('workflow_respond_stage_skip',p_project_id,p_idempotency_key,v_fingerprint);
  if v_result.project_id is not null then return v_result; end if;
  perform public._workflow_check_version(v_before.workflow_version,p_expected_workflow_version);
  perform public._workflow_validate_tuple(v_before);
  if v_before.project_status is distinct from 'active'::public.project_lifecycle_status then raise exception 'workflow_invalid_state'; end if;
  
  if not public._workflow_stage_required(v_before.workflow_stage_key,v_before.requires_print,
    v_before.requires_ebook,v_before.service_capability_status) then raise exception 'workflow_invalid_state'; end if;
  if p_stage_skip_id is null or p_decision is null or p_decision not in ('approved','rejected')
    then raise exception 'workflow_invalid_skip_target'; end if;
  perform public._workflow_lock_mutation_rows(p_project_id);
  v_after := v_before;
  v_manual := public._workflow_checked_manual_skips(p_project_id);
  select count(*) into v_history_before from public.project_stage_history h where h.project_id=p_project_id;
  v_mutation_at := clock_timestamp();
  v_local_date := (v_mutation_at at time zone 'Asia/Karachi')::date;
  
  
  select s.* into v_skip from public.project_stage_skips s where s.id=p_stage_skip_id and s.project_id=p_project_id;
  if not found then raise exception 'workflow_invalid_skip_target'; end if;
  if v_skip.canonical_status is distinct from 'pending'::public.workflow_skip_status or v_skip.responded_at is not null
    or v_skip.cancelled_at is not null or v_skip.client_response_at is not null then raise exception 'workflow_skip_not_pending'; end if;
  if v_skip.stage_key is null or v_skip.stage_key not in ('design_concept','print_version','ebook_version') then
    raise exception 'workflow_invalid_skip_target'; end if;
  if exists(select 1 from public.project_stage_skips s where s.project_id=p_project_id and s.stage_key=v_skip.stage_key
    and s.id<>v_skip.id and s.canonical_status in ('pending','approved')) then raise exception 'workflow_skip_ambiguous'; end if;
  select d.stage_order into v_order from public.workflow_stage_definitions d where d.stage_key=v_before.workflow_stage_key;
  select d.stage_order into v_target_order from public.workflow_stage_definitions d where d.stage_key=v_skip.stage_key;
  if p_decision='approved' and (v_target_order<v_order or not public._workflow_stage_required(v_skip.stage_key,
    v_before.requires_print,v_before.requires_ebook,v_before.service_capability_status)) then raise exception 'workflow_invalid_skip_target'; end if;
  if p_decision='approved' and v_target_order=v_order and (v_before.workflow_stage_status_key<>'active'
    or v_before.workflow_waiting_on_key<>'team') then raise exception 'workflow_invalid_state'; end if;
  v_skip.canonical_status := p_decision::public.workflow_skip_status; v_skip.status := upper(p_decision);
  v_skip.responded_by := v_actor.actor_id; v_skip.responded_at := v_mutation_at;
  v_skip.client_response_at := v_mutation_at; v_skip.response_note := p_response_note; v_skip.client_notes := p_response_note;
  v_skip.updated_at := v_mutation_at;
  update public.project_stage_skips set canonical_status=v_skip.canonical_status,status=v_skip.status,
    responded_by=v_skip.responded_by,responded_at=v_skip.responded_at,client_response_at=v_skip.client_response_at,
    response_note=v_skip.response_note,client_notes=v_skip.client_notes,updated_at=v_skip.updated_at where id=v_skip.id;
  if (select to_jsonb(s) from public.project_stage_skips s where s.id=v_skip.id) is distinct from to_jsonb(v_skip)
    then raise exception 'legacy_workflow_trigger_conflict'; end if;
  v_affected := jsonb_build_object('stage_skip_id',v_skip.id);
  if p_decision='rejected' then
    v_events := public._workflow_event('stage_skip_rejected',v_before,v_after,jsonb_build_object('stage_skip_id',v_skip.id),'{}');
  else
    v_intermediate := v_before; v_intermediate.workflow_stage_status_key := 'skipped';
    v_intermediate.workflow_waiting_on_key := 'none'; v_intermediate.stage_due_at := null;
    v_intermediate.workflow_stage_key := v_skip.stage_key;
    v_metadata := jsonb_build_object('effective',case when v_target_order=v_order then 'immediate' else 'when_routing_reaches_target' end);
    v_events := public._workflow_event('stage_skipped',v_before,v_intermediate,jsonb_build_object('stage_skip_id',v_skip.id),v_metadata);
    v_intermediate.workflow_stage_key := public._workflow_paired_approval(v_skip.stage_key);
    v_events := v_events || public._workflow_event('stage_skipped',v_before,v_intermediate,jsonb_build_object('stage_skip_id',v_skip.id),v_metadata);
    v_manual := public._workflow_checked_manual_skips(p_project_id);
    if v_target_order=v_order then
      select d.production_seconds_delta,d.client_wait_seconds_delta into v_production,v_client
        from public._workflow_interval_delta(p_project_id,v_before.workflow_stage_status_key,
          v_before.stage_started_at,v_mutation_at,v_before.workflow_settings) d;
      select * into v_route from public._workflow_next_stage(v_before.workflow_stage_key,v_before.requires_print,
        v_before.requires_ebook,v_before.service_capability_status,v_manual,true);
      -- The first pair is already queued above; only queue further routed skips.
      v_events := v_events || public._workflow_route_events(v_before,v_route.skipped_stages[3:],v_route.skip_reasons[3:]);
      v_after := public._workflow_enter_production(v_after,v_route.next_stage,v_mutation_at);
      v_events := v_events || public._workflow_event('stage_entered',v_intermediate,v_after,'{}','{}');
      v_after.final_due_at := public._workflow_estimate_remaining_production(v_after,v_mutation_at,v_manual,null);
    elsif v_target_order>v_order then
      -- Approval changes the future route now, but leaves the current interval,
      -- stage tuple, anchor and operational due completely untouched.
      v_after.final_due_at := public._workflow_estimate_remaining_production(
        v_after,v_mutation_at,v_manual,
        case when v_after.workflow_stage_status_key = 'revision_active'
          then v_after.stage_due_at else null end);
    end if;
  end if;
  -- Related-table legacy triggers must not secretly mutate the project before
  -- our planned UPDATE overwrites the evidence of their divergence.
  if (select to_jsonb(p) from public.projects p where p.id=p_project_id) is distinct from to_jsonb(v_before) then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;
  v_after.production_seconds_total := v_before.production_seconds_total + v_production;
  v_after.client_wait_seconds_total := v_before.client_wait_seconds_total + v_client;
  v_after.updated_at := v_mutation_at;
  v_after := jsonb_populate_record(v_after,public._workflow_compatibility_projection(v_after.project_status,
    v_after.workflow_stage_key,v_after.workflow_stage_status_key,v_after.workflow_waiting_on_key));
  
  perform public._workflow_validate_tuple(v_after);
  perform public._workflow_write_project(v_after);
  perform public._workflow_assert_project_projection(v_after);
  perform public._workflow_assert_milestones(v_after);
  v_history := public._workflow_emit_events(p_project_id,v_events,v_production,v_client,p_response_note,v_mutation_at,p_idempotency_key);
  v_notifications := public._workflow_notify(v_after,'team','skip_response',v_revision_id,v_mutation_at);
  v_affected := v_affected || jsonb_build_object('notification_ids',v_notifications);
  -- One version increment per NEW request, after history and notifications.
  v_after.workflow_version := v_before.workflow_version + 1;
  update public.projects set workflow_version = v_after.workflow_version where id = p_project_id;
  perform public._workflow_assert_project_projection(v_after);
  perform public._workflow_assert_milestones(v_after);
  if (select count(*) from public.project_stage_history h where h.project_id=p_project_id) <> v_history_before + cardinality(v_history) then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;
  v_result := public._workflow_make_result(p_project_id,v_affected,v_history);
  perform public._workflow_receipt_store('workflow_respond_stage_skip',p_project_id,p_idempotency_key,v_fingerprint,v_result,v_mutation_at);
  return v_result;
end;
$fn$;

create function public.workflow_admin_override(
  p_project_id uuid, p_expected_workflow_version bigint, p_idempotency_key uuid, p_target_lifecycle public.project_lifecycle_status, p_target_stage public.workflow_stage, p_target_stage_status public.workflow_stage_status, p_target_waiting_on public.workflow_waiting_on, p_reason text, p_explanation text
) returns public.workflow_mutation_result
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp
as $fn$
declare v_actor record; v_before public.projects%rowtype; v_after public.projects%rowtype;
  v_intermediate public.projects%rowtype; v_fingerprint text; v_result public.workflow_mutation_result;
  v_mutation_at timestamptz; v_local_date date; v_production bigint := 0; v_client bigint := 0;
  v_events jsonb := '[]'; v_affected jsonb := '{}'; v_history uuid[]; v_notifications uuid[];
  v_manual public.workflow_stage[]; v_route record; v_leaf public.revision_requests%rowtype;
  v_revision public.revision_requests%rowtype; v_revision_id uuid; v_round integer;
  v_skip public.project_stage_skips%rowtype; v_skip_expected public.project_stage_skips%rowtype;
  v_override public.admin_workflow_overrides%rowtype; v_metadata jsonb; v_event public.workflow_event_type;
  v_saved public.project_stage_history%rowtype; v_settings jsonb; v_changed boolean; v_resume boolean;
  v_history_before bigint;
  v_target public.workflow_stage; v_key text; v_order integer; v_target_order integer;
begin

  select * into v_actor from public._workflow_current_actor();
  if not exists (select 1 from public.projects p where p.id = p_project_id) then raise exception 'workflow_project_not_found'; end if;
  if not public._workflow_is_admin() then raise exception 'workflow_forbidden'; end if;
  v_before := public._workflow_lock_project(p_project_id);
  -- Recheck action access against the locked project, including reassignment.
  if not public._workflow_is_admin() then raise exception 'workflow_forbidden'; end if;
  v_fingerprint := public._workflow_request_fingerprint('workflow_admin_override',p_project_id,
    jsonb_build_object('expected_workflow_version',p_expected_workflow_version,'target_lifecycle',p_target_lifecycle,'target_stage',p_target_stage,'target_stage_status',p_target_stage_status,'target_waiting_on',p_target_waiting_on,'reason',p_reason,'explanation',p_explanation));
  v_result := public._workflow_receipt_lookup('workflow_admin_override',p_project_id,p_idempotency_key,v_fingerprint);
  if v_result.project_id is not null then return v_result; end if;
  perform public._workflow_check_version(v_before.workflow_version,p_expected_workflow_version);
  
  
  
  if p_reason is null or length(btrim(p_reason))<10 then raise exception 'workflow_admin_reason_required'; end if;
  if p_explanation is null or btrim(p_explanation)='' then raise exception 'workflow_admin_reason_required'; end if;
  if v_before.workflow_stage_status_key is null then raise exception 'workflow_invalid_state'; end if;
  perform public._workflow_lock_mutation_rows(p_project_id);
  v_after := v_before;
  v_manual := public._workflow_checked_manual_skips(p_project_id);
  select count(*) into v_history_before from public.project_stage_history h where h.project_id=p_project_id;
  v_mutation_at := clock_timestamp();
  v_local_date := (v_mutation_at at time zone 'Asia/Karachi')::date;
  select d.production_seconds_delta,d.client_wait_seconds_delta into v_production,v_client
    from public._workflow_interval_delta(p_project_id,v_before.workflow_stage_status_key,
      v_before.stage_started_at,v_mutation_at,v_before.workflow_settings) d;
  
  v_after.project_status := p_target_lifecycle; v_after.workflow_stage_key := p_target_stage;
  v_after.workflow_stage_status_key := p_target_stage_status; v_after.workflow_waiting_on_key := p_target_waiting_on;
  perform public._workflow_validate_tuple(v_after);
  if p_target_lifecycle='completed' and (v_before.delivered_at is null or v_before.delivered_at>v_mutation_at)
    then raise exception 'workflow_final_delivery_required'; end if;
  if p_target_lifecycle='active' then
    if not public._workflow_stage_required(p_target_stage,v_after.requires_print,v_after.requires_ebook,v_after.service_capability_status)
      then raise exception 'workflow_invalid_capabilities'; end if;
    if p_target_stage_status='active' then
      v_after := public._workflow_enter_production(v_after,p_target_stage,v_mutation_at);
    elsif p_target_stage_status='revision_active' then
      v_leaf := public._workflow_operational_leaf(p_project_id,p_target_stage);
      if v_leaf.id is null or v_leaf.canonical_status not in ('submitted','under_review','in_progress','changes_requested')
        or v_leaf.due_at is null then raise exception 'workflow_revision_not_ready'; end if;
      v_after.stage_started_at := v_mutation_at; v_after.stage_due_at := v_leaf.due_at; v_after.stage_completed_at := null;
    elsif p_target_stage_status='awaiting_client' then
      v_leaf := public._workflow_operational_leaf(p_project_id,p_target_stage);
      if v_leaf.id is not null and v_leaf.canonical_status<>'ready_for_client_review' then raise exception 'workflow_revision_not_ready'; end if;
      v_after.stage_started_at := v_mutation_at; v_after.stage_due_at := null; v_after.stage_completed_at := null;
    else
      v_after.stage_started_at := null; v_after.stage_due_at := null; v_after.stage_completed_at := null;
    end if;
  else
    v_after.stage_started_at := null; v_after.stage_due_at := null;
    v_after.stage_completed_at := case when p_target_lifecycle='completed' then v_before.delivered_at else null end;
  end if;
  v_override.id := gen_random_uuid(); v_override.project_id := p_project_id; v_override.actor_id := v_actor.actor_id;
  -- Unknown canonical source can retain an actual legacy label; never invent one.
  v_override.previous_stage := coalesce(v_before.current_stage,
    (select d.display_name from public.workflow_stage_definitions d where d.stage_key=v_before.workflow_stage_key));
  if v_override.previous_stage is null then raise exception 'workflow_override_source_unresolved'; end if;
  select d.display_name into v_override.new_stage from public.workflow_stage_definitions d where d.stage_key=p_target_stage;
  v_override.reason := p_reason; v_override.explanation := p_explanation;
  v_override.previous_project_status := v_before.project_status; v_override.previous_stage_key := v_before.workflow_stage_key;
  v_override.previous_stage_status := v_before.workflow_stage_status_key; v_override.previous_waiting_on := v_before.workflow_waiting_on_key;
  v_override.previous_stage_started_at := v_before.stage_started_at; v_override.previous_stage_due_at := v_before.stage_due_at;
  v_override.resulting_project_status := v_after.project_status; v_override.resulting_stage_key := v_after.workflow_stage_key;
  v_override.resulting_stage_status := v_after.workflow_stage_status_key; v_override.resulting_waiting_on := v_after.workflow_waiting_on_key;
  v_override.resulting_stage_started_at := v_after.stage_started_at; v_override.resulting_stage_due_at := v_after.stage_due_at;
  v_override.idempotency_key := p_idempotency_key; v_override.created_at := v_mutation_at;
  insert into public.admin_workflow_overrides select (v_override).*;
  if (select to_jsonb(o) from public.admin_workflow_overrides o where o.id=v_override.id) is distinct from to_jsonb(v_override)
    then raise exception 'legacy_workflow_trigger_conflict'; end if;
  v_affected := jsonb_build_object('admin_override_id',v_override.id);
  v_events := public._workflow_event('admin_override_applied',v_before,v_after,jsonb_build_object('admin_override_id',v_override.id),jsonb_build_object('previous_delivered_at',v_before.delivered_at,'resulting_delivered_at',v_after.delivered_at,'previous_stage_completed_at',v_before.stage_completed_at,'resulting_stage_completed_at',v_after.stage_completed_at));
  -- Related-table legacy triggers must not secretly mutate the project before
  -- our planned UPDATE overwrites the evidence of their divergence.
  if (select to_jsonb(p) from public.projects p where p.id=p_project_id) is distinct from to_jsonb(v_before) then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;
  v_after.production_seconds_total := v_before.production_seconds_total + v_production;
  v_after.client_wait_seconds_total := v_before.client_wait_seconds_total + v_client;
  v_after.updated_at := v_mutation_at;
  v_after := jsonb_populate_record(v_after,public._workflow_compatibility_projection(v_after.project_status,
    v_after.workflow_stage_key,v_after.workflow_stage_status_key,v_after.workflow_waiting_on_key));
  v_after.final_due_at := public._workflow_estimate_remaining_production(v_after,v_mutation_at,v_manual,
    case when v_after.workflow_stage_status_key = 'revision_active' then v_after.stage_due_at else null end);
  perform public._workflow_validate_tuple(v_after);
  perform public._workflow_write_project(v_after);
  perform public._workflow_assert_project_projection(v_after);
  perform public._workflow_assert_milestones(v_after);
  v_history := public._workflow_emit_events(p_project_id,v_events,v_production,v_client,p_reason,v_mutation_at,p_idempotency_key);
  v_notifications := public._workflow_notify(v_after,'team','admin_override',v_revision_id,v_mutation_at);
  v_affected := v_affected || jsonb_build_object('notification_ids',v_notifications);
  -- One version increment per NEW request, after history and notifications.
  v_after.workflow_version := v_before.workflow_version + 1;
  update public.projects set workflow_version = v_after.workflow_version where id = p_project_id;
  perform public._workflow_assert_project_projection(v_after);
  perform public._workflow_assert_milestones(v_after);
  if (select count(*) from public.project_stage_history h where h.project_id=p_project_id) <> v_history_before + cardinality(v_history) then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;
  v_result := public._workflow_make_result(p_project_id,v_affected,v_history);
  perform public._workflow_receipt_store('workflow_admin_override',p_project_id,p_idempotency_key,v_fingerprint,v_result,v_mutation_at);
  return v_result;
end;
$fn$;

create function public.workflow_complete_final_delivery(
  p_project_id uuid, p_expected_workflow_version bigint, p_idempotency_key uuid, p_note text default null
) returns public.workflow_mutation_result
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp
as $fn$
declare v_actor record; v_before public.projects%rowtype; v_after public.projects%rowtype;
  v_intermediate public.projects%rowtype; v_fingerprint text; v_result public.workflow_mutation_result;
  v_mutation_at timestamptz; v_local_date date; v_production bigint := 0; v_client bigint := 0;
  v_events jsonb := '[]'; v_affected jsonb := '{}'; v_history uuid[]; v_notifications uuid[];
  v_manual public.workflow_stage[]; v_route record; v_leaf public.revision_requests%rowtype;
  v_revision public.revision_requests%rowtype; v_revision_id uuid; v_round integer;
  v_skip public.project_stage_skips%rowtype; v_skip_expected public.project_stage_skips%rowtype;
  v_override public.admin_workflow_overrides%rowtype; v_metadata jsonb; v_event public.workflow_event_type;
  v_saved public.project_stage_history%rowtype; v_settings jsonb; v_changed boolean; v_resume boolean;
  v_history_before bigint;
  v_target public.workflow_stage; v_key text; v_order integer; v_target_order integer;
begin

  select * into v_actor from public._workflow_current_actor();
  if not exists (select 1 from public.projects p where p.id = p_project_id) then raise exception 'workflow_project_not_found'; end if;
  if not public._workflow_can_team_work(p_project_id) then raise exception 'workflow_forbidden'; end if;
  v_before := public._workflow_lock_project(p_project_id);
  -- Recheck action access against the locked project, including reassignment.
  if not public._workflow_can_team_work(p_project_id) then raise exception 'workflow_forbidden'; end if;
  v_fingerprint := public._workflow_request_fingerprint('workflow_complete_final_delivery',p_project_id,
    jsonb_build_object('expected_workflow_version',p_expected_workflow_version,'note',p_note));
  v_result := public._workflow_receipt_lookup('workflow_complete_final_delivery',p_project_id,p_idempotency_key,v_fingerprint);
  if v_result.project_id is not null then return v_result; end if;
  perform public._workflow_check_version(v_before.workflow_version,p_expected_workflow_version);
  perform public._workflow_validate_tuple(v_before);
  if v_before.project_status is distinct from 'active'::public.project_lifecycle_status then raise exception 'workflow_invalid_state'; end if;
  
  if v_before.workflow_stage_key<>'final_delivery' or v_before.workflow_stage_status_key<>'active'
    or v_before.workflow_waiting_on_key<>'team' then raise exception 'workflow_invalid_state'; end if; if not public._workflow_stage_required(v_before.workflow_stage_key,v_before.requires_print,
    v_before.requires_ebook,v_before.service_capability_status) then raise exception 'workflow_invalid_state'; end if;
  perform public._workflow_lock_mutation_rows(p_project_id);
  v_after := v_before;
  v_manual := public._workflow_checked_manual_skips(p_project_id);
  select count(*) into v_history_before from public.project_stage_history h where h.project_id=p_project_id;
  v_mutation_at := clock_timestamp();
  v_local_date := (v_mutation_at at time zone 'Asia/Karachi')::date;
  select d.production_seconds_delta,d.client_wait_seconds_delta into v_production,v_client
    from public._workflow_interval_delta(p_project_id,v_before.workflow_stage_status_key,
      v_before.stage_started_at,v_mutation_at,v_before.workflow_settings) d;
  
  v_after.project_status := 'completed'; v_after.workflow_stage_status_key := 'completed'; v_after.workflow_waiting_on_key := 'none';
  v_after.stage_started_at := null; v_after.stage_due_at := null; v_after.stage_completed_at := v_mutation_at;
  v_after.delivered_at := v_mutation_at; v_after.final_delivery_date := v_local_date; v_after.delivery_date := v_local_date;
  v_after.final_due_at := v_mutation_at;
  v_events := public._workflow_event('final_delivery_completed',v_before,v_after,'{}','{}');
  -- Related-table legacy triggers must not secretly mutate the project before
  -- our planned UPDATE overwrites the evidence of their divergence.
  if (select to_jsonb(p) from public.projects p where p.id=p_project_id) is distinct from to_jsonb(v_before) then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;
  v_after.production_seconds_total := v_before.production_seconds_total + v_production;
  v_after.client_wait_seconds_total := v_before.client_wait_seconds_total + v_client;
  v_after.updated_at := v_mutation_at;
  v_after := jsonb_populate_record(v_after,public._workflow_compatibility_projection(v_after.project_status,
    v_after.workflow_stage_key,v_after.workflow_stage_status_key,v_after.workflow_waiting_on_key));
  v_after.final_due_at := public._workflow_estimate_remaining_production(v_after,v_mutation_at,v_manual,
    case when v_after.workflow_stage_status_key = 'revision_active' then v_after.stage_due_at else null end);
  perform public._workflow_validate_tuple(v_after);
  perform public._workflow_write_project(v_after);
  perform public._workflow_assert_project_projection(v_after);
  perform public._workflow_assert_milestones(v_after);
  v_history := public._workflow_emit_events(p_project_id,v_events,v_production,v_client,p_note,v_mutation_at,p_idempotency_key);
  v_notifications := public._workflow_notify(v_after,'clients','final_delivery_completed',v_revision_id,v_mutation_at);
  v_affected := v_affected || jsonb_build_object('notification_ids',v_notifications);
  -- One version increment per NEW request, after history and notifications.
  v_after.workflow_version := v_before.workflow_version + 1;
  update public.projects set workflow_version = v_after.workflow_version where id = p_project_id;
  perform public._workflow_assert_project_projection(v_after);
  perform public._workflow_assert_milestones(v_after);
  if (select count(*) from public.project_stage_history h where h.project_id=p_project_id) <> v_history_before + cardinality(v_history) then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;
  v_result := public._workflow_make_result(p_project_id,v_affected,v_history);
  perform public._workflow_receipt_store('workflow_complete_final_delivery',p_project_id,p_idempotency_key,v_fingerprint,v_result,v_mutation_at);
  return v_result;
end;
$fn$;

create function public.workflow_set_project_lifecycle(
  p_project_id uuid, p_expected_workflow_version bigint, p_idempotency_key uuid, p_target_lifecycle public.project_lifecycle_status, p_reason text default null
) returns public.workflow_mutation_result
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp
as $fn$
declare v_actor record; v_before public.projects%rowtype; v_after public.projects%rowtype;
  v_intermediate public.projects%rowtype; v_fingerprint text; v_result public.workflow_mutation_result;
  v_mutation_at timestamptz; v_local_date date; v_production bigint := 0; v_client bigint := 0;
  v_events jsonb := '[]'; v_affected jsonb := '{}'; v_history uuid[]; v_notifications uuid[];
  v_manual public.workflow_stage[]; v_route record; v_leaf public.revision_requests%rowtype;
  v_revision public.revision_requests%rowtype; v_revision_id uuid; v_round integer;
  v_skip public.project_stage_skips%rowtype; v_skip_expected public.project_stage_skips%rowtype;
  v_override public.admin_workflow_overrides%rowtype; v_metadata jsonb; v_event public.workflow_event_type;
  v_saved public.project_stage_history%rowtype; v_settings jsonb; v_changed boolean; v_resume boolean;
  v_history_before bigint;
  v_target public.workflow_stage; v_key text; v_order integer; v_target_order integer;
begin

  select * into v_actor from public._workflow_current_actor();
  if not exists (select 1 from public.projects p where p.id = p_project_id) then raise exception 'workflow_project_not_found'; end if;
  if not public._workflow_is_manager() then raise exception 'workflow_forbidden'; end if;
  v_before := public._workflow_lock_project(p_project_id);
  -- Recheck action access against the locked project, including reassignment.
  if not public._workflow_is_manager() then raise exception 'workflow_forbidden'; end if;
  v_fingerprint := public._workflow_request_fingerprint('workflow_set_project_lifecycle',p_project_id,
    jsonb_build_object('expected_workflow_version',p_expected_workflow_version,'target_lifecycle',p_target_lifecycle,'reason',p_reason));
  v_result := public._workflow_receipt_lookup('workflow_set_project_lifecycle',p_project_id,p_idempotency_key,v_fingerprint);
  if v_result.project_id is not null then return v_result; end if;
  perform public._workflow_check_version(v_before.workflow_version,p_expected_workflow_version);
  perform public._workflow_validate_tuple(v_before);
  
  
  if p_target_lifecycle is null or not (
    (v_before.project_status='active' and p_target_lifecycle in ('on_hold','cancelled'))
    or (v_before.project_status='on_hold' and p_target_lifecycle in ('active','cancelled'))
    or (v_before.project_status in ('completed','cancelled') and p_target_lifecycle='archived')
    or (v_before.project_status='archived' and p_target_lifecycle in ('completed','cancelled')))
    then raise exception 'workflow_invalid_lifecycle_transition'; end if;
  if p_target_lifecycle in ('cancelled','archived') and v_before.project_status<>'archived'
    and (p_reason is null or btrim(p_reason)='') then raise exception 'workflow_lifecycle_reason_required'; end if;
  perform public._workflow_lock_mutation_rows(p_project_id);
  v_after := v_before;
  v_manual := public._workflow_checked_manual_skips(p_project_id);
  select count(*) into v_history_before from public.project_stage_history h where h.project_id=p_project_id;
  v_mutation_at := clock_timestamp();
  v_local_date := (v_mutation_at at time zone 'Asia/Karachi')::date;
  select d.production_seconds_delta,d.client_wait_seconds_delta into v_production,v_client
    from public._workflow_interval_delta(p_project_id,v_before.workflow_stage_status_key,
      v_before.stage_started_at,v_mutation_at,v_before.workflow_settings) d;
  
  v_after.project_status := p_target_lifecycle;
  v_metadata := '{}';
  if p_target_lifecycle='on_hold' then
    v_event := 'project_paused';
    v_metadata := jsonb_build_object('previous_stage',v_before.workflow_stage_key,
      'previous_status',v_before.workflow_stage_status_key,'previous_waiting',v_before.workflow_waiting_on_key,
      'previous_due_at',v_before.stage_due_at,'overdue',v_before.stage_due_at<v_mutation_at,
      'remaining_production_seconds',case when v_before.workflow_stage_status_key in ('active','revision_active')
        and v_before.stage_due_at>=v_mutation_at then public.workflow_production_seconds_between(v_mutation_at,
          v_before.stage_due_at,public._workflow_exclude_weekends(v_before.workflow_settings),'Asia/Karachi') else null end);
    v_after.workflow_stage_status_key := 'paused'; v_after.workflow_waiting_on_key := 'none';
    v_after.stage_started_at := null; v_after.stage_due_at := null;
  elsif p_target_lifecycle='active' then
    v_event := 'project_resumed';
    select h.* into v_saved from public.project_stage_history h where h.project_id=p_project_id and h.event_type='project_paused'
      order by h.sequence_no desc limit 1;
    if not found or v_saved.to_stage is distinct from v_before.workflow_stage_key
      or v_saved.metadata->>'previous_stage' is distinct from v_before.workflow_stage_key::text
      or v_saved.metadata->>'previous_status' not in ('active','revision_active','awaiting_client','pending','completed')
      or v_saved.metadata->>'previous_status' is null then raise exception 'workflow_invalid_lifecycle_transition'; end if;
    if exists (select 1 from public.project_stage_history h where h.project_id=p_project_id and h.sequence_no>v_saved.sequence_no
      and h.event_type in ('project_resumed','admin_override_applied','project_cancelled','project_archived'))
      then raise exception 'workflow_invalid_lifecycle_transition'; end if;
    v_after.workflow_stage_status_key := (v_saved.metadata->>'previous_status')::public.workflow_stage_status;
    v_after.workflow_waiting_on_key := (v_saved.metadata->>'previous_waiting')::public.workflow_waiting_on;
    if v_after.workflow_stage_status_key in ('active','revision_active') then
      if v_saved.metadata->>'remaining_production_seconds' is not null then
        v_after.stage_due_at := public._workflow_add_production_seconds(v_mutation_at,
          (v_saved.metadata->>'remaining_production_seconds')::bigint,
          public._workflow_exclude_weekends(v_before.workflow_settings),'Asia/Karachi');
      elsif (v_saved.metadata->>'overdue')::boolean is true then
        v_after.stage_due_at := (v_saved.metadata->>'previous_due_at')::timestamptz;
        if v_after.stage_due_at is null or v_after.stage_due_at>=v_saved.occurred_at then raise exception 'workflow_invalid_lifecycle_transition'; end if;
      else raise exception 'workflow_invalid_lifecycle_transition'; end if;
      v_after.stage_started_at := v_mutation_at;
      if v_after.workflow_stage_status_key='revision_active' then
        if v_after.workflow_stage_key='concept_approval' then
          v_after.concept_revision_due_date := (v_after.stage_due_at at time zone 'Asia/Karachi')::date;
        elsif v_after.workflow_stage_key='print_approval' then
          v_after.print_revision_due_date := (v_after.stage_due_at at time zone 'Asia/Karachi')::date;
        end if;
      end if;
    elsif v_after.workflow_stage_status_key='awaiting_client' then
      v_after.stage_started_at := v_mutation_at; v_after.stage_due_at := null;
    else v_after.stage_started_at := null; v_after.stage_due_at := null; end if;
    v_metadata := jsonb_build_object('pause_event_id',v_saved.id);
  elsif v_before.project_status='archived' then
    v_event := 'project_unarchived';
    select h.* into v_saved from public.project_stage_history h where h.project_id=p_project_id and h.event_type='project_archived'
      order by h.sequence_no desc limit 1;
    if not found or v_saved.metadata->>'previous_lifecycle' is distinct from p_target_lifecycle::text
      or v_saved.to_stage is distinct from v_before.workflow_stage_key then raise exception 'workflow_invalid_lifecycle_transition'; end if;
    if exists (select 1 from public.project_stage_history h where h.project_id=p_project_id and h.sequence_no>v_saved.sequence_no
      and h.event_type in ('project_unarchived','admin_override_applied')) then raise exception 'workflow_invalid_lifecycle_transition'; end if;
    v_after.workflow_stage_status_key := case when p_target_lifecycle='completed' then 'completed'::public.workflow_stage_status else 'paused'::public.workflow_stage_status end;
    v_after.workflow_waiting_on_key := 'none'; v_after.stage_started_at := null; v_after.stage_due_at := null;
    v_metadata := jsonb_build_object('archive_event_id',v_saved.id);
  else
    v_event := case when p_target_lifecycle='archived' then 'project_archived'::public.workflow_event_type else 'project_cancelled'::public.workflow_event_type end;
    v_metadata := jsonb_build_object('previous_lifecycle',v_before.project_status);
    v_after.workflow_stage_status_key := 'paused'; v_after.workflow_waiting_on_key := 'none';
    v_after.stage_started_at := null; v_after.stage_due_at := null;
  end if;
  v_events := public._workflow_event(v_event,v_before,v_after,'{}',v_metadata);
  -- Related-table legacy triggers must not secretly mutate the project before
  -- our planned UPDATE overwrites the evidence of their divergence.
  if (select to_jsonb(p) from public.projects p where p.id=p_project_id) is distinct from to_jsonb(v_before) then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;
  v_after.production_seconds_total := v_before.production_seconds_total + v_production;
  v_after.client_wait_seconds_total := v_before.client_wait_seconds_total + v_client;
  v_after.updated_at := v_mutation_at;
  v_after := jsonb_populate_record(v_after,public._workflow_compatibility_projection(v_after.project_status,
    v_after.workflow_stage_key,v_after.workflow_stage_status_key,v_after.workflow_waiting_on_key));
  v_after.final_due_at := public._workflow_estimate_remaining_production(v_after,v_mutation_at,v_manual,
    case when v_after.workflow_stage_status_key = 'revision_active' then v_after.stage_due_at else null end);
  perform public._workflow_validate_tuple(v_after);
  perform public._workflow_write_project(v_after);
  perform public._workflow_assert_project_projection(v_after);
  perform public._workflow_assert_milestones(v_after);
  v_history := public._workflow_emit_events(p_project_id,v_events,v_production,v_client,p_reason,v_mutation_at,p_idempotency_key);
  v_notifications := public._workflow_notify(v_after,'team','set_project_lifecycle',v_revision_id,v_mutation_at);
  v_affected := v_affected || jsonb_build_object('notification_ids',v_notifications);
  -- One version increment per NEW request, after history and notifications.
  v_after.workflow_version := v_before.workflow_version + 1;
  update public.projects set workflow_version = v_after.workflow_version where id = p_project_id;
  perform public._workflow_assert_project_projection(v_after);
  perform public._workflow_assert_milestones(v_after);
  if (select count(*) from public.project_stage_history h where h.project_id=p_project_id) <> v_history_before + cardinality(v_history) then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;
  v_result := public._workflow_make_result(p_project_id,v_affected,v_history);
  perform public._workflow_receipt_store('workflow_set_project_lifecycle',p_project_id,p_idempotency_key,v_fingerprint,v_result,v_mutation_at);
  return v_result;
end;
$fn$;

create function public._workflow_format_evidence(
  p_project public.projects, p_format text
) returns boolean
language plpgsql volatile security invoker set search_path = pg_catalog, pg_temp
as $fn$
declare v_stages public.workflow_stage[];
begin

  if p_format not in ('print','ebook') then raise exception 'workflow_invalid_configuration'; end if;
  v_stages := case when p_format='print' then array['print_version','print_approval']::public.workflow_stage[]
    else array['ebook_version','ebook_approval']::public.workflow_stage[] end;
  return p_project.workflow_stage_key=any(v_stages)
    or (p_format='print' and (p_project.print_version_submitted_date is not null or p_project.print_version_approval_date is not null
      or p_project.print_revision_due_date is not null or p_project.print_version_due_date is not null))
    or (p_format='ebook' and (p_project.ebook_submitted_date is not null or p_project.ebook_approval_date is not null or p_project.ebook_due_date is not null))
    or exists (select 1 from public.revision_requests r where r.project_id=p_project.id and r.stage_key=any(v_stages))
    or exists (select 1 from public.project_stage_history h where h.project_id=p_project.id
      and h.event_type is not null and h.event_type not in ('legacy_snapshot_imported','stage_skipped','stage_skip_requested','stage_skip_rejected')
      and (h.from_stage=any(v_stages) or h.to_stage=any(v_stages)));

end;
$fn$;

create function public.workflow_update_project_configuration(
  p_project_id uuid, p_expected_workflow_version bigint, p_idempotency_key uuid, p_requires_print boolean, p_requires_ebook boolean, p_workflow_settings jsonb
) returns public.workflow_mutation_result
language plpgsql volatile security definer set search_path = pg_catalog, pg_temp
as $fn$
declare v_actor record; v_before public.projects%rowtype; v_after public.projects%rowtype;
  v_intermediate public.projects%rowtype; v_fingerprint text; v_result public.workflow_mutation_result;
  v_mutation_at timestamptz; v_local_date date; v_production bigint := 0; v_client bigint := 0;
  v_events jsonb := '[]'; v_affected jsonb := '{}'; v_history uuid[]; v_notifications uuid[];
  v_manual public.workflow_stage[]; v_route record; v_leaf public.revision_requests%rowtype;
  v_revision public.revision_requests%rowtype; v_revision_id uuid; v_round integer;
  v_skip public.project_stage_skips%rowtype; v_skip_expected public.project_stage_skips%rowtype;
  v_override public.admin_workflow_overrides%rowtype; v_metadata jsonb; v_event public.workflow_event_type;
  v_saved public.project_stage_history%rowtype; v_settings jsonb; v_changed boolean; v_resume boolean;
  v_history_before bigint;
  v_target public.workflow_stage; v_key text; v_order integer; v_target_order integer;
begin

  select * into v_actor from public._workflow_current_actor();
  if not exists (select 1 from public.projects p where p.id = p_project_id) then raise exception 'workflow_project_not_found'; end if;
  if not public._workflow_is_manager() then raise exception 'workflow_forbidden'; end if;
  v_before := public._workflow_lock_project(p_project_id);
  -- Recheck action access against the locked project, including reassignment.
  if not public._workflow_is_manager() then raise exception 'workflow_forbidden'; end if;
  v_fingerprint := public._workflow_request_fingerprint('workflow_update_project_configuration',p_project_id,
    jsonb_build_object('expected_workflow_version',p_expected_workflow_version,'requires_print',p_requires_print,'requires_ebook',p_requires_ebook,'workflow_settings',p_workflow_settings));
  v_result := public._workflow_receipt_lookup('workflow_update_project_configuration',p_project_id,p_idempotency_key,v_fingerprint);
  if v_result.project_id is not null then return v_result; end if;
  perform public._workflow_check_version(v_before.workflow_version,p_expected_workflow_version);
  perform public._workflow_validate_tuple(v_before);
  
  
  if p_requires_print is null or p_requires_ebook is null or not(p_requires_print or p_requires_ebook)
    then raise exception 'workflow_invalid_capabilities'; end if;
  if p_workflow_settings is null then raise exception 'workflow_invalid_configuration'; end if;
  v_settings := public._workflow_validate_settings(p_workflow_settings);
  select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb) into v_settings from jsonb_each(v_settings) e
    where e.key in ('exclude_weekends','files_received_days','design_concept_days','print_version_days','ebook_version_days','final_delivery_days','revision_days');
  v_changed := v_before.requires_print is distinct from p_requires_print or v_before.requires_ebook is distinct from p_requires_ebook
    or v_before.service_capability_status is distinct from 'confirmed'::public.service_capability_status;
  v_resume := v_before.project_status='active' and v_before.workflow_stage_key in ('concept_approval','print_approval')
    and v_before.workflow_stage_status_key='completed' and v_before.workflow_waiting_on_key='none';
  if not v_changed and v_before.workflow_settings is not distinct from v_settings and not v_resume then
    raise exception 'workflow_invalid_configuration'; end if;
  if v_changed and v_before.project_status in ('completed','cancelled','archived') then raise exception 'workflow_invalid_configuration'; end if;
  perform public._workflow_lock_mutation_rows(p_project_id);
  v_after := v_before;
  v_manual := public._workflow_checked_manual_skips(p_project_id);
  select count(*) into v_history_before from public.project_stage_history h where h.project_id=p_project_id;
  v_mutation_at := clock_timestamp();
  v_local_date := (v_mutation_at at time zone 'Asia/Karachi')::date;
  select d.production_seconds_delta,d.client_wait_seconds_delta into v_production,v_client
    from public._workflow_interval_delta(p_project_id,v_before.workflow_stage_status_key,
      v_before.stage_started_at,v_mutation_at,v_before.workflow_settings) d;
  
  if (not p_requires_print and v_before.requires_print is distinct from false and public._workflow_format_evidence(v_before,'print'))
    or (not p_requires_ebook and v_before.requires_ebook is distinct from false and public._workflow_format_evidence(v_before,'ebook')) then
    raise exception 'workflow_invalid_configuration'; end if;
  select d.stage_order into v_order from public.workflow_stage_definitions d where d.stage_key=v_before.workflow_stage_key;
  if v_changed and ((p_requires_print and v_before.requires_print is false and (v_order>4 or v_before.project_status<>'active'))
    or (p_requires_ebook and v_before.requires_ebook is false and (v_order>6 or v_before.project_status<>'active'))
    or v_before.delivered_at is not null) then raise exception 'workflow_invalid_configuration'; end if;
  -- Historical passage also blocks enabling a format even after an override moved back.
  if v_changed and exists(select 1 from public.project_stage_history h
    join public.workflow_stage_definitions d on d.stage_key=h.to_stage where h.project_id=p_project_id
    and h.event_type in ('stage_entered','stage_skipped','stage_approved','final_delivery_completed')
    and ((p_requires_print and v_before.requires_print is false and d.stage_order>=4)
      or (p_requires_ebook and v_before.requires_ebook is false and d.stage_order>=6))) then raise exception 'workflow_invalid_configuration'; end if;
  v_after.requires_print := p_requires_print; v_after.requires_ebook := p_requires_ebook;
  v_after.service_capability_status := 'confirmed'; v_after.workflow_settings := v_settings;
  if v_changed then v_after.capabilities_resolved_by := v_actor.actor_id; v_after.capabilities_resolved_at := v_mutation_at; end if;
  if v_before.workflow_stage_status_key in ('active','revision_active','awaiting_client') then v_after.stage_started_at := v_mutation_at; end if;
  v_metadata := jsonb_build_object('previous_requires_print',v_before.requires_print,'previous_requires_ebook',v_before.requires_ebook,
    'previous_capability_status',v_before.service_capability_status,'requires_print',p_requires_print,'requires_ebook',p_requires_ebook,
    'previous_settings',v_before.workflow_settings,'settings',v_settings);
  v_events := public._workflow_event('workflow_configuration_updated',v_before,v_after,'{}',v_metadata);
  if v_resume then
    select * into v_route from public._workflow_capability_resume_route(v_after.project_status,v_after.workflow_stage_key,
      v_after.workflow_stage_status_key,v_after.workflow_waiting_on_key,v_after.requires_print,v_after.requires_ebook,
      v_after.service_capability_status,v_manual);
    v_intermediate := v_after;
    v_after := public._workflow_enter_production(v_after,v_route.next_stage,v_mutation_at);
    v_events := v_events || public._workflow_route_events(v_intermediate,v_route.skipped_stages,v_route.skip_reasons)
      || public._workflow_event('stage_entered',v_intermediate,v_after,'{}','{}');
  end if;
  -- Related-table legacy triggers must not secretly mutate the project before
  -- our planned UPDATE overwrites the evidence of their divergence.
  if (select to_jsonb(p) from public.projects p where p.id=p_project_id) is distinct from to_jsonb(v_before) then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;
  v_after.production_seconds_total := v_before.production_seconds_total + v_production;
  v_after.client_wait_seconds_total := v_before.client_wait_seconds_total + v_client;
  v_after.updated_at := v_mutation_at;
  v_after := jsonb_populate_record(v_after,public._workflow_compatibility_projection(v_after.project_status,
    v_after.workflow_stage_key,v_after.workflow_stage_status_key,v_after.workflow_waiting_on_key));
  v_after.final_due_at := public._workflow_estimate_remaining_production(v_after,v_mutation_at,v_manual,
    case when v_after.workflow_stage_status_key = 'revision_active' then v_after.stage_due_at else null end);
  perform public._workflow_validate_tuple(v_after);
  perform public._workflow_write_project(v_after);
  perform public._workflow_assert_project_projection(v_after);
  perform public._workflow_assert_milestones(v_after);
  v_history := public._workflow_emit_events(p_project_id,v_events,v_production,v_client,null,v_mutation_at,p_idempotency_key);
  v_notifications := public._workflow_notify(v_after,'team','update_project_configuration',v_revision_id,v_mutation_at);
  v_affected := v_affected || jsonb_build_object('notification_ids',v_notifications);
  -- One version increment per NEW request, after history and notifications.
  v_after.workflow_version := v_before.workflow_version + 1;
  update public.projects set workflow_version = v_after.workflow_version where id = p_project_id;
  perform public._workflow_assert_project_projection(v_after);
  perform public._workflow_assert_milestones(v_after);
  if (select count(*) from public.project_stage_history h where h.project_id=p_project_id) <> v_history_before + cardinality(v_history) then
    raise exception 'legacy_workflow_trigger_conflict';
  end if;
  v_result := public._workflow_make_result(p_project_id,v_affected,v_history);
  perform public._workflow_receipt_store('workflow_update_project_configuration',p_project_id,p_idempotency_key,v_fingerprint,v_result,v_mutation_at);
  return v_result;
end;
$fn$;

revoke all on function public._workflow_lock_mutation_rows(uuid) from public, anon, authenticated;
revoke all on function public._workflow_validate_tuple(public.projects) from public, anon, authenticated;
revoke all on function public._workflow_operational_leaf(uuid,public.workflow_stage) from public, anon, authenticated;
revoke all on function public._workflow_checked_manual_skips(uuid) from public, anon, authenticated;
revoke all on function public._workflow_enter_production(public.projects,public.workflow_stage,timestamptz) from public, anon, authenticated;
revoke all on function public._workflow_event(public.workflow_event_type,public.projects,public.projects,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public._workflow_route_events(public.projects,public.workflow_stage[],text[]) from public, anon, authenticated;
revoke all on function public._workflow_write_project(public.projects) from public, anon, authenticated;
revoke all on function public._workflow_assert_milestones(public.projects) from public, anon, authenticated;
revoke all on function public._workflow_emit_events(uuid,jsonb,bigint,bigint,text,timestamptz,uuid,integer) from public, anon, authenticated;
revoke all on function public._workflow_notify(public.projects,text,text,uuid,timestamptz) from public, anon, authenticated;
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
revoke all on function public._workflow_format_evidence(public.projects,text) from public, anon, authenticated;
revoke all on function public.workflow_update_project_configuration(uuid,bigint,uuid,boolean,boolean,jsonb) from public, anon, authenticated;
grant execute on function public.workflow_update_project_configuration(uuid,bigint,uuid,boolean,boolean,jsonb) to authenticated;

commit;
