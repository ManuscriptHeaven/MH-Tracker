-- Phase 6 Step 3D.2B finance/payroll security tests for an unlinked disposable database.
-- Apply migrations 00100-00460 first. PostgreSQL execution required; no real Auth users are created.
begin;

create function pg_temp.p6_fin_assert(p_ok boolean,p_label text) returns void
language plpgsql as $$ begin
  if p_ok is distinct from true then raise exception 'Assertion failed: %',p_label; end if;
end $$;

do $$
declare
  n text; d text; f record;
  scope_tables text[]:=array['project_payments','finance_transactions','finance_budgets','employee_compensation','employee_ledger'];
  trigger_functions text[]:=array['phase6_guard_project_payment','phase6_guard_finance_transaction',
    'phase6_guard_finance_budget','phase6_guard_employee_compensation','phase6_stamp_employee_ledger_insert'];
begin
  foreach n in array scope_tables loop
    perform pg_temp.p6_fin_assert((select c.relrowsecurity from pg_catalog.pg_class c
      join pg_catalog.pg_namespace s on s.oid=c.relnamespace
      where s.nspname='public' and c.relname=n),n || ' RLS enabled');
    perform pg_temp.p6_fin_assert(not exists(
      select 1 from pg_catalog.pg_policy p
      join pg_catalog.pg_class c on c.oid=p.polrelid
      join pg_catalog.pg_namespace s on s.oid=c.relnamespace
      where s.nspname='public' and c.relname=n and (
        coalesce(pg_get_expr(p.polqual,p.polrelid),'') ~* '^\(?true\)?$'
        or coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') ~* '^\(?true\)?$'
        or coalesce(pg_get_expr(p.polqual,p.polrelid),'') ~* 'auth\.jwt\s*\('
        or coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') ~* 'auth\.jwt\s*\(')),
      n || ' has no unconditional/JWT policy');
  end loop;

  foreach n in array trigger_functions loop
    select p.* into strict f from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace s on s.oid=p.pronamespace
      where s.nspname='public' and p.proname=n and p.pronargs=0;
    perform pg_temp.p6_fin_assert(not f.prosecdef,n || ' is SECURITY INVOKER');
    perform pg_temp.p6_fin_assert('search_path=pg_catalog, pg_temp'=any(f.proconfig),n || ' fixed search_path');
    perform pg_temp.p6_fin_assert(not has_function_privilege('authenticated',f.oid,'EXECUTE'),n || ' authenticated direct EXECUTE denied');
    perform pg_temp.p6_fin_assert(not has_function_privilege('anon',f.oid,'EXECUTE'),n || ' anon direct EXECUTE denied');
    perform pg_temp.p6_fin_assert(not exists(select 1 from pg_catalog.aclexplode(f.proacl) a
      where a.grantee=0 and a.privilege_type='EXECUTE'),n || ' PUBLIC direct EXECUTE denied');
  end loop;

  perform pg_temp.p6_fin_assert(not exists(select 1 from pg_catalog.pg_roles
    where rolname='phase6_finance_security_owner'),'no unnecessary finance definer owner');
end $$;

-- Business finance: authenticated has required verbs, while policies restrict rows to active Admin/PM.
select pg_temp.p6_fin_assert((select count(*)=4 from pg_catalog.pg_policy
  where polrelid='public.project_payments'::regclass),'project_payments exact policy set');
select pg_temp.p6_fin_assert((select count(*)=4 from pg_catalog.pg_policy
  where polrelid='public.finance_transactions'::regclass),'finance_transactions exact policy set');
select pg_temp.p6_fin_assert((select count(*)=4 from pg_catalog.pg_policy
  where polrelid='public.finance_budgets'::regclass),'finance_budgets exact policy set');
select pg_temp.p6_fin_assert(not exists(select 1 from pg_catalog.pg_policy p
  where p.polrelid=any(array['public.project_payments'::regclass,'public.finance_transactions'::regclass,'public.finance_budgets'::regclass])
    and (coalesce(pg_get_expr(p.polqual,p.polrelid),'') ~* '''(employee|client)'''
      or coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') ~* '''(employee|client)''')),
  'Employee and Client have no business-finance policy branch');
select pg_temp.p6_fin_assert((select bool_and(
  coalesce(pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid),'')
    ~* 'phase6_app_actor_class\(\)')
  from pg_catalog.pg_policy p
  where p.polrelid=any(array['public.project_payments'::regclass,'public.finance_transactions'::regclass,'public.finance_budgets'::regclass])),
  'business-finance policies use the normalized actor helper');
select pg_temp.p6_fin_assert((select pg_get_expr(polqual,polrelid) ~* '''admin'''
  from pg_catalog.pg_policy where polrelid='public.project_payments'::regclass and polcmd='d'),
  'project payment delete is Admin-only');
select pg_temp.p6_fin_assert((select pg_get_expr(polqual,polrelid) ~* '''admin'''
  from pg_catalog.pg_policy where polrelid='public.finance_budgets'::regclass and polcmd='d'),
  'budget delete is Admin-only');
select pg_temp.p6_fin_assert((select pg_get_expr(polqual,polrelid) ~* '''project_manager'''
  from pg_catalog.pg_policy where polrelid='public.finance_transactions'::regclass and polcmd='d'),
  'PM transaction deletion remains supported');

-- Payroll: Admin manages; active Employee reads only rows keyed exactly to auth.uid().
select pg_temp.p6_fin_assert((select count(*)=5 from pg_catalog.pg_policy
  where polrelid='public.employee_compensation'::regclass),'compensation exact policy set');
select pg_temp.p6_fin_assert((select count(*)=4 from pg_catalog.pg_policy
  where polrelid='public.employee_ledger'::regclass),'ledger exact policy set');
select pg_temp.p6_fin_assert((select count(*)=2 from pg_catalog.pg_policy
  where polrelid='public.employee_compensation'::regclass and polcmd='r'
    and (pg_get_expr(polqual,polrelid) ~* 'phase6_app_actor_class\(\).*''admin'''
      or pg_get_expr(polqual,polrelid) ~* 'phase6_app_actor_class\(\).*''employee''.*employee_id\s*=\s*auth\.uid\(\)')),
  'compensation SELECT is Admin or exact Employee self');
select pg_temp.p6_fin_assert((select count(*)=2 from pg_catalog.pg_policy
  where polrelid='public.employee_ledger'::regclass and polcmd='r'
    and (pg_get_expr(polqual,polrelid) ~* 'phase6_app_actor_class\(\).*''admin'''
      or pg_get_expr(polqual,polrelid) ~* 'phase6_app_actor_class\(\).*''employee''.*employee_id\s*=\s*auth\.uid\(\)')),
  'ledger SELECT is Admin or exact Employee self');
select pg_temp.p6_fin_assert(not has_table_privilege('authenticated','public.employee_ledger','UPDATE')
  and not exists(select 1 from pg_catalog.pg_policy where polrelid='public.employee_ledger'::regclass and polcmd='w'),
  'ledger entries are immutable; corrections use Admin delete/re-entry');
select pg_temp.p6_fin_assert(not exists(select 1 from pg_catalog.pg_policy p
  where p.polrelid=any(array['public.employee_compensation'::regclass,'public.employee_ledger'::regclass])
    and p.polcmd in ('a','w','d')
    and (coalesce(pg_get_expr(p.polqual,p.polrelid),'') || coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')) ~* '''employee'''),
  'Employee has no payroll mutation policy');

-- ACL/guard checks protect linkage, identity, derived values, and timestamps.
select pg_temp.p6_fin_assert(not has_table_privilege('authenticated','public.project_payments','UPDATE')
  and has_column_privilege('authenticated','public.project_payments','total_price','UPDATE')
  and not has_column_privilege('authenticated','public.project_payments','id','UPDATE')
  and not has_column_privilege('authenticated','public.project_payments','created_at','UPDATE'),
  'project payment UPDATE uses an explicit column ACL');
select pg_temp.p6_fin_assert(not has_table_privilege('authenticated','public.finance_transactions','UPDATE')
  and has_column_privilege('authenticated','public.finance_transactions','amount','UPDATE')
  and not has_column_privilege('authenticated','public.finance_transactions','created_by','UPDATE')
  and not has_column_privilege('authenticated','public.finance_transactions','created_at','UPDATE'),
  'finance transaction UPDATE protects creator identity and creation time');
select pg_temp.p6_fin_assert(not has_table_privilege('authenticated','public.employee_compensation','UPDATE')
  and has_column_privilege('authenticated','public.employee_compensation','monthly_salary','UPDATE')
  and not has_column_privilege('authenticated','public.employee_compensation','employee_id','REFERENCES'),
  'compensation UPDATE is column scoped and identity guard backed');

do $$
declare c text;
begin
  foreach c in array array['project_id','total_price','advance_paid','payment_status','updated_by'] loop
    perform pg_temp.p6_fin_assert(has_column_privilege('authenticated','public.project_payments',c,'UPDATE'),
      'project_payments.' || c || ' UPDATE granted');
  end loop;
  foreach c in array array['due_date','payment_month','payment_year','payment_date','notes'] loop
    if exists(select 1 from pg_catalog.pg_attribute
      where attrelid='public.project_payments'::regclass and attname=c and attnum>0 and not attisdropped) then
      perform pg_temp.p6_fin_assert(not has_column_privilege('authenticated','public.project_payments',c,'UPDATE'),
        'project_payments.' || c || ' UPDATE denied');
    end if;
  end loop;

  foreach c in array array['type','category','description','amount','transaction_date','project_id','currency',
    'exchange_rate','amount_pkr','client_name','invoice_id','payment_method','reference_no','vendor',
    'recurring_status','next_recurring_date','notes','attachment_url','is_soft_deleted','updated_by','updated_at'] loop
    perform pg_temp.p6_fin_assert(has_column_privilege('authenticated','public.finance_transactions',c,'UPDATE'),
      'finance_transactions.' || c || ' UPDATE granted');
  end loop;
  foreach c in array array['expense_type','payment_status','paid_date','financial_account','tax_amount','fee_amount','recurring_end_date'] loop
    if exists(select 1 from pg_catalog.pg_attribute
      where attrelid='public.finance_transactions'::regclass and attname=c and attnum>0 and not attisdropped) then
      perform pg_temp.p6_fin_assert(not has_column_privilege('authenticated','public.finance_transactions',c,'UPDATE'),
        'finance_transactions.' || c || ' UPDATE denied');
    end if;
  end loop;

  foreach c in array array['monthly_budget_pkr','updated_by','updated_at'] loop
    perform pg_temp.p6_fin_assert(has_column_privilege('authenticated','public.finance_budgets',c,'UPDATE'),
      'finance_budgets.' || c || ' UPDATE granted');
  end loop;

  foreach c in array array['monthly_salary','per_project_rate','joining_date','responsibilities','performance_rating','updated_at'] loop
    perform pg_temp.p6_fin_assert(has_column_privilege('authenticated','public.employee_compensation',c,'UPDATE'),
      'employee_compensation.' || c || ' UPDATE granted');
  end loop;
  foreach c in array array['salary_type','default_currency'] loop
    if exists(select 1 from pg_catalog.pg_attribute
      where attrelid='public.employee_compensation'::regclass and attname=c and attnum>0 and not attisdropped) then
      perform pg_temp.p6_fin_assert(not has_column_privilege('authenticated','public.employee_compensation',c,'UPDATE'),
        'employee_compensation.' || c || ' UPDATE denied');
    end if;
  end loop;
end $$;

do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='phase6_guard_finance_transaction';
  perform pg_temp.p6_fin_assert(d ~* 'new\.created_by\s+is\s+distinct\s+from\s+old\.created_by'
    and d ~* 'new\.project_id\s+is\s+distinct\s+from\s+old\.project_id[\s\S]*phase6_app_actor_class\(\)\s*<>\s*''admin'''
    and d ~* 'new\.amount_pkr\s*:=\s*round\(new\.amount\s*\*\s*new\.exchange_rate',
    'transaction guard protects audit identity, PM relinking, and derived PKR value');
  select pg_get_functiondef(p.oid) into d from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='phase6_guard_project_payment';
  perform pg_temp.p6_fin_assert(d ~* 'new\.project_id\s+is\s+distinct\s+from\s+old\.project_id'
    and d ~* 'new\.updated_by\s*:=\s*auth\.uid\(\)',
    'project payment guard protects linkage and stamps actor');
  select pg_get_functiondef(p.oid) into d from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='phase6_touch_project_metadata_updated_at';
  perform pg_temp.p6_fin_assert(d ~* 'current_user\s*=\s*''phase6_workflow_rpc_owner'''
    and d ~* 'new\.invoiced[\s\S]*new\.invoice_id[\s\S]*new\.invoiced_at[\s\S]*phase6_current_actor_class\(\)'
    and d ~* 'new\.updated_at\s*:=\s*clock_timestamp\(\)',
    'project invoice metadata is Admin/PM guarded without breaking workflow writes');
end $$;

-- The signup definer retains only exact team provisioning columns.
select pg_temp.p6_fin_assert(not has_table_privilege('phase6_app_security_owner','public.team_members','SELECT')
  and has_column_privilege('phase6_app_security_owner','public.team_members','email','SELECT')
  and has_column_privilege('phase6_app_security_owner','public.team_members','full_name','SELECT')
  and has_column_privilege('phase6_app_security_owner','public.team_members','role','SELECT')
  and has_column_privilege('phase6_app_security_owner','public.team_members','phone','SELECT')
  and has_column_privilege('phase6_app_security_owner','public.team_members','status','SELECT')
  and not has_column_privilege('phase6_app_security_owner','public.team_members','id','SELECT')
  and not has_column_privilege('phase6_app_security_owner','public.team_members','created_at','SELECT'),
  'app-security owner has only exact team provisioning SELECT columns');

-- No client billing projection is required by the current client portal.
select pg_temp.p6_fin_assert(not exists(select 1 from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname like 'phase6_client%bill%'),
  'NO CLIENT BILLING PROJECTION REQUIRED');

-- Fixture-dependent Admin/PM business-finance and Admin/self payroll runtime scenarios.
-- The harness supplies disposable active profiles; the test never inserts auth.users or profiles.
do $$
declare a uuid; pm uuid; e uuid; e2 uuid; c uuid; visible bigint; denied boolean:=false;
  v_project_id uuid:=gen_random_uuid(); tx_id uuid:=gen_random_uuid(); ledger_id uuid:=gen_random_uuid();
begin
  if current_setting('phase6.local_disposable',true) is distinct from 'on'
    or nullif(current_setting('phase6.test_admin',true),'') is null
    or nullif(current_setting('phase6.test_manager',true),'') is null
    or nullif(current_setting('phase6.test_employee',true),'') is null
    or nullif(current_setting('phase6.test_other_employee',true),'') is null
    or nullif(current_setting('phase6.test_client',true),'') is null then
    raise notice 'SKIP/UNEXECUTED: Admin/PM business-finance and Admin/self payroll runtime scenarios require disposable synthetic Auth fixtures.';
    return;
  end if;
  a:=current_setting('phase6.test_admin')::uuid; pm:=current_setting('phase6.test_manager')::uuid;
  e:=current_setting('phase6.test_employee')::uuid; e2:=current_setting('phase6.test_other_employee')::uuid;
  c:=current_setting('phase6.test_client')::uuid;
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a)::text,true);
  insert into public.projects(id,client_name,project_title,service_type,due_date,assigned_to,project_manager,created_by)
    values(v_project_id,'Disposable finance','Finance fixture','Fixture',date '2035-01-01',e,pm,a);
  insert into public.project_payments(project_id,total_price,advance_paid) values(v_project_id,1000,200);
  insert into public.finance_transactions(id,type,category,description,amount,project_id,created_by)
    values(tx_id,'income','Fixture','Disposable finance fixture',100,v_project_id,a);
  insert into public.finance_budgets(category,monthly_budget_pkr) values('Disposable fixture',500);
  insert into public.employee_compensation(employee_id,monthly_salary) values(e,1000),(e2,2000);
  insert into public.employee_ledger(id,employee_id,entry_type,amount,notes) values
    (ledger_id,e,'Salary',1000,'Disposable payroll fixture'),(gen_random_uuid(),e2,'Salary',2000,'Disposable payroll fixture');

  perform set_config('request.jwt.claim.sub',pm::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',pm)::text,true);
  execute 'set local role authenticated';
  select count(*) into visible from public.finance_transactions where id=tx_id;
  perform pg_temp.p6_fin_assert(visible=1,'PM reads business finance');
  select count(*) into visible from public.employee_compensation;
  perform pg_temp.p6_fin_assert(visible=0,'PM cannot read payroll');
  begin update public.finance_transactions set project_id=null where id=tx_id;
  exception when sqlstate '42501' then denied:=sqlerrm='phase6_finance_project_relink_denied'; end;
  execute 'reset role'; perform pg_temp.p6_fin_assert(denied,'PM cannot relink a transaction');

  perform set_config('request.jwt.claim.sub',e::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',e)::text,true);
  execute 'set local role authenticated';
  select count(*) into visible from public.project_payments pp where pp.project_id=v_project_id;
  perform pg_temp.p6_fin_assert(visible=0,'Employee cannot read business finance');
  select count(*) into visible from public.employee_compensation;
  perform pg_temp.p6_fin_assert(visible=1,'Employee sees only own compensation');
  select count(*) into visible from public.employee_ledger;
  perform pg_temp.p6_fin_assert(visible=1,'Employee sees only own dues/payroll ledger');
  execute 'reset role';

  perform set_config('request.jwt.claim.sub',c::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',c)::text,true);
  execute 'set local role authenticated'; select count(*) into visible from public.finance_transactions; execute 'reset role';
  perform pg_temp.p6_fin_assert(visible=0,'Client cannot read internal finance');
  raise notice 'PASS: Admin/PM business-finance and Admin/self payroll runtime scenarios.';
end $$;

rollback;
