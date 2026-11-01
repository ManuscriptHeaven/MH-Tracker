import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildOperationsSnapshot } from '../src/lib/operationsInsights.ts';

const nowMs = Date.parse('2026-10-24T10:00:00Z');
const today = '2026-10-24';
const profile = (id, overrides = {}) => ({
  id, full_name: id, role: 'employee', status: 'active',
  employment_condition: 'active', ...overrides,
});
const project = (id, status = 'In Progress') => ({ id, status });
const task = (id, overrides = {}) => ({
  id, title: id, project_id: 'p1', assigned_to: 'zain', status: 'To Do',
  priority: 'Normal', due_date: '2026-10-28', archived_at: null,
  visibility: 'team', estimated_minutes: null, ...overrides,
});

const projects = [project('p1'), project('finished', 'Completed')];
const profiles = [
  profile('zain'),
  profile('hamza', { employment_condition: 'leave', condition_start_date: '2026-10-23', condition_end_date: '2026-10-25' }),
  profile('tahir', { role: 'admin' }),
  profile('old', { status: 'inactive' }),
  profile('client', { role: 'client' }),
];
const tasks = [
  task('print', { status: 'In Progress', due_date: today, estimated_minutes: 180 }),
  task('blocker', { status: 'Blocked', due_date: '2026-10-22' }),
  task('epub', { assigned_to: 'hamza', estimated_minutes: 60 }),
  task('assign', { assigned_to: null, priority: 'Urgent' }),
  task('done', { status: 'Done' }),
  task('archived', { archived_at: '2026-10-23T10:00:00Z' }),
  task('personal', { visibility: 'private' }),
  task('finished-project', { project_id: 'finished' }),
];
const sessions = [
  { id: 's1', user_id: 'zain', status: 'active', clock_out: null, last_app_heartbeat_at: '2026-10-24T09:59:30Z' },
];
const args = {
  projects, profiles, tasks, attendanceSessions: sessions,
  attendanceBreaks: [], today, nowMs,
};
const result = buildOperationsSnapshot(args);

assert.deepEqual(result.openTasks.map((item) => item.id), ['print', 'blocker', 'epub', 'assign'], 'only open non-private tasks from active projects appear');
assert.equal(result.inProgressCount, 1);
assert.equal(result.blockedCount, 1);
assert.equal(result.unassignedCount, 1);
assert.equal(result.attentionTasks[0].id, 'blocker', 'blocked work takes priority over unassigned work');
assert.equal(result.attentionTasks[1].id, 'assign', 'unassigned work remains in the action queue');
assert.equal(result.projectTaskCounts.p1.open, 4);
assert.equal(result.projectTaskCounts.finished, undefined, 'completed projects do not inflate workload');
assert.ok(result.recentTasks.every((item) => !['archived','personal','finished-project'].includes(item.id)),
  'recent tasks respect archived, private and completed-project boundaries');

const freshNormal = task('new-ordinary-task', {
  status: 'To Do', priority: 'Normal', due_date: '2026-12-31',
  created_at: '2026-10-30T08:00:00Z',
});
const olderAlert = task('old-urgent-task', {
  priority: 'Urgent', due_date: '2026-10-20',
  created_at: '2026-10-12T08:00:00Z',
});
const privateFresh = task('hidden-personal', {
  visibility: 'private', created_at: '2026-10-30T09:00:00Z',
});
const recentSnapshot = buildOperationsSnapshot({
  ...args,
  tasks: [olderAlert, freshNormal, privateFresh],
});
assert.equal(recentSnapshot.recentTasks[0].id, 'new-ordinary-task',
  'new ordinary task is the first recent entry even when not urgent');
assert.equal(recentSnapshot.attentionTasks[0].id, 'old-urgent-task',
  'urgent list remains separate from recent list');
assert.ok(recentSnapshot.openTasks.some((item) => item.id === 'new-ordinary-task'),
  'new ordinary task is counted in workload');
assert.ok(!recentSnapshot.recentTasks.some((item) => item.id === 'hidden-personal'),
  'private tasks must not leak into recent team view');

const zain = result.members.find((member) => member.profile.id === 'zain');
const hamza = result.members.find((member) => member.profile.id === 'hamza');
assert.ok(zain && hamza);
assert.equal(zain.presence, 'On Duty');
assert.equal(zain.openCount, 2);
assert.equal(zain.estimatedMinutes, 180);
assert.equal(zain.unestimatedCount, 1, 'unknown estimates are explicitly counted');
assert.equal(zain.focusTask.id, 'print');
assert.equal(hamza.presence, 'On Leave', 'leave is not mislabeled as free or off duty');
assert.ok(!result.members.some((member) => member.profile.id === 'old' || member.profile.id === 'client'));

const breakResult = buildOperationsSnapshot({
  ...args,
  attendanceBreaks: [{ id: 'b1', session_id: 's1', user_id: 'zain', ended_at: null }],
});
assert.equal(breakResult.members.find((member) => member.profile.id === 'zain').presence, 'On Break');
const staleResult = buildOperationsSnapshot({ ...args, nowMs: nowMs + 180000 });
assert.equal(staleResult.members.find((member) => member.profile.id === 'zain').presence, 'Not Tracking');

const dashboard = fs.readFileSync('src/pages/DashboardPage.tsx', 'utf8');
const overview = fs.readFileSync('src/components/OperationsOverview.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const tasksPage = fs.readFileSync('src/pages/TasksPage.tsx', 'utf8');
assert.ok(dashboard.includes("useState<'projects' | 'operations'>('projects')"), 'projects view is the default');
assert.ok(dashboard.includes('role="group" aria-label="Dashboard views"'), 'there is a labelled switch for dashboards');
assert.ok(dashboard.includes("aria-pressed={dashboardView === 'projects'}") &&
  dashboard.includes("aria-pressed={dashboardView === 'operations'}"), 'view switch exposes active selection');
assert.ok(dashboard.includes("{dashboardView === 'projects' || !canManageProjects ? (") &&
  dashboard.includes('<OperationsOverview'), 'operations occupy a mutually exclusive full-width view');
assert.ok(dashboard.includes('operationsSnapshot.attentionTasks.length') &&
  dashboard.includes('setDashboardView(\'operations\')'), 'projects view links to team task alerts');
assert.ok(dashboard.includes('setQuickFilter(\'overdue\'); setDashboardView(\'projects\')'), 'operations links to overdue projects');
assert.ok(dashboard.includes('bg-[#fffdf9]') && dashboard.includes('bg-[#f4f7fc]'), 'projects and operations are visually distinct');
assert.ok(!dashboard.includes('xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.7fr)]'), 'projects are not squeezed beside a competing operations rail');
assert.ok(overview.includes('Tasks Requiring Action') && overview.includes('Team Workload'), 'both work views are visible');
assert.ok(overview.includes('Recent Team Tasks') && overview.includes('recentTasks.map'),
  'Operations has a visible list of recent tasks independent of urgency');
assert.ok(overview.includes('Open Tasks') && overview.includes('snapshot.openTasks.length'),
  'Operations shows all open tasks not only the in-progress subset');
assert.ok(app.includes('onAssignTask={() => navigateToTeamTasks({ create: true })}'), 'assign task links to existing workflow');
assert.ok(app.includes('initialTaskId={dashboardTaskIntent?.taskId}'), 'priority tasks deep-link to task detail');
assert.ok(tasksPage.includes('initialEmployeeId'), 'team member links filter the task workspace');
assert.ok(!overview.includes('Math.min(Math.max(active, 1) * 16'), 'project-count fake utilization bar is removed');
console.log('Operations overview workload and navigation tests passed.');
