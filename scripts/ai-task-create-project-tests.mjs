import assert from 'node:assert/strict';
import { resolveTaskCreation } from '../src/lib/ai/taskCreationIntent.ts';
import { voiceQueryEngine } from '../src/lib/ai/voiceQueryEngine.ts';
import { execute_create_task } from '../src/lib/ai/safeActionTools.ts';

const mkProfile = (id, full_name, role = 'employee', extra = {}) => ({
  id, full_name, role, email: `${id}@example.test`, status: 'active', ...extra,
});
const mkProject = (id, project_title, project_status = 'active', extra = {}) => ({
  id, project_title, project_status,
  project_number: id, client_name: 'Test Client',
  status: 'In Progress', ...extra,
});
const admin = mkProfile('admin-id', 'Admin Test', 'admin');
const zain = mkProfile('zain-id', 'Zain Ahmad');
const smart = mkProject('p1', 'The End of Smart');
const archived = mkProject('p2', 'The Future of Books', 'archived');
const data = { profiles: [admin, zain], projects: [smart, archived], tasks: [], revisionRequests: [] };
const ctx = { currentProfile: admin, data, visibleProjects: [smart, archived], visibleTasks: [] };
const command = 'Create a task for Zen to update the e-book cover for the project named The Smart, The End of Smart';

const parsed = resolveTaskCreation(command, ctx);
assert.equal(parsed.kind, 'ready', 'spoken instruction produces a complete task');
assert.equal(parsed.title, 'update the e-book cover', 'task title excludes assignee and project');
assert.equal(parsed.assignee.id, zain.id, 'Zen is resolved uniquely to Zain');
assert.equal(parsed.project.id, smart.id, 'spoken title correction selects The End of Smart');

const original = resolveTaskCreation(
  'Create a task for Zain to update the e-book cover for the project named The End of Smart', ctx);
assert.equal(original.kind, 'ready');
assert.equal(original.project.id, smart.id);

const invalidProject = resolveTaskCreation(
  'Create a task for Zain to update cover for the project named Missing Project', ctx);
assert.equal(invalidProject.kind, 'error');
assert.equal(invalidProject.code, 'project_not_found', 'unknown project cannot lead to unlinked task');

const closedProject = resolveTaskCreation(
  'Create a task for Zain to update cover for the project named The Future of Books', ctx);
assert.equal(closedProject.kind, 'error');
assert.equal(closedProject.code, 'project_not_found', 'archived project must not be linked');

// Genuine titles containing commas must be preferred over a shorter title
// that happens to match the final comma-separated fragment.
const commaTitle = mkProject('p-comma', 'The Smart, The End of Smart');
const commaCtx = { ...ctx, visibleProjects: [...ctx.visibleProjects, commaTitle] };
const exactComma = resolveTaskCreation(command, commaCtx);
assert.equal(exactComma.kind, 'ready');
assert.equal(exactComma.project.id, commaTitle.id, 'exact full project title outranks an apparent voice correction');

const multiple = {
  ...ctx,
  data: { ...data, profiles: [...data.profiles, mkProfile('zain-2', 'Zain Raza')] },
};
const ambiguousEmployee = resolveTaskCreation(command, multiple);
assert.equal(ambiguousEmployee.kind, 'clarify');
assert.equal(ambiguousEmployee.field, 'employee');
assert.equal(ambiguousEmployee.options.length, 2, 'identical spoken first names must not be guessed');

const conflictingProjects = {
  ...ctx,
  visibleProjects: [...ctx.visibleProjects, mkProject('p3', 'The End of Smart')],
};
const ambiguousProject = resolveTaskCreation(command, conflictingProjects);
assert.equal(ambiguousProject.kind, 'clarify');
assert.equal(ambiguousProject.field, 'project');
assert.equal(ambiguousProject.options.length, 2);

const excludedEmployee = {
  ...ctx,
  data: { ...data, profiles: [admin, mkProfile('zain-id', 'Zain Ahmad', 'employee', { status: 'inactive' })] },
};
assert.equal(resolveTaskCreation(command, excludedEmployee).kind, 'error', 'inactive employee is never assigned');

const inactive = { ...ctx, currentProfile: mkProfile('emp-current', 'Employee Current') };
const pending = await voiceQueryEngine.detectWriteIntent(command.toLowerCase(), command, ctx);
assert.equal(pending.toolName, 'create_task');
assert.equal(pending.success, true);
assert.ok(pending.pendingAction, 'creation requires confirmation');
assert.equal(pending.pendingAction.payload.assignedToId, zain.id);
assert.equal(pending.pendingAction.payload.projectId, smart.id);
assert.equal(pending.pendingAction.payload.title, 'update the e-book cover');
voiceQueryEngine.clearMemory();
const denied = await voiceQueryEngine.detectWriteIntent(command.toLowerCase(), command, inactive);
assert.equal(denied.error, 'permission_denied', 'employee cannot assign someone else');
voiceQueryEngine.clearMemory();

let createCalls = 0;
const payload = pending.pendingAction.payload;
const mutationCtx = {
  ...ctx,
  trackerMutations: {
    createTask: async (draft) => {
      createCalls++;
      assert.equal(draft.project_id, smart.id);
      assert.equal(draft.assigned_to, zain.id);
      return { id: 'task-created', ...draft };
    },
  },
};
const executed = await execute_create_task(payload, mutationCtx);
assert.equal(executed.success, true);
assert.equal(createCalls, 1);
assert.equal(executed.data.project_id, smart.id);
assert.equal(executed.data.assigned_to, zain.id);

const rejected = await execute_create_task({ ...payload, projectId: archived.id }, mutationCtx);
assert.equal(rejected.success, false);
assert.equal(rejected.error, 'project_not_found');
assert.equal(createCalls, 1, 'inactive project cannot reach mutation');

const mismatch = await execute_create_task(payload, {
  ...ctx,
  trackerMutations: { createTask: async (draft) => ({ id: 'different-id', ...draft, project_id: null }) },
});
assert.equal(mismatch.success, false, 'a task cannot be announced as correctly linked if storage differs');
assert.equal(mismatch.error, 'task_creation_unverified');

const noMutation = await execute_create_task(payload, ctx);
assert.equal(noMutation.success, false);
assert.equal(noMutation.error, 'task_creation_unavailable');

console.log('AI task creation: spoken name, active project, ambiguity, permissions, confirmation, persistence PASS.');
