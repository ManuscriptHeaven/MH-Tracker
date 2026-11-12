import assert from 'node:assert/strict';
import { voiceQueryEngine as engine } from '../src/lib/ai/voiceQueryEngine.ts';
import {
  externalLanguagePlanningEnabled,
  planNaturalLanguageAction,
} from '../src/lib/ai/aiPlannerService.ts';
import { localDate } from '../src/lib/ai/localLanguage.ts';
import { sampleData, sampleProfiles } from '../src/lib/sampleData.ts';
import { addDays } from '../src/lib/date.ts';

const admin = sampleProfiles.find((p) => p.role === 'admin');
const zain = sampleProfiles.find((p) => p.full_name === 'Zain');
const hamza = sampleProfiles.find((p) => p.full_name === 'Hamza');
const atlas = sampleData.projects[0];
const smart = {
  ...atlas,
  id: 'smart-project',
  project_number: 'MH-1200',
  project_title: 'The End of Smart',
  assigned_to: zain.id,
};
const data = { ...sampleData, projects: [...sampleData.projects, smart] };
let writes = [];
const ctx = {
  currentProfile: admin,
  data,
  visibleProjects: data.projects,
  visibleTasks: data.tasks,
  displayCurrency: 'USD',
  exchangeRate: 277,
  formatMoney: (v) => `$${v}`,
  convertMoney: (v) => v,
  trackerMutations: {
    createTask: async (draft) => {
      writes.push(draft);
      return { id: `task-${writes.length}`, ...draft };
    },
  },
};
const ask = (text) => engine.processQuery(text, ctx);
const reset = () => {
  engine.clearMemory();
  writes = [];
};
let checks = 0;
async function check(name, run) {
  reset();
  await run();
  checks++;
  console.log(`PASS ${name}`);
}

for (const phrase of [
  'Give Zain the ebook work for End of Smart, due tomorrow',
  'Can you create a task for Zain to prepare ebook for the project named End of Smart by tomorrow?',
  'Task for Zain to prepare ebook for The End of Smart tomorrow',
  'Zain ko End of Smart ka ebook kal tak de do',
  'Have Zain prepare ebook for The End of Smart tomorrow',
  'Ask Zain to prepare ebook for The End of Smart tomorrow',
  'I need Zain to prepare ebook for The End of Smart tomorrow',
  'Task Force Zen to prepare ebook for The End of Smart tomorrow',
])
  await check(`natural task: ${phrase}`, async () => {
    let result = await ask(phrase);
    if (phrase.includes('Task Force Zen')) result = await ask('Zain');
    assert.equal(result.pendingAction?.toolName, 'create_task', result.displayText);
    assert.equal(result.pendingAction.payload.assignedToId, zain.id);
    assert.equal(result.pendingAction.payload.projectId, smart.id);
    assert.equal(result.pendingAction.payload.dueDate, addDays(1));
    assert.equal(result.pendingAction.payload.title.toLowerCase(), 'prepare ebook');
    assert.equal(writes.length, 0);
  });
