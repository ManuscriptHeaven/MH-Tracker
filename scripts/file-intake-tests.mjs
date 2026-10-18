import assert from 'node:assert/strict';
import { getTimelineSummary, getTimelineMilestones } from '../src/lib/timeline.ts';
import { canConfirmReceivedFiles, receivedFilesNote } from '../src/lib/clientFileSubmission.ts';

const intake = {
  id: 'intake-test', project_status: 'active', workflow_stage_key: 'files_received',
  workflow_stage_status_key: 'pending', workflow_waiting_on_key: 'client',
  workflow_version: 1, assigned_to: 'assigned', progress_percentage: 25,
};
const summary = getTimelineSummary(intake);
assert.equal(summary.stageLabel, 'Waiting for Files');
assert.equal(summary.officialStage, 'Files Received', 'canonical stage identity is preserved');
assert.equal(summary.progress, 0, 'a stale saved percentage cannot create intake progress');
assert.equal(summary.waitingOn, 'Client');
assert.equal(summary.dueDate, null);
assert.equal(getTimelineMilestones(intake)[0].label, 'Waiting for Files');
for (const source of ['Email', 'WhatsApp']) {
  const production = { ...intake, workflow_stage_key: 'design_concept', workflow_stage_status_key: 'active', workflow_waiting_on_key: 'team' };
  assert.equal(getTimelineSummary(production).progress, 0, `${source} receipt starts at 0%`);
  assert.equal(getTimelineSummary(production).stageLabel, 'Design Concept');
  assert.equal(getTimelineSummary(production).waitingOn, 'Manuscript Heaven');
  assert.match(receivedFilesNote(source), new RegExp(source));
  assert.equal(canConfirmReceivedFiles(production, { id: 'admin', role: 'admin' }), false);
}
const submitted = { ...intake, workflow_stage_key: 'concept_approval', workflow_stage_status_key: 'awaiting_client' };
assert.equal(getTimelineSummary(submitted).progress, 35, 'progress starts when the design concept is submitted');
assert.equal(getTimelineSummary({ ...submitted, workflow_stage_status_key: 'revision_active', workflow_waiting_on_key: 'team' }).progress, 35);
for (const role of ['admin', 'manager', 'project_manager']) assert.equal(canConfirmReceivedFiles(intake, { id: role, role }), true);
assert.equal(canConfirmReceivedFiles(intake, { id: 'assigned', role: 'employee' }), true);
assert.equal(canConfirmReceivedFiles(intake, { id: 'other', role: 'employee' }), false);
assert.equal(canConfirmReceivedFiles(intake, { id: 'assigned', role: 'client' }), false);
for (const project_status of ['on_hold', 'completed', 'cancelled', 'archived']) {
  assert.equal(canConfirmReceivedFiles({ ...intake, project_status }, { id: 'admin', role: 'admin' }), false);
}
assert.equal(canConfirmReceivedFiles({ ...intake, workflow_stage_status_key: 'active' }, { id: 'admin', role: 'admin' }), true);
assert.throws(() => receivedFilesNote('unknown'), /Choose/);
assert.throws(() => receivedFilesNote('Other', '  '), /Describe/);
assert.match(receivedFilesNote('Other', 'Shared Drive'), /Shared Drive/);
console.log('File intake labels, progress, receipt details and team action eligibility passed.');
