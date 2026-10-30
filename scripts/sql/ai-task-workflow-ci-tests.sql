-- After disposable fixture + the exact task assignment notification migration.
-- No real user accounts, production data, or credentials are involved.
\set ON_ERROR_STOP on

-- No direct client privilege to forge notifications.
DO $$ BEGIN
 IF has_table_privilege('authenticated','public.notifications','INSERT')
    OR has_table_privilege('anon','public.notifications','INSERT')
    OR has_function_privilege('authenticated','public.task_assignment_notify()','EXECUTE')
    OR has_function_privilege('anon','public.task_assignment_notify()','EXECUTE')
 THEN RAISE EXCEPTION 'Notification writer exposed to API clients'; END IF;
END $$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
INSERT INTO public.tasks(id,title,project_id,assigned_to,created_by,due_date)
VALUES ('22222222-2222-4222-8222-222222222222',
  'V3: QA a book cover','11111111-1111-4111-8111-111111111111',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  current_date + 1);
RESET ROLE;

DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.tasks WHERE id='22222222-2222-4222-8222-222222222222'
   AND assigned_to='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
   AND project_id='11111111-1111-4111-8111-111111111111'
   AND status='To Do' AND due_date=current_date + 1;
 IF n<>1 THEN RAISE EXCEPTION 'Task insert/readback mismatch'; END IF;
 SELECT count(*) INTO n FROM public.task_assignees WHERE task_id='22222222-2222-4222-8222-222222222222'
   AND profile_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' AND assignment_role='primary';
 IF n<>1 THEN RAISE EXCEPTION 'Primary task assignee not synchronized'; END IF;
 SELECT count(*) INTO n FROM public.activity_logs WHERE task_id='22222222-2222-4222-8222-222222222222'
   AND action='task_created' AND user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 IF n<>1 THEN RAISE EXCEPTION 'Task creation lacks audit'; END IF;
 SELECT count(*) INTO n FROM public.notifications WHERE recipient_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
   AND project_id='11111111-1111-4111-8111-111111111111'
   AND type='task_assigned' AND title='New task assigned' AND message='V3: QA a book cover' AND NOT is_read;
 IF n<>1 THEN RAISE EXCEPTION 'Task assignment alert not written'; END IF;
END $$;

-- Sender cannot see a notification that belongs to the recipient.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.notifications)<>0
 THEN RAISE EXCEPTION 'Admin can read another recipient notification'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.notifications WHERE type='task_assigned')<>1
 THEN RAISE EXCEPTION 'Assignee cannot read their new notification'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.notifications)<>0
 THEN RAISE EXCEPTION 'Unrelated employee can read notification'; END IF;
END $$;

-- Manager changes assignment; only the new recipient receives a new alert.
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
UPDATE public.tasks SET assigned_to='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
WHERE id='22222222-2222-4222-8222-222222222222';
RESET ROLE;
DO $$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM public.notifications WHERE type='task_assigned';
 IF n<>2 THEN RAISE EXCEPTION 'Expected one creation and one reassignment alert, got %',n; END IF;
 SELECT count(*) INTO n FROM public.notifications WHERE recipient_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
 AND title='Task reassigned to you';
 IF n<>1 THEN RAISE EXCEPTION 'Reassignment did not notify new recipient'; END IF;
 SELECT count(*) INTO n FROM public.task_assignees WHERE task_id='22222222-2222-4222-8222-222222222222'
 AND profile_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 IF n<>1 THEN RAISE EXCEPTION 'Primary assignee not updated'; END IF;
 SELECT count(*) INTO n FROM public.activity_logs WHERE task_id='22222222-2222-4222-8222-222222222222'
 AND action='task_assigned';
 IF n<>1 THEN RAISE EXCEPTION 'Reassignment lacks audit event'; END IF;
END $$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
UPDATE public.tasks SET assigned_to='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
WHERE id='22222222-2222-4222-8222-222222222222';
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.notifications WHERE type='task_assigned')<>2
 THEN RAISE EXCEPTION 'No-op assignment duplicated notification'; END IF;
END $$;

-- A self-assigned employee task is permitted but needs no inbox notification.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',false);
INSERT INTO public.tasks(id,title,project_id,assigned_to,created_by)
VALUES('33333333-3333-4333-8333-333333333333','Self task',NULL,
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.notifications WHERE type='task_assigned')<>2
 THEN RAISE EXCEPTION 'Self-assignment caused unnecessary alert'; END IF;
END $$;

-- A staff member cannot assign someone else by bypassing the preview.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',false);
DO $$ DECLARE denied boolean:=false; BEGIN
 BEGIN
  INSERT INTO public.tasks(title,project_id,assigned_to,created_by)
  VALUES('Spoofed employee task','11111111-1111-4111-8111-111111111111',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd','cccccccc-cccc-4ccc-8ccc-cccccccccccc');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Employee assigned another employee'; END IF;
END $$;

-- Active client and inactive admin cannot write a task, even to themselves.
SELECT set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',false);
DO $$ DECLARE denied boolean:=false; BEGIN
 BEGIN
  INSERT INTO public.tasks(title,assigned_to,created_by)
  VALUES('Client spoof','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Client created team task'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',false);
DO $$ DECLARE denied boolean:=false; BEGIN
 BEGIN
  INSERT INTO public.tasks(title,assigned_to,created_by)
  VALUES('Suspended admin spoof','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'ffffffff-ffff-4fff-8fff-ffffffffffff');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Suspended admin created task'; END IF;
END $$;

-- Claims alone do not let an active admin spoof who created a task.
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
DO $$ DECLARE denied boolean:=false; BEGIN
 BEGIN
  INSERT INTO public.tasks(title,assigned_to,created_by)
  VALUES('Forged creator','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Admin bypassed created_by ownership'; END IF;
END $$;
RESET ROLE;

SET ROLE anon;
SELECT set_config('request.jwt.claim.sub','',false);
DO $$ BEGIN
 IF has_table_privilege('anon','public.tasks','INSERT') THEN
  RAISE EXCEPTION 'Anonymous task insertion unexpectedly granted'; END IF;
END $$;
RESET ROLE;

SELECT 'AI workflow certification: task insert, assignee, durable notice, audit, reassignment, idempotency and role denial PASS' AS result;
