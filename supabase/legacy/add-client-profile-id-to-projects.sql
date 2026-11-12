-- Add client_profile_id column to projects table
-- This creates a direct, unambiguous FK link between a project and a client profile
-- so the client portal always shows the correct projects regardless of name/email text

alter table public.projects
add column if not exists client_profile_id uuid references public.profiles(id) on delete set null;

create index if not exists projects_client_profile_id_idx on public.projects(client_profile_id);

-- Update auto_link_client_project_access trigger to also handle client_profile_id
create or replace function public.auto_link_client_project_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Direct profile ID link (most reliable)
  if new.client_profile_id is not null then
    insert into public.client_project_access (client_id, project_id)
    values (new.client_profile_id, new.id)
    on conflict (client_id, project_id) do nothing;
  end if;

  -- Fallback: match by client_email or client_name
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

-- Update client_has_project_access to also check client_profile_id
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
        -- Direct profile ID link
        p.client_profile_id = client_has_project_access.client_id
        -- Legacy: client_project_access table
        or exists (
          select 1
          from public.client_project_access access
          where access.project_id = p.id
            and access.client_id = client_has_project_access.client_id
        )
        -- Fallback: match by email
        or (c.email is not null and lower(trim(p.client_email)) = lower(trim(c.email)))
        -- Fallback: match by name
        or (c.full_name is not null and (
          lower(trim(p.client_name)) = lower(trim(c.full_name))
          or lower(trim(c.full_name)) like '%' || lower(trim(p.client_name)) || '%'
          or lower(trim(p.client_name)) like '%' || lower(trim(c.full_name)) || '%'
        ))
        -- Fallback: created by client
        or p.created_by = client_has_project_access.client_id
      )
  );
$$;

-- Backfill client_profile_id for existing projects matching client profiles by email
update public.projects p
set client_profile_id = c.id
from public.profiles c
where c.role::text = 'client'
  and p.client_profile_id is null
  and c.email is not null
  and p.client_email is not null
  and lower(trim(p.client_email)) = lower(trim(c.email));
