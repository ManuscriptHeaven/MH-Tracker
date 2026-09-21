-- Schedule accountability, client follow-up reminders, delay metrics, and submission gates.

alter table public.projects
  add column if not exists original_due_at timestamptz;

update public.projects
set original_due_at = coalesce(
  case
    when due_date is not null then (due_date::timestamp at time zone 'Asia/Karachi')
    else null
  end,
  final_due_at
)
where original_due_at is null
  and (due_date is not null or final_due_at is not null);

create or replace function public.preserve_project_original_due()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' then
    if new.original_due_at is null and new.due_date is not null then
      new.original_due_at := new.due_date::timestamp at time zone 'Asia/Karachi';
    end if;
  elsif tg_op = 'UPDATE' then
    -- The original committed due date is immutable after project creation.
    new.original_due_at := old.original_due_at;
  end if;
  return new;
end
$function$;

drop trigger if exists preserve_project_original_due_trigger on public.projects;
create trigger preserve_project_original_due_trigger
before insert or update on public.projects
for each row execute function public.preserve_project_original_due();

create table if not exists public.project_client_reminders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  workflow_version bigint not null,
  threshold_hours integer not null check (threshold_hours in (24,48,72)),
  wait_reason text not null check (wait_reason in ('files','approval')),
  stage_key public.workflow_stage not null,
  waiting_started_at timestamptz not null,
  draft_subject text not null,
  draft_body text not null,
  status text not null default 'pending' check (status in ('pending','sent','dismissed','obsolete')),
  generated_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references public.profiles(id) on delete set null,
  unique(project_id, workflow_version, threshold_hours)
);

create index if not exists project_client_reminders_project_status_idx
  on public.project_client_reminders(project_id, status, generated_at desc);

alter table public.project_client_reminders enable row level security;

grant select, update on public.project_client_reminders to authenticated;
revoke insert, delete on public.project_client_reminders from authenticated;

drop policy if exists "Team can view project client reminders" on public.project_client_reminders;
create policy "Team can view project client reminders"
on public.project_client_reminders
for select
to authenticated
using (public.phase6_team_can_access_project(project_id));

drop policy if exists "Team can resolve project client reminders" on public.project_client_reminders;
create policy "Team can resolve project client reminders"
on public.project_client_reminders
for update
to authenticated
using (public.phase6_team_can_access_project(project_id))
with check (
  public.phase6_team_can_access_project(project_id)
  and status in ('pending','sent','dismissed','obsolete')
);

create or replace function public.workflow_submission_gate()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'pg_temp'
as $function$
begin
  if new.workflow_stage_status_key = 'awaiting_client'
     and old.workflow_stage_status_key is distinct from 'awaiting_client' then
    if new.workflow_stage_key = 'concept_approval'
       and nullif(btrim(coalesce(new.cover_file_link,'')), '') is null
       and nullif(btrim(coalesce(new.proof_pdf_link,'')), '') is null then
      raise exception 'workflow_missing_concept_deliverable';
    end if;

    if new.workflow_stage_key = 'print_approval'
       and nullif(btrim(coalesce(new.proof_pdf_link,'')), '') is null
       and nullif(btrim(coalesce(new.final_print_pdf_link,'')), '') is null then
      raise exception 'workflow_missing_print_proof';
    end if;

    if new.workflow_stage_key = 'ebook_approval'
       and nullif(btrim(coalesce(new.final_ebook_link,'')), '') is null then
      raise exception 'workflow_missing_ebook_proof';
    end if;
  end if;

  if new.project_status = 'completed'
     and old.project_status is distinct from 'completed'::public.project_lifecycle_status then
    if coalesce(new.requires_print,false)
       and nullif(btrim(coalesce(new.final_print_pdf_link,'')), '') is null then
      raise exception 'workflow_missing_final_print_file';
    end if;
    if coalesce(new.requires_ebook,false)
       and nullif(btrim(coalesce(new.final_ebook_link,'')), '') is null then
      raise exception 'workflow_missing_final_ebook_file';
    end if;
  end if;

  return new;
end
$function$;

drop trigger if exists workflow_submission_gate_trigger on public.projects;
create trigger workflow_submission_gate_trigger
before update on public.projects
for each row execute function public.workflow_submission_gate();

