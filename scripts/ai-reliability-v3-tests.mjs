import assert from 'node:assert/strict';
import { normalizeTaskCreationQuery, isCreateTaskRequest, resolveTaskCreation } from '../src/lib/ai/taskCreationIntent.ts';
import { voiceQueryEngine } from '../src/lib/ai/voiceQueryEngine.ts';
import { execute_create_task } from '../src/lib/ai/safeActionTools.ts';

const profile = (id, full_name, role = 'employee', extra = {}) => ({ id, full_name, role, status: 'active', email: id + '@example.test', ...extra });
const project = (id, title, status = 'active', extra = {}) => ({
  id, project_title: title, project_number: id, client_name: 'Client',
  project_status: status, status: 'In Progress', ...extra,
});
const admin = profile('admin', 'Owner Admin', 'admin');
const zain = profile('zain', 'Zain Ahmad');
const hamza = profile('hamza', 'Hamza Khan');
const smart = project('MH-1039', 'The End  of Smart');
const other = project('MH-1040', 'Evolution Proof');
const archived = project('MH-1041', 'Old Book', 'archived');
const data = { profiles: [admin, zain, hamza], projects: [smart, other, archived], tasks: [], revisionRequests: [] };
const ctx = { data, currentProfile: admin, visibleProjects: data.projects, visibleTasks: [] };

const good = [
  ['Create a task for Zain to update the e-book cover for the project named The End of Smart.', 'update the e-book cover', smart.id],
  ['Task for Zen to update the ebook cover for the project named End of Smart.', 'update the ebook cover', smart.id],
  ['Task Force Zen to create ebook version of the project named End of Smart.', 'create ebook version', smart.id],
  ['Can you please create a task for Zen to update the e-book cover for project named The End of Smart?', 'update the e-book cover', smart.id],
  ['Could you create a task for Zain to prepare the EPUB for project MH-1039', 'prepare the EPUB', smart.id],
  ['We are going to create a task for Zain to revise the e-book for the project named The End of Smart', 'revise the e-book', smart.id],
  ['I want you to create a task for Zain to fix the cover for the project named The End of Smart', 'fix the cover', smart.id],
  ['I would like you to create a task for Zain to check the EPUB for project named End of Smart', 'check the EPUB', smart.id],
  ['Please create a task for Zain to check the EPUB for project named The End of Smart', 'check the EPUB', smart.id],
  ['Kindly add a task for Zain to update illustrations for the project named The End of Smart', 'update illustrations', smart.id],
  ['Assign a task to Zen to update the ebook cover for the project named The End of Smart', 'update the ebook cover', smart.id],
  ['Assign Zen a task to update the ebook cover for the project named The End of Smart', 'update the ebook cover', smart.id],
  ['Create a task for employee named Zain to update the ebook cover for the project named End of Smart', 'update the ebook cover', smart.id],
  ['Task for employee named Zen to update the ebook cover for the project named The End of Smart', 'update the ebook cover', smart.id],
  ['We are going to create a task for employee named Zen for the project named The End of Smart and title of the task is Create ebook', 'Create ebook', smart.id],
  ['create a task for Zain to create ebook version for the project named The End of Smart due tomorrow', 'create ebook version', smart.id],
  ['create a task for Zain to prepare epub due tomorrow for the project named The End of Smart', 'prepare epub', smart.id],
  ['create a task for Zain to proofread due Friday for the project named The End of Smart', 'proofread', smart.id],
  ['create a task for Zain to review the design for the project named The End of Smart due date is next Monday', 'review the design', smart.id],
  ['create a task for Zain to update the cover for the project named The Smart, The End of Smart', 'update the cover', smart.id],
  ['create a task for Zain to update the cover for the project named MH-1039', 'update the cover', smart.id],
  ['create a task for Zain to update the cover', 'update the cover', null],
];
for (const [prompt, title, projectId] of good) {
  assert.equal(isCreateTaskRequest(prompt), true, 'Must recognize: ' + prompt);
  const parsed = resolveTaskCreation(prompt, ctx);
  assert.equal(parsed.kind, 'ready', JSON.stringify({ prompt, parsed }));
  assert.equal(parsed.title, title, 'Correct title: ' + prompt);
  assert.equal(parsed.assignee.id, zain.id, 'Correct assignee: ' + prompt);
  assert.equal(parsed.project?.id || null, projectId, 'Correct project: ' + prompt);
  voiceQueryEngine.clearMemory();
  const result = await voiceQueryEngine.processQuery(prompt, ctx);
  assert.equal(result.toolName, 'create_task', 'Full router must not return Active Tasks: ' + prompt);
  assert.equal(result.pendingAction?.toolName, 'create_task', 'Must confirm, not execute: ' + prompt);
  assert.equal(result.pendingAction?.payload.assignedToId, zain.id);
  assert.equal(result.pendingAction?.payload.projectId || null, projectId);
}
voiceQueryEngine.clearMemory();

