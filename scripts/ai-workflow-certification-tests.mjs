import assert from 'node:assert/strict';
import { voiceQueryEngine } from '../src/lib/ai/voiceQueryEngine.ts';
import { verifyTaskCreationSnapshot } from '../src/lib/ai/aiActionVerifier.ts';

// Real query parser + confirmation dispatcher + mutation adapter contract.
// Database-triggered notifications are independently exercised in PostgreSQL CI.
const admin = { id: 'admin', full_name: 'Owner Admin', role: 'admin', email: 'admin@example.test', status: 'active' };
const manager = { id: 'manager', full_name: 'Project Manager', role: 'project_manager', email: 'manager@example.test', status: 'active' };
const zain = { id: 'zain', full_name: 'Zain Ahmad', role: 'employee', email: 'zain@example.test', status: 'active' };
const hamza = { id: 'hamza', full_name: 'Hamza Khan', role: 'employee', email: 'hamza@example.test', status: 'active' };
const client = { id: 'client', full_name: 'Author Client', role: 'client', email: 'client@example.test', status: 'active' };
const project = {
  id: 'project-1', project_title: 'The End of Smart', project_number: 'MH-1039',
  project_status: 'active', status: 'In Progress', client_name: 'Example Client'
};
const data = { profiles: [admin, manager, zain, hamza, client], projects: [project], tasks: [], revisionRequests: [] };
let writes = 0;
const persisted = new Map();
const ctx = {
  currentProfile: admin, data, visibleProjects: [project], visibleTasks: [],
  trackerMutations: {
    createTask: async (draft) => {
      writes++;
      const task = { ...draft, id: 'created-' + writes };
      persisted.set(task.id, task);
      return task;
    }
  }
};

const command = 'Please create a task for Zen to review the EPUB for the project named The End of Smart due tomorrow';
voiceQueryEngine.clearMemory();
const preview = await voiceQueryEngine.processQuery(command, ctx);
assert.equal(preview.success, true);
assert.equal(preview.toolName, 'create_task');
assert.equal(preview.pendingAction?.toolName, 'create_task');
assert.equal(preview.pendingAction?.payload.assignedToId, zain.id);
assert.equal(preview.pendingAction?.payload.projectId, project.id);
assert.equal(writes, 0, 'No database writes before confirmation');

// Presence of "yes" does not count unless the whole utterance approves.
await voiceQueryEngine.processQuery('yes but do not create it', ctx);
assert.equal(writes, 0, 'Ambiguous phrase executed a task');
const confirmed = await voiceQueryEngine.processQuery('confirm', ctx);
assert.equal(writes, 1, 'Confirmed action must execute exactly once');
assert.ok(confirmed.auditLog, 'Confirmation must return an auditable action');
assert.equal(confirmed.toolName, 'create_task');
const row = persisted.get('created-1');
assert.equal(verifyTaskCreationSnapshot(preview.pendingAction, row).status, 'verified');
for (const field of ['title', 'status', 'assigned_to', 'project_id', 'due_date']) {
  const changed = { ...row, [field]: field === 'due_date' ? '1999-01-01' : 'WRONG' };
  assert.equal(verifyTaskCreationSnapshot(preview.pendingAction, changed).status, 'failed', 'Mutation of ' + field + ' must fail DB verification');
}
assert.equal(verifyTaskCreationSnapshot(preview.pendingAction, null).status, 'failed');
await voiceQueryEngine.processQuery('confirm', ctx);
assert.equal(writes, 1, 'Repeated confirmation must not duplicate a task');

voiceQueryEngine.clearMemory();
const cancelledPreview = await voiceQueryEngine.processQuery(command, ctx);
assert.ok(cancelledPreview.pendingAction);
const cancelled = await voiceQueryEngine.processQuery('cancel', ctx);
assert.match(cancelled.displayText, /cancel/i);
assert.equal(writes, 1, 'Cancel must leave mutation count unchanged');

voiceQueryEngine.clearMemory();
const deniedClient = await voiceQueryEngine.processQuery(command, {...ctx, currentProfile: client});
assert.equal(deniedClient.error, 'permission_denied', 'Clients must not assign team tasks');

voiceQueryEngine.clearMemory();
const deniedEmployee = await voiceQueryEngine.processQuery(command, {...ctx, currentProfile: hamza});
assert.equal(deniedEmployee.error, 'permission_denied', 'Employees cannot assign another employee');

voiceQueryEngine.clearMemory();
const managed = await voiceQueryEngine.processQuery(command, {...ctx, currentProfile: manager});
assert.ok(managed.pendingAction, 'Managers may propose task assignments');
assert.equal(writes, 1, 'Manager preview is not a write');

voiceQueryEngine.clearMemory();
const missingProject = await voiceQueryEngine.processQuery('Create a task for Zain to review EPUB for the project named Not a Real Project',ctx);
assert.equal(missingProject.error, 'project_not_found');
assert.equal(writes, 1, 'Unknown project must not create an unlinked task');

voiceQueryEngine.clearMemory();
console.log('AI Workflow Certification: spoken task to preview, cancel/confirm, one mutation, readback and role gates PASS');
