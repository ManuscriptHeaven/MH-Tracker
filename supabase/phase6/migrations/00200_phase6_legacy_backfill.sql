-- Phase 6 / Step 3B: legacy data normalization and canonical shadow backfill
--
-- Scope is intentionally limited to deterministic, data-preserving backfill.
-- This migration does not replace legacy workflow columns, functions, triggers,
-- RLS policies, views, or frontend behavior. It does not calculate new workflow
-- deadlines and does not reconstruct an eight-stage history that was never stored.

-- -----------------------------------------------------------------------------
-- 01 Preconditions
-- -----------------------------------------------------------------------------

-- Apply the entire file on ONE connection, in ONE transaction; never execute
-- sections separately. Explicit boundaries protect direct SQL execution too.
-- The installed Supabase runner/ledger transaction behavior is UNVERIFIED locally.
-- REQUIRED RUNBOOK: freeze all workflow writers and drain in-flight transactions
-- before application; retain the freeze through commit, ledger and data validation.
-- Rehearse runner handling of these boundaries on an isolated local/staging copy.
begin;
set transaction isolation level read committed;

do $phase6$
declare
  missing_columns text[];
begin
  if to_regclass('public.projects') is null
     or to_regclass('public.revision_requests') is null
     or to_regclass('public.project_stage_history') is null
     or to_regclass('public.project_stage_skips') is null
     or to_regclass('public.admin_workflow_overrides') is null then
    raise exception 'Phase 6 Step 3B requires the Step 3A application and workflow tables';
  end if;

  if to_regtype('public.project_lifecycle_status') is null
     or to_regtype('public.workflow_stage') is null
     or to_regtype('public.workflow_stage_status') is null
     or to_regtype('public.workflow_waiting_on') is null
     or to_regtype('public.workflow_revision_status') is null
     or to_regtype('public.workflow_skip_status') is null
     or to_regtype('public.workflow_event_type') is null
     or to_regtype('public.service_capability_status') is null then
    raise exception 'Phase 6 Step 3B requires the canonical enum types from Step 3A';
  end if;

  select array_agg(required.column_name order by required.column_name)
    into missing_columns
  from (
    values
      ('projects', 'project_status'),
      ('projects', 'workflow_stage_key'),
      ('projects', 'workflow_stage_status_key'),
      ('projects', 'workflow_waiting_on_key'),
      ('projects', 'requires_print'),
      ('projects', 'requires_ebook'),
      ('projects', 'service_capability_status'),
      ('projects', 'production_seconds_total'),
      ('projects', 'client_wait_seconds_total'),
      ('projects', 'delivered_at'),
      ('revision_requests', 'stage_key'),
      ('revision_requests', 'canonical_status'),
      ('revision_requests', 'revision_round'),
      ('revision_requests', 'parent_revision_request_id'),
      ('revision_requests', 'due_at'),
      ('project_stage_history', 'sequence_no'),
      ('project_stage_history', 'event_type'),
      ('project_stage_history', 'metadata')
  ) as required(table_name, column_name)
  where not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = required.table_name
      and c.column_name = required.column_name
  );

  if missing_columns is not null then
    raise exception 'Phase 6 Step 3B missing required Step 3A columns: %', missing_columns;
  end if;
end
$phase6$;

-- -----------------------------------------------------------------------------
-- 02 Backfill Issue Tracking
-- -----------------------------------------------------------------------------

-- Held through the final COMMIT. EXCLUSIVE conflicts with writes AND row-locking
-- reads (including RPC SELECT FOR UPDATE), while ordinary SELECT may continue.
-- NOWAIT aborts the whole transaction if the required write freeze has not drained
-- conflicting transactions. Retry the WHOLE file after rollback; do not continue
-- individual statements. No workflow trigger is disabled or changed.
-- Reference: https://www.postgresql.org/docs/15/explicit-locking.html
lock table public.projects, public.revision_requests,
  public.project_stage_history, public.project_stage_skips,
  public.admin_workflow_overrides in exclusive mode nowait;

create table if not exists public.phase6_backfill_issues (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  project_id uuid references public.projects(id) on delete restrict,
  issue_code text not null,
  severity text not null check (severity in ('info', 'warning', 'error')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- NULLS are normalized in this index so one stable entity/code issue is retained
-- even when the diagnostic applies to a project rather than a child row.
create unique index if not exists phase6_backfill_issues_stable_uidx
  on public.phase6_backfill_issues (
    entity_type,
    coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    issue_code
  );
create index if not exists phase6_backfill_issues_project_idx
  on public.phase6_backfill_issues (project_id, resolved, issue_code);
create index if not exists phase6_backfill_issues_code_idx
  on public.phase6_backfill_issues (issue_code, severity, resolved);

alter table public.phase6_backfill_issues enable row level security;
revoke all on table public.phase6_backfill_issues from anon, authenticated;

comment on table public.phase6_backfill_issues is
  'Internal Phase 6 migration diagnostics. No ordinary authenticated access is granted in Step 3B.';

-- Stable issue-code vocabulary used by this migration (14 codes):
-- CAPABILITY_UNRESOLVED, CAPABILITY_CONFLICT,
-- PROJECT_STATUS_UNRECOGNIZED, WORKFLOW_STAGE_AMBIGUOUS,
-- WORKFLOW_STATE_CONTRADICTORY, REVISION_STAGE_AMBIGUOUS,
-- REVISION_STATUS_AMBIGUOUS, REVISION_ROUND_CONFLICT,
-- REVISION_COUNT_DISCREPANCY, TIMESTAMP_UNRELIABLE,
-- LEGACY_TOTAL_UNIT_UNCERTAIN, HISTORY_SEQUENCE_CONFLICT,
-- SKIP_STAGE_AMBIGUOUS, OVERRIDE_STATE_AMBIGUOUS.

-- -----------------------------------------------------------------------------
-- 03 Lifecycle Backfill
-- -----------------------------------------------------------------------------

-- A reliable final-delivery milestone wins over a contradictory legacy lifecycle
-- label. Completed/Delivered are also explicit terminal evidence. Archived,
-- Cancelled, and On Hold are then mapped exactly. All repository-recognized normal
-- workflow labels map to active. Unknown status text is left NULL and diagnosed.


-- Diagnose partial/staging installations before filling lifecycle NULLs.
-- Inference is independent of the existing canonical value and uses the SAME
-- terminal-first rules below. Preserve populated lifecycle even on contradiction.
with inferred_lifecycle as (
  select p.*, case
  when p.final_delivery_date is not null
    or p.status::text in ('Completed', 'Delivered') then 'completed'::public.project_lifecycle_status
  when p.status::text = 'Archived' then 'archived'::public.project_lifecycle_status
  when p.status::text = 'Cancelled' then 'cancelled'::public.project_lifecycle_status
  when p.status::text = 'On Hold' then 'on_hold'::public.project_lifecycle_status
  when p.status::text in (
    'Active', 'In Progress', 'Awaiting Client Approval', 'In Revision',
    'Final Delivery', 'New', 'Waiting for Files', 'Files Required',
    'Files Received', 'Design Concept in Progress',
    'Awaiting Concept Approval', 'Concept Revisions',
    'Print Version in Progress', 'Awaiting Print Approval',
    'Print Revisions', 'eBook in Progress', 'eBook Review',
    'Final Quality Check', 'Ready to Start', 'Formatting', 'Cover Design',
    'eBook Conversion', 'First Proof Ready', 'Sent to Client',
    'Client Review', 'Revision Requested', 'Final QA', 'Ready for Delivery'
  )
    then 'active'::public.project_lifecycle_status
  else null
end as inferred_status
  from public.projects p
)
insert into public.phase6_backfill_issues (
  entity_type, entity_id, project_id, issue_code, severity, details
)
select 'project', p.id, p.id, 'WORKFLOW_STATE_CONTRADICTORY', 'error',
  jsonb_build_object(
    'lifecycle_contradiction', jsonb_build_object(
      'existing_canonical_lifecycle', p.project_status,
      'inferred_lifecycle', p.inferred_status,
      'legacy_status', p.status::text,
      'final_delivery_date', p.final_delivery_date,
      'delivery_date', p.delivery_date,
      'resolution', 'existing_canonical_value_preserved'
    )
  )
from inferred_lifecycle p
where p.project_status is not null and p.inferred_status is not null
  and p.project_status <> p.inferred_status
on conflict (
  entity_type,
  (coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid)),
  (coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid)),
  issue_code
) do update
set details = public.phase6_backfill_issues.details || excluded.details,
    updated_at = now()
where not (public.phase6_backfill_issues.details @> excluded.details);

insert into public.phase6_backfill_issues (
  entity_type, entity_id, project_id, issue_code, severity, details
)
select
  'project', p.id, p.id, 'WORKFLOW_STATE_CONTRADICTORY', 'error',
  jsonb_build_object(
    'reason', 'reliable_terminal_evidence_conflicts_with_legacy_status',
    'legacy_status', p.status::text,
    'final_delivery_date', p.final_delivery_date,
    'delivery_date', p.delivery_date,
    'resolution', 'completed_precedence'
  )
from public.projects p
where (p.final_delivery_date is not null or p.status::text in ('Completed', 'Delivered'))
  and p.status::text in ('Archived', 'Cancelled', 'On Hold')
on conflict do nothing;

insert into public.phase6_backfill_issues (
  entity_type, entity_id, project_id, issue_code, severity, details
)
select
  'project', p.id, p.id, 'PROJECT_STATUS_UNRECOGNIZED', 'warning',
  jsonb_build_object('legacy_status', p.status::text)
