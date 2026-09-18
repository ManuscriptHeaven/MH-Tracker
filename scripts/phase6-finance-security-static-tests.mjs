// Dependency-free source assertions only; this does not execute PostgreSQL.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const migrationDir='supabase/phase6/migrations';
const expected=[
  '00100_phase6_canonical_foundation.sql',
  '00200_phase6_legacy_backfill.sql',
  '00300_phase6_workflow_rpcs.sql',
  '00400_phase6_security_and_projections.sql',
  '00450_phase6_core_application_security.sql',
  '00460_phase6_finance_payroll_security.sql',
];
const cutoverPresent=fs.existsSync(`${migrationDir}/00500_phase6_cutover_and_validation.sql`);
const files=fs.readdirSync(migrationDir).filter((f)=>f.includes('phase6')&&f.endsWith('.sql')&&!f.startsWith('00500_')).sort();
assert.deepEqual(files,expected);
const sha=(p)=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const accepted=[
  '3bdae7a341b22699cb8879a3508e3f97eb76e1e09287949ebd7fe93aed1ee21a',
  '848c80db812dfa583c563fc9b73c44deebf6130d56578946712a78003cbb2cfc',
  '296b77041d7af216c499c50a7e91866cb70d2f7e4fb9e36f6410e86bf6c7e767',
  '22a852cf39d1e6d3292d98fcdc8ad90663770864e65592472a9b783565415628',
  'fcffa593f087308a87c5d58e974cfbb81f13c2335429da82c24bfe8c11c980ee',
  '927032d087c2f1cd9faaa59ba10a9dbf76afb8a47b074dff029d7ced19b76add',
];
for(let i=0;i<accepted.length;i++) assert.equal(sha(`${migrationDir}/${expected[i]}`),accepted[i],`${expected[i]} unchanged`);

const phase6Readme=fs.readFileSync('supabase/phase6/README.md','utf8');
assert.match(phase6Readme,/historical frontend snapshot of 128 files/i);
assert.match(phase6Readme,/f7299751ed2a80e9cfa82d5d46dea521637879f0394ede7514906e6add97bf99/);

