import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getRevisionView, parseRevisionTextIntoItems, revisionFileLocation, revisionWorkflowIssue, sendRevisionForReview } from '../src/lib/revisionWorkflow.ts';

const profile = { id: 'staff', role: 'employee' };
const project = { id: 'p', project_status: 'active', workflow_stage_key: 'print_approval', workflow_stage_status_key: 'revision_active', workflow_waiting_on_key: 'team', assigned_to: 'staff' };
const request = { id: 'r', project_id: 'p', canonical_status: 'in_progress', status: 'In Progress', stage_key: 'print_approval', assigned_to: 'staff', revision_round: 1 };
const view = (r = request, p = project, requests = [r], user = profile, manager = false) => getRevisionView(r, p, requests, user, manager);
assert.equal(view().canSend, true);
assert.equal(view().label, 'Changes in progress');
for (const status of ['submitted', 'under_review', 'in_progress', 'changes_requested']) {
  assert.equal(view({ ...request, canonical_status: status }).canEdit, true);
}
for (const stage of ['concept_approval', 'print_approval', 'ebook_approval']) {
  assert.equal(view({ ...request, stage_key: stage }, { ...project, workflow_stage_key: stage }).canSend, true);
}
for (const status of ['ready_for_client_review', 'approved', 'cancelled']) {
  const result = view({ ...request, canonical_status: status });
  assert.equal(result.canSend, false);
  assert.equal(result.canEdit, false);
}
assert.equal(view({ ...request, canonical_status: 'ready_for_client_review', status: 'In Progress' }).state, 'waiting', 'canonical status overrides stale legacy display');
assert.equal(view({ ...request, canonical_status: null }).canSend, false, 'missing canonical mapping cannot silently send');
assert.equal(getRevisionView(request, undefined, [request], profile, false).canSend, false);
assert.equal(view(request, project, [request], { id: 'other', role: 'employee' }).canSend, false);
assert.equal(view(request, project, [request], { id: 'staff', role: 'client' }, true).canSend, false, 'client cannot gain team actions through a UI flag');
assert.equal(view(request, project, [request], { id: 'admin', role: 'admin' }, true).canSend, true);
for (const projectUpdate of [
  { project_status: 'on_hold' }, { project_status: 'cancelled' }, { project_status: 'archived' },
  { project_status: 'completed' }, { workflow_stage_key: 'final_delivery' },
  { workflow_stage_status_key: 'awaiting_client' }, { workflow_waiting_on_key: 'client' },
]) assert.equal(view(request, { ...project, ...projectUpdate }).canSend, false);
const child = { ...request, id: 'child', parent_revision_request_id: 'r', revision_round: 2 };
assert.equal(view(request, project, [request, child]).state, 'history');
assert.equal(view(child, project, [request, child]).canSend, true);
assert.equal(view(request, project, [request, { ...request, id: 'duplicate' }]).canSend, false, 'ambiguous operational leaves must not be guessed');
const unlinkedRounds = [1, 2, 3, 4, 5].map((round) => ({ ...request, id: `round-${round}`, revision_round: round }));
assert.equal(view(unlinkedRounds[4], project, unlinkedRounds).canSend, false, 'QAI-style unlinked older rounds cannot be bypassed by choosing latest');
assert.match(view(unlinkedRounds[4], project, unlinkedRounds).hint, /Several revision rounds/);
assert.ok(revisionWorkflowIssue('p', 'print_approval', [request, { ...child, canonical_status: 'ready_for_client_review', parent_revision_request_id: null }]));
assert.ok(revisionWorkflowIssue('p', 'print_approval', [{ ...request, revision_round: null }]));
assert.ok(revisionWorkflowIssue('p', 'print_approval', [request, { ...child, revision_round: 4 }]));
assert.equal(revisionWorkflowIssue('p', 'print_approval', [request, child]), null);

assert.equal(parseRevisionTextIntoItems('', 'r').items.length, 0);
const numbered = parseRevisionTextIntoItems('Please update:\n1. Fix headings\n2) Check page breaks', 'r');
assert.equal(numbered.preamble, 'Please update:');
assert.deepEqual(numbered.items.map((i) => [i.id, i.instruction]), [['r-parsed-1', 'Fix headings'], ['r-parsed-2', 'Check page breaks']]);
assert.deepEqual(parseRevisionTextIntoItems('- First\n- Second', 'r').items.map((i) => i.id), ['r-bullet-1', 'r-bullet-2']);
assert.equal(parseRevisionTextIntoItems('check pdf in revisions folder', 'r').items[0].id, 'r-single-1', 'existing local checklist cache IDs stay compatible');
assert.equal(parseRevisionTextIntoItems('First\n\nSecond', 'r').items.length, 2);

let calls = 0;
const file = new File(['proof'], 'updated.pdf', { type: 'application/pdf' });
await sendRevisionForReview(true, true, file, '  Changes applied  ', async (observedFile, response) => {
  calls++; assert.equal(observedFile, file); assert.equal(response, 'Changes applied');
});
assert.equal(calls, 1);
await sendRevisionForReview(true, true, file, '  ', async (_file, response) => { calls++; assert.equal(response, undefined); });
for (const inputs of [[false, true, file], [true, false, file], [true, true, null], [true, true, new File([], 'empty.pdf')]]) {
  await assert.rejects(sendRevisionForReview(...inputs, '', async () => { calls++; }));
}
assert.equal(calls, 2, 'unready/unauthorized/empty submissions never call the canonical action');
const failure = new Error('workflow_stale_version');
await assert.rejects(sendRevisionForReview(true, true, file, '', async () => { throw failure; }), (error) => error === failure);
assert.deepEqual(revisionFileLocation('revision-files/client/project/request/proof.pdf'), { path: 'client/project/request/proof.pdf' });
assert.deepEqual(revisionFileLocation('client/project/request/proof.pdf'), { path: 'client/project/request/proof.pdf' });
assert.equal(revisionFileLocation('https://example.test/proof.pdf').url, 'https://example.test/proof.pdf');
for (const url of ['javascript:alert(1)', 'file:///proof', '/private/file', '../file', 'client//file', '']) assert.throws(() => revisionFileLocation(url));

const page = fs.readFileSync('src/pages/RevisionRequestsPage.tsx', 'utf8');
assert.doesNotMatch(page, /handleInternalStatusChange|Approved for Client|Client Delivery Staging Area|deliveryFileUrl/, 'no pretend review controls or unused delivery URL');
assert.match(page, /onUploadRevisedProof\(request\.id, proof, response\)/, 'reply and file go together through the canonical action');
assert.match(page, /busyRef\.current/, 'duplicate clicks are guarded');
assert.match(page, /onChange=\{\(e\) => \{ setFile\(/, 'file selection changes local state only');
console.log('Simplified revision workflow tests passed.');
