begin;

-- Tasks were readable through RLS but were not part of the Supabase Realtime
-- publication, so already-open team sessions did not receive admin-created or
-- reassigned task changes until a manual reload.
do $task_realtime$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'tasks'
    ) then
      alter publication supabase_realtime add table public.tasks;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'task_assignees'
    ) then
      alter publication supabase_realtime add table public.task_assignees;
    end if;
  end if;
end
$task_realtime$;

commit;
