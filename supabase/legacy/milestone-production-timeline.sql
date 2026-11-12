-- Automated milestone-based production timeline for Manuscript Heaven projects.
-- Safe to run more than once.

do $$
begin
  alter type public.project_status add value if not exists 'Files Required';
  alter type public.project_status add value if not exists 'Files Received';
  alter type public.project_status add value if not exists 'Design Concept in Progress';
  alter type public.project_status add value if not exists 'Awaiting Concept Approval';
  alter type public.project_status add value if not exists 'Concept Revisions';
  alter type public.project_status add value if not exists 'Print Version in Progress';
  alter type public.project_status add value if not exists 'Awaiting Print Approval';
  alter type public.project_status add value if not exists 'Print Revisions';
  alter type public.project_status add value if not exists 'eBook in Progress';
  alter type public.project_status add value if not exists 'eBook Review';
  alter type public.project_status add value if not exists 'Final Quality Check';
  alter type public.project_status add value if not exists 'Completed';
exception
  when duplicate_object then null;
end $$;

alter table public.projects
add column if not exists files_received_date date,
add column if not exists design_concept_due_date date,
add column if not exists design_concept_due_date_manual boolean not null default false,
add column if not exists design_concept_submitted_date date,
add column if not exists design_concept_approval_date date,
add column if not exists concept_revision_due_date date,
add column if not exists print_version_due_date date,
add column if not exists print_version_due_date_manual boolean not null default false,
add column if not exists print_version_submitted_date date,
add column if not exists print_version_approval_date date,
add column if not exists print_revision_due_date date,
add column if not exists ebook_due_date date,
add column if not exists ebook_due_date_manual boolean not null default false,
add column if not exists ebook_submitted_date date,
add column if not exists ebook_approval_date date,
add column if not exists final_delivery_date date,
add column if not exists current_stage text,
add column if not exists progress_percentage integer not null default 0,
add column if not exists waiting_on text not null default 'None',
add column if not exists timeline_status text not null default 'Paused',
add column if not exists production_days_used integer not null default 0,
add column if not exists delay_reason text not null default '',
add column if not exists client_action_required text not null default '',
add column if not exists print_timeline_days integer not null default 5;

alter table public.projects
drop constraint if exists projects_print_timeline_days_check,
add constraint projects_print_timeline_days_check check (print_timeline_days in (3, 4, 5));

alter table public.projects
drop constraint if exists projects_timeline_status_check,
add constraint projects_timeline_status_check check (timeline_status in ('Active', 'Paused', 'Completed', 'On Hold', 'Cancelled'));

alter table public.projects
drop constraint if exists projects_waiting_on_check,
add constraint projects_waiting_on_check check (waiting_on in ('Manuscript Heaven', 'Client', 'None'));

alter table public.activity_logs
add column if not exists activity_type text,
add column if not exists description text,
add column if not exists attachment_url text,
add column if not exists internal_note text;

create index if not exists projects_current_stage_idx on public.projects(current_stage);
create index if not exists projects_timeline_status_idx on public.projects(timeline_status);
create index if not exists projects_files_received_date_idx on public.projects(files_received_date);

create or replace function public.add_business_days(start_date date, days_to_add integer)
returns date
language plpgsql
stable
as $$
declare
  cursor_date date := start_date;
  added integer := 0;
begin
  if start_date is null or days_to_add <= 0 then
    return start_date;
  end if;

  while added < days_to_add loop
    cursor_date := cursor_date + 1;
    if extract(isodow from cursor_date) < 6 then
      added := added + 1;
    end if;
  end loop;

  return cursor_date;
end;
$$;

create or replace function public.add_calendar_days(start_date date, days_to_add integer)
returns date
language sql
stable
as $$
  select case
    when start_date is null or days_to_add <= 0 then start_date
    else start_date + days_to_add
  end;
$$;

create or replace function public.timeline_progress(stage text)
returns integer
language sql
immutable
as $$
  select case stage
    when 'Files Required' then 0
    when 'Files Received' then 10
    when 'Design Concept in Progress' then 20
    when 'Awaiting Concept Approval' then 30
    when 'Concept Revisions' then 35
    when 'Print Version in Progress' then 50
    when 'Awaiting Print Approval' then 70
    when 'Print Revisions' then 75
    when 'eBook in Progress' then 85
    when 'eBook Review' then 90
    when 'Final Quality Check' then 95
    when 'Completed' then 100
    else 0
  end;