// A read question cannot become a write, including speech-to-text's task-force ambiguity.
for (const question of [
  'What tasks are assigned to Zain?',
  'Show all active tasks',
  'Task Force Zen meeting tomorrow',
  'What is task force Zen doing?',
  'How many tasks are overdue?',
]) {
  assert.equal(isCreateTaskRequest(question), false, 'Read question misclassified: ' + question);
}
for (const [prompt, code] of [
  ['create a task for Zen to update cover for the project named Unknown Book', 'project_not_found'],
  ['create a task for Nobody to update cover for the project named The End of Smart', 'employee_not_found'],
  ['create a task for Zain to update cover for project named Old Book', 'project_not_found'],
  ['create a task for Zen to', 'task_details_required'],
]) {
  const result = resolveTaskCreation(prompt, ctx);
  assert.equal(result.kind, 'error');
  assert.equal(result.code, code);
}

const dupEmployee = {...ctx, data: {...data, profiles: [...data.profiles, profile('zain2', 'Zain Raza')] }};
assert.equal(resolveTaskCreation(good[0][0], dupEmployee).kind, 'clarify', 'Two Zains require selection');
const dupProject = {...ctx, visibleProjects: [...ctx.visibleProjects, project('MH-9999', 'The End of Smart')] };
assert.equal(resolveTaskCreation(good[0][0], dupProject).kind, 'clarify', 'Duplicate titles require selection');
const employee = {...ctx, currentProfile: profile('hamza','Hamza Khan')};
voiceQueryEngine.clearMemory();
const forbidden = await voiceQueryEngine.processQuery(good[0][0], employee);
assert.equal(forbidden.error, 'permission_denied', 'Employee cannot assign other staff');
voiceQueryEngine.clearMemory();
const client = {...ctx, currentProfile: profile('client','Client', 'client')};
const forbiddenClient = await voiceQueryEngine.processQuery(good[0][0], client);
assert.equal(forbiddenClient.error, 'permission_denied');

// The presence of "yes" in an unrelated/cancelled sentence must never trigger a write.
voiceQueryEngine.clearMemory();
let writes = 0;
const withMutation = {...ctx, trackerMutations: {createTask: async (draft) => { writes++; return {id:'a1',...draft}; }}};
const requested = await voiceQueryEngine.processQuery(good[0][0], withMutation);
assert.ok(requested.pendingAction);
for (const speech of ['yes, but do not create it', 'okay maybe tomorrow', 'I said yes yesterday', 'no, not yet']) {
  // Only a standalone confirmation is authorization.
  voiceQueryEngine.clearMemory();
  await voiceQueryEngine.processQuery(good[0][0], withMutation);
  await voiceQueryEngine.processQuery(speech, withMutation);
  assert.equal(writes, 0, 'Ambiguous confirmation caused a write: ' + speech);
}

voiceQueryEngine.clearMemory();
const checked = await voiceQueryEngine.processQuery(good[0][0], withMutation);
assert.ok(checked.pendingAction);
const cancelling = await voiceQueryEngine.processQuery('cancel', withMutation);
assert.match(cancelling.displayText, /cancel/i);
assert.equal(writes, 0);
voiceQueryEngine.clearMemory();

// Integration through the actual production mutation adapter contract, with a
// disposable in-memory store (no real customers, credentials or side effects).
let stored = null;
const mutationCtx = {...ctx, trackerMutations:{createTask: async draft => (stored = {id:'task-1', ...draft})}};
const task = resolveTaskCreation(good[0][0], mutationCtx);
const created = await execute_create_task({
  title:task.title, assignedToId:task.assignee.id, projectId:task.project.id, priority:'Normal',
}, mutationCtx);
assert.equal(created.success,true);
assert.equal(stored.assigned_to,zain.id);
assert.equal(stored.project_id,smart.id);
const mismatched = await execute_create_task({
 title:task.title, assignedToId:task.assignee.id, projectId:task.project.id,
}, {...ctx, trackerMutations:{createTask:async draft=>({id:'mismatch',...draft,project_id:null})}});
assert.equal(mismatched.success,false,'Mismatched task writes must not be called verified');
assert.equal(mismatched.error,'task_creation_unverified');
const noWrite = await execute_create_task({title:task.title,assignedToId:zain.id,projectId:smart.id},ctx);
assert.equal(noWrite.success,false,'Missing mutation adapter must not claim success');

console.log('AI Reliability V3: ' + good.length + ' full-router writes, confirmation safety, permissions and persistence checks passed.');