create or replace function public.get_project_delay_metrics()
returns table(
  project_id uuid,
  production_seconds bigint,
  client_wait_seconds bigint,
  internal_overdue_seconds bigint
)
language sql
stable
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  with accessible as (
    select p.*
    from public.projects p
    where public.phase6_current_actor_class() in ('admin','project_manager','manager','employee','junior_assistant')
      and public.phase6_team_can_access_project(p.id)
  ),
  live_delta as (
    select
      p.id as project_id,
      d.production_seconds_delta,
      d.client_wait_seconds_delta
    from accessible p
    cross join lateral public._workflow_interval_delta(
      p.id,
      p.workflow_stage_status_key,
      p.stage_started_at,
      clock_timestamp(),
      p.workflow_settings
    ) d
  ),
  historical_overdue as (
    select
      p.id as project_id,
      coalesce(sum(
        greatest(
          extract(epoch from (
            (
              select min(h2.created_at)
              from public.project_stage_history h2
              where h2.project_id = h.project_id
                and h2.created_at > h.created_at
                and (
                  h2.stage is distinct from h.stage
                  or h2.status is distinct from h.status
                )
            ) - h.due_at
          )),
          0
        )
      ) filter (
        where h.due_at is not null
          and h.status in ('ACTIVE','REVISION_ACTIVE')
          and exists (
            select 1
            from public.project_stage_history h3
            where h3.project_id = h.project_id
              and h3.created_at > h.created_at
              and (
                h3.stage is distinct from h.stage
                or h3.status is distinct from h.status
              )
          )
      ),0)::bigint as seconds
    from accessible p
    left join public.project_stage_history h on h.project_id = p.id
    group by p.id
  )
  select
    p.id,
    greatest(
      coalesce(p.production_seconds_total,0) + coalesce(d.production_seconds_delta,0),
      0
    )::bigint as production_seconds,
    greatest(
      coalesce(p.client_wait_seconds_total,0)
      + case
          when p.workflow_stage_key = 'files_received'
               and p.workflow_stage_status_key = 'pending'
            then floor(extract(epoch from (
              clock_timestamp() - coalesce(p.stage_started_at,p.created_at)
            )))::bigint
          else coalesce(d.client_wait_seconds_delta,0)
        end,
      0
    )::bigint as client_wait_seconds,
    greatest(
      coalesce(o.seconds,0)
      + case
          when p.workflow_waiting_on_key = 'team'
               and p.workflow_stage_status_key in ('active','revision_active')
               and p.stage_due_at is not null
               and clock_timestamp() > p.stage_due_at
            then floor(extract(epoch from (clock_timestamp() - p.stage_due_at)))::bigint
          else 0
        end,
      0
    )::bigint as internal_overdue_seconds
  from accessible p
  left join live_delta d on d.project_id = p.id
  left join historical_overdue o on o.project_id = p.id
$function$;

revoke all on function public.get_project_delay_metrics() from public;
revoke all on function public.get_project_delay_metrics() from anon;
grant execute on function public.get_project_delay_metrics() to authenticated;

create or replace function public.generate_client_reminder_drafts()
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  v_project public.projects%rowtype;
  v_wait_started timestamptz;
  v_wait_reason text;
  v_stage_label text;
  v_threshold integer;
  v_age_hours numeric;
  v_subject text;
  v_body text;
  v_reminder_id uuid;
  v_recipient uuid;
  v_created integer := 0;
