import assert from 'node:assert/strict';
import {
  assistantState,
  dashboardCommands,
  groupConversations,
} from '../src/lib/ai/dashboardV2.ts';
import { confirmationIntent, reviseTaskPreview } from '../src/lib/ai/aiPreviewRevision.ts';
import { voiceQueryEngine } from '../src/lib/ai/voiceQueryEngine.ts';
import { voiceService } from '../src/lib/ai/voiceService.ts';
import { sampleData, sampleProfiles } from '../src/lib/sampleData.ts';

let checks = 0;
function check(name, run) {
  run();
  checks += 1;
  console.log(`PASS ${name}`);
}
const profile = sampleProfiles.find((item) => item.role === 'admin');
const employee = sampleProfiles.find((item) => item.role === 'employee');
const ctx = {
  currentProfile: profile,
  data: sampleData,
  visibleProjects: sampleData.projects,
  visibleTasks: sampleData.tasks,
  displayCurrency: 'USD',
  exchangeRate: 277,
  formatMoney: (value) => `$${value}`,
  convertMoney: (value) => value,
  trackerMutations: {},
};
const idle = {
  isListening: false,
  isSpeaking: false,
  isProcessing: false,
  voiceError: null,
  hasPendingAction: false,
};
check('all six assistant states and processing precedence', () => {
  assert.equal(assistantState(idle), 'Ready');
  assert.equal(assistantState({ ...idle, isListening: true }), 'Listening');
  assert.equal(assistantState({ ...idle, isProcessing: true, hasPendingAction: true }), 'Thinking');
  assert.equal(assistantState({ ...idle, isSpeaking: true }), 'Speaking');
  assert.equal(assistantState({ ...idle, hasPendingAction: true }), 'Awaiting Confirmation');
  assert.equal(assistantState({ ...idle, voiceError: 'Denied' }), 'Error');
});
check('restricted commands follow existing role boundaries', () => {
  const admin = dashboardCommands(profile, []);
  for (const role of ['manager', 'project_manager', 'employee', 'client']) {
    const commands = dashboardCommands({ ...profile, role }, []);
    assert.ok(!commands.some((item) => ['receivables', 'finance', 'payroll'].includes(item.id)));
    if (role === 'client')
      assert.ok(!commands.some((item) => item.group === 'Operations' || item.id === 'workload'));
  }
  assert.ok(admin.some((item) => item.id === 'task' && item.query === 'Create a task'));
  assert.ok(!admin.some((item) => item.query.includes('Zain')));
});
check('history searches, orders, and groups across a month boundary', () => {
  const groups = groupConversations(
    [
      { id: 'earlier', title: 'Invoice', updatedAt: '2026-09-29T12:00:00' },
      { id: 'yesterday', title: 'Invoice draft', updatedAt: '2026-09-30T23:30:00' },
      { id: 'today', title: 'Invoice review', updatedAt: '2026-10-01T00:30:00' },
      { id: 'unrelated', title: 'Tasks', updatedAt: '2026-10-01T01:00:00' },
    ],
    'invoice',
    new Date('2026-10-01T10:00:00'),
  );
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(groups).map(([key, items]) => [key, items.map((item) => item.id)]),
    ),
    { Today: ['today'], Yesterday: ['yesterday'], Earlier: ['earlier'] },
  );
});
check('corrections and questions containing confirmation words never confirm', () => {
  for (const value of ['yes please', 'Confirm.', 'go ahead'])
    assert.equal(confirmationIntent(value), 'confirm');
  for (const value of ['no', 'cancel', 'never mind!'])
    assert.equal(confirmationIntent(value), 'cancel');
  for (const value of [
    'Do not confirm',
    'yes but change the date',
    'is it okay to edit?',
    'Change title to Yes We Can',
    'no, confirm it',
  ])
    assert.equal(confirmationIntent(value), null);
});