from public.projects p
where p.project_status is null
  and p.status::text not in (
    'Active', 'In Progress', 'Awaiting Client Approval', 'In Revision',
    'Final Delivery', 'Completed', 'On Hold', 'Cancelled', 'New',
    'Waiting for Files', 'Files Required', 'Files Received',
    'Design Concept in Progress', 'Awaiting Concept Approval',
    'Concept Revisions', 'Print Version in Progress',
    'Awaiting Print Approval', 'Print Revisions', 'eBook in Progress',
    'eBook Review', 'Final Quality Check', 'Ready to Start', 'Formatting',
    'Cover Design', 'eBook Conversion', 'First Proof Ready',
    'Sent to Client', 'Client Review', 'Revision Requested', 'Final QA',
    'Ready for Delivery', 'Delivered', 'Archived'
  )
on conflict do nothing;

update public.projects p
set project_status = case
  when p.final_delivery_date is not null
    or p.status::text in ('Completed', 'Delivered') then 'completed'::public.project_lifecycle_status
  when p.status::text = 'Archived' then 'archived'::public.project_lifecycle_status
  when p.status::text = 'Cancelled' then 'cancelled'::public.project_lifecycle_status
  when p.status::text = 'On Hold' then 'on_hold'::public.project_lifecycle_status
  when p.status::text in (
    'Active', 'In Progress', 'Awaiting Client Approval', 'In Revision',
    'Final Delivery', 'New', 'Waiting for Files', 'Files Required',
    'Files Received', 'Design Concept in Progress',
    'Awaiting Concept Approval', 'Concept Revisions',
    'Print Version in Progress', 'Awaiting Print Approval',
    'Print Revisions', 'eBook in Progress', 'eBook Review',
    'Final Quality Check', 'Ready to Start', 'Formatting', 'Cover Design',
    'eBook Conversion', 'First Proof Ready', 'Sent to Client',
    'Client Review', 'Revision Requested', 'Final QA', 'Ready for Delivery'
  )
    then 'active'::public.project_lifecycle_status
  else null
end
where p.project_status is null;

-- -----------------------------------------------------------------------------
-- 04 Service Capability Backfill
-- -----------------------------------------------------------------------------

-- Exact, normalized mappings only. These values are evidenced by frontend
-- options, creation defaults, sample/evaluation data, or timeline tests.
-- Generic Cover Design and content/product labels are intentionally not guessed.

with capability_map(normalized_service_type, requires_print, requires_ebook) as (
  values
    ('formatting', true, false),
    ('print formatting', true, false),
    ('print formatting & cover', true, false),
    ('print cover design', true, false),
    ('print only', true, false),
    ('ebook formatting', false, true),
    ('ebook cover design', false, true),
    ('ebook only', false, true),
    ('print + ebook', true, true)
), normalized as (
  select
    p.id,
    lower(regexp_replace(trim(p.service_type), '\s+', ' ', 'g')) as normalized_service_type
  from public.projects p
)
insert into public.phase6_backfill_issues (
  entity_type, entity_id, project_id, issue_code, severity, details
)
select
  'project', p.id, p.id, 'CAPABILITY_CONFLICT', 'error',
  jsonb_build_object(
    'service_type', p.service_type,
    'canonical_status', p.service_capability_status,
    'existing_requires_print', p.requires_print,
    'existing_requires_ebook', p.requires_ebook,
    'mapped_requires_print', m.requires_print,
    'mapped_requires_ebook', m.requires_ebook,
    'resolution', 'confirmed_values_preserved'
  )
from public.projects p
join normalized n on n.id = p.id
join capability_map m on m.normalized_service_type = n.normalized_service_type
where p.service_capability_status = 'confirmed'::public.service_capability_status
  and (
    p.requires_print is null
    or p.requires_ebook is null
    or not (p.requires_print or p.requires_ebook)
    or p.requires_print is distinct from m.requires_print
    or p.requires_ebook is distinct from m.requires_ebook
  )
on conflict do nothing;

with capability_map(normalized_service_type, requires_print, requires_ebook) as (
  values
    ('formatting', true, false),
    ('print formatting', true, false),
    ('print formatting & cover', true, false),
    ('print cover design', true, false),
    ('print only', true, false),
    ('ebook formatting', false, true),
    ('ebook cover design', false, true),
    ('ebook only', false, true),
    ('print + ebook', true, true)
), normalized as (
  select
    p.id,
    lower(regexp_replace(trim(p.service_type), '\s+', ' ', 'g')) as normalized_service_type
  from public.projects p
)
update public.projects p
set requires_print = m.requires_print,
    requires_ebook = m.requires_ebook,
    service_capability_status = 'inferred'::public.service_capability_status,
    capabilities_resolved_by = null,
    capabilities_resolved_at = null
from normalized n
join capability_map m on m.normalized_service_type = n.normalized_service_type
where p.id = n.id
  and p.service_capability_status <> 'confirmed'::public.service_capability_status;

with capability_map(normalized_service_type) as (
  values
    ('formatting'),
    ('print formatting'),
    ('print formatting & cover'),
    ('print cover design'),
    ('print only'),
    ('ebook formatting'),
    ('ebook cover design'),
    ('ebook only'),
    ('print + ebook')
), unresolved as (
  select
    p.id,
    lower(regexp_replace(trim(p.service_type), '\s+', ' ', 'g')) as normalized_service_type
  from public.projects p
  where p.service_capability_status <> 'confirmed'::public.service_capability_status
)
update public.projects p
set requires_print = null,
    requires_ebook = null,
    service_capability_status = 'needs_review'::public.service_capability_status,
    capabilities_resolved_by = null,
    capabilities_resolved_at = null
from unresolved u
where p.id = u.id
  and not exists (
    select 1 from capability_map m
    where m.normalized_service_type = u.normalized_service_type
  );

insert into public.phase6_backfill_issues (
  entity_type, entity_id, project_id, issue_code, severity, details
)
select
  'project', p.id, p.id, 'CAPABILITY_UNRESOLVED', 'warning',
  jsonb_build_object(
    'service_type', p.service_type,
    'normalized_service_type', lower(regexp_replace(trim(p.service_type), '\s+', ' ', 'g')),
    'resolution', 'manual_review_required'
  )
from public.projects p
where p.service_capability_status = 'needs_review'::public.service_capability_status
   or p.requires_print is null
   or p.requires_ebook is null
on conflict do nothing;

-- Bare Cover Design is explicitly selectable, while repository tests distinguish
-- ebook cover work with the qualified value eBook Cover Design. The bare value
-- therefore cannot prove which format is required and is an ambiguity, not merely
-- an unrecognized string.
insert into public.phase6_backfill_issues (
  entity_type, entity_id, project_id, issue_code, severity, details
)
select
  'project', p.id, p.id, 'CAPABILITY_CONFLICT', 'warning',
  jsonb_build_object(
    'service_type', p.service_type,
    'reason', 'bare_cover_design_does_not_identify_print_or_ebook_format',
    'resolution', 'manual_review_required'
  )
from public.projects p
where lower(regexp_replace(trim(p.service_type), '\s+', ' ', 'g')) = 'cover design'
  and p.service_capability_status <> 'confirmed'::public.service_capability_status
on conflict do nothing;

-- A confirmed pair that is structurally unusable is preserved but diagnosed.
insert into public.phase6_backfill_issues (
  entity_type, entity_id, project_id, issue_code, severity, details
)
select
  'project', p.id, p.id, 'CAPABILITY_CONFLICT', 'error',
  jsonb_build_object(
    'reason', 'confirmed_capability_pair_is_incomplete_or_disables_both_formats',
    'requires_print', p.requires_print,
    'requires_ebook', p.requires_ebook
  )
from public.projects p
where p.service_capability_status = 'confirmed'::public.service_capability_status
  and (
    p.requires_print is null
    or p.requires_ebook is null
    or not (p.requires_print or p.requires_ebook)
  )
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 05 Delivered Timestamp Backfill
-- -----------------------------------------------------------------------------

-- Both repository delivery fields are DATE, not TIMESTAMPTZ. The conversion below
-- stores the start of the known local calendar date in Asia/Karachi. It is a
-- deterministic date-precision convention, not a claim that delivery happened at
-- midnight. Snapshot metadata records the source and its date-only precision.

update public.projects p
set delivered_at = case
  when p.final_delivery_date is not null then
    p.final_delivery_date::timestamp at time zone 'Asia/Karachi'
  when p.delivery_date is not null
    and (p.project_status = 'completed'::public.project_lifecycle_status
      or p.status::text in ('Completed', 'Delivered')) then
    p.delivery_date::timestamp at time zone 'Asia/Karachi'
  else null
end
where p.delivered_at is null
  and (
    p.final_delivery_date is not null
    or (
      p.delivery_date is not null
      and (p.project_status = 'completed'::public.project_lifecycle_status
        or p.status::text in ('Completed', 'Delivered'))
    )
  );

-- -----------------------------------------------------------------------------
-- 06 Revision Backfill
-- -----------------------------------------------------------------------------

-- Revision stage precedence:
--   1. The latest request may use the project's exact current approval/revision
--      label when no later milestone proves that stage was left.
--   2. Otherwise request submission date is placed within exact dated milestone
--      windows (ebook, then print, then concept).
--   3. No title/description keyword parsing and no default-to-print behavior.

