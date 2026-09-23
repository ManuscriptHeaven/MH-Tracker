-- Reusable publishing workflow/project templates.
-- Templates describe canonical stages and seed project tasks without replacing Phase 6 workflow authority.

begin;

create table if not exists public.project_templates (
  template_key text primary key,
  name text not null,
  description text not null default '',
  service_type text not null,
  recommended_requires_print boolean not null,
  recommended_requires_ebook boolean not null,
  is_system boolean not null default false,
  active boolean not null default true,
  created_by uuid null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (recommended_requires_print or recommended_requires_ebook)
);

alter table public.projects
  add column if not exists workflow_template_key text null;

do $project_template_fk$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='projects_workflow_template_key_fkey'
      and conrelid='public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_workflow_template_key_fkey
      foreign key(workflow_template_key) references public.project_templates(template_key)
      on delete set null;
  end if;
end
$project_template_fk$;

create table if not exists public.project_template_stages (
  id uuid primary key default gen_random_uuid(),
  template_key text not null references public.project_templates(template_key) on delete cascade,
  stage_key public.workflow_stage not null,
  label text not null,
  position integer not null check (position >= 0),
  unique(template_key, stage_key)
);

create table if not exists public.project_template_tasks (
  id uuid primary key default gen_random_uuid(),
  template_key text not null references public.project_templates(template_key) on delete cascade,
  stage_key public.workflow_stage not null,
  title text not null,
  description text not null default '',
  priority text not null default 'Normal' check (priority in ('Low','Normal','High','Urgent')),
  estimated_minutes integer null check (estimated_minutes is null or estimated_minutes >= 0),
  relative_due_days integer null check (relative_due_days is null or relative_due_days >= 0),
  sort_order integer not null default 0,
  unique(template_key, stage_key, title)
);

alter table public.tasks
  add column if not exists workflow_stage_key public.workflow_stage null,
  add column if not exists template_key text null,
  add column if not exists template_task_id uuid null;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='tasks_template_key_fkey'
      and conrelid='public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_template_key_fkey
      foreign key(template_key) references public.project_templates(template_key)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname='tasks_template_task_id_fkey'
      and conrelid='public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_template_task_id_fkey
      foreign key(template_task_id) references public.project_template_tasks(id)
      on delete set null;
  end if;
end
$constraints$;

create unique index if not exists idx_tasks_project_template_task_unique
  on public.tasks(project_id, template_task_id)
  where template_task_id is not null;
create index if not exists idx_tasks_workflow_stage
  on public.tasks(project_id, workflow_stage_key, sort_order)
  where archived_at is null;

alter table public.project_templates enable row level security;
alter table public.project_template_stages enable row level security;
alter table public.project_template_tasks enable row level security;

revoke all on public.project_templates from anon;
revoke all on public.project_template_stages from anon;
revoke all on public.project_template_tasks from anon;
revoke all on public.project_templates from authenticated;
revoke all on public.project_template_stages from authenticated;
revoke all on public.project_template_tasks from authenticated;

grant select on public.project_templates, public.project_template_stages, public.project_template_tasks to authenticated;
grant insert, update, delete on public.project_templates, public.project_template_stages, public.project_template_tasks to authenticated;

drop policy if exists project_templates_select on public.project_templates;
create policy project_templates_select
on public.project_templates for select to authenticated
using (public.phase6_app_actor_class() in ('admin','project_manager'));

drop policy if exists project_templates_admin_insert on public.project_templates;
create policy project_templates_admin_insert
on public.project_templates for insert to authenticated
with check (
  public.phase6_app_actor_class()='admin'
  and created_by=(select auth.uid())
  and is_system=false
);

drop policy if exists project_templates_admin_update on public.project_templates;
create policy project_templates_admin_update
on public.project_templates for update to authenticated
using (public.phase6_app_actor_class()='admin' and is_system=false)
with check (public.phase6_app_actor_class()='admin' and is_system=false);

drop policy if exists project_templates_admin_delete on public.project_templates;
create policy project_templates_admin_delete
on public.project_templates for delete to authenticated
using (public.phase6_app_actor_class()='admin' and is_system=false);

drop policy if exists project_template_stages_select on public.project_template_stages;
create policy project_template_stages_select
on public.project_template_stages for select to authenticated
using (
  public.phase6_app_actor_class() in ('admin','project_manager')
  and exists (
    select 1 from public.project_templates t
    where t.template_key=project_template_stages.template_key and t.active
  )
);

