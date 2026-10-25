-- This test MUST run only after task-incentive-ci-fixture.sql and the
-- exact PR migration, on a disposable PostgreSQL instance.
\set ON_ERROR_STOP on
begin;

-- Administrator creates a proposed incentive on an incomplete task.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into public.task_incentives(task_id,employee_id,amount,created_by)
values('22222222-2222-4222-8222-222222222222',
       'cccccccc-cccc-4ccc-8ccc-cccccccccccc',15.00,
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
do $$
begin
 if (select count(*) from public.task_incentives) <> 1 then
   raise exception 'Admin must see the private proposed amount';
 end if;
 if (select count(*) from public.employee_ledger) <> 0 then
   raise exception 'A proposed task must never create a payroll earning';
 end if;
end $$;

-- Server refuses payment for work that is not Done.
do $$
declare denied boolean := false;
begin
 begin
   update public.task_incentives set status='approved'
   where task_id='22222222-2222-4222-8222-222222222222';
 exception when check_violation or insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Incomplete task was incorrectly approved'; end if;
 if (select count(*) from public.employee_ledger) <> 0 then
   raise exception 'Failed approval has a financial side effect';
 end if;
end $$;

-- Read isolation against role escalation, including inactive Admin.
set request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
declare denied boolean := false;
begin
 if (select count(*) from public.task_incentives) <> 0 then
   raise exception 'Manager can see Admin task bonus';
 end if;
 begin
   insert into public.task_incentives(task_id,employee_id,amount,created_by)
   values ('33333333-3333-4333-8333-333333333333',
           'cccccccc-cccc-4ccc-8ccc-cccccccccccc',77,
           'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 exception when insufficient_privilege or check_violation then denied:=true; end;
 if not denied then raise exception 'Manager could set incentive'; end if;
end $$;

set request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$
declare affected integer;
begin
 if (select count(*) from public.task_incentives) <> 0 then
   raise exception 'Employee can see proposed bonus';
 end if;
 update public.task_incentives set amount=9999;
 get diagnostics affected=row_count;
 if affected<>0 then raise exception 'Employee changed proposed amount'; end if;
end $$;

set request.jwt.claim.sub = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
do $$
begin
 if (select count(*) from public.task_incentives) <> 0 then
   raise exception 'Client can see task bonus';
 end if;
end $$;

set request.jwt.claim.sub = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
do $$
begin
 if (select count(*) from public.task_incentives) <> 0 then
   raise exception 'Inactive Admin still has private payroll access';
 end if;
end $$;

-- Only the active Admin can award a completed task.
set request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.tasks set status='Done'
where id='22222222-2222-4222-8222-222222222222';
update public.task_incentives set status='approved'
where task_id='22222222-2222-4222-8222-222222222222';
do $$
begin
 if not exists(
   select 1 from public.task_incentives i
   join public.employee_ledger l on l.id=i.ledger_entry_id
   where i.task_id='22222222-2222-4222-8222-222222222222'
     and i.status='approved'
     and i.amount=15.00 and i.approved_by='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and l.entry_type='Bonus' and l.amount=15.00 and l.currency='USD'
     and l.employee_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
     and l.reference='TASK_INCENTIVE:22222222-2222-4222-8222-222222222222'
 ) then raise exception 'Approved bonus is not atomically linked to payroll'; end if;
 if (select count(*) from public.employee_ledger)<>1 then
   raise exception 'Approval produced wrong number of ledger credits';
 end if;
end $$;

-- Repeated approval, amount change, deleting earned payroll, and direct
-- duplicate ledger credit must all fail.
do $$
declare denied boolean;
begin
 denied:=false;
 begin
   update public.task_incentives set status='approved'
   where task_id='22222222-2222-4222-8222-222222222222';
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Second approval succeeded'; end if;
 denied:=false;
 begin
   update public.task_incentives set amount=99
   where task_id='22222222-2222-4222-8222-222222222222';
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Approved price was edited'; end if;
 denied:=false;
 begin
   delete from public.employee_ledger
   where reference='TASK_INCENTIVE:22222222-2222-4222-8222-222222222222';
 exception when foreign_key_violation then denied:=true; end;
 if not denied then raise exception 'Approved bonus payroll record was deleted'; end if;
 denied:=false;
 begin
   insert into public.employee_ledger(employee_id,entry_type,amount,reference)
   values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Bonus',15,
     'TASK_INCENTIVE:22222222-2222-4222-8222-222222222222');
 exception when unique_violation then denied:=true; end;
 if not denied then raise exception 'Duplicate bonus ledger reference was accepted'; end if;
end $$;

-- Assignee change must block approval until Admin updates the draft recipient.
insert into public.task_incentives(task_id,employee_id,amount,created_by)
values('33333333-3333-4333-8333-333333333333',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',24.00,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
update public.tasks set assigned_to='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
where id='33333333-3333-4333-8333-333333333333';
do $$
declare denied boolean := false;
begin
 begin
   update public.task_incentives set status='approved'
   where task_id='33333333-3333-4333-8333-333333333333';
 exception when check_violation then denied:=true; end;
 if not denied then raise exception 'Assignee mismatch paid the wrong employee'; end if;
 if (select count(*) from public.employee_ledger)<>1 then
   raise exception 'Rejected reassignment generated a payout'; end if;
end $$;
update public.task_incentives
set employee_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
where task_id='33333333-3333-4333-8333-333333333333';
update public.task_incentives set status='approved'
where task_id='33333333-3333-4333-8333-333333333333';
do $$
begin
 if (select count(*) from public.employee_ledger) <> 2 then
   raise exception 'Second valid award missing';
 end if;
 if not exists(
   select 1 from public.employee_ledger
   where employee_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' and amount=24
 ) then raise exception 'Reassigned bonus credited wrong person'; end if;
end $$;

-- Employees may view their OWN approved payroll ledger only, not Admin's proposals
-- or other people's pay.
set request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$
begin
 if (select count(*) from public.employee_ledger) <> 1 then
   raise exception 'Employee can see someone else payroll or is missing own award';
 end if;
 if (select count(*) from public.task_incentives) <> 0 then
   raise exception 'Employee can see Admin pricing after approval';
 end if;
end $$;
reset role;

-- Anon does not have SELECT table privileges, even with a forged claim.
set role anon;
set request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
begin
 if has_table_privilege('anon','public.task_incentives','SELECT') then
   raise exception 'Anonymous role has SELECT privilege on private bonuses';
 end if;
end $$;
reset role;

-- Structural conditions: no security definer trigger, RLS enabled,
-- no write access to completed incentives, and protected reference uniqueness.
do $$
begin
 if not (select relrowsecurity from pg_class where oid='public.task_incentives'::regclass)
   then raise exception 'Private incentive RLS not enabled'; end if;
 if (select prosecdef from pg_proc where oid='public.task_incentive_guard_and_award()'::regprocedure)
   then raise exception 'Guard trigger unexpectedly SECURITY DEFINER'; end if;
 if (select count(*) from pg_policies where schemaname='public'
   and tablename='task_incentives')<>3 then
   raise exception 'Unexpected incentive RLS policy count'; end if;
 if not exists (
   select 1 from pg_indexes where schemaname='public' and tablename='employee_ledger'
   and indexname='employee_ledger_unique_task_incentive_reference'
 ) then raise exception 'Duplicate payout prevention index missing'; end if;
end $$;
rollback;
\echo PASS: verified Admin-only proposals, employee payroll isolation, atomic approval, reassignment, and duplicate protection.
