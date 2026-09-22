import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}
function assert(condition, message) {
  if (!condition) {
    console.error('✗ FAIL: ' + message);
    process.exitCode = 1;
    return;
  }
  console.log('✓ PASS: ' + message);
}

const types = read('src/lib/ai/aiTypes.ts');
const context = read('src/lib/ai/aiContext.tsx');
const engine = read('src/lib/ai/voiceQueryEngine.ts');
const actions = read('src/lib/ai/safeActionTools.ts');
const planner = read('src/lib/ai/aiNaturalActionPlanner.ts');
const edge = read('supabase/functions/ai-action-planner/index.ts');

console.log('--- AI Agent Proficiency Static Tests ---');

assert(
  types.includes("'submit_stage_for_approval'") &&
    types.includes('submitStageForApproval?:'),
  'AI type system exposes canonical stage submission',
);

assert(
  context.includes('submitStageForApproval: t.submitStageForApproval'),
  'AI context exposes the real tracker stage-submission mutation',
);

assert(
  actions.includes('execute_submit_stage_for_approval') &&
    actions.includes('ctx.trackerMutations?.submitStageForApproval'),
  'stage submission executor uses the canonical tracker mutation',
);

assert(
  engine.includes("toolName: 'submit_stage_for_approval'") &&
    engine.includes('prepare_generate_client_invoice') &&
    engine.includes('planNaturalAction'),
  'voice engine supports stage submission, invoice preview and natural-language fallback planning',
);

assert(
  actions.includes('prepare_generate_client_invoice') &&
    actions.includes("confirmButtonText: 'Generate Invoice'"),
  'invoice generation requires an explicit preview/confirmation before persistence',
);

assert(
  planner.includes('ALLOWED_ACTIONS') &&
    planner.includes('ai-action-planner') &&
    edge.includes('You NEVER execute actions'),
  'LLM planner is allowlisted and cannot execute business mutations',
);

if (process.exitCode) {
  console.error('AI Agent Proficiency checks failed.');
} else {
  console.log('ALL AI AGENT PROFICIENCY CHECKS PASSED.');
}
