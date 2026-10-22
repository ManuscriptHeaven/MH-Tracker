import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyTaskAlert, claimRealtimeSound } from '../src/lib/realtimeSoundEvents.ts';

const task = {
  id: 'task-1',
  title: 'Proofread pages',
  created_by: 'admin',
  assigned_to: 'employee',
  status: 'To Do',
  updated_at: '2026-10-22T10:00:00Z',
  archived_at: null,
};
const previous = { ...task };
const moved = { ...task, status: 'In Progress', updated_at: '2026-10-22T10:01:00Z' };

assert.equal(classifyTaskAlert(undefined, task, 'employee', false, false), 'assigned',
  'new task assigned by someone else should chime for the recipient');
assert.equal(classifyTaskAlert(undefined, { ...task, created_by: 'employee' }, 'employee', false, false), null,
  'no chime for a task someone creates for themselves');
assert.equal(classifyTaskAlert(undefined, task, 'unrelated', false, false), null,
  'do not chime for people unrelated to the new task');
assert.equal(classifyTaskAlert(previous, { ...task, assigned_to: 'another' }, 'another', false, false), 'assigned',
  'newly reassigned recipient hears task assignment');
assert.equal(classifyTaskAlert(previous, { ...task, assigned_to: 'another' }, 'employee', false, false), null,
  'old assignee does not hear a new assignment');
assert.equal(classifyTaskAlert(previous, moved, 'employee', false, false), 'status_changed',
  'task assignee hears status changes');
assert.equal(classifyTaskAlert(previous, moved, 'admin', false, false), 'status_changed',
  'task creator hears status changes');
assert.equal(classifyTaskAlert(previous, moved, 'manager', true, false), 'status_changed',
  'manager hears team task status changes');
assert.equal(classifyTaskAlert(previous, moved, 'collaborator', false, true), 'status_changed',
  'collaborator hears relevant task status changes');
assert.equal(classifyTaskAlert(previous, moved, 'unrelated', false, false), null,
  'unrelated team member is not notified');
assert.equal(classifyTaskAlert(previous, moved, 'employee', false, false, true), null,
  'local mutations do not alert their actor');
assert.equal(classifyTaskAlert(previous, { ...moved, archived_at: '2026-10-22' }, 'employee', false, false), null,
  'no alert for archived tasks');
assert.equal(classifyTaskAlert(previous, { ...task, title: 'Updated' }, 'employee', false, false), null,
  'non-status edits are silent');
assert.equal(claimRealtimeSound('employee', 'message:m1'), true);
assert.equal(claimRealtimeSound('employee', 'message:m1'), false,
  'repeat realtime delivery is silent');
assert.equal(claimRealtimeSound('client', 'message:m1'), true,
  'deduplication is scoped to each signed-in user');
assert.equal(claimRealtimeSound('employee', 'message:m2'), true,
  'new incoming message has its own chime');

const tracker = readFileSync('src/lib/useTracker.ts', 'utf8');
const sound = readFileSync('src/lib/sound.ts', 'utf8');
const layout = readFileSync('src/components/Layout.tsx', 'utf8');
assert.ok(
  tracker.includes("newMsg.sender_id !== currentProfile.id") &&
  tracker.includes("claimRealtimeSound(currentProfile.id, 'message:' + newMsg.id)") &&
  tracker.includes('playMessageSound();'),
  'message chime is recipient scoped and deduplicated');
assert.ok(
  tracker.includes("table: 'tasks' }, soundForTaskRow") &&
  tracker.includes("table: 'task_assignees' }, soundForTaskAssignee") &&
  tracker.includes("assignment.profile_id === currentProfile.id") &&
  tracker.includes("assignment.assigned_by !== currentProfile.id") &&
  tracker.includes("assignment.assignment_role !== 'primary'") &&
  tracker.includes('classifyTaskAlert('),
  'task events use realtime with relevant assignee/manager checks');
assert.ok(
  !tracker.includes("notifyWithSoundAndVoice('message'") &&
  !tracker.includes("const senderName = sender?.full_name || 'Team Member';\n              notifyWithSoundAndVoice"),
  'audio side effects are not inside React state updaters');
assert.ok(
  sound.includes("export function playTaskSound") &&
  sound.includes('if (!isSoundEnabled()) return;') &&
  sound.includes("return saved === 'true';") &&
  layout.includes('Message and task notification sounds'),
  'distinct task chimes, mute button and voice-opt-in are wired');
console.log('PASS: realtime message, assignment and status sound regression tests');
