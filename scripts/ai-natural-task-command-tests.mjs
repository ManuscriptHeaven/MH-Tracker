import assert from 'node:assert/strict';
import {
  isCreateTaskRequest, resolveTaskCreation, extractTaskDueDate, parseTaskDate,
  answerTaskClarification, NO_PROJECT, NO_DUE_DATE,
} from '../src/lib/ai/taskCreationIntent.ts';
import { voiceQueryEngine } from '../src/lib/ai/voiceQueryEngine.ts';

// Fixed "today": Sunday 15 November 2026 (local noon).
const NOW = new Date(2026, 10, 15, 12, 0, 0);
const mkProfile = (id, full_name, role = 'employee') => ({ id, full_name, role, email: `${id}@x.test`, status: 'active' });
const mkProject = (id, project_title, extra = {}) => ({
  id, project_title, project_status: 'active', project_number: `MH-${id}`, client_name: 'Client', status: 'In Progress',
  due_date: '2026-12-10', internal_deadline: '2026-12-05', ...extra,
});
const tahir = mkProfile('tahir', 'Tahir Tariq', 'admin');
const zain = mkProfile('zain', 'Zain Ahmad');
const atia = mkProfile('atia', 'Atia Noor', 'manager');
const snowman = mkProject('1101', 'A Snowman Patch');
const smart = mkProject('1039', 'The End of Smart', { internal_deadline: '2026-11-01', due_date: '2026-11-02' });
const money = mkProject('1050', 'Money Tribe');
const data = { profiles: [tahir, zain, atia], projects: [snowman, smart, money], tasks: [], revisionRequests: [] };
const ctx = { currentProfile: tahir, data, visibleProjects: [snowman, smart, money], visibleTasks: [] };
const r = (q, o = {}, c = ctx) => resolveTaskCreation(q, c, o, NOW);

// ---- dates ----
assert.equal(parseTaskDate('tomorrow', NOW), '2026-11-16');
assert.equal(parseTaskDate('kal', NOW), '2026-11-16');
assert.equal(parseTaskDate('friday', NOW), '2026-11-20');
assert.equal(parseTaskDate('20 November', NOW), '2026-11-20');
assert.equal(parseTaskDate('nov 20th', NOW), '2026-11-20');
assert.equal(parseTaskDate('5 january', NOW), '2027-01-05', 'past month rolls to next year');
assert.equal(parseTaskDate('25/11', NOW), '2026-11-25', 'DD/MM');
assert.equal(parseTaskDate('in 3 days', NOW), '2026-11-18');
assert.equal(parseTaskDate('end of week', NOW), '2026-11-20');
assert.equal(parseTaskDate('next week', NOW), '2026-11-23');
assert.equal(parseTaskDate('end of month', NOW), '2026-11-30');
assert.equal(parseTaskDate('31 february', NOW), null);
assert.equal(extractTaskDueDate('work on Monday newsletter layout', NOW).dueDate, undefined, 'title words are not deadlines');

// ---- the exact command from the request ----
const cmd = 'assign a task to Zen to create print version for A Snowman Patch';
assert.equal(isCreateTaskRequest(cmd), true);
let x = r(cmd);
assert.equal(x.kind, 'ready', JSON.stringify(x));
assert.equal(x.title, 'Create print version');
assert.equal(x.assignee.id, 'zain', 'Zen -> Zain');
assert.equal(x.project.id, snowman.id, 'project found without the word "project"');
assert.equal(x.dueDate, '2026-12-05', 'due date defaults to the project internal deadline');
assert.equal(x.dueDateSource, 'project');
assert.equal(x.priority, 'Normal');

// Many natural phrasings, same result.
const variants = [
  'Assign Zen to create the print version of Snowman Patch',
  'assign a task to Zain to create print version for snowman patch by friday',
  'Ask Zain to create print version for A Snowman Patch',
  'Give Zain a task to create print version for Snowman Patch',
  'give a task to Zen to create print version in Snowman Patch',
  'Create a print version task for Zen for A Snowman Patch',
  'Assign the print version task to Zain for Snowman Patch',
  'Have Zen create the print version for A Snowman Patch',
  'Can you please assign a task to Zen to create print version for A Snowman Patch?',
  'Zen ko Snowman Patch ka print version banane ka task do',
  'Zain ko task do ke Snowman Patch ka print version banana',
  'Create a task for Zen to create print version for the project named A Snowman Patch',
  'Assign a task to Zen to create print version for snowmen patch',
];
for (const v of variants) {
  assert.equal(isCreateTaskRequest(v), true, `intent: ${v}`);
  const res = r(v);
  assert.equal(res.kind, 'ready', `${v} -> ${JSON.stringify(res)}`);
  assert.equal(res.assignee.id, 'zain', v);
  assert.equal(res.project?.id, snowman.id, v);
  assert.match(res.title, /^(?:Create )?(?:the )?print version$/i, `${v} -> ${res.title}`);
}

