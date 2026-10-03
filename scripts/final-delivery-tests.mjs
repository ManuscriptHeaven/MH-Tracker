import assert from 'node:assert/strict';
import { performFinalDelivery } from '../src/lib/finalDelivery.ts';

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

for (const [missingState, message] of [
  [{ ...readyState, final_print_pdf_link: '  ' }, /final print-ready PDF/],
  [{ ...readyState, requires_print: false, requires_ebook: true }, /final eBook\/EPUB file/],
]) {
  await assert.rejects(
    performFinalDelivery(
      async () => missingState,
      async () => { calls++; return receipt; },
    ),
    message,
  );
}
assert.equal(calls, 0, 'missing required deliverables must not reach the mutation');

const domainError = new Error('workflow_forbidden');
await assert.rejects(
  performFinalDelivery(
    async () => readyState,
    async () => { throw domainError; },
  ),
  (error) => error === domainError,
  'domain errors must reach the UI for display',
);

console.log('Final delivery behavior tests passed.');
