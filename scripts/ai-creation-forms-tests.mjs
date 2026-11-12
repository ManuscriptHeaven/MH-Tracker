import assert from 'node:assert/strict';
import { buildCreationPreview } from '../src/lib/ai/creationForms.ts';
import { VoiceInputRouter } from '../src/lib/ai/voiceInputRouter.ts';
import { voiceQueryEngine } from '../src/lib/ai/voiceQueryEngine.ts';
import { sampleData, sampleProfiles } from '../src/lib/sampleData.ts';
import { dashboardCommands } from '../src/lib/ai/dashboardV2.ts';

const admin = sampleProfiles.find((profile) => profile.role === 'admin');
const zain = sampleProfiles.find((profile) => profile.full_name === 'Zain');
const employee = sampleProfiles.find((profile) => profile.role === 'employee');
const taskWrites = [],
  projectWrites = [];
const ctx = {
  currentProfile: admin,
  data: sampleData,
  visibleProjects: sampleData.projects,
  visibleTasks: sampleData.tasks,
  displayCurrency: 'USD',
  exchangeRate: 1,
  formatMoney: (value) => `$${value}`,
  convertMoney: (value) => value,
  trackerMutations: {
    createTask: async (draft) => {
      taskWrites.push(draft);
      return { ...sampleData.tasks[0], ...draft, id: 'form-task' };
    },
    createProject: async (draft) => {
      projectWrites.push(draft);
      return { ...sampleData.projects[0], ...draft, id: 'form-project' };
    },
  },
};
const taskRequest = {
  kind: 'task',
  draft: {
    title: 'Prepare ebook, for “New Project”',
    description: 'Keep all punctuation. Do not infer names.',
    assignedToId: zain.id,
    projectId: sampleData.projects[0].id,
    dueDate: '2026-12-12',
    priority: 'High',
  },
};
const task = voiceQueryEngine.prepareCreationDraft(taskRequest, ctx);
assert.equal(task.pendingAction.payload.title, taskRequest.draft.title);
assert.equal(task.pendingAction.payload.assignedToId, zain.id);
assert.equal(task.pendingAction.payload.description, taskRequest.draft.description);
assert.equal(taskWrites.length, 0, 'Review must not save a task');
await voiceQueryEngine.processQuery('confirm', ctx);
assert.equal(taskWrites.length, 1);
assert.equal(taskWrites[0].title, taskRequest.draft.title);
assert.equal(taskWrites[0].assigned_to, zain.id);
assert.equal(taskWrites[0].description, taskRequest.draft.description);
console.log(
  'PASS structured task form preserves every entered detail and saves only after confirmation',
);

const projectRequest = {
  kind: 'project',
  draft: {
    projectTitle: 'New Project, For the Reader',
    clientName: sampleData.projects[0].client_name,
    serviceType: 'Print + eBook',
    totalPrice: 300,
    advancePaid: 50,
    startDate: '2026-12-01',
    dueDate: '2026-12-12',
    assignedToId: zain.id,
    priority: 'Normal',
    notes: 'Literal project notes.',
  },
};
voiceQueryEngine.clearMemory();
const project = voiceQueryEngine.prepareCreationDraft(projectRequest, ctx);
assert.equal(project.pendingAction.payload.projectTitle, projectRequest.draft.projectTitle);
assert.equal(project.pendingAction.payload.totalPrice, 300);
assert.equal(project.pendingAction.payload.requiresPrint, true);
assert.equal(project.pendingAction.payload.requiresEbook, true);
assert.equal(projectWrites.length, 0);
await voiceQueryEngine.processQuery('confirm', ctx);
assert.equal(projectWrites.length, 1);
assert.equal(projectWrites[0].project_title, projectRequest.draft.projectTitle);
console.log('PASS structured project form uses canonical project creation after confirmation');

for (const draft of [
  { ...taskRequest.draft, assignedToId: 'unknown' },
  { ...taskRequest.draft, dueDate: '2026-02-31' },
  { ...taskRequest.draft, projectId: 'private-project' },
  { ...taskRequest.draft, title: '' },
])
  assert.equal(buildCreationPreview({ kind: 'task', draft }, ctx).success, false);
assert.equal(
  buildCreationPreview(taskRequest, { ...ctx, currentProfile: { ...admin, role: 'client' } })
    .success,
  false,
);
assert.equal(
  buildCreationPreview(taskRequest, {
    ...ctx,
    currentProfile: { ...employee, id: 'another-employee' },
  }).success,
  false,
);
assert.equal(
  buildCreationPreview(
    { kind: 'project', draft: { ...projectRequest.draft, advancePaid: 500 } },
    ctx,
  ).success,
  false,
);
console.log(
  'PASS form validation rejects unavailable records, invalid dates, missing details, and unauthorized assignments',
);

const router = new VoiceInputRouter();
const fieldValues = [],
  commands = [];
router.beginDictation((text, final) => fieldValues.push({ text, final }));
router.receive('prepare', false, (text) => commands.push(text));
router.receive('confirm', true, (text) => commands.push(text));
assert.deepEqual(fieldValues, [
  { text: 'prepare', final: false },
  { text: 'confirm', final: true },
]);
assert.equal(commands.length, 0, 'Dictated field content must never execute a chat command');
router.receive('new task', true, (text) => commands.push(text));
assert.deepEqual(commands, ['new task']);
console.log('PASS field dictation fills the field without sending or confirming a command');

for (const [phrase, kind] of [
  ['New task', 'task'],
  ['Please new task', 'task'],
  ['New project', 'project'],
]) {
  voiceQueryEngine.clearMemory();
  const result = await voiceQueryEngine.processQuery(phrase, ctx);
  assert.equal(result.data?.creationForm?.kind, kind);
  assert.equal(result.pendingAction, undefined);
}
assert.ok(dashboardCommands(admin, []).some((command) => command.label === 'New Task'));
assert.ok(dashboardCommands(admin, []).some((command) => command.label === 'New Project'));
console.log(
  'PASS New Task and New Project commands request the correct form, including spoken phrases',
);
voiceQueryEngine.clearMemory();
