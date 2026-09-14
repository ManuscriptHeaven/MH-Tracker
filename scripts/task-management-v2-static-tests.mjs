import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migration = readFileSync(resolve(root, 'supabase/phase6/migrations/00600_task_management_v2.sql'), 'utf8');
const advisorFix = readFileSync(resolve(root, 'supabase/phase6/migrations/00610_task_management_v2_advisor_fixes.sql'), 'utf8');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const types = readFileSync(resolve(root, 'src/lib/types.ts'), 'utf8');
const tracker = readFileSync(resolve(root, 'src/lib/useTracker.ts'), 'utf8');
const tasksPage = readFileSync(resolve(root, 'src/pages/TasksPage.tsx'), 'utf8');

const checks = [
  ['Task V2 migration bytes match the staging-applied review artifacts', sha256(migration) === '051f3e4143f1a027bc38cfd6f6a74bbe7063e4a0a3db2a778a81e0ed617b6f98' && sha256(advisorFix) === '681aaba07d3c4d9ae069e3020812db8bb2d9cffed8a2ec99e2662191c402265e'],
  ['all additive task columns exist', ['start_date', 'parent_task_id', 'estimated_minutes', 'actual_minutes', 'blocked_reason', 'sort_order', 'task_type', 'visibility', 'archived_at'].every((value) => migration.includes(`add column if not exists ${value}`))],
  ['Blocked status is supported without an enum conversion', migration.includes("'Blocked'") && !migration.includes('create type task_status')],
  ['legacy assigned_to remains and is backfilled', migration.includes('t.assigned_to') && migration.includes("'primary'") && migration.includes('on conflict (task_id,profile_id)')],
  ['primary backfill reconciles inconsistencies before unique enforcement', migration.indexOf("set assignment_role='collaborator'") < migration.indexOf('create unique index if not exists task_assignees_one_primary_idx')],
  ['all V2 tables enable RLS', ['task_assignees', 'task_comments', 'task_checklist_items', 'task_dependencies'].every((table) => migration.includes(`alter table public.${table} enable row level security`))],
  ['all V2 tables authorize through task access', ['task_v2_assignees_select', 'task_v2_comments_select', 'task_v2_checklist_select', 'task_v2_dependencies_select'].every((policy) => migration.includes(`create policy ${policy}`)) && migration.includes('public.phase6_can_access_task(task_id)')],
  ['clients are excluded by the established actor classes', migration.includes("public.phase6_app_actor_class()='employee'") && migration.includes("public.phase6_app_actor_class() in ('admin','project_manager')")],
  ['dependency self and direct-cycle guards exist', migration.includes('check (task_id <> depends_on_task_id)') && migration.includes('task_dependency_direct_cycle')],
  ['parent and child projects are enforced by a non-RPC integrity trigger', migration.includes('task_v2_guard_parent_project') && migration.includes('task_parent_project_mismatch') && migration.includes('task_child_project_mismatch')],
  ['checklist completion metadata is trigger-controlled', migration.includes('task_v2_set_checklist_completion') && migration.includes('new.completed_by := auth.uid()')],
  ['comments reject blank text', migration.includes("check (btrim(comment) <> '')")],
  ['task activity reuses activity_logs', migration.includes('alter table public.activity_logs add column if not exists task_id') && !migration.includes('create table if not exists public.task_activity')],
  ['primary sync events are de-duplicated and comment bodies stay out of activity values', migration.includes("new.assignment_role='primary'") && !migration.includes('left(new.comment,500)')],
  ['staging advisor findings are corrected append-only', ['task_assignees_assigned_by_idx', 'task_comments_user_id_idx', 'task_checklist_items_completed_by_idx', '(select auth.uid())'].every((value) => advisorFix.includes(value))],
  ['TypeScript V2 models exist', ['TaskAssignee', 'TaskComment', 'TaskChecklistItem', 'TaskDependency'].every((name) => types.includes(`interface ${name}`))],
  ['data access exposes all required mutations', ['archiveTask', 'assignTaskCollaborator', 'removeTaskCollaborator', 'addTaskComment', 'updateTaskComment', 'deleteTaskComment', 'addTaskChecklistItem', 'toggleTaskChecklistItem', 'addTaskDependency', 'removeTaskDependency', 'createSubtask'].every((name) => tracker.includes(name))],
  ['task UI includes V2 sections and filters', ['Collaborators', 'Comments', 'Checklist', 'Subtasks', 'Blocked', 'Due Today', 'All Priorities'].every((label) => tasksPage.includes(label) || readFileSync(resolve(root, 'src/components/tasks/TaskDetailModal.tsx'), 'utf8').includes(label))],
];

let failures = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'}: ${name}`);
  if (!passed) failures += 1;
}
if (failures) throw new Error(`${failures} Task Management V2 static check(s) failed.`);
console.log(`Task Management V2 static checks passed (${checks.length}/${checks.length}).`);
