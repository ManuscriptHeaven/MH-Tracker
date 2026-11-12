import assert from 'node:assert/strict';
import { voiceQueryEngine } from '../src/lib/ai/voiceQueryEngine.ts';
import { sampleData, sampleProfiles } from '../src/lib/sampleData.ts';

const admin = sampleProfiles.find((profile) => profile.role === 'admin');
const zain = sampleProfiles.find((profile) => profile.full_name.toLowerCase() === 'zain');
assert.ok(zain, 'Test fixture includes Zain');
let writes = [];
const ctx = {
  currentProfile: admin,
  data: sampleData,
  visibleProjects: sampleData.projects,
  visibleTasks: sampleData.tasks,
  displayCurrency: 'USD',
  exchangeRate: 277,
  formatMoney: (value) => `$${value}`,
  convertMoney: (value) => value,
  trackerMutations: {
    createTask: async (draft) => {
      writes.push(draft);
      return { id: `task-${writes.length}`, ...draft };
    },
  },
};
const cases = [
  ['Zain to prepare ebook.'],
  ['Create a task', 'Zain to prepare ebook.'],
  ['Please create a task', 'Zain to prepare ebook.'],
  ['Can you create a task?', 'Zain to prepare ebook.'],
  ['Please create a task for Zain to prepare ebook.'],
  ['Create a task Zain to prepare ebook.'],
  ['Assign a task to Zain to prepare ebook.'],
  ['Create a task for Zain.', 'prepare ebook.'],
];
for (const prompts of cases) {
  voiceQueryEngine.clearMemory();
  writes = [];
  let result;
  for (const prompt of prompts) result = await voiceQueryEngine.processQuery(prompt, ctx);
  assert.equal(result.pendingAction?.toolName, 'create_task', prompts.join(' -> '));
  assert.equal(
    result.pendingAction.payload.assignedToId,
    zain.id,
    'The requested assignee is preserved',
  );
  assert.equal(
    result.pendingAction.payload.title.toLowerCase(),
    'prepare ebook',
    'The task title excludes the assignee',
  );
  assert.equal(writes.length, 0, 'A preview does not create a task');
  const confirmed = await voiceQueryEngine.processQuery('confirm', ctx);
  assert.equal(confirmed.success, true);
  assert.equal(writes.length, 1, 'Confirmation creates exactly one real task');
  assert.equal(writes[0].assigned_to, zain.id);
  assert.equal(writes[0].title.toLowerCase(), 'prepare ebook');
  console.log(`PASS ${prompts.join(' -> ')} -> preview -> confirmed task`);
}
voiceQueryEngine.clearMemory();
const unknown = await voiceQueryEngine.processQuery(
  'Create a task for Nonexistent Person to prepare ebook',
  ctx,
);
assert.equal(
  unknown.pendingAction,
  undefined,
  'An unknown assignee never silently becomes the current user',
);
const summary = await voiceQueryEngine.processQuery('Show my tasks', ctx);
assert.equal(
  summary.toolName,
  'get_tasks_summary',
  'Read-only task requests still return task data',
);
voiceQueryEngine.clearMemory();
const unavailableContext = { ...ctx, trackerMutations: {} };
await voiceQueryEngine.processQuery('Zain to prepare ebook.', unavailableContext);
const unavailable = await voiceQueryEngine.processQuery('confirm', unavailableContext);
assert.equal(
  unavailable.success,
  false,
  'A missing task integration cannot report a successful save',
);
assert.match(unavailable.displayText, /No task was saved/);
console.log('PASS unknown assignee and read-only task boundaries');
voiceQueryEngine.clearMemory();
