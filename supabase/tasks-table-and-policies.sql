-- Adds real team tasks for the My Tasks tab.

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  project_id uuid references public.projects(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'To Do'
    check (status in ('To Do', 'In Progress', 'Done')),
  priority public.project_priority not null default 'Normal',
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_project_id_idx on public.tasks(project_id);
create index if not exists tasks_assigned_to_idx on public.tasks(assigned_to);
create index if not exists tasks_created_by_idx on public.tasks(created_by);
create index if not exists tasks_status_idx on public.tasks(status);
create index if not exists tasks_due_date_idx on public.tasks(due_date);

drop trigger if exists touch_tasks_updated_at on public.tasks;
create trigger touch_tasks_updated_at
before update on public.tasks
for each row execute function public.touch_updated_at();

alter table public.tasks enable row level security;
grant select, insert, update, delete on public.tasks to authenticated;
revoke all on public.tasks from anon;

drop policy if exists "Team can read visible tasks" on public.tasks;
create policy "Team can read visible tasks"
on public.tasks
for select
to authenticated
using (
  public.current_user_role()::text <> 'client'
  and (
    public.can_manage_all_projects()
    or assigned_to = auth.uid()
    or created_by = auth.uid()
  )
);

drop policy if exists "Team can create tasks" on public.tasks;
create policy "Team can create tasks"
on public.tasks
for insert
to authenticated
with check (
  public.current_user_role()::text <> 'client'
  and created_by = auth.uid()
);

drop policy if exists "Team can update visible tasks" on public.tasks;
create policy "Team can update visible tasks"
on public.tasks
for update
to authenticated
using (
  public.current_user_role()::text <> 'client'
  and (
    public.can_manage_all_projects()
    or assigned_to = auth.uid()
    or created_by = auth.uid()
  )
)
with check (
  public.current_user_role()::text <> 'client'
  and (
    public.can_manage_all_projects()
    or assigned_to = auth.uid()
    or created_by = auth.uid()
  )
);

drop policy if exists "Admins and creators can delete tasks" on public.tasks;
create policy "Admins and creators can delete tasks"
on public.tasks
for delete
to authenticated
using (
  public.current_user_role() = 'admin'
  or created_by = auth.uid()
);