// Date + priority are pulled out of the title.
x = r('Assign a task to Zen to create print version for A Snowman Patch by 20 November, urgent');
assert.equal(x.kind, 'ready'); assert.equal(x.title, 'Create print version');
assert.equal(x.dueDate, '2026-11-20'); assert.equal(x.dueDateSource, 'command'); assert.equal(x.priority, 'Urgent');
x = r('Zen ko Snowman Patch ka print version banane ka task do kal tak');
assert.equal(x.kind, 'ready'); assert.equal(x.dueDate, '2026-11-16'); assert.equal(x.title, 'Create print version');
x = r('assign a task to Zen to fix the cover ASAP for Money Tribe');
assert.equal(x.priority, 'Urgent'); assert.equal(x.dueDate, '2026-11-15', 'asap means due today'); assert.equal(x.title, 'Fix the cover');
x = r('assign me a task to review the proofs for Money Tribe high priority');
assert.equal(x.kind, 'ready'); assert.equal(x.assignee.id, 'tahir'); assert.equal(x.priority, 'High'); assert.equal(x.title, 'Review the proofs');
x = r('Create "Review KDP PDF" for Money Tribe and assign it to Atia due tomorrow');
assert.equal(x.kind, 'ready', JSON.stringify(x)); assert.equal(x.assignee.id, 'atia'); assert.equal(x.title, 'Review KDP PDF'); assert.equal(x.dueDate, '2026-11-16');

// ---- missing info -> questions ----
x = r('assign a task to Zen to create print version');
assert.equal(x.kind, 'clarify'); assert.equal(x.field, 'project');
assert.ok(x.options.some((o) => o.id === NO_PROJECT), 'offers No project');
// On a project page, that project is used.
x = resolveTaskCreation('assign a task to Zen to create print version', { ...ctx, selectedProject: snowman }, {}, NOW);
assert.equal(x.kind, 'ready'); assert.equal(x.project.id, snowman.id); assert.equal(x.projectSource, 'page');
// Project whose deadline already passed -> ask for date.
x = r('assign a task to Zen to create ebook version for The End of Smart');
assert.equal(x.kind, 'clarify'); assert.equal(x.field, 'due_date');
x = r('assign a task to Zen to create ebook version for The End of Smart', { dueDate: '2026-11-18' });
assert.equal(x.kind, 'ready'); assert.equal(x.dueDate, '2026-11-18');
x = r('assign a task to Zen to tidy the shared drive', { projectId: NO_PROJECT });
assert.equal(x.kind, 'clarify'); assert.equal(x.field, 'due_date');
x = r('assign a task to Zen to tidy the shared drive', { projectId: NO_PROJECT, dueDate: NO_DUE_DATE });
assert.equal(x.kind, 'ready'); assert.equal(x.project, undefined); assert.equal(x.dueDate, undefined);
x = r('create a task for Zain to tidy the shared drive by Friday, no project');
assert.equal(x.kind, 'ready'); assert.equal(x.project, undefined); assert.equal(x.title, 'Tidy the shared drive'); assert.equal(x.dueDate, '2026-11-20');
// Unknown person -> asks who.
x = r('assign a task to Bilal to create print version for Snowman Patch');
assert.equal(x.kind, 'clarify'); assert.equal(x.field, 'employee');
// Free-text answers.
assert.deepEqual(answerTaskClarification('due_date', '20 November', ctx, NOW), { dueDate: '2026-11-20' });
assert.deepEqual(answerTaskClarification('due_date', 'no', ctx, NOW), { dueDate: NO_DUE_DATE });
assert.deepEqual(answerTaskClarification('project', 'snowman patch', ctx, NOW), { projectId: snowman.id });
assert.deepEqual(answerTaskClarification('project', 'no project', ctx, NOW), { projectId: NO_PROJECT });

// Read queries stay read-only.
assert.equal(isCreateTaskRequest('What tasks are assigned to Zain?'), false);
assert.equal(isCreateTaskRequest('Show tasks for Snowman Patch'), false);

// ---- full conversation through the engine ----
voiceQueryEngine.clearMemory();
let turn = await voiceQueryEngine.processQuery('assign a task to Zen to create print version', ctx);
assert.equal(turn.toolName, 'create_task'); assert.ok(turn.disambiguation?.length, 'asks which project');
turn = await voiceQueryEngine.processQuery('Snowman Patch', ctx);
assert.equal(turn.pendingAction?.toolName, 'create_task', JSON.stringify(turn.displayText));
assert.equal(turn.pendingAction.payload.projectId, snowman.id);
assert.equal(turn.pendingAction.payload.dueDate, '2026-12-05');
voiceQueryEngine.clearMemory();

turn = await voiceQueryEngine.processQuery('assign a task to Zen to tidy the shared drive', ctx);
assert.ok(turn.disambiguation?.length);
turn = await voiceQueryEngine.processQuery('No project', ctx);
assert.ok(turn.disambiguation?.some((o) => o.type === 'date'), 'then asks for the due date');
turn = await voiceQueryEngine.processQuery('Tomorrow', ctx);
assert.equal(turn.pendingAction?.toolName, 'create_task', turn.displayText);
assert.equal(turn.pendingAction.payload.projectId, undefined);
assert.ok(turn.pendingAction.payload.dueDate);
voiceQueryEngine.clearMemory();

turn = await voiceQueryEngine.processQuery('Assign a task to Zen to create print version for A Snowman Patch by Friday, urgent', ctx);
assert.equal(turn.pendingAction?.payload.priority, 'Urgent');
assert.equal(turn.pendingAction?.payload.title, 'Create print version');
voiceQueryEngine.clearMemory();

console.log('✅ natural-language task command tests passed');
