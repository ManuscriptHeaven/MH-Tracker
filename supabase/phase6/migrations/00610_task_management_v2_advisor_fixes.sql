begin;

-- Cover the three actor foreign keys reported by the staging Performance Advisor.
create index if not exists task_assignees_assigned_by_idx
  on public.task_assignees(assigned_by) where assigned_by is not null;
create index if not exists task_comments_user_id_idx
  on public.task_comments(user_id);
create index if not exists task_checklist_items_completed_by_idx
  on public.task_checklist_items(completed_by) where completed_by is not null;

-- Cache auth.uid() once per statement rather than recalculating it per row.
drop policy if exists task_v2_assignees_insert on public.task_assignees;
create policy task_v2_assignees_insert on public.task_assignees for insert to authenticated
with check (
  public.phase6_can_access_task(task_id)
  and public.phase6_collaboration_target_is_team(profile_id)
  and (
    public.phase6_app_actor_class() in ('admin','project_manager')
    or exists (select 1 from public.tasks t where t.id=task_id
      and (t.created_by=(select auth.uid()) or t.assigned_to=(select auth.uid())))
  )
  and (assignment_role <> 'primary' or exists (
    select 1 from public.tasks t where t.id=task_id and t.assigned_to=profile_id
  ))
);
drop policy if exists task_v2_assignees_delete on public.task_assignees;
create policy task_v2_assignees_delete on public.task_assignees for delete to authenticated
using (
  public.phase6_can_access_task(task_id)
  and not (assignment_role='primary' and exists (
    select 1 from public.tasks t where t.id=task_id and t.assigned_to=profile_id
  ))
  and (
    public.phase6_app_actor_class() in ('admin','project_manager')
    or exists (select 1 from public.tasks t where t.id=task_id
      and (t.created_by=(select auth.uid()) or t.assigned_to=(select auth.uid())))
  )
);

drop policy if exists task_v2_comments_insert on public.task_comments;
create policy task_v2_comments_insert on public.task_comments for insert to authenticated
with check (user_id=(select auth.uid()) and public.phase6_can_access_task(task_id));
drop policy if exists task_v2_comments_update on public.task_comments;
create policy task_v2_comments_update on public.task_comments for update to authenticated
using (public.phase6_can_access_task(task_id) and (
  user_id=(select auth.uid()) or public.phase6_app_actor_class() in ('admin','project_manager')
)) with check (public.phase6_can_access_task(task_id) and (
  user_id=(select auth.uid()) or public.phase6_app_actor_class() in ('admin','project_manager')
));
drop policy if exists task_v2_comments_delete on public.task_comments;
create policy task_v2_comments_delete on public.task_comments for delete to authenticated
using (public.phase6_can_access_task(task_id) and (
  user_id=(select auth.uid()) or public.phase6_app_actor_class() in ('admin','project_manager')
));

notify pgrst, 'reload schema';
commit;