drop policy if exists project_template_stages_admin_write on public.project_template_stages;
create policy project_template_stages_admin_write
on public.project_template_stages for all to authenticated
using (
  public.phase6_app_actor_class()='admin'
  and exists (
    select 1 from public.project_templates t
    where t.template_key=project_template_stages.template_key and t.is_system=false
  )
)
with check (
  public.phase6_app_actor_class()='admin'
  and exists (
    select 1 from public.project_templates t
    where t.template_key=project_template_stages.template_key and t.is_system=false
  )
);

drop policy if exists project_template_tasks_select on public.project_template_tasks;
create policy project_template_tasks_select
on public.project_template_tasks for select to authenticated
using (
  public.phase6_app_actor_class() in ('admin','project_manager')
  and exists (
    select 1 from public.project_templates t
    where t.template_key=project_template_tasks.template_key and t.active
  )
);

drop policy if exists project_template_tasks_admin_write on public.project_template_tasks;
create policy project_template_tasks_admin_write
on public.project_template_tasks for all to authenticated
using (
  public.phase6_app_actor_class()='admin'
  and exists (
    select 1 from public.project_templates t
    where t.template_key=project_template_tasks.template_key and t.is_system=false
  )
)
with check (
  public.phase6_app_actor_class()='admin'
  and exists (
    select 1 from public.project_templates t
    where t.template_key=project_template_tasks.template_key and t.is_system=false
  )
);

insert into public.project_templates(
  template_key,name,description,service_type,
  recommended_requires_print,recommended_requires_ebook,is_system,active
) values
  ('book-formatting','Book Formatting','Print-focused formatting workflow with concept, production, QA and delivery tasks.','Print Formatting',true,false,true,true),
  ('print-ebook','Print + eBook','Combined print and eBook workflow with approval gates for both deliverables.','Print + eBook',true,true,true,true),
  ('cover-design','Cover Design','Cover design workflow with brief, concept review, final artwork QA and delivery.','Cover Design',true,false,true,true),
  ('revision-only','Revision Only','Focused revision workflow for intake, implementation, QA and final handoff.','Revision Only',true,false,true,true)
on conflict (template_key) do update
set name=excluded.name,
    description=excluded.description,
    service_type=excluded.service_type,
    recommended_requires_print=excluded.recommended_requires_print,
    recommended_requires_ebook=excluded.recommended_requires_ebook,
    is_system=true,
    active=true,
    updated_at=now();

insert into public.project_template_stages(template_key,stage_key,label,position) values
  ('book-formatting','files_received','Files Received',10),
  ('book-formatting','design_concept','Design Concept',20),
  ('book-formatting','concept_approval','Concept Approval',30),
  ('book-formatting','print_version','Print Version',40),
  ('book-formatting','print_approval','Print Approval',50),
  ('book-formatting','final_delivery','Final Delivery',60),

  ('print-ebook','files_received','Files Received',10),
  ('print-ebook','design_concept','Design Concept',20),
  ('print-ebook','concept_approval','Concept Approval',30),
  ('print-ebook','print_version','Print Version',40),
  ('print-ebook','print_approval','Print Approval',50),
  ('print-ebook','ebook_version','eBook Version',60),
  ('print-ebook','ebook_approval','eBook Approval',70),
  ('print-ebook','final_delivery','Final Delivery',80),

  ('cover-design','files_received','Brief & Files',10),
  ('cover-design','design_concept','Cover Concept',20),
  ('cover-design','concept_approval','Concept Approval',30),
  ('cover-design','final_delivery','Final Artwork',40),

  ('revision-only','files_received','Revision Intake',10),
  ('revision-only','print_version','Revision Production',20),
  ('revision-only','print_approval','Revision QA',30),
  ('revision-only','final_delivery','Final Delivery',40)
on conflict (template_key,stage_key) do update
set label=excluded.label, position=excluded.position;

