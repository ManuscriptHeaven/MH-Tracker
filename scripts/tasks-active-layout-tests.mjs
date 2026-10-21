import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isOpenTask, isTaskOverdue, matchesTaskQuickFilter, compareTaskAttention, compareTaskCompletion } from '../src/lib/taskView.ts';

const today = '2026-10-21';
const make = (id, status, due_date, priority = 'Normal', archived_at = null) => ({
  id, title: id, status, due_date, priority, archived_at,
  project_id: null, assigned_to: 'person-a',
  created_at: '2026-10-01T00:00:00Z',
});
const progress = make('progress', 'In Progress', '2026-10-22');
const overdue = make('overdue', 'To Do', '2026-10-20', 'Urgent');
const blocked = make('blocked', 'Blocked', null);
const todo = make('todo', 'To Do', '2026-10-25');
const done = make('done', 'Done', '2026-10-20');
const archived = make('archived', 'In Progress', '2026-10-20', 'Normal', today);

assert.equal(isOpenTask(progress), true);
assert.equal(isOpenTask(blocked), true, 'blocked tasks remain active and visible');
assert.equal(isOpenTask(done), false);
assert.equal(isOpenTask(archived), false);
assert.equal(isTaskOverdue(overdue, today), true);
assert.equal(isTaskOverdue(done, today), false);
const tasks = [done, todo, progress, overdue, blocked, archived];
assert.deepEqual(tasks.filter(t => matchesTaskQuickFilter(t, 'active', false, today)).map(t=>t.id), ['todo','progress','overdue','blocked']);
assert.deepEqual(tasks.filter(t => matchesTaskQuickFilter(t, 'in_progress', false, today)).map(t=>t.id), ['progress']);
assert.deepEqual(tasks.filter(t => matchesTaskQuickFilter(t, 'mine', true, today)).map(t=>t.id), ['todo','progress','overdue','blocked']);
assert.deepEqual(tasks.filter(t => matchesTaskQuickFilter(t, 'mine', false, today)), []);
assert.deepEqual(tasks.filter(t => matchesTaskQuickFilter(t, 'done', false, today)).map(t=>t.id), ['done']);
assert.deepEqual(tasks.filter(t => matchesTaskQuickFilter(t, 'all', false, today)).map(t=>t.id), ['done','todo','progress','overdue','blocked']);
assert.deepEqual([done, todo, overdue, progress, blocked].sort((a,b)=>compareTaskAttention(a,b,today)).map(t=>t.id),
  ['progress','blocked','overdue','todo','done']);
assert.equal(compareTaskCompletion(done, progress), 1);
const page = readFileSync('src/pages/TasksPage.tsx','utf8');
assert.match(page, /useState<TaskQuickFilter>\('active'\)/);
assert.match(page, /matchesTaskQuickFilter\(/);
assert.match(page, /compareTaskAttention\(/);
assert.match(page, /compareTaskCompletion\(/);
assert.match(page, /Active Tasks/);
assert.match(page, /aria-label=\{`Change status of/);
assert.match(page, /line-clamp-1/);
assert.match(page, /setListError\(/);
console.log('Task workspace default active filter, attention sort, compact cards, history and status updates passed.');
