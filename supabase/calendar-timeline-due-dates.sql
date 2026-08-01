-- Calendar-day timeline due dates for Manuscript Heaven projects.
-- Safe to run more than once in Supabase SQL Editor.

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

-- Recalculate existing rows once so old projects pick up the calendar-day rules.
update public.projects
set print_timeline_days = 5;
