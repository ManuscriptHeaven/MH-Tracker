-- Fix Client Project Access (e.g. BCH)
-- Updates client_has_project_access function so clients can access all projects assigned to them by:
-- 1. client_project_access table mapping
-- 2. Matching client_email with client profile email
-- 3. Matching client_name with client profile full_name / name (e.g. 'BCH')
-- 4. Created by client ID

create or replace function public.client_has_project_access(project_id uuid, client_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    left join public.profiles c on c.id = client_has_project_access.client_id
    where p.id = client_has_project_access.project_id
      and (
        exists (
          select 1
          from public.client_project_access access
          where access.project_id = p.id
            and access.client_id = client_has_project_access.client_id
        )
        or (c.email is not null and lower(trim(p.client_email)) = lower(trim(c.email)))
        or (c.full_name is not null and (
          lower(trim(p.client_name)) = lower(trim(c.full_name))
          or lower(trim(c.full_name)) like '%' || lower(trim(p.client_name)) || '%'
          or lower(trim(p.client_name)) like '%' || lower(trim(c.full_name)) || '%'
        ))
        or p.created_by = client_has_project_access.client_id
      )
  );
$$;

-- Auto-populate client_project_access table for all existing projects matching client profiles
insert into public.client_project_access (client_id, project_id)
select c.id as client_id, p.id as project_id
from public.projects p
cross join public.profiles c
where c.role::text = 'client'
  and (
    lower(trim(p.client_email)) = lower(trim(c.email))
    or lower(trim(p.client_name)) = lower(trim(c.full_name))
    or lower(trim(c.full_name)) like '%' || lower(trim(p.client_name)) || '%'
    or lower(trim(p.client_name)) like '%' || lower(trim(c.full_name)) || '%'
  )
on conflict (client_id, project_id) do nothing;

-- Auto-sync trigger for future project inserts or updates
create or replace function public.auto_link_client_project_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.client_project_access (client_id, project_id)
  select c.id, new.id
  from public.profiles c
  where c.role::text = 'client'
    and (
      (new.client_email is not null and lower(trim(new.client_email)) = lower(trim(c.email)))
      or (new.client_name is not null and (
        lower(trim(new.client_name)) = lower(trim(c.full_name))
        or lower(trim(c.full_name)) like '%' || lower(trim(new.client_name)) || '%'
        or lower(trim(new.client_name)) like '%' || lower(trim(c.full_name)) || '%'
      ))
    )
  on conflict (client_id, project_id) do nothing;
  
  return new;
end;
$$;

drop trigger if exists auto_link_client_project_access_trigger on public.projects;
create trigger auto_link_client_project_access_trigger
after insert or update on public.projects
for each row execute function public.auto_link_client_project_access();
