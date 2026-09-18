-- MH Tracker stability patch: allow admin project hard-delete without weakening
-- append-only workflow history during normal operations.
--
-- Production Supabase migration applied as:
--   20260918072100_stabilize_project_hard_delete
--
-- Root causes addressed:
-- 1. project_stage_history cascades were blocked by the append-only trigger.
-- 2. phase6_backfill_issues and workflow_idempotency_receipts used ON DELETE RESTRICT.
--
-- Direct history DELETE/UPDATE remains forbidden. A history DELETE is allowed only
-- when the parent project row is already absent, which is the FK-cascade context.

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
  drop constraint phase6_backfill_issues_project_id_fkey,
  add constraint phase6_backfill_issues_project_id_fkey
    foreign key (project_id)
    references public.projects(id)
    on delete cascade;

alter table public.workflow_idempotency_receipts
  drop constraint workflow_idempotency_receipts_project_id_fkey,
  add constraint workflow_idempotency_receipts_project_id_fkey
    foreign key (project_id)
    references public.projects(id)
    on delete cascade;

commit;