with ranked as (
  select
    r.id,
    r.project_id,
    coalesce(r.submitted_at, r.created_at) as evidence_at,
    row_number() over (
      partition by r.project_id
      order by coalesce(r.submitted_at, r.created_at) desc nulls last, r.id desc
    ) as project_recency
  from public.revision_requests r
), inferred as (
  select
    r.id,
    case
      when r.project_recency = 1
        and p.current_stage in (
          'Awaiting Concept Approval', 'Concept Approval', 'Concept Revisions'
        )
        and p.print_version_submitted_date is null
        and p.ebook_submitted_date is null
        and p.final_delivery_date is null
        then 'concept_approval'::public.workflow_stage
      when r.project_recency = 1
        and p.current_stage in (
          'Awaiting Print Approval', 'Print Approval', 'Print Revisions'
        )
        and p.ebook_submitted_date is null
        and p.final_delivery_date is null
        then 'print_approval'::public.workflow_stage
      when r.project_recency = 1
        and p.current_stage in ('eBook Review', 'Ebook Approval')
        and p.final_delivery_date is null
        then 'ebook_approval'::public.workflow_stage
      when p.ebook_submitted_date is not null
        and (r.evidence_at at time zone 'Asia/Karachi')::date >= p.ebook_submitted_date
        and (p.ebook_approval_date is null or (r.evidence_at at time zone 'Asia/Karachi')::date <= p.ebook_approval_date)
        then 'ebook_approval'::public.workflow_stage
      when p.print_version_submitted_date is not null
        and (r.evidence_at at time zone 'Asia/Karachi')::date >= p.print_version_submitted_date
        and (p.ebook_submitted_date is null or (r.evidence_at at time zone 'Asia/Karachi')::date < p.ebook_submitted_date)
        and (p.print_version_approval_date is null or (r.evidence_at at time zone 'Asia/Karachi')::date <= p.print_version_approval_date)
        then 'print_approval'::public.workflow_stage
      when p.design_concept_submitted_date is not null
        and (r.evidence_at at time zone 'Asia/Karachi')::date >= p.design_concept_submitted_date
        and (p.print_version_submitted_date is null or (r.evidence_at at time zone 'Asia/Karachi')::date < p.print_version_submitted_date)
        and (p.design_concept_approval_date is null or (r.evidence_at at time zone 'Asia/Karachi')::date <= p.design_concept_approval_date)
        then 'concept_approval'::public.workflow_stage
      else null
    end as inferred_stage
  from ranked r
  join public.projects p on p.id = r.project_id
)
update public.revision_requests r
set stage_key = i.inferred_stage
from inferred i
where r.id = i.id
  and r.stage_key is null
  and i.inferred_stage is not null;

insert into public.phase6_backfill_issues (
  entity_type, entity_id, project_id, issue_code, severity, details
)
select
  'revision_request', r.id, r.project_id, 'REVISION_STAGE_AMBIGUOUS', 'warning',
  jsonb_build_object(
    'legacy_status', r.status,
    'submitted_at', r.submitted_at,
    'created_at', r.created_at,
    'project_current_stage', p.current_stage,
    'resolution', 'stage_key_left_null'
  )
from public.revision_requests r
join public.projects p on p.id = r.project_id
where r.stage_key is null
on conflict do nothing;

-- Exact status mapping. Completed is approved only with stage-matched approval
-- DATE evidence strictly AFTER submission's Asia/Karachi local date. Same-day
-- approval cannot establish event order; otherwise it becomes ready_for_client_review and
-- remains explicitly diagnosed as historically ambiguous.

update public.revision_requests r
set canonical_status = case r.status
  when 'Submitted' then 'submitted'::public.workflow_revision_status
  when 'Under Review' then 'under_review'::public.workflow_revision_status
  when 'Assigned' then 'under_review'::public.workflow_revision_status
  when 'In Progress' then 'in_progress'::public.workflow_revision_status
  when 'Ready for Client Review' then 'ready_for_client_review'::public.workflow_revision_status
  when 'Additional Revision Required' then 'changes_requested'::public.workflow_revision_status
  when 'Approved' then 'approved'::public.workflow_revision_status
  when 'Completed' then case
    when r.stage_key = 'concept_approval'::public.workflow_stage
      and p.design_concept_approval_date is not null
      and p.design_concept_approval_date > (coalesce(r.submitted_at, r.created_at) at time zone 'Asia/Karachi')::date
      then 'approved'::public.workflow_revision_status
    when r.stage_key = 'print_approval'::public.workflow_stage
      and p.print_version_approval_date is not null
      and p.print_version_approval_date > (coalesce(r.submitted_at, r.created_at) at time zone 'Asia/Karachi')::date
      then 'approved'::public.workflow_revision_status
    when r.stage_key = 'ebook_approval'::public.workflow_stage
      and p.ebook_approval_date is not null
      and p.ebook_approval_date > (coalesce(r.submitted_at, r.created_at) at time zone 'Asia/Karachi')::date
      then 'approved'::public.workflow_revision_status
    else 'ready_for_client_review'::public.workflow_revision_status
  end
  else null
end
from public.projects p
where p.id = r.project_id
  and r.canonical_status is null;

insert into public.phase6_backfill_issues (
  entity_type, entity_id, project_id, issue_code, severity, details
)
select
  'revision_request', r.id, r.project_id, 'REVISION_STATUS_AMBIGUOUS', 'warning',
  jsonb_build_object(
    'legacy_status', r.status,
    'stage_key', r.stage_key,
    'reason', case
      when r.status = 'Completed' then 'completed_without_strictly_later_local_approval_date'
      else 'unrecognized_revision_status'
    end,
    'canonical_resolution', r.canonical_status,
    'submission_local_date', (coalesce(r.submitted_at, r.created_at) at time zone 'Asia/Karachi')::date,
    'approval_date_precision', 'date_only_same_day_order_unknown'
  )
from public.revision_requests r
where (r.status = 'Completed' and r.canonical_status = 'ready_for_client_review'::public.workflow_revision_status)
   or r.canonical_status is null
on conflict do nothing;

-- Round order is deterministic by submitted_at, created_at, then UUID. Identical
-- evidence timestamps use UUID only as a stable tie-breaker and are diagnosed.

insert into public.phase6_backfill_issues (
  entity_type, entity_id, project_id, issue_code, severity, details
)
select
  'project', r.project_id, r.project_id, 'REVISION_ROUND_CONFLICT', 'warning',
  jsonb_build_object(
    'reason', 'multiple_revision_rows_share_the_same_ordering_timestamp',
    'stage_key', r.stage_key,
    'evidence_at', coalesce(r.submitted_at, r.created_at),
    'row_count', count(*)
  )
from public.revision_requests r
where r.stage_key is not null
group by r.project_id, r.stage_key, coalesce(r.submitted_at, r.created_at)
having count(*) > 1
on conflict do nothing;

with ordered as (
  select
    r.id,
    row_number() over (
      partition by r.project_id, r.stage_key
      order by r.submitted_at nulls last, r.created_at nulls last, r.id
    )::integer as inferred_round
  from public.revision_requests r
  where r.stage_key is not null
)
insert into public.phase6_backfill_issues (
  entity_type, entity_id, project_id, issue_code, severity, details
)
select
  'revision_request', r.id, r.project_id, 'REVISION_ROUND_CONFLICT', 'warning',
  jsonb_build_object(
    'reason', 'existing_revision_round_differs_from_deterministic_order',
    'existing_round', r.revision_round,
    'inferred_round', o.inferred_round,
    'stage_key', r.stage_key
  )
from public.revision_requests r
join ordered o on o.id = r.id
where r.revision_round is not null
  and r.revision_round <> o.inferred_round
on conflict do nothing;

with ordered as (
  select
    r.id,
    row_number() over (
      partition by r.project_id, r.stage_key
      order by r.submitted_at nulls last, r.created_at nulls last, r.id
    )::integer as inferred_round
  from public.revision_requests r
  where r.stage_key is not null
)
update public.revision_requests r
set revision_round = o.inferred_round
from ordered o
where r.id = o.id
  and r.revision_round is null;

-- A parent link is created only when an explicit Additional Revision Required row
-- has a distinct immediately following round on the same project and stage.

with continuation as (
  select
    child.id as child_id,
    parent.id as parent_id
  from public.revision_requests parent
  join public.revision_requests child
    on child.project_id = parent.project_id
   and child.stage_key = parent.stage_key
   and child.revision_round = parent.revision_round + 1
  where parent.status = 'Additional Revision Required'
    and parent.stage_key is not null
    and parent.revision_round is not null
)
update public.revision_requests child
set parent_revision_request_id = c.parent_id
from continuation c
where child.id = c.child_id
  and child.parent_revision_request_id is null;

-- A project has only one legacy revision due DATE per concept/print stage. It is
-- attached only to the latest nonterminal request in that stage. No ebook revision
-- deadline column exists. Ambiguous multiple-open-row cases remain unresolved.

with due_candidates as (
  select
    r.id,
    r.project_id,
    r.stage_key,
    case
      when r.stage_key = 'concept_approval'::public.workflow_stage then p.concept_revision_due_date
      when r.stage_key = 'print_approval'::public.workflow_stage then p.print_revision_due_date
      else null
    end as legacy_due_date,
    row_number() over (
      partition by r.project_id, r.stage_key
      order by r.submitted_at desc nulls last, r.created_at desc nulls last, r.id desc
    ) as recency,
    count(*) filter (
      where r.canonical_status in (
        'submitted'::public.workflow_revision_status,
        'under_review'::public.workflow_revision_status,
        'in_progress'::public.workflow_revision_status,
        'changes_requested'::public.workflow_revision_status
      )
    ) over (partition by r.project_id, r.stage_key) as open_count
  from public.revision_requests r
  join public.projects p on p.id = r.project_id
  where r.stage_key is not null
)
update public.revision_requests r
-- date.ts isOverdue/daysUntil and timeline.ts treat the named date as due today.
-- Keep the whole local deadline date usable: 23:59:59.999999 Asia/Karachi.
-- This is normalization precision, not an observed historical time of day.
set due_at = ((d.legacy_due_date + 1)::timestamp - interval '1 microsecond')
  at time zone 'Asia/Karachi'
