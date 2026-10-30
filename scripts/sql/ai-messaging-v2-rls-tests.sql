-- Production-shaped security checks against disposable Postgres 17, not live data.
\set ON_ERROR_STOP on
DO $$BEGIN
 IF has_table_privilege('anon','public.messages','SELECT')
    OR has_table_privilege('anon','public.messages','INSERT') THEN
 RAISE EXCEPTION 'Anonymous Data API permissions detected'; END IF;
END$$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
DO $$DECLARE n integer; BEGIN
 SELECT COUNT(*) INTO n FROM public.messages;
 IF n<>5 THEN RAISE EXCEPTION 'Admin expected 5 accessible messages, got %',n; END IF;
 IF EXISTS(SELECT 1 FROM public.messages WHERE id='20000000-0000-4000-8000-000000000003')
 THEN RAISE EXCEPTION 'Admin read private staff DM'; END IF;
END$$;

SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
DO $$DECLARE n integer; BEGIN
 SELECT COUNT(*) INTO n FROM public.messages;
 IF n<>5 THEN RAISE EXCEPTION 'Manager expected 5 messages, got %',n; END IF;
 IF EXISTS(SELECT 1 FROM public.messages WHERE id='20000000-0000-4000-8000-000000000003')
 THEN RAISE EXCEPTION 'Manager read unrelated private DM'; END IF;
END$$;

SELECT set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',false);
DO $$DECLARE n integer; denied boolean:=false; BEGIN
 SELECT COUNT(*) INTO n FROM public.messages;
 IF n<>4 THEN RAISE EXCEPTION 'Employee C expected 4 messages, got %',n; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.messages WHERE id='20000000-0000-4000-8000-000000000003')
 THEN RAISE EXCEPTION 'Employee cannot read own private DM'; END IF;
 BEGIN
 INSERT INTO public.messages(conversation_id,sender_id,body)
 VALUES('10000000-0000-4000-8000-000000000003',
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd','Forged source');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Employee forged another sender'; END IF;
 denied:=false;
 BEGIN
 INSERT INTO public.messages(conversation_id,sender_id,parent_message_id,body)
 VALUES('10000000-0000-4000-8000-000000000003',
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 '20000000-0000-4000-8000-000000000002','Wrong conversation reply');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Foreign parent message accepted'; END IF;
END$$;
INSERT INTO public.messages(conversation_id,sender_id,parent_message_id,body)
VALUES('10000000-0000-4000-8000-000000000003',
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 '20000000-0000-4000-8000-000000000003','Valid member reply');

SELECT set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',false);
DO $$DECLARE n integer; BEGIN
 SELECT COUNT(*) INTO n FROM public.messages WHERE
 conversation_id='10000000-0000-4000-8000-000000000003';
 IF n<>2 THEN RAISE EXCEPTION 'Peer cannot read valid linked reply'; END IF;
 IF EXISTS(SELECT 1 FROM public.messages WHERE id='20000000-0000-4000-8000-000000000004')
 THEN RAISE EXCEPTION 'Employee D saw Admin+Manager DM'; END IF;
END$$;

SELECT set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',false);
DO $$DECLARE n integer; BEGIN
 SELECT COUNT(*) INTO n FROM public.messages;
 IF n<>1 THEN RAISE EXCEPTION 'Client should see only own project-client message, saw %',n; END IF;
END$$;

SELECT set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',false);
DO $$DECLARE n integer; denied boolean:=false; BEGIN
 SELECT COUNT(*) INTO n FROM public.messages;
 IF n<>0 THEN RAISE EXCEPTION 'Inactive admin read % messages',n; END IF;
 BEGIN
 INSERT INTO public.messages(conversation_id,sender_id,body)
 VALUES('10000000-0000-4000-8000-000000000005',
 'ffffffff-ffff-4fff-8fff-ffffffffffff','Inactive spoof');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Inactive account sent message'; END IF;
END$$;
RESET ROLE;
SET ROLE anon;
SELECT set_config('request.jwt.claim.sub','',false);
DO $$BEGIN IF has_table_privilege('anon','public.messages','SELECT') THEN
 RAISE EXCEPTION 'Anonymous messages access'; END IF; END$$;
RESET ROLE;

SELECT 'AI Messaging V2 PostgreSQL: Admin/Manager/Employee/Client/Inactive/Anon RLS, private DM, spoof denial, parent match, authorized linked reply PASS' AS result;
