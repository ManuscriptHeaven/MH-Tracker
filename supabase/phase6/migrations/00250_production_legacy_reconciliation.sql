-- Phase 6 production legacy reconciliation
-- Run AFTER 00200_legacy_backfill.sql and BEFORE 00300_workflow_rpcs.sql.
--
-- Why this exists:
-- The legacy MH Tracker workflow advanced every project through Print -> eBook
-- regardless of service_type. Therefore historical print/eBook milestones cannot
-- be treated as proof that the service label was wrong or that the row is corrupt.
-- However, an actual submitted/approved milestone IS reliable evidence that the
-- format participated in this project's historical workflow. We only widen a
-- capability from false/null -> true; we never turn a true capability off and we
-- never auto-resolve an unknown service type merely because one milestone exists.
--
-- This migration is deliberately additive so the staging-validated 00100/00200
-- sources remain unchanged and auditable.

begin;

-- Preconditions: this reconciliation belongs to the Phase 6 post-00200 schema.
do $phase6_reconcile_preconditions$
begin
  if to_regclass('public.phase6_backfill_issues') is null then
    raise exception 'phase6_reconciliation_failed: phase6_backfill_issues missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='projects' and column_name='requires_print'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='projects' and column_name='requires_ebook'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='projects' and column_name='workflow_stage_key'
  ) then
    raise exception 'phase6_reconciliation_failed: canonical project columns missing';
  end if;
end
$phase6_reconcile_preconditions$;

-- Record exactly which capability values are being widened before changing them.
insert into public.phase6_backfill_issues (
  entity_type, entity_id, project_id, issue_code, severity, details
)
select
  'project', p.id, p.id, 'CAPABILITY_CONFLICT', 'warning',
  jsonb_build_object(
    'reason', 'legacy_workflow_milestone_evidence_widened_capability',
    'service_type', p.service_type,
    'previous_requires_print', p.requires_print,
    'previous_requires_ebook', p.requires_ebook,
    'print_milestone_evidence',
      (p.print_version_submitted_date is not null or p.print_version_approval_date is not null),
    'ebook_milestone_evidence',
      (p.ebook_submitted_date is not null or p.ebook_approval_date is not null),
    'resolution', 'capability_widened_only_when_submitted_or_approved_milestone_exists'
  )
from public.projects p
where (
    (p.print_version_submitted_date is not null or p.print_version_approval_date is not null)
    and p.requires_print is distinct from true
  ) or (
    (p.ebook_submitted_date is not null or p.ebook_approval_date is not null)
    and p.requires_ebook is distinct from true
  )
on conflict do nothing;

-- Widen capabilities only from concrete submitted/approved milestone evidence.
-- Do not alter service_capability_status here: unknown service labels remain
-- needs_review and therefore continue to fail closed at the 00500 preflight.
update public.projects p
set requires_print = case
      when p.print_version_submitted_date is not null
        or p.print_version_approval_date is not null then true
      else p.requires_print
    end,
    requires_ebook = case
      when p.ebook_submitted_date is not null
        or p.ebook_approval_date is not null then true
      else p.requires_ebook
    end
where (
    (p.print_version_submitted_date is not null or p.print_version_approval_date is not null)
    and p.requires_print is distinct from true
  ) or (
    (p.ebook_submitted_date is not null or p.ebook_approval_date is not null)
    and p.requires_ebook is distinct from true
  );

-- 00200 intentionally records milestone/capability mismatches as error-level
-- WORKFLOW_STATE_CONTRADICTORY issues. Resolve ONLY the two exact legacy reasons
-- once the corresponding evidence-backed capability has been widened.
update public.phase6_backfill_issues i
set resolved = true,
    details = i.details || jsonb_build_object(
      'reconciled_by', '00250_production_legacy_reconciliation',
      'resolution', 'legacy_milestone_evidence_widened_capability'
    ),
    updated_at = now()
