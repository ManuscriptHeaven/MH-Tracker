-- Disposable PostgreSQL 17 fixture for the staff attachment migration.
-- This is NOT production data and tests the actual migration SQL/RLS semantics.
CREATE SCHEMA IF NOT EXISTS auth;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $$;

CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text NOT NULL, status text NOT NULL);
CREATE TABLE public.projects (id uuid PRIMARY KEY, assigned_to uuid NULL);
CREATE TABLE public.project_initial_files (
  id uuid PRIMARY KEY, project_id uuid NOT NULL, uploaded_by uuid NOT NULL,
  file_name text NOT NULL, file_type text NOT NULL,
  file_size bigint NOT NULL, storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.project_initial_files ENABLE ROW LEVEL SECURITY;

INSERT INTO public.profiles(id,role,status) VALUES
('00000000-0000-4000-8000-000000000001','admin','active'),
('00000000-0000-4000-8000-000000000002','project_manager','active'),
('00000000-0000-4000-8000-000000000003','employee','active'),
('00000000-0000-4000-8000-000000000004','client','active'),
('00000000-0000-4000-8000-000000000005','admin','inactive');
INSERT INTO public.projects(id,assigned_to) VALUES
('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000003'),
('00000000-0000-4000-8000-000000000102',null);

-- Simplified server-owned role functions matching the production role semantics.
CREATE FUNCTION public.phase6_app_actor_class() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE WHEN p.status='active' THEN
   CASE WHEN p.role IN ('admin','project_manager','employee','client') THEN p.role END END
 FROM public.profiles p WHERE p.id=auth.uid() LIMIT 1
$$;
CREATE FUNCTION public.phase6_team_can_access_project(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.projects p WHERE p.id=pid AND (
    public.phase6_app_actor_class() IN ('admin','project_manager')
    OR (public.phase6_app_actor_class()='employee' AND p.assigned_to=auth.uid())
  )
 )
$$;
CREATE FUNCTION public.phase6_client_can_access_project(pid uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT false $$;

CREATE POLICY "Project file viewers can read initial files"
ON public.project_initial_files FOR SELECT TO authenticated
USING (public.phase6_team_can_access_project(project_id) OR public.phase6_client_can_access_project(project_id));

GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
GRANT EXECUTE ON FUNCTION public.phase6_app_actor_class() TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase6_team_can_access_project(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase6_client_can_access_project(uuid) TO authenticated;
GRANT SELECT ON public.project_initial_files TO authenticated;