$$;

create or replace function public.project_production_days(project_row public.projects)
returns integer
language sql
stable
as $$
  select greatest(0, coalesce(project_row.design_concept_submitted_date - project_row.files_received_date, 0))
       + greatest(0, coalesce(project_row.print_version_submitted_date - project_row.design_concept_approval_date, 0))
       + greatest(0, coalesce(project_row.ebook_submitted_date - project_row.print_version_approval_date, 0))
       + greatest(0, coalesce(project_row.final_delivery_date - project_row.ebook_approval_date, 0));
$$;

create or replace function public.apply_project_timeline()
returns trigger
language plpgsql
as $$
declare
  next_stage text;
  next_timeline_status text;
  next_waiting_on text;
  next_client_action text := '';
  needs_ebook boolean;
  estimated_final_due_date date;
begin
  needs_ebook :=
    position('ebook' in lower(coalesce(new.service_type, ''))) > 0
    or position('e-book' in lower(coalesce(new.service_type, ''))) > 0
    or position('kindle' in lower(coalesce(new.service_type, ''))) > 0;
  new.print_timeline_days := 5;

  if new.status::text = 'On Hold' then
    next_stage := 'On Hold';
    next_timeline_status := 'On Hold';
    next_waiting_on := 'None';
  elsif new.status::text in ('Cancelled', 'Archived') then
    next_stage := 'Cancelled';
    next_timeline_status := 'Cancelled';
    next_waiting_on := 'None';
  elsif new.final_delivery_date is not null then
    next_stage := 'Completed';
    next_timeline_status := 'Completed';
    next_waiting_on := 'None';
    new.delivery_date := coalesce(new.delivery_date, new.final_delivery_date);
  elsif new.ebook_approval_date is not null then
    next_stage := 'Final Quality Check';
    next_timeline_status := 'Active';
    next_waiting_on := 'Manuscript Heaven';
  elsif new.ebook_submitted_date is not null then
    next_stage := 'eBook Review';
    next_timeline_status := 'Paused';
    next_waiting_on := 'Client';
    next_client_action := 'Review the eBook version';
  elsif new.print_version_approval_date is not null then
    if not new.print_version_due_date_manual and new.print_version_due_date is null and new.design_concept_approval_date is not null then
      new.print_version_due_date := public.add_calendar_days(new.design_concept_approval_date, 5);
    end if;

    if needs_ebook then
      if not new.ebook_due_date_manual then
        new.ebook_due_date := public.add_calendar_days(new.print_version_approval_date, 2);
      end if;
      next_stage := 'eBook in Progress';
      next_timeline_status := 'Active';
      next_waiting_on := 'Manuscript Heaven';
    else
      if not new.ebook_due_date_manual then
        new.ebook_due_date := null;
      end if;
      next_stage := 'Final Quality Check';
      next_timeline_status := 'Active';
      next_waiting_on := 'Manuscript Heaven';
    end if;
  elsif new.print_version_submitted_date is not null then
    next_stage := 'Awaiting Print Approval';
    next_timeline_status := 'Paused';
    next_waiting_on := 'Client';
    next_client_action := 'Review and approve the complete print version';
  elsif new.design_concept_approval_date is not null then
    if not new.print_version_due_date_manual then
      new.print_version_due_date := public.add_calendar_days(new.design_concept_approval_date, 5);
    end if;
    next_stage := 'Print Version in Progress';
    next_timeline_status := 'Active';
    next_waiting_on := 'Manuscript Heaven';
  elsif new.design_concept_submitted_date is not null then
    next_stage := 'Awaiting Concept Approval';
    next_timeline_status := 'Paused';
    next_waiting_on := 'Client';
    next_client_action := 'Review and approve the design concept';
  elsif new.files_received_date is not null then
    if not new.design_concept_due_date_manual then
      new.design_concept_due_date := public.add_calendar_days(new.files_received_date, 3);
    end if;
    next_stage := 'Design Concept in Progress';
    next_timeline_status := 'Active';
    next_waiting_on := 'Manuscript Heaven';
  else
    next_stage := coalesce(new.current_stage, 'Files Required');
    next_timeline_status := coalesce(new.timeline_status, 'Paused');
    next_waiting_on := coalesce(new.waiting_on, 'Client');
    next_client_action := coalesce(new.client_action_required, 'Upload required project files');
  end if;

  if new.final_delivery_date is not null then
    estimated_final_due_date := new.final_delivery_date;
  elsif new.print_version_approval_date is not null then
    estimated_final_due_date := case
      when needs_ebook then public.add_calendar_days(new.print_version_approval_date, 2)
      else coalesce(new.print_version_due_date, new.print_version_approval_date)
    end;
  elsif new.design_concept_approval_date is not null then
    estimated_final_due_date := public.add_calendar_days(new.design_concept_approval_date, case when needs_ebook then 7 else 5 end);
  elsif new.files_received_date is not null then
    estimated_final_due_date := public.add_calendar_days(new.files_received_date, case when needs_ebook then 10 else 8 end);
  end if;

  if estimated_final_due_date is not null then
    new.due_date := estimated_final_due_date;
    new.internal_deadline := estimated_final_due_date;
  end if;

  new.current_stage := next_stage;
  new.timeline_status := next_timeline_status;
  new.waiting_on := next_waiting_on;
  new.client_action_required := next_client_action;
  new.progress_percentage := public.timeline_progress(next_stage);
  new.production_days_used := public.project_production_days(new);

  if next_stage in (
    'Files Required',
    'Files Received',
    'Design Concept in Progress',
    'Awaiting Concept Approval',
    'Concept Revisions',
    'Print Version in Progress',
    'Awaiting Print Approval',
    'Print Revisions',
    'eBook in Progress',
    'eBook Review',
    'Final Quality Check',
    'Completed'
  ) then
    new.status := next_stage::public.project_status;
  end if;

  return new;
