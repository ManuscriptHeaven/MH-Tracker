-- SQL update script to support self-signup with custom roles (employee, client, etc.) and RLS policies.

-- 1. Update trigger function to extract full_name and role from user_metadata
create or replace function public.create_profile_for_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_team record;
  profile_name text;
  profile_role public.app_role;
  meta_role text;
begin
  if new.email is null then
    return new;
  end if;

  -- Check if user is in team_members table
  select *
  into matched_team
  from public.team_members
  where lower(email) = lower(new.email)
  limit 1;

  -- Determine full name from metadata, team_members, or email prefix
  profile_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    matched_team.full_name,
    split_part(new.email, '@', 1)
  );

  -- Extract role from metadata if valid app_role
  meta_role := lower(trim(coalesce(new.raw_user_meta_data ->> 'role', '')));

  if matched_team.role is not null then
    profile_role := matched_team.role;
  elsif meta_role in ('admin', 'project_manager', 'manager', 'employee', 'junior_assistant', 'client') then
    profile_role := meta_role::public.app_role;
  else
    profile_role := 'employee'::public.app_role;
  end if;

  -- Insert or update profile record
  insert into public.profiles (id, full_name, email, role, phone, status)
  values (new.id, profile_name, new.email, profile_role, matched_team.phone, 'active')
  on conflict (id) do update set
    full_name = excluded.full_name,
    email = excluded.email,
    role = excluded.role,
    phone = coalesce(excluded.phone, public.profiles.phone),
    status = 'active';

  -- If role is client, ensure team_members record exists
  if profile_role = 'client' then
    insert into public.team_members (full_name, email, role, status)
    values (profile_name, new.email, 'client', 'active')
    on conflict (email) do update set
      role = 'client',
      status = 'active';
  else
    insert into public.team_members (full_name, email, role, status)
    values (profile_name, new.email, profile_role, 'active')
    on conflict (email) do update set
      role = profile_role,
      status = 'active';
  end if;

  return new;
end;
$$;

-- Ensure trigger is active
drop trigger if exists create_profile_after_auth_user_created on auth.users;
create trigger create_profile_after_auth_user_created
after insert on auth.users
for each row execute function public.create_profile_for_new_auth_user();

-- 2. Update RLS policies for profiles to allow self insert & update
drop policy if exists "Profiles are visible to authenticated users" on public.profiles;
create policy "Profiles are visible to authenticated users"
on public.profiles
for select
to authenticated
using (true);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
on public.profiles
for insert
to authenticated
with check (id = auth.uid() or public.current_user_role() = 'admin');

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles
for update
to authenticated
using (id = auth.uid() or public.current_user_role() = 'admin')
with check (id = auth.uid() or public.current_user_role() = 'admin');