from due_candidates d
where r.id = d.id
  and r.due_at is null
  and d.legacy_due_date is not null
  and d.recency = 1
  and d.open_count <= 1
  and r.canonical_status in (
    'submitted'::public.workflow_revision_status,
    'under_review'::public.workflow_revision_status,
    'in_progress'::public.workflow_revision_status,
    'changes_requested'::public.workflow_revision_status
  );

with ambiguous_due as (
  select
    r.project_id,
    r.stage_key,
    count(*) as open_count
  from public.revision_requests r
  join public.projects p on p.id = r.project_id
  where r.stage_key in (
      'concept_approval'::public.workflow_stage,
      'print_approval'::public.workflow_stage
    )
    and r.canonical_status in (
      'submitted'::public.workflow_revision_status,
      'under_review'::public.workflow_revision_status,
      'in_progress'::public.workflow_revision_status,
      'changes_requested'::public.workflow_revision_status
    )
    and case
      when r.stage_key = 'concept_approval'::public.workflow_stage then p.concept_revision_due_date
      when r.stage_key = 'print_approval'::public.workflow_stage then p.print_revision_due_date
      else null
    end is not null
  group by r.project_id, r.stage_key
  having count(*) > 1
)
insert into public.phase6_backfill_issues (
  entity_type, entity_id, project_id, issue_code, severity, details
)
select
  'project', a.project_id, a.project_id, 'TIMESTAMP_UNRELIABLE', 'warning',
  jsonb_build_object(
    'reason', 'one_legacy_revision_due_date_has_multiple_open_candidates',
    'stage_key', a.stage_key,
    'candidate_count', a.open_count
  )
from ambiguous_due a
on conflict do nothing;

-- Reconcile the project counter to the highest supported value. A higher legacy
-- counter is retained; no synthetic revision rows are created.

with request_counts as (
  select p.id as project_id, count(r.id)::integer as request_count
  from public.projects p
  left join public.revision_requests r on r.project_id = p.id
  group by p.id
)
insert into public.phase6_backfill_issues (
  entity_type, entity_id, project_id, issue_code, severity, details
)
select
  'project', p.id, p.id, 'REVISION_COUNT_DISCREPANCY', 'warning',
  jsonb_build_object(
    'legacy_revision_count', p.revision_count,
    'revision_request_count', c.request_count,
    'resolution', 'greatest_supported_value_retained'
  )
from public.projects p
join request_counts c on c.project_id = p.id
where coalesce(p.revision_count, 0) <> c.request_count
on conflict do nothing;

with request_counts as (
  select p.id as project_id, count(r.id)::integer as request_count
  from public.projects p
  left join public.revision_requests r on r.project_id = p.id
  group by p.id
)
update public.projects p
set revision_count = greatest(coalesce(p.revision_count, 0), c.request_count)
from request_counts c
where p.id = c.project_id
  and p.revision_count is distinct from greatest(coalesce(p.revision_count, 0), c.request_count);

-- -----------------------------------------------------------------------------
-- 07 Canonical Workflow State Backfill
-- -----------------------------------------------------------------------------

-- Evidence precedence is explicit and conservative:
--   A. final delivery/status terminal evidence;
--   B. a latest nonterminal revision whose stage is not disproved by later dates;
--   C. ebook, print, concept, and files milestone dates (latest first);
--   D. exact legacy current_stage mapping;
--   E. exact workflow-shaped legacy status mapping.
-- Format routing occurs only with resolved capabilities. If concept/print approval
-- is proven but the next required format is unresolved, the last proven approval
-- stage is retained as completed/none and an issue gates later mutation.

with latest_revision as (
  select distinct on (r.project_id)
    r.project_id,
    r.stage_key,
    r.canonical_status,
    coalesce(r.submitted_at, r.created_at) as evidence_at
  from public.revision_requests r
  where r.stage_key is not null
    and r.canonical_status in (
      'submitted'::public.workflow_revision_status,
      'under_review'::public.workflow_revision_status,
      'in_progress'::public.workflow_revision_status,
      'ready_for_client_review'::public.workflow_revision_status,
      'changes_requested'::public.workflow_revision_status
    )
  order by r.project_id, coalesce(r.submitted_at, r.created_at) desc nulls last, r.id desc
), stage_evidence as (
  select
    p.id,
    lr.stage_key as revision_stage,
    lr.canonical_status as revision_status,
    case
      when p.final_delivery_date is not null
        or p.project_status = 'completed'::public.project_lifecycle_status
        or p.status::text in ('Completed', 'Delivered')
        then 'final_delivery'::public.workflow_stage
      when lr.stage_key = 'ebook_approval'::public.workflow_stage
        and p.final_delivery_date is null
        then lr.stage_key
      when lr.stage_key = 'print_approval'::public.workflow_stage
        and p.ebook_submitted_date is null
        and p.final_delivery_date is null
        then lr.stage_key
      when lr.stage_key = 'concept_approval'::public.workflow_stage
        and p.print_version_submitted_date is null
        and p.ebook_submitted_date is null
        and p.final_delivery_date is null
        then lr.stage_key
      when p.ebook_approval_date is not null
        then 'final_delivery'::public.workflow_stage
      when p.ebook_submitted_date is not null
        then 'ebook_approval'::public.workflow_stage
      when p.print_version_approval_date is not null and p.requires_ebook is true
        then 'ebook_version'::public.workflow_stage
      when p.print_version_approval_date is not null and p.requires_ebook is false
        then 'final_delivery'::public.workflow_stage
      when p.print_version_approval_date is not null
        then 'print_approval'::public.workflow_stage
      when p.print_version_submitted_date is not null
        then 'print_approval'::public.workflow_stage
      when p.design_concept_approval_date is not null and p.requires_print is true
        then 'print_version'::public.workflow_stage
      when p.design_concept_approval_date is not null
        and p.requires_print is false and p.requires_ebook is true
        then 'ebook_version'::public.workflow_stage
      when p.design_concept_approval_date is not null
        then 'concept_approval'::public.workflow_stage
      when p.design_concept_submitted_date is not null
        then 'concept_approval'::public.workflow_stage
      when p.files_received_date is not null
        then 'design_concept'::public.workflow_stage
      when p.current_stage in ('Files Required', 'Files Received', 'New', 'Waiting for Files', 'Ready to Start')
        then 'files_received'::public.workflow_stage
      when p.current_stage in ('Design Concept in Progress', 'Design Concept')
        then 'design_concept'::public.workflow_stage
      when p.current_stage in ('Awaiting Concept Approval', 'Concept Approval', 'Concept Revisions')
        then 'concept_approval'::public.workflow_stage
      when p.current_stage in ('Print Version in Progress', 'Print Version')
        then 'print_version'::public.workflow_stage
      when p.current_stage in ('Awaiting Print Approval', 'Print Approval', 'Print Revisions')
        then 'print_approval'::public.workflow_stage
      when p.current_stage in ('eBook in Progress', 'eBook Conversion', 'Ebook Version', 'eBook Version')
        then 'ebook_version'::public.workflow_stage
      when p.current_stage in ('eBook Review', 'Ebook Approval')
        then 'ebook_approval'::public.workflow_stage
      when p.current_stage in ('Final Quality Check', 'Final Delivery', 'Ready for Delivery', 'Final QA', 'Completed', 'Delivered')
        then 'final_delivery'::public.workflow_stage
      when p.status::text in ('Files Required', 'Files Received', 'New', 'Waiting for Files', 'Ready to Start')
        then 'files_received'::public.workflow_stage
      when p.status::text = 'Design Concept in Progress'
        then 'design_concept'::public.workflow_stage
      when p.status::text in ('Awaiting Concept Approval', 'Concept Revisions')
        then 'concept_approval'::public.workflow_stage
      when p.status::text = 'Print Version in Progress'
        then 'print_version'::public.workflow_stage
      when p.status::text in ('Awaiting Print Approval', 'Print Revisions')
        then 'print_approval'::public.workflow_stage
      when p.status::text in ('eBook in Progress', 'eBook Conversion')
        then 'ebook_version'::public.workflow_stage
      when p.status::text = 'eBook Review'
        then 'ebook_approval'::public.workflow_stage
      when p.status::text in ('Final Quality Check', 'Final Delivery', 'Ready for Delivery', 'Final QA')
        then 'final_delivery'::public.workflow_stage
      else null
    end as inferred_stage
  from public.projects p
  left join latest_revision lr on lr.project_id = p.id
), inferred_state as (
  select
    p.id,
    e.inferred_stage,
    case
      when p.project_status = 'completed'::public.project_lifecycle_status
        then 'completed'::public.workflow_stage_status
      when p.project_status in (
        'on_hold'::public.project_lifecycle_status,
        'cancelled'::public.project_lifecycle_status,
        'archived'::public.project_lifecycle_status
      ) then 'paused'::public.workflow_stage_status
      when e.inferred_stage = e.revision_stage
        and e.revision_status in (
          'submitted'::public.workflow_revision_status,
          'under_review'::public.workflow_revision_status,
          'in_progress'::public.workflow_revision_status,
          'changes_requested'::public.workflow_revision_status
        ) then 'revision_active'::public.workflow_stage_status
      when e.inferred_stage = e.revision_stage
        and e.revision_status = 'ready_for_client_review'::public.workflow_revision_status
        then 'awaiting_client'::public.workflow_stage_status
      when p.print_version_approval_date is not null
        and p.requires_ebook is null
        and e.inferred_stage = 'print_approval'::public.workflow_stage
        then 'completed'::public.workflow_stage_status
      when p.design_concept_approval_date is not null
        and (p.requires_print is null or p.requires_ebook is null)
        and e.inferred_stage = 'concept_approval'::public.workflow_stage
        then 'completed'::public.workflow_stage_status
      when p.current_stage in ('Files Required', 'New', 'Waiting for Files')
        and e.inferred_stage = 'files_received'::public.workflow_stage
        then 'pending'::public.workflow_stage_status
      when p.current_stage in ('Concept Revisions', 'Print Revisions')
        or (p.stage_status = 'REVISION_ACTIVE' and e.inferred_stage in (
          'concept_approval'::public.workflow_stage,
          'print_approval'::public.workflow_stage,
          'ebook_approval'::public.workflow_stage
        ))
        or (p.status::text = 'In Revision' and e.inferred_stage in (
          'concept_approval'::public.workflow_stage,
          'print_approval'::public.workflow_stage,
          'ebook_approval'::public.workflow_stage
        ))
        then 'revision_active'::public.workflow_stage_status
      when e.inferred_stage in (
        'concept_approval'::public.workflow_stage,
        'print_approval'::public.workflow_stage,
        'ebook_approval'::public.workflow_stage
      ) then 'awaiting_client'::public.workflow_stage_status
      when e.inferred_stage is not null
        then 'active'::public.workflow_stage_status
      else null
    end as inferred_stage_status,
    case
      when p.project_status in (
        'completed'::public.project_lifecycle_status,
        'on_hold'::public.project_lifecycle_status,
        'cancelled'::public.project_lifecycle_status,
        'archived'::public.project_lifecycle_status
      ) then 'none'::public.workflow_waiting_on
      when e.inferred_stage = e.revision_stage
        and e.revision_status in (
          'submitted'::public.workflow_revision_status,
          'under_review'::public.workflow_revision_status,
          'in_progress'::public.workflow_revision_status,
          'changes_requested'::public.workflow_revision_status
        ) then 'team'::public.workflow_waiting_on
      when e.inferred_stage = e.revision_stage
        and e.revision_status = 'ready_for_client_review'::public.workflow_revision_status
        then 'client'::public.workflow_waiting_on
      when p.print_version_approval_date is not null
        and p.requires_ebook is null
        and e.inferred_stage = 'print_approval'::public.workflow_stage
        then 'none'::public.workflow_waiting_on
      when p.design_concept_approval_date is not null
        and (p.requires_print is null or p.requires_ebook is null)
        and e.inferred_stage = 'concept_approval'::public.workflow_stage
        then 'none'::public.workflow_waiting_on
      when p.current_stage in ('Files Required', 'Waiting for Files')
        and e.inferred_stage = 'files_received'::public.workflow_stage
        then 'client'::public.workflow_waiting_on
      when p.current_stage = 'New'
        and e.inferred_stage = 'files_received'::public.workflow_stage
        then case
          when p.waiting_on = 'Client' then 'client'::public.workflow_waiting_on
          else 'none'::public.workflow_waiting_on
        end
      when p.current_stage in ('Concept Revisions', 'Print Revisions')
        or (p.stage_status = 'REVISION_ACTIVE' and e.inferred_stage in (
          'concept_approval'::public.workflow_stage,
          'print_approval'::public.workflow_stage,
          'ebook_approval'::public.workflow_stage
        ))
        or (p.status::text = 'In Revision' and e.inferred_stage in (
          'concept_approval'::public.workflow_stage,
          'print_approval'::public.workflow_stage,
          'ebook_approval'::public.workflow_stage
        ))
        then 'team'::public.workflow_waiting_on
      when e.inferred_stage in (
        'concept_approval'::public.workflow_stage,
        'print_approval'::public.workflow_stage,
        'ebook_approval'::public.workflow_stage
      ) then 'client'::public.workflow_waiting_on
      when e.inferred_stage is not null
        then 'team'::public.workflow_waiting_on
      else null
    end as inferred_waiting_on
  from public.projects p
  join stage_evidence e on e.id = p.id
)
insert into public.phase6_backfill_issues (
  entity_type, entity_id, project_id, issue_code, severity, details
)
select
  'project', p.id, p.id, 'WORKFLOW_STATE_CONTRADICTORY', 'error',
  jsonb_build_object(
    'reason', 'existing_canonical_state_differs_from_repository_evidence',
    'existing_stage', p.workflow_stage_key,
    'inferred_stage', s.inferred_stage,
    'existing_stage_status', p.workflow_stage_status_key,
    'inferred_stage_status', s.inferred_stage_status,
    'existing_waiting_on', p.workflow_waiting_on_key,
    'inferred_waiting_on', s.inferred_waiting_on,
    'resolution', 'existing_canonical_values_preserved'
  )
