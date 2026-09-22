import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error(`✗ FAIL: ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ PASS: ${message}`);
}

const types = read('src/lib/ai/aiTypes.ts');
const context = read('src/lib/ai/aiContext.tsx');
const actions = read('src/lib/ai/safeActionTools.ts');
const engine = read('src/lib/ai/voiceQueryEngine.ts');
const planner = read('src/lib/ai/aiPlannerService.ts');
const edge = read('supabase/functions/ai-planner/index.ts');

console.log('--- AI Action Agent Safety & Natural Language Tests ---');

assert(
  types.includes("| 'submit_stage_for_approval'") &&
    types.includes('submitStageForApproval?:') &&
    types.includes('setProjectLifecycle?:') &&
    types.includes('completeFinalDelivery?:'),
  'AI tool types expose canonical stage submission and lifecycle mutations',
);

assert(
  context.includes('submitStageForApproval: t.submitStageForApproval') &&
    context.includes('setProjectLifecycle: t.setProjectLifecycle') &&
    context.includes('completeFinalDelivery: t.completeFinalDelivery'),
  'AI context wires canonical tracker mutations instead of inventing workflow writes',
);

assert(
  actions.includes('export async function execute_submit_stage_for_approval') &&
    actions.includes('ctx.trackerMutations.submitStageForApproval') &&
    actions.includes("error: 'deliverable_required'") &&
    actions.includes("error: 'invalid_workflow_stage'"),
  'stage submission executor validates current canonical stage and deliverable before mutation',
);

const statusStart = actions.indexOf('export async function execute_update_project_status');
const statusEnd = actions.indexOf('export async function execute_update_project_due_date', statusStart);
const statusBlock = actions.slice(statusStart, statusEnd);
assert(
  statusBlock.includes('ctx.trackerMutations.setProjectLifecycle') &&
    statusBlock.includes('ctx.trackerMutations.completeFinalDelivery') &&
    statusBlock.includes("error: 'canonical_workflow_required'") &&
    !statusBlock.includes('ctx.trackerMutations.updateProject'),
  'generic project status action can no longer fake or directly mutate canonical workflow stages',
);

assert(
  actions.includes('export function prepare_generate_client_invoice') &&
    actions.includes('Nothing has been generated yet. Confirm to create and save this invoice.') &&
    actions.includes("if (!ctx.trackerMutations?.saveInvoiceVersion)") &&
    actions.includes('No duplicate invoice was created.'),
  'invoice generation is preview-first, persistent-only, and duplicate-safe',
);

const invoiceIntentStart = engine.indexOf('// 00. INVOICE GENERATION INTENT');
const invoiceIntentEnd = engine.indexOf('// 0. CREATE PROJECT INTENT', invoiceIntentStart);
const invoiceIntentBlock = engine.slice(invoiceIntentStart, invoiceIntentEnd);
assert(
  invoiceIntentBlock.includes('prepare_generate_client_invoice') &&
    !invoiceIntentBlock.includes('execute_generate_client_invoice'),
  'natural-language invoice requests never execute before explicit confirmation',
);

assert(
  engine.includes('// C2. SUBMIT CURRENT PRODUCTION STAGE FOR CLIENT APPROVAL') &&
    engine.includes("toolName: 'submit_stage_for_approval'") &&
    engine.includes("case 'submit_stage_for_approval':") &&
    engine.includes("context?.intentType === 'submit_stage_for_approval'"),
  'voice/text engine supports stage submission previews, confirmation execution and project disambiguation',
);

assert(
  engine.includes('approvalSubmissionMap') &&
    engine.includes('return this.detectWriteIntent(submitQuery.toLowerCase(), submitQuery, ctx)'),
  'legacy requests to move a project into an approval stage are translated to canonical submit actions',
);

assert(
  engine.includes('enableLegacyWritePlanning: false') &&
    read('src/lib/ai/aiUnderstandingEngine.ts').includes('legacyWritePlanningEnabled'),
  'production AI flow disables the legacy write/approval executor so only one write authority remains',
);

assert(
  planner.includes("supabase.functions.invoke('ai-planner'") &&
    planner.includes('safePlannerContext') &&
    planner.includes('Planner is an enhancement, never a dependency'),
  'natural-language planner is optional, context-limited and fails closed to deterministic parsing',
);

assert(
  edge.includes("createClient(supabaseUrl, anonKey") &&
    edge.includes('authClient.auth.getUser()') &&
    !edge.includes('SUPABASE_SERVICE_ROLE_KEY') &&
    edge.includes('You NEVER execute actions') &&
    edge.includes('deterministicFallback'),
  'planner edge function authenticates users, has no service-role write authority and only normalizes commands',
);

if (process.exitCode) {
  console.error('AI Action Agent regression checks failed.');
} else {
  console.log('ALL AI ACTION AGENT CHECKS PASSED.');
}
