# Hosting and Deployment Plan

This project should be deployed as a lightweight internal business app with a static React frontend and Supabase for authentication, database, and access control.

If this guide feels too technical, start with `SIMPLE_SETUP_GUIDE.md`. It gives the same setup in a simpler step-by-step order.

For the current app build, use `supabase/schema.sql` as the main database setup file. It includes the app tables, sample team rows, Row Level Security, policies, indexes, and activity logging triggers in one place.

## Target Stack

### Frontend

- React
- Vite
- TypeScript
- Tailwind CSS
- Shadcn/UI or clean reusable custom components
- No Next.js
- No server-side rendering
- No custom backend by default

### Backend, Database, and Auth

- Supabase Free Plan
- Supabase Auth for employee login
- Supabase Postgres for application data
- Supabase Row Level Security for role-based project access
- Supabase anon key in the browser only
- Never expose the Supabase service role key in frontend code or Cloudflare Pages variables

### Hosting

- GitHub for source code
- Cloudflare Pages Free Plan for frontend hosting
- Supabase for database and authentication
- No paid domain required
- The production app should work on the free Cloudflare Pages URL:

```text
https://<cloudflare-pages-project>.pages.dev
```

## Architecture

The app is a static Vite build served by Cloudflare Pages. Browser clients connect directly to Supabase using the public Supabase URL and anon key.

```text
Employee browser
  -> Cloudflare Pages static React app
  -> Supabase Auth for login/session
  -> Supabase Postgres through RLS-protected API
```

Access rules live in the database, not in frontend-only checks:

- Employees can only see projects assigned to them.
- Admin users can see and manage all projects.
- Project Managers can see and manage all projects.
- Role assignment is stored in the `profiles` table.

## Environment Variables

Use these variables locally and in Cloudflare Pages:

```text
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-supabase-anon-key>
```

For local development, put them in `.env.local`. For Cloudflare Pages, add them in the Pages project settings.

Vite exposes variables with the `VITE_` prefix to the browser bundle. That is expected for the Supabase anon key, but do not put private secrets in `VITE_*` variables.

## 1. Create the Supabase Project

1. Go to Supabase and create a new project on the Free Plan.
2. Choose a project name, region close to most employees, and a strong database password.
3. Wait for the project to finish provisioning.
4. Open Project Settings > API.
5. Copy:
   - Project URL into `VITE_SUPABASE_URL`
   - anon public key into `VITE_SUPABASE_ANON_KEY`
6. Do not use the service role key in the frontend.

## 2. Create Database Tables

Open Supabase Dashboard > SQL Editor and run this SQL.

```sql
create extension if not exists pgcrypto;

do $$
begin
  create type public.app_role as enum ('admin', 'project_manager', 'employee');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role public.app_role not null default 'employee',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'active',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_assignments (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists project_assignments_user_id_idx on public.project_assignments(user_id);
create index if not exists project_assignments_project_id_idx on public.project_assignments(project_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_profiles_updated_at on public.profiles;
create trigger touch_profiles_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists touch_projects_updated_at on public.projects;
create trigger touch_projects_updated_at
before update on public.projects
for each row execute function public.touch_updated_at();
```

## 3. Enable Row Level Security

Run this SQL after creating the tables.

```sql
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_assignments enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.project_assignments to authenticated;

revoke all on public.profiles from anon;
revoke all on public.projects from anon;
revoke all on public.project_assignments from anon;

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = (select auth.uid())
    and is_active = true
  limit 1;
$$;

create or replace function public.can_manage_all_projects()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin', 'project_manager');
$$;

revoke all on function public.current_user_role() from public;
revoke all on function public.can_manage_all_projects() from public;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.can_manage_all_projects() to authenticated;
```

## 4. Add RLS Policies

Run this SQL after enabling RLS.

```sql
drop policy if exists "Profiles are visible to owner and managers" on public.profiles;
create policy "Profiles are visible to owner and managers"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or public.can_manage_all_projects()
);

drop policy if exists "Admins can create profiles" on public.profiles;
create policy "Admins can create profiles"
on public.profiles
for insert
to authenticated
with check (public.current_user_role() = 'admin');

drop policy if exists "Admins can update profiles" on public.profiles;
create policy "Admins can update profiles"
on public.profiles
for update
to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

drop policy if exists "Admins can delete profiles" on public.profiles;
create policy "Admins can delete profiles"
on public.profiles
for delete
to authenticated
using (public.current_user_role() = 'admin');

drop policy if exists "Assigned employees and managers can view projects" on public.projects;
create policy "Assigned employees and managers can view projects"
on public.projects
for select
to authenticated
using (
  public.can_manage_all_projects()
  or exists (
    select 1
    from public.project_assignments pa
    where pa.project_id = projects.id
      and pa.user_id = (select auth.uid())
  )
);

drop policy if exists "Managers can create projects" on public.projects;
create policy "Managers can create projects"
on public.projects
for insert
to authenticated
with check (
  public.can_manage_all_projects()
  and created_by = (select auth.uid())
);

drop policy if exists "Managers can update projects" on public.projects;
create policy "Managers can update projects"
on public.projects
for update
to authenticated
using (public.can_manage_all_projects())
with check (public.can_manage_all_projects());

drop policy if exists "Managers can delete projects" on public.projects;
create policy "Managers can delete projects"
on public.projects
for delete
to authenticated
using (public.can_manage_all_projects());

drop policy if exists "Users can view their own assignments" on public.project_assignments;
create policy "Users can view their own assignments"
on public.project_assignments
for select
to authenticated
using (
  public.can_manage_all_projects()
  or user_id = (select auth.uid())
);

drop policy if exists "Managers can create assignments" on public.project_assignments;
create policy "Managers can create assignments"
on public.project_assignments
for insert
to authenticated
with check (public.can_manage_all_projects());

drop policy if exists "Managers can update assignments" on public.project_assignments;
create policy "Managers can update assignments"
on public.project_assignments
for update
to authenticated
using (public.can_manage_all_projects())
with check (public.can_manage_all_projects());

drop policy if exists "Managers can delete assignments" on public.project_assignments;
create policy "Managers can delete assignments"
on public.project_assignments
for delete
to authenticated
using (public.can_manage_all_projects());
```