begin
  -- Stale reminder drafts disappear from the actionable queue automatically.
  update public.project_client_reminders r
  set status = 'obsolete',
      handled_at = coalesce(handled_at, clock_timestamp())
  where r.status = 'pending'
    and not exists (
      select 1
      from public.projects p
      where p.id = r.project_id
        and p.project_status = 'active'
        and p.workflow_version = r.workflow_version
        and (
          (p.workflow_stage_key = 'files_received' and p.workflow_stage_status_key = 'pending')
          or p.workflow_stage_status_key = 'awaiting_client'
        )
    );

  for v_project in
    select p.*
    from public.projects p
    where p.project_status = 'active'
      and (
        (p.workflow_stage_key = 'files_received' and p.workflow_stage_status_key = 'pending')
        or p.workflow_stage_status_key = 'awaiting_client'
      )
  loop
    v_wait_reason := case
      when v_project.workflow_stage_key = 'files_received' then 'files'
      else 'approval'
    end;

    v_wait_started := case
      when v_wait_reason = 'files'
        then coalesce(v_project.stage_started_at, v_project.created_at)
      else v_project.stage_started_at
    end;

    if v_wait_started is null then
      continue;
    end if;

    v_age_hours := extract(epoch from (clock_timestamp() - v_wait_started)) / 3600.0;
    v_stage_label := case v_project.workflow_stage_key
      when 'files_received' then 'project files'
      when 'concept_approval' then 'design concept'
      when 'print_approval' then 'print proof'
      when 'ebook_approval' then 'eBook proof'
      else 'project approval'
    end;

    foreach v_threshold in array array[24,48,72]
    loop
      if v_age_hours < v_threshold then
        continue;
      end if;

      if v_threshold = 24 then
        v_subject := 'Friendly reminder: ' || v_project.project_title;
        if v_wait_reason = 'files' then
          v_body := 'Hi ' || coalesce(nullif(v_project.client_name,''),'there')
            || ', just a friendly reminder that we are waiting for the project files for “'
            || v_project.project_title
            || '”. Once they are submitted, our production timeline will start automatically. Thank you!';
        else
          v_body := 'Hi ' || coalesce(nullif(v_project.client_name,''),'there')
            || ', just a friendly reminder that the ' || v_stage_label
            || ' for “' || v_project.project_title
            || '” is ready for your review. Please approve it or send revision notes when convenient. Thank you!';
        end if;
      elsif v_threshold = 48 then
        v_subject := 'Follow-up required: ' || v_project.project_title;
        if v_wait_reason = 'files' then
          v_body := 'Hi ' || coalesce(nullif(v_project.client_name,''),'there')
            || ', we are following up on the required files for “' || v_project.project_title
            || '”. Production remains paused until the files are received. Please send them when possible so we can begin work.';
        else
          v_body := 'Hi ' || coalesce(nullif(v_project.client_name,''),'there')
            || ', we are following up on the ' || v_stage_label
            || ' awaiting your review for “' || v_project.project_title
            || '”. Production is paused while we wait for your approval or revision instructions.';
        end if;
      else
        v_subject := 'Action needed to keep schedule moving: ' || v_project.project_title;
        if v_wait_reason = 'files' then
          v_body := 'Hi ' || coalesce(nullif(v_project.client_name,''),'there')
            || ', we still need the project files for “' || v_project.project_title
            || '”. The production clock has not started yet, and the delivery date shifts automatically with client waiting time. Please submit the files as soon as possible.';
        else
          v_body := 'Hi ' || coalesce(nullif(v_project.client_name,''),'there')
            || ', the ' || v_stage_label || ' for “' || v_project.project_title
            || '” has been awaiting your response for more than 72 hours. Production is paused, and the delivery date shifts automatically with client waiting time. Please approve or send revision instructions as soon as possible.';
        end if;
      end if;

      insert into public.project_client_reminders(
        project_id, workflow_version, threshold_hours, wait_reason, stage_key,
        waiting_started_at, draft_subject, draft_body, status, generated_at
      )
      values(
        v_project.id, v_project.workflow_version, v_threshold, v_wait_reason,
        v_project.workflow_stage_key, v_wait_started, v_subject, v_body, 'pending', clock_timestamp()
      )
      on conflict (project_id, workflow_version, threshold_hours) do nothing
      returning id into v_reminder_id;

      if v_reminder_id is null then
        continue;
      end if;

      v_created := v_created + 1;

      for v_recipient in
        select distinct pr.id
        from public.profiles pr
        where pr.status = 'active'
          and pr.role::text in ('admin','project_manager','manager','employee','junior_assistant')
          and (
            pr.id in (v_project.project_manager, v_project.assigned_to)
            or (v_threshold = 72 and pr.role::text = 'admin')
          )
      loop
        insert into public.notifications(
          recipient_id, project_id, type, title, message, is_read, created_at
        )
        values(
          v_recipient,
          v_project.id,
          case when v_threshold = 72 then 'client_wait_escalation' else 'client_reminder_due' end,
          case when v_threshold = 72 then 'Client wait escalation' else 'Client follow-up ready' end,
          v_project.project_title || ': ' || v_threshold::text
            || 'h client wait — reminder draft is ready for review.',
          false,
          clock_timestamp()
        );
      end loop;

      v_reminder_id := null;
    end loop;
  end loop;

  return v_created;
end
$function$;

revoke all on function public.generate_client_reminder_drafts() from public;
revoke all on function public.generate_client_reminder_drafts() from anon;
revoke all on function public.generate_client_reminder_drafts() from authenticated;

create extension if not exists pg_cron;

do $block$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'mh-client-reminder-generator'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'mh-client-reminder-generator',
    '17 * * * *',
    'select public.generate_client_reminder_drafts();'
  );
end
$block$;

-- Generate any reminders already due when this migration lands.
select public.generate_client_reminder_drafts();
