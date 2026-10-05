import assert from 'node:assert/strict';
import { FinalDeliveryFilesSavedError, performFinalDelivery, submitFinalDeliveryWithFiles } from '../src/lib/finalDelivery.ts';

const receipt = {
  project_id: 'project-1',
  workflow_version: 8,
  project_snapshot: { project_status: 'completed', status: 'Completed' },
  affected_entity_ids: {},
  history_event_ids: ['event-1'],
  already_applied: false,
};
const readyState = {
  project_status: 'active', workflow_version: 7,
  requires_print: true, requires_ebook: false,
  final_print_pdf_link: 'https://example.test/final.pdf', final_ebook_link: null,
};

let observedVersion;
const result = await performFinalDelivery(
  async () => readyState,
  async (version) => { observedVersion = version; return receipt; },
);
assert.equal(observedVersion, 7, 'completion must use the freshly read version');
assert.equal(result, receipt, 'the canonical receipt must be returned');

let calls = 0;
assert.equal(await performFinalDelivery(
  async () => ({ ...readyState, project_status: 'completed', workflow_version: 8 }),
  async () => { calls++; return receipt; },
), null);
assert.equal(calls, 0, 'an already completed project must not be submitted twice');

for (const invalidVersion of [undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  await assert.rejects(
    performFinalDelivery(
      async () => ({ ...readyState, workflow_version: invalidVersion }),
      async () => { calls++; return receipt; },
    ),
    /workflow version is unavailable/,
  );
}
assert.equal(calls, 0, 'invalid state must never reach the mutation');

for (const flags of [
  { requires_print: true, requires_ebook: false },
  { requires_print: false, requires_ebook: true },
  { requires_print: true, requires_ebook: true },
]) {
  const blankState = { ...readyState, ...flags, final_print_pdf_link: null, final_ebook_link: '  ' };
  assert.equal(await performFinalDelivery(
    async () => blankState,
    async (version) => { assert.equal(version, 7); calls++; return receipt; },
  ), receipt);
  let saved = false;
  let completed = false;
  await submitFinalDeliveryWithFiles(
    blankState,
    { final_print_pdf_link: '  ', final_ebook_link: '' },
    async () => { saved = true; },
    async () => { completed = true; },
  );
  assert.equal(saved, false, 'blank links must not create metadata writes');
  assert.equal(completed, true, 'all service types can complete without links');
}
assert.equal(calls, 3, 'optional final links must not block the canonical mutation');

const domainError = new Error('workflow_forbidden');
await assert.rejects(
  performFinalDelivery(
    async () => readyState,
    async () => { throw domainError; },
  ),
  (error) => error === domainError,
  'domain errors must reach the UI for display',
);

let savedFiles;
const sequence = [];
let canonicalState = { ...readyState, final_print_pdf_link: '' };
await submitFinalDeliveryWithFiles(
  canonicalState,
  { final_print_pdf_link: '  https://example.test/final.pdf  ', final_ebook_link: 'https://example.test/not-required.epub' },
  async (updates) => {
    savedFiles = updates;
    sequence.push('save');
    canonicalState = { ...canonicalState, ...updates, workflow_version: 11 };
  },
  async () => {
    await performFinalDelivery(
      async () => { sequence.push('read'); return canonicalState; },
      async (version) => { sequence.push(`complete:${version}`); return receipt; },
    );
  },
);
assert.deepEqual(savedFiles, { final_print_pdf_link: 'https://example.test/final.pdf' }, 'save only trimmed, applicable final-file metadata');
assert.deepEqual(sequence, ['save', 'read', 'complete:11'], 'save files before completion and use the current canonical workflow version');

calls = 0;
for (const link of ['not-a-url', 'javascript:alert(1)', 'file:///final.pdf']) {
  await assert.rejects(submitFinalDeliveryWithFiles(
    { ...readyState, final_print_pdf_link: '', proof_pdf_link: 'https://example.test/proof.pdf' },
    { final_print_pdf_link: link },
    async () => { calls++; },
    async () => { calls++; },
  ));
}
assert.equal(calls, 0, 'supplied unsafe final links cannot save or complete');

await submitFinalDeliveryWithFiles(
  { ...readyState, proof_pdf_link: 'https://example.test/proof.pdf' },
  { final_print_pdf_link: '' },
  async () => { throw new Error('Blank draft must neither erase the existing link nor promote a proof'); },
  async () => {},
);

await submitFinalDeliveryWithFiles(
  { ...readyState, final_print_pdf_link: null },
  { final_print_pdf_link: '' },
  undefined,
  async () => {},
);

await submitFinalDeliveryWithFiles(
  readyState,
  { final_print_pdf_link: readyState.final_print_pdf_link },
  undefined,
  async () => { calls++; },
);
assert.equal(calls, 1, 'a team member can complete using existing final files without metadata-edit permission');
await assert.rejects(submitFinalDeliveryWithFiles(
  readyState,
  { final_print_pdf_link: 'https://example.test/replacement.pdf' },
  undefined,
  async () => { calls++; },
), /Ask a manager/);
assert.equal(calls, 1, 'metadata-edit permission is required for changing a final file');

const saveFailure = new Error('Unable to save files');
await assert.rejects(submitFinalDeliveryWithFiles(
  { ...readyState, final_print_pdf_link: '' },
  { final_print_pdf_link: readyState.final_print_pdf_link },
  async () => { throw saveFailure; },
  async () => { calls++; },
), (error) => error === saveFailure);
assert.equal(calls, 1, 'a failed file save must not reach completion');

await assert.rejects(submitFinalDeliveryWithFiles(
  { ...readyState, final_print_pdf_link: '' },
  { final_print_pdf_link: readyState.final_print_pdf_link },
  async () => {},
  async () => { throw domainError; },
), (error) => error instanceof FinalDeliveryFilesSavedError && error.completionError === domainError,
'a partial success must preserve the completion domain error and identify that files were saved');

let combinedUpdates;
await submitFinalDeliveryWithFiles(
  { ...readyState, requires_ebook: true, final_print_pdf_link: '' },
  { final_print_pdf_link: readyState.final_print_pdf_link, final_ebook_link: '' },
  async (updates) => { combinedUpdates = updates; },
  async () => { calls++; },
);
assert.deepEqual(combinedUpdates, { final_print_pdf_link: readyState.final_print_pdf_link });
assert.equal(calls, 2, 'Print + eBook delivery can save a supplied print link and omit the eBook link');

console.log('Final delivery behavior tests passed.');