await check(
  'successive corrections preserve all other fields and save only the final draft',
  async () => {
    let result = await ask('Give Zain the ebook work for End of Smart due tomorrow');
    const initial = result.pendingAction;
    result = await ask('Actually, make it Friday');
    assert.equal(result.pendingAction.payload.dueDate, localDate('Friday'));
    assert.equal(result.pendingAction.payload.projectId, smart.id);
    assert.notEqual(initial.actionId, result.pendingAction.actionId);
    result = await ask('Assign it to Hamza');
    assert.equal(result.pendingAction.payload.assignedToId, hamza.id);
    result = await ask('Yes, but make it urgent');
    assert.equal(result.pendingAction.payload.priority, 'Urgent');
    assert.equal(writes.length, 0);
    result = await ask('Call it Check ebook chapter links');
    assert.equal(result.pendingAction.payload.title, 'Check ebook chapter links');
    result = await ask('Confirm');
    assert.equal(result.success, true);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].assigned_to, hamza.id);
    assert.equal(writes[0].due_date, localDate('Friday'));
    assert.equal(writes[0].project_id, smart.id);
    assert.match(result.displayText, /Created/);
    await ask('Actually make it tomorrow');
    assert.equal(writes.length, 1, 'A correction after saving cannot create a second task');
  },
);
await check('misheard name asks for a selection and retains the full request', async () => {
  let result = await ask('Create a task for Zen to prepare ebook for The End of Smart tomorrow');
  assert.equal(result.pendingAction, undefined);
  assert.ok(result.disambiguation.some((p) => p.id === zain.id));
  result = await ask('Zain');
  assert.equal(result.pendingAction.payload.assignedToId, zain.id);
  assert.equal(result.pendingAction.payload.projectId, smart.id);
  assert.equal(result.pendingAction.payload.dueDate, addDays(1));
});
await check(
  'one missing instruction is collected without a summary or premature write',
  async () => {
    let result = await ask('Create a task for Zain');
    assert.match(result.displayText, /What should Zain do/);
    result = await ask('Check the revised ebook tomorrow');
    assert.equal(result.pendingAction.payload.title, 'Check the revised ebook');
    assert.equal(result.pendingAction.payload.dueDate, addDays(1));
    assert.equal(writes.length, 0);
  },
);
await check('unknown explicit project asks rather than linking the previous project', async () => {
  await ask('How is The Quiet Atlas going?');
  let result = await ask(
    'Create a task for Zain to prepare ebook for the project named Missing Book tomorrow',
  );
  assert.equal(result.pendingAction, undefined);
  assert.match(result.displayText, /Missing Book/);
  result = await ask('no project');
  assert.equal(result.pendingAction.payload.projectId, undefined);
  assert.equal(result.pendingAction.payload.title, 'prepare ebook');
});
await check(
  'invalid dates are clarified and invalid corrections preserve the preview',
  async () => {
    let result = await ask('Create a task for Zain to prepare ebook by 2026-02-31');
    assert.equal(result.pendingAction, undefined);
    assert.match(result.displayText, /date/);
    result = await ask('tomorrow');
    assert.equal(result.pendingAction.payload.dueDate, addDays(1));
    result = await ask('Change due date to 2026-02-31');
    assert.equal(result.success, false);
    assert.equal(result.pendingAction.payload.dueDate, addDays(1));
  },
);
await check(
  'project questions and pronouns answer the requested field from current records',
  async () => {
    let result = await ask('How is The End of Smart going?');
    assert.equal(result.toolName, 'get_project_details');
    assert.match(result.displayText, /The End of Smart/);
    result = await ask('Who has it?');
    assert.match(result.displayText, /Zain/);
    result = await ask('When is it due?');
    assert.match(result.displayText, /due date/);
    result = await ask('What about The Little Star Bakery?');
    assert.match(result.displayText, /The Little Star Bakery/);
    result = await ask('Is it waiting on the client?');
    assert.match(result.displayText, /waiting/i);
    assert.equal(writes.length, 0);
  },
);
await check(
  'ambiguous titles ask which project, and numeric selection retains the question',
  async () => {
    const duplicate = {
      ...smart,
      id: 'other-smart',
      project_number: 'MH-1201',
      assigned_to: hamza.id,
    };
    const ambiguous = { ...ctx, visibleProjects: [...data.projects, duplicate] };
    let result = await engine.processQuery('Who is working on The End of Smart?', ambiguous);
    assert.equal(result.pendingAction, undefined);
    assert.equal(result.disambiguation.length, 2);
    result = await engine.processQuery('2', ambiguous);
    assert.match(result.displayText, /Hamza/);
  },
);
await check(
  'context is cleared on a new conversation and rechecks project visibility',
  async () => {
    await ask('How is The End of Smart going?');
    const restricted = { ...ctx, visibleProjects: [atlas] };
    let result = await engine.processQuery('Who has it?', restricted);
    assert.doesNotMatch(result.displayText, /The End of Smart/);
    reset();
    result = await ask('When is it due?');
    assert.match(result.displayText, /Which project/);
  },
);
await check('clients cannot create internal work or see internal assignments', async () => {
  const client = { ...ctx, currentProfile: { ...admin, role: 'client' }, visibleProjects: [smart] };
  const task = await engine.processQuery(
    'Give Zain the ebook work for The End of Smart tomorrow',
    client,
  );
  assert.equal(task.success, false);
  const owner = await engine.processQuery('Who is working on The End of Smart?', client);
  assert.doesNotMatch(owner.displayText, /Zain/);
});
await check('employees cannot assign a task to somebody else', async () => {
  const result = await engine.processQuery('Create a task for Zain to prepare ebook', {
    ...ctx,
    currentProfile: { ...hamza, role: 'employee' },
  });
  assert.equal(result.success, false);
  assert.equal(result.pendingAction, undefined);
});
await check('external model planning stays disabled even in a browser context', async () => {
  assert.equal(externalLanguagePlanningEnabled(), false);
  globalThis.window = {};
  assert.equal(await planNaturalLanguageAction('Create a task for Zain', ctx), null);
  delete globalThis.window;
});
await check('explicit answers complete a clarification without discarding the task', async () => {
  let result = await ask('Create a task for Nobody Here to prepare ebook tomorrow');
  assert.equal(result.pendingAction, undefined);
  result = await ask('Assign it to Zain');
  assert.equal(result.pendingAction.payload.assignedToId, zain.id);
  assert.equal(result.pendingAction.payload.title, 'prepare ebook');
});
await check('confirmation cannot become a missing task title', async () => {
  await ask('Create a task for Zain to');
  const result = await ask('confirm');
  assert.equal(result.pendingAction, undefined);
  assert.match(result.displayText, /What should Zain do/);
  assert.equal(writes.length, 0);
});
await check(
  'a new independent question cancels an incomplete task instead of completing it',
  async () => {
    await ask('Create a task for Nobody Here to check the ebook');
    const result = await ask('How is The Quiet Atlas going?');
    assert.equal(result.toolName, 'get_project_details');
    await ask('yes');
    assert.equal(writes.length, 0);
  },
);
await check('financial questions and aggregate dates never inherit a project pronoun', async () => {
  await ask('How is The Quiet Atlas going?');
  const finance = await ask("What's our income this month?");
  assert.equal(finance.toolName, 'get_finance_summary');
  const week = await ask("What's due this week?");
  assert.equal(week.toolName, 'get_due_this_week_projects');
});
engine.clearMemory();
await check(
  'spoken narrative and labelled task fields retain the instruction across name and project clarification',
  async () => {
    let result = await ask(
      'We are going to create a task for employee named Zen for the projects the end of summer and title of the task is Create ebook.',
    );
    assert.equal(result.pendingAction, undefined);
    assert.match(result.displayText, /Zain/);
    result = await ask("It's Zen.");
    assert.match(result.displayText, /Zain/);
    result = await ask('yes');
    assert.equal(writes.length, 0, 'Accepting a suggested name never creates a task');
    assert.match(result.displayText, /project/i);
    result = await ask('The End of Smart');
    assert.equal(result.pendingAction.payload.title, 'Create ebook');
    assert.equal(result.pendingAction.payload.assignedToId, zain.id);
    assert.equal(result.pendingAction.payload.projectId, smart.id);
  },
);
for (const phrase of [
  'Ebook Creation task for Zen.',
  'Task ebook Creation.',
  'Task for ebook creation.',
])
  await check(`short spoken task title: ${phrase}`, async () => {
    let result = await ask(phrase);
    assert.equal(result.pendingAction, undefined, 'Ask or resolve the assignee before previewing');
    result = await ask(phrase.includes('Zen') ? 'yes' : 'Zain');
    assert.equal(result.pendingAction.payload.title.toLowerCase(), 'ebook creation');
    assert.equal(result.pendingAction.payload.assignedToId, zain.id);
    assert.equal(writes.length, 0);
  });
await check(
  'a spoken preamble alone opens task details instead of becoming the task title',
  async () => {
    const result = await ask('We are going to create a new task.');
    assert.equal(result.pendingAction, undefined);
    assert.equal(result.error, 'task_details_required');
  },
);
console.log(`${checks} local conversation checks passed.`);