const sql=fs.readFileSync(`${migrationDir}/${expected[5]}`,'utf8').replace(/\r\n/g,'\n');
const compact=sql.replace(/--.*$/gm,'').replace(/\s+/g,' ').toLowerCase();
assert.match(compact,/\bbegin;[\s\S]*\bcommit;\s*$/);
assert.doesNotMatch(compact,/auth\.jwt\s*\(|grant all|grant execute on all functions|grant .* on all tables/);
assert.doesNotMatch(compact,/\bsecurity definer\b|create role|alter role|owner to/);
assert.doesNotMatch(compact,/\bcurrent_user_role\s*\(|\bcan_manage_all_projects\s*\(/);

const business=['project_payments','finance_transactions','finance_budgets'];
const payroll=['employee_compensation','employee_ledger'];
const scope=[...business,...payroll];
for(const table of scope){
  assert.match(compact,new RegExp(`alter table public\\.${table} enable row level security`));
  const policies=[...compact.matchAll(new RegExp(`create policy [^;]+ on public\\.${table} [^;]+;`,'g'))].map((m)=>m[0]);
  assert.ok(policies.length>0,`${table} has policies`);
  for(const policy of policies) assert.doesNotMatch(policy,/\btrue\b|auth\.jwt\s*\(/,`${table} policy is normalized`);
}
assert.match(compact,/revoke all on public\.project_payments,public\.finance_transactions,public\.finance_budgets, public\.employee_compensation,public\.employee_ledger from public,anon,authenticated/);
for(const table of business){
  const policies=[...compact.matchAll(new RegExp(`create policy [^;]+ on public\\.${table} [^;]+;`,'g'))].map((m)=>m[0]).join(' ');
  assert.match(policies,/phase6_app_actor_class\(\) in \('admin','project_manager'\)/,`${table} Admin/PM access`);
  assert.doesNotMatch(policies,/'employee'|'client'/,`${table} excludes Employee/Client`);
}
for(const table of payroll){
  const policies=[...compact.matchAll(new RegExp(`create policy [^;]+ on public\\.${table} [^;]+;`,'g'))].map((m)=>m[0]).join(' ');
  assert.match(policies,/phase6_app_actor_class\(\)='admin'/,`${table} Admin access`);
  assert.match(policies,/phase6_app_actor_class\(\)='employee' and employee_id=auth\.uid\(\)/,`${table} employee self-read`);
  assert.doesNotMatch(policies,/'project_manager'|'client'/,`${table} excludes PM/Client`);
}
assert.doesNotMatch(compact,/create policy [^;]+ on public\.employee_(?:compensation|ledger) for (?:insert|update|delete)[^;]+'employee'/);
assert.doesNotMatch(compact,/grant update(?:\s*\([^)]*\))? on public\.employee_ledger|create policy [^;]+ on public\.employee_ledger for update/);

const updateGrant=(table)=>compact.match(new RegExp(`grant update \\(([^)]+)\\) on public\\.${table} to authenticated`))?.[1]
  .split(',').map((column)=>column.trim())??[];
const expectedUpdateColumns={
  project_payments:['project_id','total_price','advance_paid','payment_status','updated_by'],
  finance_transactions:['type','category','description','amount','transaction_date','project_id','currency','exchange_rate',
    'amount_pkr','client_name','invoice_id','payment_method','reference_no','vendor','recurring_status','next_recurring_date',
    'notes','attachment_url','is_soft_deleted','updated_by','updated_at'],
  finance_budgets:['category','monthly_budget_pkr','updated_by','updated_at'],
  employee_compensation:['employee_id','monthly_salary','per_project_rate','joining_date','responsibilities','performance_rating','updated_at'],
};
const productionColumns={
  project_payments:['id','project_id','total_price','advance_paid','remaining_balance','payment_status','updated_by','created_at','updated_at'],
  finance_transactions:['id','type','category','description','amount','transaction_date','project_id','created_by','created_at','currency',
    'exchange_rate','amount_pkr','client_name','invoice_id','payment_method','reference_no','vendor','recurring_status',
    'next_recurring_date','notes','attachment_url','is_soft_deleted','updated_by','updated_at'],
  finance_budgets:['category','monthly_budget_pkr','updated_by','updated_at'],
  employee_compensation:['employee_id','monthly_salary','per_project_rate','joining_date','responsibilities','performance_rating','updated_at'],
};
for(const [table,columns] of Object.entries(expectedUpdateColumns)){
  assert.deepEqual(updateGrant(table),columns,`${table} UPDATE grant matches the staging-proven allowlist`);
  for(const column of columns) assert.ok(productionColumns[table].includes(column),`${table}.${column} exists in production-derived schema`);
}

assert.match(compact,/revoke select on public\.team_members from phase6_app_security_owner/);
assert.match(compact,/grant select \(email,full_name,role,phone,status\) on public\.team_members to phase6_app_security_owner/);
assert.doesNotMatch(compact,/grant select on public\.team_members to phase6_app_security_owner/);
assert.doesNotMatch(compact,/create (?:or replace )?view|create materialized view/);

const guards=['phase6_guard_project_payment','phase6_guard_finance_transaction','phase6_guard_finance_budget',
  'phase6_guard_employee_compensation','phase6_stamp_employee_ledger_insert'];
for(const name of guards){
  const block=sql.match(new RegExp(`create or replace function public\\.${name}\\(\\)[\\s\\S]*?\\$fn\\$;`,'i'))?.[0]??'';
  assert.match(block,/security invoker\s+set search_path = pg_catalog, pg_temp/i,`${name} invoker/fixed path`);
  assert.match(sql,new RegExp(`revoke all on function public\\.${name}\\(\\) from public,anon,authenticated;`,'i'),`${name} direct EXECUTE revoked`);
}
assert.match(compact,/phase6_guard_project_payment[\s\S]*new\.project_id is distinct from old\.project_id/);
assert.match(compact,/phase6_guard_finance_transaction[\s\S]*new\.created_by is distinct from old\.created_by/);
assert.match(compact,/new\.project_id is distinct from old\.project_id and public\.phase6_app_actor_class\(\)<>'admin'/);
assert.match(compact,/new\.amount_pkr := round\(new\.amount \* new\.exchange_rate,2\)/);
assert.match(compact,/phase6_guard_finance_budget[\s\S]*new\.category is distinct from old\.category/);
assert.match(compact,/phase6_guard_employee_compensation[\s\S]*new\.employee_id is distinct from old\.employee_id/);
assert.match(compact,/new\.invoiced is distinct from old\.invoiced[\s\S]*phase6_project_invoice_metadata_denied/);
assert.match(compact,/current_user='phase6_workflow_rpc_owner'[\s\S]*return new/);
assert.match(compact,/new\.updated_at := clock_timestamp\(\)/);

assert.match(compact,/phase6_project_payments_admin_delete[\s\S]*phase6_app_actor_class\(\)='admin'/);
assert.match(compact,/phase6_finance_budgets_admin_delete[\s\S]*phase6_app_actor_class\(\)='admin'/);
assert.match(compact,/phase6_finance_transactions_finance_delete[\s\S]*phase6_app_actor_class\(\) in \('admin','project_manager'\)/);

const test='supabase/tests/database/phase6_finance_security.test.sql';
assert.ok(fs.existsSync(test));
const testSql=fs.readFileSync(test,'utf8');
assert.match(testSql,/^begin;/m);
assert.match(testSql,/rollback;\s*$/);
assert.doesNotMatch(testSql,/insert into (?:auth\.users|public\.profiles)/i);
assert.match(testSql,/Admin\/PM business-finance and Admin\/self payroll runtime scenarios/i);
assert.match(testSql,/NO CLIENT BILLING PROJECTION REQUIRED/i);
assert.match(testSql,/PostgreSQL execution required/i);

console.log(JSON.stringify({
  staticChecks:'passed (source assertions, NOT PostgreSQL execution)',
  phase6Migrations:files.length,
  reservedCutover00500:cutoverPresent ? 'authored' : 'absent',
  businessFinanceTables:business.length,
  payrollTables:payroll.length,
  financeSecurityDefiners:0,
  legacyUnsafeFinanceRpcs:0,
  clientBillingProjection:'not required',
  frontendAttestation:'historical 128-file digest preserved; current semantics asserted separately',
},null,2));
