-- Source mirror of production migration 20260918072100_stabilize_project_hard_delete.
-- Keeps workflow history append-only during normal operations while permitting
-- the FK cascade that occurs only when an Admin physically deletes a parent project.
-- The current Task V2 UI archives projects instead of physically deleting them,
-- but the database remains internally consistent for authorized maintenance paths.

begin;

create or replace function public.phase6_guard_history_append_only()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'pg_temp'
as $function$
begin
  if tg_op = 'UPDATE' then
    raise exception 'phase6_project_stage_history_append_only: workflow history is append-only'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    if not exists (
      select 1
      from public.projects p
      where p.id = old.project_id
    ) then
      return old;
    end if;

    raise exception 'phase6_project_stage_history_append_only: workflow history is append-only'
      using errcode = '42501';
  end if;

  return null;
end
$function$;

alter table public.phase6_backfill_issues
  drop constraint if exists phase6_backfill_issues_project_id_fkey;

alter table public.phase6_backfill_issues
  add constraint phase6_backfill_issues_project_id_fkey
    foreign key (project_id)
    references public.projects(id)
    on delete cascade;

alter table public.workflow_idempotency_receipts
  drop constraint if exists workflow_idempotency_receipts_project_id_fkey;

alter table public.workflow_idempotency_receipts
  add constraint workflow_idempotency_receipts_project_id_fkey
    foreign key (project_id)
    references public.projects(id)
    on delete cascade;

commit;