voiceQueryEngine.clearMemory();
const incomplete = await voiceQueryEngine.processQuery('Create a task', ctx);
check('quick command requests missing details without creating work', () => {
  assert.equal(incomplete.error, 'task_details_required');
  assert.equal(incomplete.pendingAction, undefined);
});
const prepared = await voiceQueryEngine.processQuery('Check the revised dashboard', ctx);
check('short follow-up completes the command into a preview', () => {
  assert.equal(prepared.pendingAction?.toolName, 'create_task');
});
const original = prepared.pendingAction;
const revised = reviseTaskPreview(`Change assignee to ${employee.full_name}`, original, ctx);
check('draft edits create a new preview and preserve the original payload', () => {
  assert.ok(revised.pendingAction);
  assert.notEqual(revised.pendingAction.actionId, original.actionId);
  assert.equal(revised.pendingAction.payload.assignedToId, employee.id);
  assert.equal(original.payload.assignedToId, profile.id);
});
check('invalid draft edits keep the original confirmation visible', () => {
  const bad = reviseTaskPreview('Change assignee to Nobody Here', original, ctx);
  assert.equal(bad.success, false);
  assert.deepEqual(bad.pendingAction.payload, original.payload);
  assert.notEqual(bad.pendingAction.actionId, original.actionId);
  assert.equal(reviseTaskPreview('Change due date to 2026-02-31', original, ctx).success, false);
});
let writes = 0;
const liveCtx = {
  ...ctx,
  trackerMutations: {
    createTask: async (draft) => {
      writes += 1;
      return { id: 'test-task', ...draft };
    },
  },
};
voiceQueryEngine.setPendingAction(original);
const cancelled = await voiceQueryEngine.processQuery('cancel', liveCtx);
check('cancelling clears the engine draft and performs zero writes', () => {
  assert.match(cancelled.displayText, /cancelled/i);
  assert.equal(writes, 0);
  assert.equal(voiceQueryEngine.getMemory().pendingAction, null);
});
voiceQueryEngine.setPendingAction(original);
await voiceQueryEngine.processQuery('How many projects are overdue?', liveCtx);
await voiceQueryEngine.processQuery('yes', liveCtx);
check('a superseded preview cannot execute after a new read request', () =>
  assert.equal(writes, 0),
);
voiceQueryEngine.setPendingAction(original);
const editResult = await voiceQueryEngine.processQuery('Change title to Yes We Can', liveCtx);
check('an edit containing Yes revises the draft without writing', () => {
  assert.equal(writes, 0);
  assert.equal(editResult.pendingAction.payload.title, 'Yes We Can');
});
await voiceQueryEngine.processQuery('confirm', liveCtx);
check('only a separate explicit confirmation executes the draft', () => assert.equal(writes, 1));

// A delayed browser permission response must never reopen capture after Stop.
let release;
let started = 0;
let releasedTracks = 0;
let recognition;
class FakeRecognition {
  constructor() {
    recognition = this;
  }
  start() {
    started += 1;
    this.onstart?.();
  }
  abort() {
    this.onend?.();
  }
}
globalThis.window = { SpeechRecognition: FakeRecognition };
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    mediaDevices: {
      getUserMedia: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
  },
});
const pendingPermission = voiceService.startListening();
voiceService.stopListening();
release({
  getTracks: () => [
    {
      stop: () => {
        releasedTracks += 1;
      },
    },
  ],
});
await pendingPermission;
check('late microphone permission is cancelled and hardware tracks released', () => {
  assert.equal(started, 0);
  assert.equal(releasedTracks, 1);
});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
});
await voiceService.startListening();
let transcripts = 0;
voiceService.onTranscript = () => {
  transcripts += 1;
};
const oldSession = recognition;
voiceService.stopListening();
oldSession.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'confirm' } }] });
check('transcripts arriving after Stop cannot trigger a hidden command', () => {
  assert.equal(started, 1);
  assert.equal(transcripts, 0);
});
delete globalThis.window;
voiceQueryEngine.clearMemory();
console.log(`${checks} Dashboard V2 behavior checks passed.`);
