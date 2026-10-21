import fs from 'node:fs';
import assert from 'node:assert/strict';

const team = fs.readFileSync('src/pages/TeamPage.tsx', 'utf8');
const modal = fs.readFileSync('src/components/TeamStatusModal.tsx', 'utf8');
const tracker = fs.readFileSync('src/lib/useTracker.ts', 'utf8');
const sql = fs.readFileSync('supabase/migrations/20261020090000_employee_lifecycle_status.sql', 'utf8');
const payroll = fs.readFileSync('src/lib/payrollUtils.ts', 'utf8');

assert.ok(team.includes('Manage Status'), 'Each non-admin card must expose Manage Status');
assert.ok(team.includes('Show Former Team Members'), 'Inactive employees must be restorable from directory');
assert.ok(team.includes('last_app_heartbeat_at'), 'Duty status requires a recent app heartbeat');
assert.ok(team.includes("profile.role !== 'admin'"), 'Admin accounts cannot be archived from card');
assert.ok(modal.includes('On Holiday') && modal.includes('On Leave'));
assert.ok(modal.includes('Resigned / Left') && modal.includes('Terminated / Fired'));
assert.ok(modal.includes('reassign') || modal.includes('Reassign'), 'Open work must be reassigned');
assert.ok(modal.includes('confirmed') && modal.includes('Confirm & Archive'), 'Confirmation is mandatory');
assert.ok(tracker.includes("admin_set_team_employment_condition"), 'Status mutation must use authenticated server RPC');
assert.ok(tracker.includes("profile.status === 'inactive'"), 'Inactive user login must be handled');
assert.ok(sql.includes("public.phase6_app_actor_class() is distinct from 'admin'"), 'Status RPC must check admin role');
assert.ok(sql.includes('p_employee_id = auth.uid()'), 'Self-removal must be blocked');
assert.ok(sql.includes('employee_condition_audit'), 'Status changes must be auditable');
assert.ok(sql.includes('Reassign the employee'), 'Server must reject orphaned active work');
assert.ok(sql.includes('grant execute on function public.admin_set_team_employment_condition'), 'RPC granted explicitly');
assert.ok(payroll.includes('afterDepartureBeforeReturn'), 'Archived staff must not accrue recurring salary');
console.log('Employee status static regression checks passed.');
