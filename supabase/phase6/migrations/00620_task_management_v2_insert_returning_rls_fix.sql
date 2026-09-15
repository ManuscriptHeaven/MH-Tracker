begin;

-- Allow the row just inserted by an authenticated team member to satisfy the
-- SELECT policy used by PostgREST's INSERT ... RETURNING path. The fallback
-- mirrors the existing INSERT authorization and does not broaden ordinary
-- task visibility after commit; phase6_can_access_task(id) remains canonical.
drop policy if exists phase6_tasks_team_select on public.tasks;
create policy phase6_tasks_team_select on public.tasks for select to authenticated
using (
  public.phase6_can_access_task(id)
  or (
    created_by=(select auth.uid())
    and public.phase6_app_actor_class() in ('admin','project_manager','employee')
    and (project_id is null or public.phase6_team_can_access_project(project_id))
    and (assigned_to is null or public.phase6_collaboration_target_is_team(assigned_to))
    and (public.phase6_app_actor_class() in ('admin','project_manager') or assigned_to=(select auth.uid()))
    and (parent_task_id is null or public.phase6_can_access_task(parent_task_id))
  )
);

notify pgrst, 'reload schema';
commit;
