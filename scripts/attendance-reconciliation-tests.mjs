import fs from 'node:fs';

function assert(value, message) {
  if (value) console.log('✓ PASS: ' + message);
  else {
    console.error('✗ FAIL: ' + message);
    process.exitCode = 1;
  }
}

const sql = fs.readFileSync('supabase/migrations/20261021080615_attendance_admin_reconciliation_v2_20261020.sql','utf8');
const tests = fs.readFileSync('scripts/sql/attendance-reconciliation-ci-tests.sql','utf8');
const component = fs.readFileSync('src/components/AttendanceReconciliationAdmin.tsx','utf8');
const app = fs.readFileSync('src/App.tsx','utf8');
const attendancePage = fs.readFileSync('src/pages/AttendancePage.tsx','utf8');
const workflow = fs.readFileSync('.github/workflows/attendance-ledger-integration.yml','utf8');
const ledger = fs.readFileSync('supabase/migrations/20261021080547_attendance_daily_credits_v2_20261019.sql','utf8');
const fixture = fs.readFileSync('scripts/sql/attendance-ledger-ci-fixture.sql','utf8');
const ledgerSqlTests = fs.readFileSync('scripts/sql/attendance-ledger-ci-tests.sql','utf8');

assert(sql.includes('create table if not exists public.attendance_reconciliation_audit') &&
  sql.includes('previous_record jsonb not null') && sql.includes('updated_record jsonb not null') &&
  sql.includes('performed_by uuid not null') && sql.includes('evidence_note text not null'),
  'correction audit preserves full before/after snapshots, actor and evidence');

assert(sql.includes('attendance_reconciliation_admin_read') &&
  sql.includes("phase6_app_actor_class() = 'admin'") &&
  sql.includes('revoke all on public.attendance_reconciliation_audit') &&
  sql.includes('grant select on public.attendance_reconciliation_audit to authenticated'),
  'only admin can read correction records under row-level security');

assert(sql.includes('create trigger attendance_reconciliation_no_mutation') &&
  sql.includes('attendance_audit_is_append_only') &&
  sql.includes('before update or delete'),
  'immutable database trigger rejects rewriting or removing audit events');

assert(sql.includes("coalesce(public.phase6_app_actor_class(), '') <> 'admin'") &&
  sql.includes('p_expected_seconds is distinct from v_before.verified_seconds') &&
  sql.includes("raise exception 'attendance_record_changed_reload'") &&
  sql.includes('p_corrected_seconds < v_dated') &&
  sql.includes('p_corrected_seconds > v_max') &&
  sql.includes('verified_seconds=p_corrected_seconds'),
  'server validates admin role, stale updates, trusted dated credits and clock/break cap');

assert(sql.includes("'verified_seconds_reconciliation'") &&
  sql.includes("'session_window_correction'") &&
  sql.includes('to_jsonb(v_before),to_jsonb(v_after)'),
  'both historical-hour correction and clock-window adjustment create audit entries');

assert(tests.includes('employee_was_allowed_to_reconcile') &&
  tests.includes('manager_was_allowed_to_reconcile') &&
  tests.includes('below_dated_credits_allowed') &&
  tests.includes('above_session_bounds_allowed') &&
  tests.includes('stale_expected_value_allowed') &&
  tests.includes('audit_delete_was_allowed') &&
  tests.includes('reconciliation_modified_dated_credits'),
  'integration suite asserts role denial, evidence caps, concurrency and immutability');

assert(workflow.includes('attendance_admin_reconciliation.sql') &&
  workflow.includes('attendance-reconciliation-ci-tests.sql') &&
  workflow.includes('postgres:17-alpine'),
  'disposable PostgreSQL 17 CI applies and tests audited migration before release');

assert(component.includes("currentProfile.role !== 'admin'") &&
  component.includes("supabase.rpc('attendance_admin_reconcile_session'") &&
  component.includes('p_expected_seconds: originalSeconds') &&
  component.includes('Approve and audit correction') &&
  component.includes('Supporting evidence / reference') &&
  app.includes('<AttendanceReconciliationAdmin') &&
  app.includes('onReconciled={tracker.refreshAttendance}') &&
  attendancePage.includes('editReason.trim().length < 15'),
  'admin-only review UI requests evidence and a human confirmation for corrections');

assert(ledger.includes('as $$') && !ledger.includes('as $\n') &&
  !ledger.includes('\n$;\n'),
  'existing attendance migration contains valid dollar-quoted PostgreSQL RPCs');

assert(fixture.includes('grant select on public.attendance_breaks to authenticated') &&
  fixture.includes('alter table public.attendance_breaks enable row level security') &&
  fixture.includes('create policy attendance_breaks_select'),
  'disposable SQL fixture mirrors production break visibility for employees and managers');

assert(ledger.includes('revoke all privileges on table') &&
  ledger.includes('public.attendance_sessions') &&
  ledger.includes('public.attendance_breaks') &&
  ledger.includes('from public, anon, authenticated') &&
  ledger.includes('grant select on table') &&
  fixture.includes('grant all privileges on table public.attendance_sessions, public.attendance_breaks') &&
  ledgerSqlTests.includes("'TRUNCATE','TRIGGER','REFERENCES'"),
  'migration removes direct high-risk attendance table grants from API roles');
assert(!/do \\$(?!\\$)|end \\$;/.test(ledgerSqlTests) &&
  (ledgerSqlTests.match(/do \\$\\$/g) || []).length === (ledgerSqlTests.match(/end \\$\\$/g) || []).length,
  'PostgreSQL ledger security suite uses correctly paired dollar-quoted DO blocks');

if (process.exitCode) console.error('Attendance reconciliation static certification FAILED.');
else console.log('ALL ATTENDANCE RECONCILIATION STATIC CERTIFICATION CHECKS PASSED.');