from public.projects p
join inferred_state s on s.id = p.id
where (p.workflow_stage_key is not null and s.inferred_stage is not null
      and p.workflow_stage_key <> s.inferred_stage)
   or (p.workflow_stage_status_key is not null and s.inferred_stage_status is not null
      and p.workflow_stage_status_key <> s.inferred_stage_status)
   or (p.workflow_waiting_on_key is not null and s.inferred_waiting_on is not null
      and p.workflow_waiting_on_key <> s.inferred_waiting_on)
on conflict do nothing;

with latest_revision as (
  select distinct on (r.project_id)
    r.project_id, r.stage_key, r.canonical_status
  from public.revision_requests r
  where r.stage_key is not null
    and r.canonical_status in (
      'submitted'::public.workflow_revision_status,
      'under_review'::public.workflow_revision_status,
      'in_progress'::public.workflow_revision_status,
      'ready_for_client_review'::public.workflow_revision_status,
      'changes_requested'::public.workflow_revision_status
    )
  order by r.project_id, coalesce(r.submitted_at, r.created_at) desc nulls last, r.id desc
), stage_evidence as (
  select
    p.id,
    lr.stage_key as revision_stage,
    lr.canonical_status as revision_status,
    case
      when p.final_delivery_date is not null
        or p.project_status = 'completed'::public.project_lifecycle_status
        or p.status::text in ('Completed', 'Delivered') then 'final_delivery'::public.workflow_stage
      when lr.stage_key = 'ebook_approval'::public.workflow_stage and p.final_delivery_date is null then lr.stage_key
      when lr.stage_key = 'print_approval'::public.workflow_stage and p.ebook_submitted_date is null and p.final_delivery_date is null then lr.stage_key
      when lr.stage_key = 'concept_approval'::public.workflow_stage and p.print_version_submitted_date is null and p.ebook_submitted_date is null and p.final_delivery_date is null then lr.stage_key
      when p.ebook_approval_date is not null then 'final_delivery'::public.workflow_stage
      when p.ebook_submitted_date is not null then 'ebook_approval'::public.workflow_stage
      when p.print_version_approval_date is not null and p.requires_ebook is true then 'ebook_version'::public.workflow_stage
      when p.print_version_approval_date is not null and p.requires_ebook is false then 'final_delivery'::public.workflow_stage
      when p.print_version_approval_date is not null then 'print_approval'::public.workflow_stage
      when p.print_version_submitted_date is not null then 'print_approval'::public.workflow_stage
      when p.design_concept_approval_date is not null and p.requires_print is true then 'print_version'::public.workflow_stage
      when p.design_concept_approval_date is not null and p.requires_print is false and p.requires_ebook is true then 'ebook_version'::public.workflow_stage
      when p.design_concept_approval_date is not null then 'concept_approval'::public.workflow_stage
      when p.design_concept_submitted_date is not null then 'concept_approval'::public.workflow_stage
      when p.files_received_date is not null then 'design_concept'::public.workflow_stage
      when p.current_stage in ('Files Required', 'Files Received', 'New', 'Waiting for Files', 'Ready to Start') then 'files_received'::public.workflow_stage
      when p.current_stage in ('Design Concept in Progress', 'Design Concept') then 'design_concept'::public.workflow_stage
      when p.current_stage in ('Awaiting Concept Approval', 'Concept Approval', 'Concept Revisions') then 'concept_approval'::public.workflow_stage
      when p.current_stage in ('Print Version in Progress', 'Print Version') then 'print_version'::public.workflow_stage
      when p.current_stage in ('Awaiting Print Approval', 'Print Approval', 'Print Revisions') then 'print_approval'::public.workflow_stage
      when p.current_stage in ('eBook in Progress', 'eBook Conversion', 'Ebook Version', 'eBook Version') then 'ebook_version'::public.workflow_stage
      when p.current_stage in ('eBook Review', 'Ebook Approval') then 'ebook_approval'::public.workflow_stage
      when p.current_stage in ('Final Quality Check', 'Final Delivery', 'Ready for Delivery', 'Final QA', 'Completed', 'Delivered') then 'final_delivery'::public.workflow_stage
      when p.status::text in ('Files Required', 'Files Received', 'New', 'Waiting for Files', 'Ready to Start') then 'files_received'::public.workflow_stage
      when p.status::text = 'Design Concept in Progress' then 'design_concept'::public.workflow_stage
      when p.status::text in ('Awaiting Concept Approval', 'Concept Revisions') then 'concept_approval'::public.workflow_stage
      when p.status::text = 'Print Version in Progress' then 'print_version'::public.workflow_stage
      when p.status::text in ('Awaiting Print Approval', 'Print Revisions') then 'print_approval'::public.workflow_stage
      when p.status::text in ('eBook in Progress', 'eBook Conversion') then 'ebook_version'::public.workflow_stage
      when p.status::text = 'eBook Review' then 'ebook_approval'::public.workflow_stage
      when p.status::text in ('Final Quality Check', 'Final Delivery', 'Ready for Delivery', 'Final QA') then 'final_delivery'::public.workflow_stage
      else null
    end as inferred_stage
  from public.projects p
  left join latest_revision lr on lr.project_id = p.id
), inferred_state as (
  select
    p.id,
    e.inferred_stage,
    case
      when p.project_status = 'completed'::public.project_lifecycle_status then 'completed'::public.workflow_stage_status
      when p.project_status in ('on_hold'::public.project_lifecycle_status, 'cancelled'::public.project_lifecycle_status, 'archived'::public.project_lifecycle_status) then 'paused'::public.workflow_stage_status
      when e.inferred_stage = e.revision_stage and e.revision_status in ('submitted'::public.workflow_revision_status, 'under_review'::public.workflow_revision_status, 'in_progress'::public.workflow_revision_status, 'changes_requested'::public.workflow_revision_status) then 'revision_active'::public.workflow_stage_status
      when e.inferred_stage = e.revision_stage and e.revision_status = 'ready_for_client_review'::public.workflow_revision_status then 'awaiting_client'::public.workflow_stage_status
      when p.print_version_approval_date is not null and p.requires_ebook is null and e.inferred_stage = 'print_approval'::public.workflow_stage then 'completed'::public.workflow_stage_status
      when p.design_concept_approval_date is not null and (p.requires_print is null or p.requires_ebook is null) and e.inferred_stage = 'concept_approval'::public.workflow_stage then 'completed'::public.workflow_stage_status
      when p.current_stage in ('Files Required', 'New', 'Waiting for Files') and e.inferred_stage = 'files_received'::public.workflow_stage then 'pending'::public.workflow_stage_status
      when p.current_stage in ('Concept Revisions', 'Print Revisions') or (p.stage_status = 'REVISION_ACTIVE' and e.inferred_stage in ('concept_approval'::public.workflow_stage, 'print_approval'::public.workflow_stage, 'ebook_approval'::public.workflow_stage)) or (p.status::text = 'In Revision' and e.inferred_stage in ('concept_approval'::public.workflow_stage, 'print_approval'::public.workflow_stage, 'ebook_approval'::public.workflow_stage)) then 'revision_active'::public.workflow_stage_status
      when e.inferred_stage in ('concept_approval'::public.workflow_stage, 'print_approval'::public.workflow_stage, 'ebook_approval'::public.workflow_stage) then 'awaiting_client'::public.workflow_stage_status
      when e.inferred_stage is not null then 'active'::public.workflow_stage_status
      else null
    end as inferred_stage_status,
    case
      when p.project_status in ('completed'::public.project_lifecycle_status, 'on_hold'::public.project_lifecycle_status, 'cancelled'::public.project_lifecycle_status, 'archived'::public.project_lifecycle_status) then 'none'::public.workflow_waiting_on
      when e.inferred_stage = e.revision_stage and e.revision_status in ('submitted'::public.workflow_revision_status, 'under_review'::public.workflow_revision_status, 'in_progress'::public.workflow_revision_status, 'changes_requested'::public.workflow_revision_status) then 'team'::public.workflow_waiting_on
      when e.inferred_stage = e.revision_stage and e.revision_status = 'ready_for_client_review'::public.workflow_revision_status then 'client'::public.workflow_waiting_on
      when p.print_version_approval_date is not null and p.requires_ebook is null and e.inferred_stage = 'print_approval'::public.workflow_stage then 'none'::public.workflow_waiting_on
      when p.design_concept_approval_date is not null and (p.requires_print is null or p.requires_ebook is null) and e.inferred_stage = 'concept_approval'::public.workflow_stage then 'none'::public.workflow_waiting_on
      when p.current_stage in ('Files Required', 'Waiting for Files') and e.inferred_stage = 'files_received'::public.workflow_stage then 'client'::public.workflow_waiting_on
      when p.current_stage = 'New' and e.inferred_stage = 'files_received'::public.workflow_stage then case when p.waiting_on = 'Client' then 'client'::public.workflow_waiting_on else 'none'::public.workflow_waiting_on end
      when p.current_stage in ('Concept Revisions', 'Print Revisions') or (p.stage_status = 'REVISION_ACTIVE' and e.inferred_stage in ('concept_approval'::public.workflow_stage, 'print_approval'::public.workflow_stage, 'ebook_approval'::public.workflow_stage)) or (p.status::text = 'In Revision' and e.inferred_stage in ('concept_approval'::public.workflow_stage, 'print_approval'::public.workflow_stage, 'ebook_approval'::public.workflow_stage)) then 'team'::public.workflow_waiting_on
      when e.inferred_stage in ('concept_approval'::public.workflow_stage, 'print_approval'::public.workflow_stage, 'ebook_approval'::public.workflow_stage) then 'client'::public.workflow_waiting_on
      when e.inferred_stage is not null then 'team'::public.workflow_waiting_on
      else null
    end as inferred_waiting_on
  from public.projects p
  join stage_evidence e on e.id = p.id
)
update public.projects p
set workflow_stage_key = coalesce(p.workflow_stage_key, s.inferred_stage),
    workflow_stage_status_key = coalesce(p.workflow_stage_status_key, s.inferred_stage_status),
    workflow_waiting_on_key = coalesce(p.workflow_waiting_on_key, s.inferred_waiting_on)