## 5. Set Up Authentication

1. Open Supabase Dashboard > Authentication > Providers.
2. Enable Email login.
3. For a simple internal team setup, use email and password login.
4. Open Authentication > URL Configuration.
5. Set the Site URL to the deployed Cloudflare Pages URL:

```text
https://<cloudflare-pages-project>.pages.dev
```

6. Add local and production redirect URLs:

```text
http://localhost:5173/**
https://<cloudflare-pages-project>.pages.dev/**
```

7. Keep third-party OAuth disabled unless the business explicitly needs it.

## 6. Add Employee Users

1. Open Supabase Dashboard > Authentication > Users.
2. Create each employee user or send an invite.
3. Copy each user's Auth user ID.
4. Add a matching row in `public.profiles`.

Example profile inserts:

```sql
insert into public.profiles (id, email, full_name, role)
values
  ('00000000-0000-0000-0000-000000000001', 'admin@company.com', 'Admin User', 'admin'),
  ('00000000-0000-0000-0000-000000000002', 'manager@company.com', 'Project Manager', 'project_manager'),
  ('00000000-0000-0000-0000-000000000003', 'employee@company.com', 'Employee User', 'employee');
```

Replace the sample UUIDs with the real Supabase Auth user IDs.

## 7. Frontend Supabase Client

The frontend should connect to Supabase directly from the Vite app.

```ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

Use Supabase Auth session state for login. Use database policies for real authorization. Frontend route guards should improve the user experience, but they should not be the only protection.

When an admin or Project Manager creates a project, the app must set `created_by` to the logged-in user's Supabase Auth ID. The insert policy intentionally rejects project creation when `created_by` does not match the current user.

```ts
const {
  data: { user },
} = await supabase.auth.getUser();

await supabase.from('projects').insert({
  name,
  description,
  created_by: user?.id,
});
```

## 8. Deploy Frontend to Cloudflare Pages

1. Push the project code to GitHub.
2. Open Cloudflare Dashboard > Workers & Pages.
3. Create a new Pages project.
4. Connect the GitHub repository.
5. Select the repository and production branch.
6. Use these build settings:

```text
Framework preset: React (Vite) or None
Build command: npm run build
Output directory: dist
Root directory: leave blank unless the app is inside a subfolder
```

7. Add production environment variables:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

8. Add the same variables to preview deployments if preview builds need login.
9. Deploy the app.
10. Use the generated `*.pages.dev` URL. A paid custom domain is not required.

## 9. Test After Deployment

Test on mobile, laptop, and desktop browsers.

1. Open the Cloudflare Pages URL.
2. Confirm the login page loads.
3. Login as an admin.
4. Create a project.
5. Assign one employee to the project.
6. Login as that employee and confirm they can see only assigned projects.
7. Create a second employee with no assignment and confirm they cannot see the project.
8. Login as Project Manager and confirm they can see all projects.
9. Confirm unauthenticated visitors cannot view project data.
10. Confirm the browser console does not show missing environment variable errors.

## Admin Setup Guide

Initial setup order:

1. Create the first admin user in Supabase Auth.
2. Copy the admin user's Auth user ID.
3. Add the admin user record in `public.profiles` with `role = 'admin'`.
4. Create employee users in Supabase Auth.
5. Add matching employee records in `public.profiles`.
6. Assign roles in `public.profiles`:

```text
admin
project_manager
employee
```

7. Login as admin.
8. Create projects.
9. Assign employees to projects through the app.
10. Test that employees only see assigned projects.

If the app does not have a profile-management screen yet, manage profiles from the Supabase Dashboard or SQL Editor until that screen exists.

## Free Hosting Guidelines

- Keep the app static and client-rendered.
- Avoid server-side rendering and API routes.
- Avoid paid domains unless the business later needs one.
- Keep images and attachments small.
- Paginate project lists instead of loading everything at once.
- Add indexes for frequently filtered fields.
- Avoid heavy charting or document libraries unless needed.
- Use Supabase RLS for access control instead of building a custom backend.
- Monitor Supabase and Cloudflare usage; upgrade only when the internal team outgrows the free limits.

## Deployment Checklist

- [ ] Code pushed to GitHub
- [ ] Supabase project created
- [ ] Tables created
- [ ] RLS enabled
- [ ] Policies created
- [ ] Email/password auth enabled
- [ ] Admin user created in Supabase Auth
- [ ] Admin profile row added
- [ ] Employee users created in Supabase Auth
- [ ] Employee profile rows added with roles
- [ ] Cloudflare Pages connected to GitHub
- [ ] Build command set to `npm run build`
- [ ] Output directory set to `dist`
- [ ] `VITE_SUPABASE_URL` added to Cloudflare Pages
- [ ] `VITE_SUPABASE_ANON_KEY` added to Cloudflare Pages
- [ ] App deployed to `*.pages.dev`
- [ ] Login tested
- [ ] Admin access tested
- [ ] Project Manager access tested
- [ ] Employee assigned-project access tested
- [ ] Employee unassigned-project restriction tested

## Official References

- [Supabase user management](https://supabase.com/docs/guides/auth/managing-user-data)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Cloudflare Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)
- [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/)
- [Vite environment variables](https://vite.dev/guide/env-and-mode)
