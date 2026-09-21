-- Repair compatibility fields when legacy project display columns drift from canonical workflow state.
-- Canonical project_status/workflow_* keys remain the source of truth.

with projected as (
  select
    p.id,
    public._workflow_compatibility_projection(
      p.project_status,
      p.workflow_stage_key,
      p.workflow_stage_status_key,
      p.workflow_waiting_on_key
    ) as compat
  from public.projects p
  where p.project_status is not null
    and p.workflow_stage_key is not null
    and p.workflow_stage_status_key is not null
    and p.workflow_waiting_on_key is not null
)
update public.projects p
set
  status = projected.compat->>'status',
  current_stage = projected.compat->>'current_stage',
  stage_status = projected.compat->>'stage_status',
  waiting_on = projected.compat->>'waiting_on',
  timeline_status = projected.compat->>'timeline_status'
from projected
where p.id = projected.id
  and (
    p.status is distinct from projected.compat->>'status'
    or p.current_stage is distinct from projected.compat->>'current_stage'
    or p.stage_status is distinct from projected.compat->>'stage_status'
    or p.waiting_on is distinct from projected.compat->>'waiting_on'
    or p.timeline_status is distinct from projected.compat->>'timeline_status'
  );
