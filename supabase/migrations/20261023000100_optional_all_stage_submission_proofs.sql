-- The stage-submission UI and submitStageForApproval API intentionally allow
-- files and links to be omitted for Design Concept, Print, eBook and Final
-- Delivery. A legacy BEFORE UPDATE trigger still rejected blank proof fields
-- when canonical approval RPCs moved projects into awaiting_client.
--
-- This removes ONLY that conflicting proof-presence gate. The canonical
-- workflow RPCs continue to enforce actor permissions, stage/state/version
-- checks, service-capability rules, client notifications, and audit history.
--
-- A stage can have an attached file OR a link, or neither. An empty field
-- must never overwrite a previously saved proof.

begin;

do $verify_workflow$
begin
  if to_regprocedure('public.workflow_submit_stage_for_approval(uuid,bigint,uuid,text)') is null
    or to_regprocedure('public.workflow_complete_final_delivery(uuid,bigint,uuid,text)') is null then
    raise exception 'Canonical workflow RPCs are missing; stage proof migration cannot proceed.';
  end if;
end
$verify_workflow$;

drop trigger if exists workflow_submission_gate_trigger on public.projects;
drop function if exists public.workflow_submission_gate();

commit;
