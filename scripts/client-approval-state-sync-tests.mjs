import fs from 'node:fs';

function assert(condition, message) {
  if (!condition) {
    console.error('✗ FAIL: ' + message);
    process.exitCode = 1;
    return;
  }
  console.log('✓ PASS: ' + message);
}

const timeline = fs.readFileSync('src/lib/timeline.ts', 'utf8');
const modal = fs.readFileSync('src/components/ClientProjectDetailModal.tsx', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260921000700_repair_workflow_compatibility_projection.sql', 'utf8');

console.log('--- Client Approval State Sync Regression Tests ---');

assert(
  timeline.includes('function withCanonicalWorkflowProjection') &&
  timeline.includes("statusKey === 'revision_active' ? 'REVISION_ACTIVE'") &&
  timeline.includes("waitingKey === 'team' ? 'Manuscript Heaven'") &&
  timeline.includes('project = withCanonicalWorkflowProjection(project)'),
  'timeline and clocks trust canonical workflow keys over stale legacy display fields',
);

assert(
  modal.includes("project.workflow_stage_status_key === 'awaiting_client'") &&
  modal.includes("project.workflow_waiting_on_key === 'client'") &&
  modal.includes('{canApproveCurrentStage ? (') &&
  modal.includes('Revision is still with the Manuscript Heaven team.'),
  'client approval button only appears when the canonical workflow explicitly allows approval',
);

assert(
  migration.includes('public._workflow_compatibility_projection') &&
  migration.includes("status = (projected.compat->>'status')::public.project_status") &&
  migration.includes("stage_status = projected.compat->>'stage_status'") &&
  migration.includes("waiting_on = projected.compat->>'waiting_on'"),
  'legacy display columns are repaired from canonical workflow state',
);

if (process.exitCode) {
  console.error('Client approval state sync checks failed.');
} else {
  console.log('ALL CLIENT APPROVAL STATE SYNC CHECKS PASSED.');
}
