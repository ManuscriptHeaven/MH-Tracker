import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performStageSubmission, ProofUploadCache, projectFileLocation, privateProjectFileName, validateProofFile, MAX_PROOF_BYTES } from '../src/lib/stageSubmission.ts';

const id = '11111111-1111-4111-8111-111111111111';
const actor = '22222222-2222-4222-8222-222222222222';
const object = '33333333-3333-4333-8333-333333333333';
const privateRef = `storage://project-source-files/${id}/${actor}/${object}-proof.pdf`;
const initial = { id, project_status: 'active', workflow_stage_key: 'design_concept', workflow_stage_status_key: 'active', workflow_version: 7 };
const receipt = { project_snapshot: {}, workflow_version: 8 };
const file = new File(['proof'], 'proof.pdf', { type: 'application/pdf' });
function harness(states = [initial, initial]) {
  const calls = [];
  return { calls, dependencies: {
    readProject: async () => { calls.push('read'); return states.shift() || initial; },
    upload: async () => { calls.push('upload'); return privateRef; },
    saveMetadata: async (patch, state) => { calls.push(['metadata', patch, state.workflow_version]); },
    submit: async (state, note) => { calls.push(['submit', state.workflow_version, note]); return receipt; },
  } };
}
for (const [stage, field] of [['design_concept','cover_file_link'], ['print_version','proof_pdf_link'], ['ebook_version','final_ebook_link'], ['final_delivery','final_print_pdf_link']]) {
  const state = { ...initial, workflow_stage_key: stage };
  const { calls, dependencies } = harness([state, state]);
  assert.equal(await performStageSubmission(stage, '  Review please  ', '', file, dependencies), receipt);
  assert.deepEqual(calls, ['read','upload',['metadata',{ [field]: privateRef, delivery_notes: 'Review please' },7],'read',['submit',7,'Review please']]);
}
{
  const { calls, dependencies } = harness();
  await performStageSubmission('design_concept', '', ' https://example.test/proof.pdf ', undefined, dependencies);
  assert.equal(calls.includes('upload'), false);
  assert.deepEqual(calls[1][1], { cover_file_link: 'https://example.test/proof.pdf' });
}
for (const change of [{project_status:'archived'}, {workflow_stage_status_key:'revision_active'}, {workflow_stage_key:'print_version'}, {workflow_version:undefined}, {workflow_version:Number.MAX_SAFE_INTEGER+1}]) {
  const { calls, dependencies } = harness([{...initial,...change}]);
  await assert.rejects(performStageSubmission('design_concept','', '',file,dependencies));
  assert.deepEqual(calls,['read']);
}
for (const value of ['javascript:alert(1)', 'data:text/html,x', 'https://user:pass@example.test/a', privateRef.replace(id, actor), privateRef + '/../x']) {
  assert.equal(projectFileLocation(value,id),null);
  const { calls, dependencies } = harness();
  await assert.rejects(performStageSubmission('design_concept','',value,undefined,dependencies));
  assert.deepEqual(calls,['read']);
}
assert.equal(privateProjectFileName(privateRef),'proof.pdf');
assert.equal(projectFileLocation(privateRef,id).kind,'private');
assert.equal(validateProofFile({name:'x',size:0}),'The selected file is empty.');
assert.ok(validateProofFile({name:'x',size:MAX_PROOF_BYTES+1}));
assert.equal(validateProofFile({name:'x',size:MAX_PROOF_BYTES}),null);
{
  const { calls, dependencies } = harness();
  await assert.rejects(performStageSubmission('design_concept','','https://example.test/a',file,dependencies), /not both/);
  assert.deepEqual(calls,['read']);
}
{
  const existing = {...initial,cover_file_link:privateRef};
  const saved = harness([existing,existing]);
  await performStageSubmission('design_concept','','',undefined,saved.dependencies);
  assert.deepEqual(saved.calls,['read','read',['submit',7,null]]);
}
// Every ordinary submission stage permits note-only and completely blank drafts.
for (const stage of ['design_concept','print_version','ebook_version','final_delivery']) {
  for (const note of ['', '  ', '  Already shared through email  ']) {
    const state = {...initial,workflow_stage_key:stage};
    const { calls, dependencies } = harness([state,state]);
    assert.equal(await performStageSubmission(stage,note,'  ',undefined,dependencies),receipt);
    const expected = ['read'];
    if (note.trim()) expected.push(['metadata',{delivery_notes:note.trim()},7]);
    expected.push('read',['submit',7,note.trim()||null]);
    assert.deepEqual(calls,expected, `${stage}: missing file/link must never block or upload`);
  }
  const state = {...initial,workflow_stage_key:stage,cover_file_link:privateRef,proof_pdf_link:'https://example.test/saved.pdf',final_ebook_link:privateRef};
  const saved = harness([state,state]);
  await performStageSubmission(stage,'A note only','',undefined,saved.dependencies);
  assert.deepEqual(saved.calls[1][1],{delivery_notes:'A note only'}, 'blank proof inputs must not overwrite existing files');
  const failing = harness([state,state]);
  failing.dependencies.submit = async () => { throw new Error('workflow_forbidden'); };
  await assert.rejects(performStageSubmission(stage,'','',undefined,failing.dependencies), /workflow_forbidden/);
}
{
  const { calls, dependencies } = harness([initial,{...initial,workflow_version:8}]);
  await assert.rejects(performStageSubmission('design_concept','','',undefined,dependencies), /workflow changed/);
  assert.deepEqual(calls,['read','read'], 'blank submissions must still fail closed on stale workflow state');
}
{
  const { calls, dependencies } = harness([initial,{...initial,workflow_version:8}]);
  await assert.rejects(performStageSubmission('design_concept','','',file,dependencies), /workflow changed/);
  assert.equal(calls.some(call => Array.isArray(call) && call[0]==='submit'),false);
}
for (const failureAt of ['upload','saveMetadata','submit']) {
  const { dependencies } = harness();
  dependencies[failureAt] = async () => { throw new Error(`${failureAt} denied`); };
  await assert.rejects(performStageSubmission('design_concept','','',file,dependencies), new RegExp(`${failureAt} denied`));
}
{
  const cache = new ProofUploadCache(); let uploads=0;
  const upload = async () => { uploads++; return privateRef; };
  assert.deepEqual(await Promise.all([cache.get(file,'scope',upload),cache.get(file,'scope',upload)]),[privateRef,privateRef]);
  await cache.get(file,'scope',upload);
  assert.equal(uploads,1);
  await cache.get(file,'different-stage',upload);
  assert.equal(uploads,2);
  await assert.rejects(cache.get(file,'failed',async () => { throw new Error('offline'); }));
  await cache.get(file,'failed',upload);
  assert.equal(uploads,3);
}
const modal = readFileSync('src/components/StageSubmissionModal.tsx','utf8');
assert.ok(modal.includes('type="file"'));
assert.ok(modal.includes('Attach File (optional)'));
assert.ok(modal.includes('File link (optional)'));
assert.ok(!modal.includes('required='));
assert.ok(!modal.includes('placeholder='));
assert.ok(!modal.includes('Client Submission & Approval Request'));
assert.ok(modal.includes('busyRef.current'));
const tracker = readFileSync('src/lib/useTracker.ts','utf8');
const submission = tracker.slice(tracker.indexOf('const submitStageForApproval'),tracker.indexOf('const getProjectFileUrl'));
assert.ok(submission.includes(".eq('workflow_version', latest.workflow_version)"));
assert.ok(submission.includes('upsert: false'));
assert.ok(!submission.includes('.remove('));
assert.ok(tracker.includes('createSignedUrl(location.path, 600)'));
for (const path of ['src/components/ProjectDetail.tsx','src/components/ClientProjectDetailModal.tsx','src/pages/ClientProjectsPage.tsx']) {
  assert.ok(readFileSync(path,'utf8').includes('ProjectFileLink'), `${path} must open private attachments safely`);
}
console.log('Stage submission: optional files/links at every stage, note-only and blank drafts, validation, race protection, retry safety, private links and UI wiring passed.');
