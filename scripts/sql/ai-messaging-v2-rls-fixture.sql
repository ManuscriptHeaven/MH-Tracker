-- Disposable PostgreSQL 17 message authorization fixture. No real user data.
CREATE SCHEMA auth;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;

CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text NOT NULL,status text NOT NULL);
CREATE TABLE public.projects(id uuid PRIMARY KEY,team_member uuid,client_id uuid);
CREATE TABLE public.conversations(id uuid PRIMARY KEY,type text NOT NULL,project_id uuid REFERENCES public.projects(id));
CREATE TABLE public.conversation_members(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 conversation_id uuid NOT NULL REFERENCES public.conversations(id),
 user_id uuid NOT NULL REFERENCES public.profiles(id),
 last_read_at timestamptz
);
CREATE TABLE public.messages(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 conversation_id uuid NOT NULL REFERENCES public.conversations(id),
 sender_id uuid NOT NULL REFERENCES public.profiles(id),
 body text NOT NULL,
 parent_message_id uuid REFERENCES public.messages(id),
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.phase6_app_actor_class() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='pg_catalog','pg_temp' AS $$
 SELECT CASE WHEN status='active' THEN
 CASE WHEN role IN ('admin','project_manager','manager') THEN CASE WHEN role='admin' THEN 'admin' ELSE 'project_manager' END
 WHEN role IN ('employee','junior_assistant') THEN 'employee'
 WHEN role='client' THEN 'client'
 END END FROM public.profiles WHERE id=auth.uid() LIMIT 1;
$$;
CREATE FUNCTION public.phase6_auth_uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT auth.uid();
$$;
CREATE FUNCTION public.phase6_team_can_access_project(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='pg_catalog','pg_temp' AS $$
 SELECT public.phase6_app_actor_class() IN ('admin','project_manager')
 OR (public.phase6_app_actor_class()='employee' AND EXISTS(
   SELECT 1 FROM public.projects p WHERE p.id=pid AND p.team_member=auth.uid()));
$$;
CREATE FUNCTION public.phase6_client_can_access_project(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='pg_catalog','pg_temp' AS $$
 SELECT public.phase6_app_actor_class()='client' AND EXISTS(
 SELECT 1 FROM public.projects p WHERE p.id=pid AND p.client_id=auth.uid());
$$;
CREATE FUNCTION public.phase6_can_access_task(task_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT false; $$;

-- Mirrors the deployed private-DM membership predicate and project/channel cases.
CREATE FUNCTION public.phase6_can_access_conversation(cid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='pg_catalog','pg_temp' AS $$
 SELECT public.phase6_auth_uid() IS NOT NULL AND EXISTS (
   SELECT 1 FROM public.conversations c WHERE c.id=cid AND
   CASE
   WHEN c.type='project_internal' THEN c.project_id IS NOT NULL AND public.phase6_team_can_access_project(c.project_id)
   WHEN c.type='project_client' THEN c.project_id IS NOT NULL
      AND (public.phase6_team_can_access_project(c.project_id) OR public.phase6_client_can_access_project(c.project_id))
   WHEN c.type='task' THEN public.phase6_can_access_task(c.id)
   WHEN c.type='dm' THEN public.phase6_app_actor_class() IN ('admin','project_manager','employee')
     AND (SELECT COUNT(*) FROM public.conversation_members m WHERE m.conversation_id=c.id)=2
     AND (SELECT COUNT(*) FROM public.conversation_members m JOIN public.profiles p
       ON p.id=m.user_id AND p.status='active'
       AND p.role IN ('admin','project_manager','manager','employee','junior_assistant')
       WHERE m.conversation_id=c.id)=2
     AND EXISTS (SELECT 1 FROM public.conversation_members m
       WHERE m.conversation_id=c.id AND m.user_id=public.phase6_auth_uid())
   WHEN c.type='team_channel' THEN public.phase6_app_actor_class() IN ('admin','project_manager','employee')
   ELSE false END
 );
$$;
CREATE FUNCTION public.phase6_parent_message_matches(parent_id uuid,cid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='pg_catalog','pg_temp' AS $$
 SELECT EXISTS(SELECT 1 FROM public.messages WHERE id=parent_id AND conversation_id=cid);
$$;

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY cert_conv_select ON public.conversations FOR SELECT TO authenticated
 USING(public.phase6_can_access_conversation(id));
CREATE POLICY cert_members_select ON public.conversation_members FOR SELECT TO authenticated
 USING(public.phase6_can_access_conversation(conversation_id));
CREATE POLICY cert_messages_select ON public.messages FOR SELECT TO authenticated
 USING(public.phase6_can_access_conversation(conversation_id));
CREATE POLICY cert_messages_insert ON public.messages FOR INSERT TO authenticated WITH CHECK(
 sender_id=auth.uid() AND public.phase6_can_access_conversation(conversation_id)
 AND (parent_message_id IS NULL OR public.phase6_parent_message_matches(parent_message_id,conversation_id)));

GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public,auth TO authenticated;
GRANT SELECT ON public.conversations,public.conversation_members,public.messages TO authenticated;
GRANT INSERT ON public.messages TO authenticated;

INSERT INTO public.profiles VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','admin','active'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','project_manager','active'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','employee','active'),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','employee','active'),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','client','active'),
 ('ffffffff-ffff-4fff-8fff-ffffffffffff','admin','inactive');

INSERT INTO public.projects VALUES
 ('11111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
 ('22222222-2222-4222-8222-222222222222','dddddddd-dddd-4ddd-8ddd-dddddddddddd',NULL);
INSERT INTO public.conversations VALUES
 ('10000000-0000-4000-8000-000000000001','project_internal','11111111-1111-4111-8111-111111111111'),
 ('10000000-0000-4000-8000-000000000002','project_client','11111111-1111-4111-8111-111111111111'),
 ('10000000-0000-4000-8000-000000000003','dm',NULL),
 ('10000000-0000-4000-8000-000000000004','dm',NULL),
 ('10000000-0000-4000-8000-000000000005','team_channel',NULL),
 ('10000000-0000-4000-8000-000000000006','project_internal','22222222-2222-4222-8222-222222222222');
INSERT INTO public.conversation_members(conversation_id,user_id) VALUES
 ('10000000-0000-4000-8000-000000000003','cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
 ('10000000-0000-4000-8000-000000000003','dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
 ('10000000-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('10000000-0000-4000-8000-000000000004','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
INSERT INTO public.messages(id,conversation_id,sender_id,body) VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','cccccccc-cccc-4ccc-8ccc-cccccccccccc','Internal details'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Client proof question'),
 ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','cccccccc-cccc-4ccc-8ccc-cccccccccccc','PRIVATE employee DM'),
 ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Private Admin+Manager DM'),
 ('20000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000005','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Team channel'),
 ('20000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000006','dddddddd-dddd-4ddd-8ddd-dddddddddddd','Project beta internal');