end;
$$;

drop trigger if exists apply_project_timeline_trigger on public.projects;
create trigger apply_project_timeline_trigger
before insert or update on public.projects
for each row execute function public.apply_project_timeline();

create or replace function public.client_approve_project_milestone(project_id uuid, milestone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  project_row public.projects;
begin
  select * into project_row
  from public.projects p
  where p.id = client_approve_project_milestone.project_id;

  if not found or not public.client_has_project_access(project_id, auth.uid()) then
    raise exception 'Project is not available for this client.';
  end if;

  if milestone = 'concept' then
    update public.projects
    set design_concept_approval_date = current_date
    where id = project_id;

    insert into public.activity_logs(project_id, action, activity_type, description, old_value, new_value, user_id)
    values (project_id, 'Design concept approved', 'concept_approved', 'Client approved the design concept.', null, current_date::text, auth.uid());
  elsif milestone = 'print' then
    update public.projects
    set print_version_approval_date = current_date
    where id = project_id;

    insert into public.activity_logs(project_id, action, activity_type, description, old_value, new_value, user_id)
    values (project_id, 'Print version approved', 'print_approved', 'Client approved the complete print version.', null, current_date::text, auth.uid());
  elsif milestone = 'ebook' then
    update public.projects
    set ebook_approval_date = current_date
    where id = project_id;

    insert into public.activity_logs(project_id, action, activity_type, description, old_value, new_value, user_id)
    values (project_id, 'eBook approved', 'ebook_approved', 'Client approved the eBook version.', null, current_date::text, auth.uid());
  else
    raise exception 'Unsupported milestone approval.';
  end if;

  insert into public.notifications(recipient_id, project_id, type, title, message)
  select
    p.id,
    project_id,
    'timeline_approval',
    'Client Approval Received',
    'Client approved the ' || milestone || ' milestone.'
  from public.profiles p
  where p.status = 'active'
    and (
      p.role::text in ('admin', 'manager', 'project_manager')
      or p.id = project_row.assigned_to
      or p.id = project_row.project_manager
    );
end;
$$;

grant execute on function public.client_approve_project_milestone(uuid, text) to authenticated;

create or replace function public.apply_revision_request_timeline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  project_row public.projects;
  next_stage text;
begin
  select * into project_row from public.projects where id = new.project_id;

  if not found then
    return new;
  end if;

  if project_row.current_stage in ('Awaiting Concept Approval', 'Design Concept in Progress', 'Concept Revisions') then
    next_stage := 'Concept Revisions';
  else
    next_stage := 'Print Revisions';
  end if;

  update public.projects
  set
    current_stage = next_stage,
    status = next_stage::public.project_status,
    waiting_on = 'Manuscript Heaven',
    timeline_status = 'Active',
    client_action_required = '',
    updated_at = now()
  where id = new.project_id;

  insert into public.activity_logs(project_id, action, activity_type, description, old_value, new_value, user_id)
  values (new.project_id, next_stage || ' requested', 'revision_requested', new.instructions, project_row.current_stage, next_stage, auth.uid());

  return new;
end;
$$;

drop trigger if exists revision_request_timeline_trigger on public.revision_requests;
create trigger revision_request_timeline_trigger
after insert on public.revision_requests
for each row execute function public.apply_revision_request_timeline();

create or replace function public.create_timeline_deadline_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  with due_projects as (
    select
      p.*,
      case
        when p.current_stage in ('Design Concept in Progress', 'Concept Revisions') then coalesce(p.concept_revision_due_date, p.design_concept_due_date)
        when p.current_stage in ('Print Version in Progress', 'Print Revisions') then coalesce(p.print_revision_due_date, p.print_version_due_date)
        when p.current_stage = 'eBook in Progress' then p.ebook_due_date
        when p.current_stage = 'Final Quality Check' then coalesce(p.final_delivery_date, p.due_date)
        else null
      end as active_due_date
    from public.projects p
    where p.timeline_status = 'Active'
      and p.waiting_on = 'Manuscript Heaven'
  ), recipients as (
    select d.id as project_id, profile.id as recipient_id, d.project_title, d.current_stage, d.active_due_date
    from due_projects d
    join public.profiles profile on profile.status = 'active'
    where profile.role::text in ('admin', 'manager', 'project_manager')
       or profile.id = d.assigned_to
       or profile.id = d.project_manager
  )
  insert into public.notifications(recipient_id, project_id, type, title, message)
  select
    recipient_id,
    project_id,
    'timeline_deadline',
    case
      when active_due_date = current_date + interval '1 day' then current_stage || ' due tomorrow'
      when active_due_date < current_date then current_stage || ' overdue'
      else current_stage || ' due today'
    end,
    project_title || ' is at ' || current_stage || ' and the active production due date is ' || active_due_date::text || '.'
  from recipients
  where active_due_date <= current_date + interval '1 day'
    and not exists (
      select 1
      from public.notifications existing
      where existing.recipient_id = recipients.recipient_id
        and existing.project_id = recipients.project_id
        and existing.type = 'timeline_deadline'
        and existing.created_at::date = current_date
    );

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

grant execute on function public.create_timeline_deadline_notifications() to authenticated;

drop view if exists public.client_project_summaries;

create or replace view public.client_project_summaries
with (security_invoker = false)
as
select
  project.id,
  project.project_number,
  project.project_title,
  project.client_name,
  project.client_email,
  project.service_type,
  project.due_date,
  project.status,
  project.proof_pdf_link,
  project.final_print_pdf_link,
  project.final_ebook_link,
  project.cover_file_link,
  project.files_received_date,
  project.design_concept_due_date,
  project.design_concept_due_date_manual,
  project.design_concept_submitted_date,
  project.design_concept_approval_date,
  project.concept_revision_due_date,
  project.print_version_due_date,
  project.print_version_due_date_manual,
  project.print_version_submitted_date,
  project.print_version_approval_date,
  project.print_revision_due_date,
  project.ebook_due_date,
  project.ebook_due_date_manual,
  project.ebook_submitted_date,
  project.ebook_approval_date,
  project.final_delivery_date,
  project.current_stage,
  project.progress_percentage,
  project.waiting_on,
  project.timeline_status,
  project.client_action_required,
  project.print_timeline_days,
  project.updated_at,
  project.created_at
from public.projects project
where public.client_has_project_access(project.id, auth.uid());

grant select on public.client_project_summaries to authenticated;

notify pgrst, 'reload schema';