from inferred_state s
where p.id = s.id
  and (
    (p.workflow_stage_key is null and s.inferred_stage is not null)
    or (p.workflow_stage_status_key is null and s.inferred_stage_status is not null)
    or (p.workflow_waiting_on_key is null and s.inferred_waiting_on is not null)
  );

insert into public.phase6_backfill_issues (
  entity_type, entity_id, project_id, issue_code, severity, details
)
select
  'project', p.id, p.id, 'WORKFLOW_STAGE_AMBIGUOUS', 'warning',
  jsonb_build_object(
    'legacy_status', p.status::text,
    'legacy_current_stage', p.current_stage,
    'milestone_summary', jsonb_strip_nulls(jsonb_build_object(
      'files_received_date', p.files_received_date,
      'design_concept_submitted_date', p.design_concept_submitted_date,
      'design_concept_approval_date', p.design_concept_approval_date,
      'print_version_submitted_date', p.print_version_submitted_date,
      'print_version_approval_date', p.print_version_approval_date,
      'ebook_submitted_date', p.ebook_submitted_date,
      'ebook_approval_date', p.ebook_approval_date,
      'final_delivery_date', p.final_delivery_date
    )),
    'resolution', 'canonical_stage_left_null'
  )
from public.projects p
where p.workflow_stage_key is null
on conflict do nothing;

-- Milestones that contradict confirmed/inferred routing are preserved and flagged.
insert into public.phase6_backfill_issues (
  entity_type, entity_id, project_id, issue_code, severity, details
)
select
  'project', p.id, p.id, 'WORKFLOW_STATE_CONTRADICTORY', 'error',
  jsonb_build_object(
    'reason', case
      when p.requires_print is false and (p.print_version_submitted_date is not null or p.print_version_approval_date is not null)
        then 'print_milestone_exists_but_print_capability_is_false'
      else 'ebook_milestone_exists_but_ebook_capability_is_false'
    end,
    'service_type', p.service_type
  )
from public.projects p
where (p.requires_print is false and (p.print_version_submitted_date is not null or p.print_version_approval_date is not null))
   or (p.requires_ebook is false and (p.ebook_submitted_date is not null or p.ebook_approval_date is not null))
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 08 Stage Skip Backfill
-- -----------------------------------------------------------------------------

update public.project_stage_skips s
set stage_key = case s.stage
  when 'Files Required' then 'files_received'::public.workflow_stage
  when 'Files Received' then 'files_received'::public.workflow_stage
  when 'Design Concept in Progress' then 'design_concept'::public.workflow_stage
  when 'Design Concept' then 'design_concept'::public.workflow_stage
  when 'Awaiting Concept Approval' then 'concept_approval'::public.workflow_stage
  when 'Concept Approval' then 'concept_approval'::public.workflow_stage
  when 'Concept Revisions' then 'concept_approval'::public.workflow_stage
  when 'Print Version in Progress' then 'print_version'::public.workflow_stage
  when 'Print Version' then 'print_version'::public.workflow_stage
  when 'Awaiting Print Approval' then 'print_approval'::public.workflow_stage
  when 'Print Approval' then 'print_approval'::public.workflow_stage
  when 'Print Revisions' then 'print_approval'::public.workflow_stage
  when 'eBook in Progress' then 'ebook_version'::public.workflow_stage
  when 'eBook Conversion' then 'ebook_version'::public.workflow_stage
  when 'Ebook Version' then 'ebook_version'::public.workflow_stage
  when 'eBook Version' then 'ebook_version'::public.workflow_stage
  when 'eBook Review' then 'ebook_approval'::public.workflow_stage
  when 'Ebook Approval' then 'ebook_approval'::public.workflow_stage
  when 'Final Quality Check' then 'final_delivery'::public.workflow_stage
  when 'Final Delivery' then 'final_delivery'::public.workflow_stage
  when 'Ready for Delivery' then 'final_delivery'::public.workflow_stage
  when 'Final QA' then 'final_delivery'::public.workflow_stage
  else null
end
where s.stage_key is null;