from public.projects p
where i.project_id = p.id
  and i.issue_code = 'WORKFLOW_STATE_CONTRADICTORY'
  and i.severity = 'error'
  and not i.resolved
  and (
    (i.details->>'reason' = 'print_milestone_exists_but_print_capability_is_false'
      and p.requires_print is true
      and (p.print_version_submitted_date is not null or p.print_version_approval_date is not null))
    or
    (i.details->>'reason' = 'ebook_milestone_exists_but_ebook_capability_is_false'
      and p.requires_ebook is true
      and (p.ebook_submitted_date is not null or p.ebook_approval_date is not null))
  );

-- A paused terminal lifecycle still needs a non-null canonical stage because the
-- canonical tuple validator requires one. If no historical stage/milestone can be
-- inferred, use files_received as an inert neutral anchor. The lifecycle remains
-- on_hold/cancelled/archived, status remains paused, and waiting_on remains none;
-- this does NOT restart workflow execution.
update public.projects p
set workflow_stage_key = 'files_received'::public.workflow_stage,
    workflow_stage_status_key = 'paused'::public.workflow_stage_status,
    workflow_waiting_on_key = 'none'::public.workflow_waiting_on
where p.project_status in (
    'on_hold'::public.project_lifecycle_status,
    'cancelled'::public.project_lifecycle_status,
    'archived'::public.project_lifecycle_status
  )
  and p.workflow_stage_key is null;

-- Resolve only the ambiguity warnings now given the documented neutral anchor.
update public.phase6_backfill_issues i
set resolved = true,
    details = i.details || jsonb_build_object(
      'reconciled_by', '00250_production_legacy_reconciliation',
      'resolution', 'neutral_paused_lifecycle_anchor_files_received'
    ),
    updated_at = now()
from public.projects p
where i.project_id = p.id
  and i.issue_code = 'WORKFLOW_STAGE_AMBIGUOUS'
  and not i.resolved
  and p.project_status in (
    'on_hold'::public.project_lifecycle_status,
    'cancelled'::public.project_lifecycle_status,
    'archived'::public.project_lifecycle_status
  )
  and p.workflow_stage_key = 'files_received'::public.workflow_stage
  and p.workflow_stage_status_key = 'paused'::public.workflow_stage_status
  and p.workflow_waiting_on_key = 'none'::public.workflow_waiting_on;

-- Fail closed if this reconciliation did not remove the exact false-positive
-- blockers it was designed to address, or if a paused terminal row still lacks a
-- canonical stage.
do $phase6_reconcile_verify$
declare
  v_unresolved_legacy_conflicts integer;
  v_stage_less_paused_terminal integer;
begin
  select count(*) into v_unresolved_legacy_conflicts
  from public.phase6_backfill_issues i
  join public.projects p on p.id = i.project_id
  where i.issue_code = 'WORKFLOW_STATE_CONTRADICTORY'
    and i.severity = 'error'
    and not i.resolved
    and i.details->>'reason' in (
      'print_milestone_exists_but_print_capability_is_false',
      'ebook_milestone_exists_but_ebook_capability_is_false'
    );

  if v_unresolved_legacy_conflicts > 0 then
    raise exception
      'phase6_reconciliation_failed: % evidence-backed legacy capability conflicts remain unresolved',
      v_unresolved_legacy_conflicts;
  end if;

  select count(*) into v_stage_less_paused_terminal
  from public.projects p
  where p.project_status in (
      'on_hold'::public.project_lifecycle_status,
      'cancelled'::public.project_lifecycle_status,
      'archived'::public.project_lifecycle_status
    )
    and p.workflow_stage_key is null;

  if v_stage_less_paused_terminal > 0 then
    raise exception
      'phase6_reconciliation_failed: % paused terminal projects still lack canonical stage',
      v_stage_less_paused_terminal;
  end if;
end
$phase6_reconcile_verify$;

commit;
