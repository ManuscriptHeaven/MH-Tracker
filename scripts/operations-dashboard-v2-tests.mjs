import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildOperationsSnapshot } from '../src/lib/operationsInsights.ts';

const overview = fs.readFileSync('src/components/OperationsOverview.tsx', 'utf8');
const insight = fs.readFileSync('src/lib/operationsInsights.ts', 'utf8');

const panelStart = overview.indexOf('<div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">');
const left = overview.indexOf('Recent Team Tasks', panelStart);
const right = overview.indexOf('Tasks Requiring Action', panelStart);
const workload = overview.indexOf('Team Workload', right);

assert(panelStart >= 0 && left > panelStart && right > left && workload > right,
  'recent tasks on left, actions on right, full-width team workload below');
assert(overview.includes('md:grid-cols-2 xl:grid-cols-3'), 'workload uses responsive multi-column employee cards');
assert(overview.includes('grid grid-cols-2 gap-3 lg:grid-cols-4'), 'KPI layout stacks from mobile through desktop');
assert(overview.includes('aria-pressed={kpiFilter === item.id}') && overview.includes('setKpiFilter('),
  'KPI controls filter tasks and expose pressed state');
for (const label of ['Employee', 'Status', 'Priority', 'Project', 'Due from', 'Due through']) {
  assert(overview.includes(label), 'shared task filter is present: ' + label);
}
assert(overview.includes('snapshot.visibleTasks.filter(') &&
  overview.includes('const recentTasks = useMemo(() => [...filteredTasks]') &&
  overview.includes('snapshot.attentionTasks.filter((task) => filteredIds.has(task.id))'),
  'filters are applied consistently before lists are limited');
assert(overview.includes('onOpenTask(task.id)') && overview.includes('onViewMemberTasks(member.profile.id)') &&
  overview.includes('onAssignTask') && overview.includes('onViewTeamTasks'), 'task and member actions are connected');
assert(overview.includes('member.estimatedMinutes > 0') &&
  overview.includes('member.unestimatedCount') && !overview.includes('width: ') &&
  !overview.includes('capacityPercent'), 'unknown estimates do not become invented utilization percentages');
assert(overview.includes('dark:bg-slate-900') && overview.includes('bg-blue-50') &&
  overview.includes('bg-amber-50') && overview.includes('bg-rose-50'), 'light/dark semantic status accents are in place');
assert(overview.includes('Summary cards remain organization-wide'), 'dashboard does not misrepresent KPI counts as filtered totals');
assert(insight.includes('visibleTasks: dashboardTasks'), 'filters receive authorized and active-project-scoped tasks');
assert(insight.includes("if (task.status === 'Blocked') return 0") &&
  insight.includes("if (task.due_date && task.due_date < today) return 1") &&
  insight.includes("if (!task.assigned_to) return 2"), 'attention sorting respects blocked/overdue/unassigned order');

const task = (id, props = {}) => ({
  id, title: id, project_id: 'active', assigned_to: 'a', visibility: 'team',
  status: 'To Do', priority: 'Normal', due_date: null, archived_at: null, created_at: '2026-11-01T01:00:00Z', ...props,
});
const data = buildOperationsSnapshot({
  today: '2026-11-01',
  nowMs: Date.parse('2026-11-01T15:00:00Z'),
  profiles: [{ id: 'a', role: 'employee', status: 'active', employment_condition: 'active', full_name: 'A' }],
  projects: [{ id: 'active', status: 'In Progress' }, { id: 'archived', status: 'Archived' }],
  tasks: [
    task('overdue', { due_date: '2026-10-30' }),
    task('unassigned', { assigned_to: null }),
    task('blocked', { status: 'Blocked' }),
    task('done', { status: 'Done' }),
    task('hidden', { visibility: 'private' }),
    task('archived-project', { project_id: 'archived' }),
  ],
});
assert.deepEqual(data.attentionTasks.map((item) => item.id), ['blocked', 'overdue', 'unassigned']);
assert.deepEqual(new Set(data.visibleTasks.map((item) => item.id)), new Set(['overdue','unassigned','blocked','done']));
assert.equal(data.openTasks.length, 3, 'done tasks excluded from open count');
console.log('ALL OPERATIONS DASHBOARD V2 TESTS PASSED.');
