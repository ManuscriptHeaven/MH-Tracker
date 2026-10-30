-- Disposable PostgreSQL 17 fixture. Never connect this script to production.
CREATE SCHEMA auth;
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END$$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE TABLE public.profiles (
 id uuid PRIMARY KEY,
 role text NOT NULL,
 status text NOT NULL DEFAULT 'active'
);
CREATE TABLE public.projects (id uuid PRIMARY KEY, project_status text NOT NULL DEFAULT 'active');
CREATE TABLE public.tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title text NOT NULL,
 description text NOT NULL DEFAULT '',
 project_id uuid REFERENCES public.projects(id),
 assigned_to uuid REFERENCES public.profiles(id),
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 status text NOT NULL DEFAULT 'To Do',
 due_date date,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid REFERENCES public.profiles(id),
 project_id uuid REFERENCES public.projects(id),
 recipient_id uuid NOT NULL REFERENCES public.profiles(id),
 revision_request_id uuid,
 type text NOT NULL DEFAULT 'general',
 title text NOT NULL,
 message text NOT NULL,
 is_read boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.activity_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id uuid REFERENCES public.tasks(id),
 project_id uuid REFERENCES public.projects(id),
 user_id uuid REFERENCES public.profiles(id),
 action text NOT NULL,
 activity_type text,
 description text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.task_assignees (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id uuid REFERENCES public.tasks(id),
 profile_id uuid REFERENCES public.profiles(id),
 assignment_role text NOT NULL DEFAULT 'primary',
 assigned_by uuid REFERENCES public.profiles(id)
);

-- Test identity uses an active server-side profile, not user-provided JWT role.
CREATE FUNCTION public.phase6_app_actor_class() RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path='pg_catalog','pg_temp' AS $$
 SELECT CASE WHEN status='active' THEN
   CASE WHEN role IN ('admin','project_manager','employee','client') THEN role END
 END FROM public.profiles WHERE id=auth.uid() LIMIT 1
$$;
CREATE FUNCTION public.phase6_collaboration_target_is_team(target uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path='pg_catalog','pg_temp' AS $$
 SELECT EXISTS (SELECT 1 FROM public.profiles
 WHERE id=target AND status='active' AND role IN ('admin','project_manager','employee'))
$$;
CREATE FUNCTION public.phase6_team_can_access_project(pid uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path='pg_catalog','pg_temp' AS $$
 SELECT public.phase6_app_actor_class() IN ('admin','project_manager','employee')
   AND EXISTS (SELECT 1 FROM public.projects WHERE id=pid AND project_status='active')
$$;

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY ci_tasks_insert ON public.tasks FOR INSERT TO authenticated
WITH CHECK (
 created_by=auth.uid()
 AND public.phase6_app_actor_class() IN ('admin','project_manager','employee')
 AND (project_id IS NULL OR public.phase6_team_can_access_project(project_id))
 AND (assigned_to IS NULL OR public.phase6_collaboration_target_is_team(assigned_to))
 AND (public.phase6_app_actor_class() IN ('admin','project_manager') OR assigned_to=auth.uid())
);
CREATE POLICY ci_tasks_select ON public.tasks FOR SELECT TO authenticated
USING (
 public.phase6_app_actor_class() IN ('admin','project_manager')
 OR (public.phase6_app_actor_class()='employee' AND (created_by=auth.uid() OR assigned_to=auth.uid()))
);
CREATE POLICY ci_tasks_update ON public.tasks FOR UPDATE TO authenticated
USING (public.phase6_app_actor_class() IN ('admin','project_manager') OR assigned_to=auth.uid())
WITH CHECK (public.phase6_app_actor_class() IN ('admin','project_manager') OR assigned_to=auth.uid());

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY ci_notifications_recipient_read ON public.notifications FOR SELECT TO authenticated
USING (recipient_id=auth.uid());
-- Crucially, authenticated has no INSERT policy or SQL privilege to forge notifications.

CREATE FUNCTION public.ci_task_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog','pg_temp' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO public.activity_logs(task_id,project_id,user_id,action,activity_type)
  VALUES (NEW.id,NEW.project_id,auth.uid(),'task_created','task_created');
  IF NEW.assigned_to IS NOT NULL THEN
   INSERT INTO public.task_assignees(task_id,profile_id,assignment_role,assigned_by)
   VALUES(NEW.id,NEW.assigned_to,'primary',auth.uid());
  END IF;
 ELSE
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
   INSERT INTO public.activity_logs(task_id,project_id,user_id,action,activity_type)
   VALUES(NEW.id,NEW.project_id,auth.uid(),'task_assigned','task_assigned');
   DELETE FROM public.task_assignees WHERE task_id=NEW.id AND assignment_role='primary';
   IF NEW.assigned_to IS NOT NULL THEN
    INSERT INTO public.task_assignees(task_id,profile_id,assignment_role,assigned_by)
    VALUES(NEW.id,NEW.assigned_to,'primary',auth.uid());
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER ci_task_integrity AFTER INSERT OR UPDATE OF assigned_to ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.ci_task_integrity();

GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
GRANT EXECUTE ON FUNCTION public.phase6_app_actor_class() TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase6_team_can_access_project(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase6_collaboration_target_is_team(uuid) TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.tasks TO authenticated;
GRANT SELECT ON public.notifications TO authenticated;

INSERT INTO public.profiles(id,role,status) VALUES
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','admin','active'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','project_manager','active'),
('cccccccc-cccc-4ccc-8ccc-cccccccccccc','employee','active'),
('dddddddd-dddd-4ddd-8ddd-dddddddddddd','employee','active'),
('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','client','active'),
('ffffffff-ffff-4fff-8fff-ffffffffffff','admin','inactive');
INSERT INTO public.projects(id) VALUES('11111111-1111-4111-8111-111111111111');
