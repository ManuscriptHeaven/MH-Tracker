-- Files Received is a client action, not production time.
update public.workflow_stage_definitions
set default_production_days = 0,
    updated_at = now()
where stage_key = 'files_received';

update public.projects
set workflow_settings = jsonb_set(
      coalesce(workflow_settings, '{}'::jsonb),
      '{files_received_days}',
      '0'::jsonb,
      true
    ),
    updated_at = updated_at
where project_status = 'active'
  and coalesce((workflow_settings->>'files_received_days')::integer, 2) <> 0;
