-- Add Abdullah as a Supabase client profile.
-- Run this after the Auth user support@bookcoverhub.com has been created.

do $$
declare
  target_user_id uuid;
begin
  select id
  into target_user_id
  from auth.users
  where lower(email) = lower('support@bookcoverhub.com')
  order by created_at desc
  limit 1;

  if target_user_id is null then
    raise exception 'Auth user support@bookcoverhub.com was not found. Create the user in Supabase Auth first, then run this SQL again.';
  end if;

  insert into public.profiles (id, full_name, email, role, status)
  values (
    target_user_id,
    'Abdullah',
    'support@bookcoverhub.com',
    'client'::public.app_role,
    'active'
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    email = excluded.email,
    role = excluded.role,
    status = excluded.status;
end $$;

-- Give Abdullah access to existing BCH projects.
insert into public.client_project_access (client_id, project_id)
select profile.id, project.id
from public.profiles profile
cross join public.projects project
where lower(profile.email) = lower('support@bookcoverhub.com')
  and (
    lower(project.client_name) in ('bch', 'book cover hub', 'bookcoverhub')
    or lower(coalesce(project.client_email, '')) = lower('support@bookcoverhub.com')
  )
on conflict (client_id, project_id) do nothing;

select
  profile.id,
  profile.full_name,
  profile.email,
  profile.role,
  profile.status,
  count(access.project_id) as accessible_projects
from public.profiles profile
left join public.client_project_access access on access.client_id = profile.id
where lower(profile.email) = lower('support@bookcoverhub.com')
group by profile.id, profile.full_name, profile.email, profile.role, profile.status;