update public.project_stage_skips s
set requester_id = coalesce(s.requester_id, s.requested_by),
    canonical_status = case
      when s.canonical_status is not null then s.canonical_status
      when upper(trim(s.status)) = 'PENDING' then 'pending'::public.workflow_skip_status
      when upper(trim(s.status)) = 'APPROVED' then 'approved'::public.workflow_skip_status
      when upper(trim(s.status)) = 'REJECTED' then 'rejected'::public.workflow_skip_status
      else null
    end,
    responded_at = coalesce(s.responded_at, s.client_response_at),
    response_note = coalesce(s.response_note, s.client_notes)
where s.requester_id is null
   or s.canonical_status is null
   or (s.responded_at is null and s.client_response_at is not null)
   or (s.response_note is null and s.client_notes is not null);

insert into public.phase6_backfill_issues (
  entity_type, entity_id, project_id, issue_code, severity, details
)
select
  'project_stage_skip', s.id, s.project_id, 'SKIP_STAGE_AMBIGUOUS', 'warning',
  jsonb_build_object('legacy_stage', s.stage, 'legacy_status', s.status)
from public.project_stage_skips s
where s.stage_key is null
   or (
     s.canonical_status is null
     and upper(trim(s.status)) <> 'SERVICE_TYPE_PRESET'
   )
on conflict do nothing;

-- SERVICE_TYPE_PRESET deliberately remains canonical_status NULL. It records an
-- automatic legacy routing artifact, not a manual client-approved skip request.

-- -----------------------------------------------------------------------------
-- 09 Admin Override Compatibility Backfill
-- -----------------------------------------------------------------------------

-- One exact map feeds both diagnostics and missing-key updates.
with stage_map(legacy_stage, stage_key) as (
  values
    ('Files Required', 'files_received'::public.workflow_stage),
    ('Files Received', 'files_received'::public.workflow_stage),
    ('Design Concept in Progress', 'design_concept'::public.workflow_stage),
    ('Design Concept', 'design_concept'::public.workflow_stage),
    ('Awaiting Concept Approval', 'concept_approval'::public.workflow_stage),
    ('Concept Approval', 'concept_approval'::public.workflow_stage),
    ('Concept Revisions', 'concept_approval'::public.workflow_stage),
    ('Print Version in Progress', 'print_version'::public.workflow_stage),
    ('Print Version', 'print_version'::public.workflow_stage),
    ('Awaiting Print Approval', 'print_approval'::public.workflow_stage),
    ('Print Approval', 'print_approval'::public.workflow_stage),
    ('Print Revisions', 'print_approval'::public.workflow_stage),
    ('eBook in Progress', 'ebook_version'::public.workflow_stage),
    ('eBook Conversion', 'ebook_version'::public.workflow_stage),
    ('Ebook Version', 'ebook_version'::public.workflow_stage),
    ('eBook Version', 'ebook_version'::public.workflow_stage),
    ('eBook Review', 'ebook_approval'::public.workflow_stage),
    ('Ebook Approval', 'ebook_approval'::public.workflow_stage),
    ('Final Quality Check', 'final_delivery'::public.workflow_stage),
    ('Final Delivery', 'final_delivery'::public.workflow_stage),
    ('Ready for Delivery', 'final_delivery'::public.workflow_stage),
    ('Final QA', 'final_delivery'::public.workflow_stage)
), mapped as (
  select o.id, o.project_id, o.previous_stage, o.new_stage,
    o.previous_stage_key, o.resulting_stage_key,
    before_map.stage_key as inferred_previous,
    after_map.stage_key as inferred_resulting
  from public.admin_workflow_overrides o
  left join stage_map before_map on before_map.legacy_stage = o.previous_stage
  left join stage_map after_map on after_map.legacy_stage = o.new_stage
), diagnosed as (
  insert into public.phase6_backfill_issues (
    entity_type, entity_id, project_id, issue_code, severity, details
  )
  select 'admin_workflow_override', o.id, o.project_id,
    'OVERRIDE_STATE_AMBIGUOUS', 'warning',
    jsonb_build_object(
      'legacy_previous_stage', o.previous_stage,
      'legacy_new_stage', o.new_stage,
      'existing_previous_stage_key', o.previous_stage_key,
      'existing_resulting_stage_key', o.resulting_stage_key,
      'inferred_previous_stage_key', o.inferred_previous,
      'inferred_resulting_stage_key', o.inferred_resulting,
      'resolution', 'existing_canonical_value_preserved_missing_keys_only'
    )
  from mapped o
  where o.inferred_previous is null or o.inferred_resulting is null
    or (o.previous_stage_key is not null and o.previous_stage_key <> o.inferred_previous)
    or (o.resulting_stage_key is not null and o.resulting_stage_key <> o.inferred_resulting)
  on conflict (
    entity_type,
    (coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    issue_code
  ) do update
  set details = public.phase6_backfill_issues.details || excluded.details,
      updated_at = now()
  where not (public.phase6_backfill_issues.details @> excluded.details)
  returning id
)
update public.admin_workflow_overrides o
set previous_stage_key = coalesce(o.previous_stage_key, m.inferred_previous),
    resulting_stage_key = coalesce(o.resulting_stage_key, m.inferred_resulting)
from mapped m
where o.id = m.id
  and ((o.previous_stage_key is null and m.inferred_previous is not null)
    or (o.resulting_stage_key is null and m.inferred_resulting is not null));

-- No lifecycle, stage-status, waiting-owner, or clock timestamps are inferred for
-- legacy overrides because those fields were not stored on the override row.

-- -----------------------------------------------------------------------------
-- 10 Time Total Backfill
-- -----------------------------------------------------------------------------

-- Repository code copies production_time_used and client_wait_time directly into
-- fields explicitly named active_seconds and client_wait_seconds. That is the only
-- supported 1:1 unit evidence. Integral, nonnegative values can therefore seed the
-- canonical second caches. production_days_used is not converted: its calendar-day
-- derivation mixes different semantics and cannot reconstruct the two clock totals.

update public.projects p
set production_seconds_total = p.production_time_used::bigint
where p.production_seconds_total = 0
  and p.production_time_used is not null
  and p.production_time_used >= 0
  and trunc(p.production_time_used) = p.production_time_used;

update public.projects p
set client_wait_seconds_total = p.client_wait_time::bigint
where p.client_wait_seconds_total = 0
  and p.client_wait_time is not null
  and p.client_wait_time >= 0
  and trunc(p.client_wait_time) = p.client_wait_time;

insert into public.phase6_backfill_issues (
  entity_type, entity_id, project_id, issue_code, severity, details
)
select
  'project', p.id, p.id, 'LEGACY_TOTAL_UNIT_UNCERTAIN', 'warning',
  jsonb_build_object(
    'production_time_used', p.production_time_used,
    'client_wait_time', p.client_wait_time,
    'production_days_used', p.production_days_used,
    'reason', case
      when coalesce(p.production_days_used, 0) > 0
        then 'production_days_used_is_calendar_day_derived_and_not_convertible_to_clock_seconds'
      else 'legacy_second_candidate_is_negative_or_fractional'
    end
  )
from public.projects p
where coalesce(p.production_days_used, 0) > 0
   or (p.production_time_used is not null
      and (p.production_time_used < 0 or trunc(p.production_time_used) <> p.production_time_used))
   or (p.client_wait_time is not null
      and (p.client_wait_time < 0 or trunc(p.client_wait_time) <> p.client_wait_time))
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 11 History Sequence Reconciliation and Legacy Snapshot Import
-- -----------------------------------------------------------------------------

-- Existing populated sequence values never change. Missing sequences append
-- after the maximum using a documented storage-order convention:
-- completed_at > paused_at > resumed_at > started_at > legacy created_at >
-- occurred_at ONLY when event_type is populated (canonical event evidence).
-- These legacy boundaries describe different events; priority is a normalization
-- convention, not proof of chronology. due_at is a deadline, never event evidence.
-- Corrected Step 3A leaves absent upgrade timestamps NULL. A rehearsal made with
-- the earlier timestamp defaults must be restored/rebuilt from the pre-Phase-6
-- fixture: contaminated values cannot be distinguished safely after the fact.
-- ALL unsequenced legacy events, missing timestamps, and ties are diagnosed;
-- UUID is only deterministic ordering, never a claim of historical precedence.
with evidence as (
  select h.id, h.project_id, h.event_type,
    coalesce(h.completed_at, h.paused_at, h.resumed_at, h.started_at,
      h.created_at, case when h.event_type is not null then h.occurred_at end) as evidence_at
  from public.project_stage_history h
  where h.sequence_no is null
), assessed as (
  select e.*, count(*) over (partition by e.project_id, e.evidence_at) as tied_rows
  from evidence e
)
insert into public.phase6_backfill_issues (
  entity_type, entity_id, project_id, issue_code, severity, details
)
select 'project', e.project_id, e.project_id, 'HISTORY_SEQUENCE_CONFLICT', 'warning',
  jsonb_build_object(
    'reason', 'unsequenced_history_order_is_a_migration_convention',
    'legacy_rows', count(*) filter (where e.event_type is null),
    'rows_without_time', count(*) filter (where e.evidence_at is null),
    'rows_with_tied_time', count(*) filter (where e.tied_rows > 1),
    'tie_breaker', 'uuid_not_historical_evidence'
  )
from assessed e
where e.event_type is null or e.evidence_at is null or e.tied_rows > 1
group by e.project_id
on conflict do nothing;

with maxima as (
  select h.project_id, coalesce(max(h.sequence_no), 0) as max_sequence
  from public.project_stage_history h
  where h.sequence_no is not null
  group by h.project_id
), missing as (
  select
    h.id,
    h.project_id,
    coalesce(m.max_sequence, 0) + row_number() over (
      partition by h.project_id
      order by coalesce(h.completed_at, h.paused_at, h.resumed_at, h.started_at,
        h.created_at, case when h.event_type is not null then h.occurred_at end) nulls last, h.id
    ) as assigned_sequence
  from public.project_stage_history h
  left join maxima m on m.project_id = h.project_id
  where h.sequence_no is null
)
update public.project_stage_history h
set sequence_no = m.assigned_sequence
from missing m
where h.id = m.id
  and h.sequence_no is null;

do $phase6$
begin
  if exists (
    select 1
    from public.project_stage_history h
    where h.event_type = 'legacy_snapshot_imported'::public.workflow_event_type
    group by h.project_id
    having count(*) > 1
  ) then
    raise exception 'Structural corruption: more than one legacy snapshot event already exists for a project';
  end if;
end
$phase6$;

create unique index if not exists project_stage_history_one_legacy_snapshot_uidx
  on public.project_stage_history (project_id)
  where event_type = 'legacy_snapshot_imported'::public.workflow_event_type;

insert into public.project_stage_history (
  project_id,
  stage,
  status,
  started_at,
  due_at,
  active_seconds,
  client_wait_seconds,
  action,
  sequence_no,
  event_type,
  from_stage,
  to_stage,
  from_stage_status,
  to_stage_status,
  from_waiting_on,
  to_waiting_on,
  occurred_at,
  production_seconds_delta,
  client_wait_seconds_delta,
  actor_id,
  actor_role,
  reason,
  metadata,
  created_at
)
select
  p.id,
  p.current_stage,
  p.stage_status,
  p.stage_started_at,
  p.stage_due_at,
  greatest(coalesce(p.production_time_used, 0), 0),
  greatest(coalesce(p.client_wait_time, 0), 0),
  'legacy_snapshot_imported',
  coalesce((
    select max(h.sequence_no) + 1
    from public.project_stage_history h
    where h.project_id = p.id
  ), 1),
  'legacy_snapshot_imported'::public.workflow_event_type,
  null,
  p.workflow_stage_key,
  null,
  p.workflow_stage_status_key,
  null,
  p.workflow_waiting_on_key,
  clock_timestamp(),
  0,
  0,
  null,
  null,
  'Phase 6 canonical history begins from the imported legacy snapshot',
  jsonb_strip_nulls(jsonb_build_object(
    'import_version', 'phase6_step3b_v1',
    'occurred_at_semantics', 'migration_import_time_not_historical_stage_entry_time',
    'date_timestamp_convention', 'DATE only: delivery uses local day start; revision due uses local day end in Asia/Karachi; neither proves historical time of day',
    'legacy', jsonb_build_object(
      'status', p.status::text,
      'current_stage', p.current_stage,
      'stage_status', p.stage_status,
      'waiting_on', p.waiting_on,
      'timeline_status', p.timeline_status,
      'service_type', p.service_type,
      'production_time_used', p.production_time_used,
      'client_wait_time', p.client_wait_time,
      'production_days_used', p.production_days_used,
      'canonical_revision_count_after_reconciliation', p.revision_count
    ),
    'milestones', jsonb_strip_nulls(jsonb_build_object(
      'files_received_date', p.files_received_date,
      'design_concept_submitted_date', p.design_concept_submitted_date,
      'design_concept_approval_date', p.design_concept_approval_date,
      'concept_revision_due_date', p.concept_revision_due_date,
      'print_version_submitted_date', p.print_version_submitted_date,
      'print_version_approval_date', p.print_version_approval_date,
      'print_revision_due_date', p.print_revision_due_date,
      'ebook_submitted_date', p.ebook_submitted_date,
      'ebook_approval_date', p.ebook_approval_date,
      'final_delivery_date', p.final_delivery_date,
      'delivery_date', p.delivery_date
    )),
    'canonical_snapshot', jsonb_build_object(
      'project_status', p.project_status,
      'workflow_stage_key', p.workflow_stage_key,
      'workflow_stage_status_key', p.workflow_stage_status_key,
      'workflow_waiting_on_key', p.workflow_waiting_on_key,
      'requires_print', p.requires_print,
      'requires_ebook', p.requires_ebook,
      'service_capability_status', p.service_capability_status,
      'revision_count', p.revision_count,
      'production_seconds_total', p.production_seconds_total,
      'client_wait_seconds_total', p.client_wait_seconds_total,
      'delivered_at', p.delivered_at
    ),
    'revision_request_count', (
      select count(*) from public.revision_requests r where r.project_id = p.id
    ),
    'revision_count_reconciliation', (
      select i.details
      from public.phase6_backfill_issues i
      where i.project_id = p.id
        and i.issue_code = 'REVISION_COUNT_DISCREPANCY'
      order by i.created_at, i.id
      limit 1
    ),
    'legacy_skipped_stage_states', coalesce((
      select jsonb_object_agg(e.key, e.value)
      from jsonb_each(
        case when jsonb_typeof(p.stage_states) = 'object' then p.stage_states else '{}'::jsonb end
      ) e
      where upper(coalesce(e.value ->> 'status', '')) = 'SKIPPED'
    ), '{}'::jsonb),
    'legacy_service_type_preset_skips', coalesce((
      select jsonb_agg(jsonb_build_object('stage', s.stage, 'status', s.status) order by s.requested_at, s.id)
      from public.project_stage_skips s
      where s.project_id = p.id
        and upper(trim(s.status)) = 'SERVICE_TYPE_PRESET'
    ), '[]'::jsonb),
    'legacy_stage_skip_evidence', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'stage', s.stage,
          'stage_key', s.stage_key,
          'legacy_status', s.status,
          'canonical_status', s.canonical_status
        ) order by s.requested_at, s.id
      )
      from public.project_stage_skips s
      where s.project_id = p.id
    ), '[]'::jsonb),
    'backfill_issue_codes', coalesce((
      select jsonb_agg(i.issue_code order by i.issue_code)
      from public.phase6_backfill_issues i
      where i.project_id = p.id and not i.resolved
    ), '[]'::jsonb)
  )),
  now()
