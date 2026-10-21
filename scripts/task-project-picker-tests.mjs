import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { activeTaskProjects, isActiveTaskProject, searchTaskProjects } from '../src/lib/taskProjectOptions.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = (id, status, lifecycle) => ({
  id, project_number: id, project_title: 'Ebook Formatting', client_name: 'Alice Smith',
  status, project_status: lifecycle,
});

const all = [
  project('MH-1', 'In Progress', 'active'),
  project('MH-2', 'Formatting', null),
  project('MH-3', 'Completed', 'completed'),
  project('MH-4', 'On Hold', 'on_hold'),
  project('MH-5', 'Archived', 'archived'),
  project('MH-6', 'Cancelled', 'cancelled'),
  project('MH-7', 'Delivered', null),
  project('MH-8', 'On Hold', null),
  project('MH-9', 'Completed', null),
];
assert.deepEqual(activeTaskProjects(all).map((p) => p.id), ['MH-1', 'MH-2']);
assert.equal(isActiveTaskProject(project('MH-10', 'Completed', 'active')), true, 'canonical lifecycle wins');
assert.deepEqual(searchTaskProjects(activeTaskProjects(all), 'mh-2').map((p) => p.id), ['MH-2']);
assert.deepEqual(searchTaskProjects(activeTaskProjects(all), 'ebook alice').map((p) => p.id), ['MH-1', 'MH-2']);
assert.deepEqual(searchTaskProjects(activeTaskProjects(all), 'not found'), []);

const create = readFileSync(resolve(root, 'src/pages/TasksPage.tsx'), 'utf8');
const edit = readFileSync(resolve(root, 'src/components/tasks/TaskDetailModal.tsx'), 'utf8');
const picker = readFileSync(resolve(root, 'src/components/tasks/ActiveProjectPicker.tsx'), 'utf8');
assert.match(create, /<ActiveProjectPicker[\s\S]*?value=\{draft\.project_id\}/);
assert.match(edit, /<ActiveProjectPicker[\s\S]*?value=\{form\.project_id\}/);
assert.match(picker, /aria-expanded=\{open\}/);
assert.match(picker, /aria-activedescendant/);
assert.match(picker, /legacyLink/);
assert.match(picker, /event\.key === 'Enter'/);
console.log('PASS: Task project selector only offers active projects, searches title/number/client, and preserves historical links.');