insert into public.project_template_tasks(
  template_key,stage_key,title,description,priority,estimated_minutes,relative_due_days,sort_order
) values
  ('book-formatting','files_received','Review manuscript and client brief','Confirm files, trim size, platform requirements and missing inputs.','High',45,0,100),
  ('book-formatting','design_concept','Prepare formatting concept','Build representative sample pages and typography system.','High',180,2,200),
  ('book-formatting','concept_approval','Resolve concept feedback','Process client concept feedback and lock design direction.','Normal',90,3,300),
  ('book-formatting','print_version','Complete print formatting','Format the full print manuscript to the approved system.','High',420,7,400),
  ('book-formatting','print_approval','Run print QA','Check pagination, styles, widows/orphans, TOC and export quality.','High',120,8,500),
  ('book-formatting','final_delivery','Package final print files','Prepare final PDF/source package and delivery notes.','Normal',60,9,600),

  ('print-ebook','files_received','Review manuscript and production requirements','Confirm source files, print specs and eBook platform requirements.','High',60,0,100),
  ('print-ebook','design_concept','Prepare shared design concept','Create the approved visual system for print and digital outputs.','High',180,2,200),
  ('print-ebook','print_version','Complete print formatting','Produce full print interior from approved concept.','High',420,7,400),
  ('print-ebook','print_approval','Run print QA and corrections','Validate print PDF before digital conversion.','High',120,8,500),
  ('print-ebook','ebook_version','Build eBook edition','Create reflowable/fixed-layout eBook as required.','High',240,11,600),
  ('print-ebook','ebook_approval','Validate eBook package','Run EPUB/device checks and resolve validation issues.','High',90,12,700),
  ('print-ebook','final_delivery','Package print and eBook deliverables','Prepare final files, links and delivery notes.','Normal',60,13,800),

  ('cover-design','files_received','Review cover brief and assets','Verify dimensions, copy, branding references and supplied assets.','High',45,0,100),
  ('cover-design','design_concept','Create cover concept','Develop the primary cover direction for client review.','High',180,2,200),
  ('cover-design','concept_approval','Apply cover feedback','Resolve approved revision notes and lock final direction.','Normal',120,4,300),
  ('cover-design','final_delivery','Prepare final cover artwork','Export print/digital assets and run final preflight.','High',90,5,400),

  ('revision-only','files_received','Triage revision request','Confirm scope, source version and requested corrections.','High',45,0,100),
  ('revision-only','print_version','Implement requested revisions','Apply approved revision instructions to the working files.','High',180,2,200),
  ('revision-only','print_approval','QA revised output','Verify each requested change and check for regressions.','High',90,3,300),
  ('revision-only','final_delivery','Deliver revised files','Package revised outputs and change summary.','Normal',45,4,400)
on conflict (template_key,stage_key,title) do update
set description=excluded.description,
    priority=excluded.priority,
    estimated_minutes=excluded.estimated_minutes,
    relative_due_days=excluded.relative_due_days,
    sort_order=excluded.sort_order;

create or replace function public.apply_project_template(
  p_project_id uuid,
  p_template_key text
)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_actor uuid := auth.uid();
  v_assignee uuid;
  v_created integer := 0;
begin
  if v_actor is null then
    raise exception 'template_auth_required';
  end if;

  if public.phase6_app_actor_class() not in ('admin','project_manager') then
    raise exception 'template_admin_or_pm_required';
  end if;

  if not public.phase6_team_can_access_project(p_project_id) then
    raise exception 'template_project_access_denied';
  end if;

  if not exists (
    select 1 from public.project_templates t
    where t.template_key=p_template_key and t.active
  ) then
    raise exception 'template_not_found';
  end if;

  select p.assigned_to into v_assignee
  from public.projects p
  where p.id=p_project_id;

  insert into public.tasks(
    title,description,project_id,assigned_to,created_by,status,priority,
    due_date,estimated_minutes,sort_order,task_type,visibility,
    workflow_stage_key,template_key,template_task_id
  )
  select
    tt.title,
    tt.description,
    p_project_id,
    v_assignee,
    v_actor,
    'To Do',
    tt.priority,
    case when tt.relative_due_days is null then null else current_date + tt.relative_due_days end,
    tt.estimated_minutes,
    tt.sort_order,
    'template',
    'team',
    tt.stage_key,
    tt.template_key,
    tt.id
  from public.project_template_tasks tt
  where tt.template_key=p_template_key
    and not exists (
      select 1 from public.tasks existing
      where existing.project_id=p_project_id
        and existing.template_task_id=tt.id
    )
  order by tt.sort_order;

  get diagnostics v_created = row_count;
  return v_created;
end
$fn$;

revoke all on function public.apply_project_template(uuid,text) from public, anon;
grant execute on function public.apply_project_template(uuid,text) to authenticated;

create or replace function public.apply_project_template_after_project_insert()
returns trigger
language plpgsql
security invoker
set search_path=pg_catalog,pg_temp
as $fn$
begin
  if new.workflow_template_key is not null then
    perform public.apply_project_template(new.id,new.workflow_template_key);
  end if;
  return new;
end
$fn$;

revoke all on function public.apply_project_template_after_project_insert() from public,anon,authenticated;

drop trigger if exists apply_project_template_after_project_insert_trigger on public.projects;
create trigger apply_project_template_after_project_insert_trigger
after insert on public.projects
for each row
when (new.workflow_template_key is not null)
execute function public.apply_project_template_after_project_insert();

notify pgrst, 'reload schema';

commit;