from public.projects p
where not exists (
  select 1
  from public.project_stage_history h
  where h.project_id = p.id
    and h.event_type = 'legacy_snapshot_imported'::public.workflow_event_type
)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 12 Structural Validation and Queryable Report Counts
-- -----------------------------------------------------------------------------

do $phase6$
begin
  if exists (
    select 1
    from public.project_stage_history h
    where h.sequence_no is not null
    group by h.project_id, h.sequence_no
    having count(*) > 1
  ) then
    raise exception 'Structural corruption: duplicate project_stage_history sequence numbers remain';
  end if;

  if exists (
    select 1
    from public.projects p
    where not exists (
      select 1
      from public.project_stage_history h
      where h.project_id = p.id
        and h.event_type = 'legacy_snapshot_imported'::public.workflow_event_type
    )
  ) then
    raise exception 'Structural corruption: a project is missing its legacy snapshot import event';
  end if;

  if exists (
    select 1
    from public.project_stage_history h
    where h.event_type = 'legacy_snapshot_imported'::public.workflow_event_type
    group by h.project_id
    having count(*) <> 1
  ) then
    raise exception 'Structural corruption: legacy snapshot cardinality is not exactly one per imported project';
  end if;
end
$phase6$;

-- These read-only statements make Step 3B results queryable without requiring
-- zero business ambiguities. They intentionally return counts instead of changing
-- unresolved rows.

select
  count(*) as total_projects,
  count(*) filter (where project_status is null) as project_status_null_count,
  count(*) filter (where workflow_stage_key is null) as workflow_stage_key_null_count,
  count(*) filter (where workflow_stage_status_key is null) as workflow_stage_status_key_null_count,
  count(*) filter (where workflow_waiting_on_key is null) as workflow_waiting_on_key_null_count,
  count(*) filter (where service_capability_status = 'needs_review'::public.service_capability_status) as capability_needs_review_count,
  count(*) filter (where service_capability_status = 'inferred'::public.service_capability_status) as capability_inferred_count,
  count(*) filter (where service_capability_status = 'confirmed'::public.service_capability_status) as capability_confirmed_count
from public.projects;

select
  count(*) filter (where stage_key is null) as revision_stage_unresolved_count,
  count(*) filter (where canonical_status is null) as revision_canonical_status_unresolved_count
from public.revision_requests;

select count(*) as history_projects_missing_imported_snapshot
from public.projects p
where not exists (
  select 1
  from public.project_stage_history h
  where h.project_id = p.id
    and h.event_type = 'legacy_snapshot_imported'::public.workflow_event_type
);

select count(*) as duplicate_history_sequence_number_groups
from (
  select h.project_id, h.sequence_no
  from public.project_stage_history h
  where h.sequence_no is not null
  group by h.project_id, h.sequence_no
  having count(*) > 1
) duplicates;

select issue_code, severity, count(*) as issue_count
from public.phase6_backfill_issues
where not resolved
group by issue_code, severity
order by severity, issue_code;

-- -----------------------------------------------------------------------------
-- 13 Comments
-- -----------------------------------------------------------------------------

comment on column public.projects.delivered_at is
  'Canonical delivery timestamp. Step 3B date-only imports use start of the known Asia/Karachi date and disclose that precision in snapshot metadata.';
comment on column public.revision_requests.due_at is
  'Canonical revision due timestamp. Step 3B normalizes an unambiguous legacy due DATE to 23:59:59.999999 Asia/Karachi, preserving inclusive-date deadline semantics; historical time of day is unknown.';
comment on column public.project_stage_history.occurred_at is
  'Event occurrence timestamp. For legacy_snapshot_imported this is migration import time, not historical stage-entry time.';

-- All data changes, sequence allocation and validation share the locks above.
commit;
