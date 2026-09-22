import fs from 'node:fs';
import {
  buildOperatorIntelligence,
  summarizeOperatorEvents,
} from '../src/lib/ai/operatorIntelligence.ts';

function assert(condition, message) {
  if (!condition) {
    console.error('✗ FAIL: ' + message);
    process.exitCode = 1;
    return;
  }
  console.log('✓ PASS: ' + message);
}

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

console.log('--- AI Operator Intelligence Tests ---');

const migration = read('supabase/migrations/20260922000600_ai_operator_intelligence.sql');
const service = read('src/lib/ai/aiService.ts');
const context = read('src/lib/ai/aiContext.tsx');
const panel = read('src/components/ai/AIOperatorIntelligencePanel.tsx');
const operator = read('src/lib/ai/operatorIntelligence.ts');

assert(
  migration.includes('create table if not exists public.ai_operator_events') &&
    migration.includes('enable row level security') &&
    migration.includes('ai_operator_events_insert_own') &&
    migration.includes('ai_operator_events_select_own_or_admin'),
  'operator telemetry table is RLS-protected with own-write and admin workspace-read policies',
);

assert(
  migration.includes('revoke all on table public.ai_operator_events from authenticated') &&
    migration.includes('grant select, insert on table public.ai_operator_events to authenticated') &&
    !migration.includes('grant select, insert, update, delete on table public.ai_operator_events to authenticated'),
  'authenticated users only receive least-privilege SELECT/INSERT grants for telemetry',
);

assert(
  !migration.includes('prompt text') &&
    !migration.includes('message_body') &&
    !migration.includes('content text'),
  'telemetry schema does not duplicate raw prompt or message content',
);

assert(
  service.includes("from('ai_operator_events').insert") &&
    service.includes('event_type: input.eventType') &&
    service.includes('latency_ms:') &&
    !service.includes('prompt: input') &&
    !service.includes('content: input'),
  'AI service persists outcome metadata without raw prompt text',
);

const rows = [
  {
    event_type: 'query_result',
    tool_name: 'get_overdue_projects',
    success: true,
    was_clarification: false,
    had_disambiguation: false,
    plan_step_count: 0,
    latency_ms: 400,
    created_at: '2026-09-22T10:00:00Z',
  },
  {
    event_type: 'query_result',
    tool_name: 'generate_client_invoice',
    success: true,
    was_clarification: true,
    had_disambiguation: true,
    plan_step_count: 2,
    latency_ms: 900,
    created_at: '2026-09-22T10:01:00Z',
  },
  {
    event_type: 'query_result',
    tool_name: 'create_task',
    success: false,
    error_code: 'task_details_required',
    was_clarification: true,
    had_disambiguation: false,
    plan_step_count: 0,
    latency_ms: 500,
    created_at: '2026-09-22T10:02:00Z',
  },
  {
    event_type: 'action_confirmed',
    tool_name: 'generate_client_invoice',
    success: true,
    verification_status: 'verified',
    created_at: '2026-09-22T10:03:00Z',
  },
  {
    event_type: 'action_confirmed',
    tool_name: 'update_project_status',
    success: false,
    verification_status: 'failed',
    error_code: 'verification_failed',
    created_at: '2026-09-22T10:04:00Z',
  },
  {
    event_type: 'action_cancelled',
    tool_name: 'delete_task',
    success: true,
    created_at: '2026-09-22T10:05:00Z',
  },
];

const telemetry = summarizeOperatorEvents(rows, 'workspace', 30);
assert(
  telemetry.totalQueries === 3 &&
    telemetry.successfulQueries === 2 &&
    telemetry.failedQueries === 1,
  'telemetry summary calculates query outcomes',
);
assert(
  telemetry.clarificationCount === 2 &&
    telemetry.disambiguationCount === 1 &&
    telemetry.multiStepPlans === 1,
  'telemetry summary tracks clarification, ambiguity and multi-step usage',
);
assert(
  telemetry.verifiedActions === 1 &&
    telemetry.failedVerifications === 1 &&
    telemetry.verificationRate === 50,
  'telemetry summary measures confirmed-action verification reliability',
);
assert(
  telemetry.scope === 'workspace' && telemetry.averageLatencyMs === 600,
  'operator telemetry preserves workspace scope and average query latency',
);

const now = Date.now();
const isoDaysAgo = (days) => new Date(now - days * 86_400_000).toISOString();
const dateDaysAgo = (days) => new Date(now - days * 86_400_000).toISOString().slice(0, 10);

const admin = {
  id: 'admin-1',
  full_name: 'Admin User',
  role: 'admin',
  status: 'active',
};

const formatter = {
  id: 'team-1',
  full_name: 'Zain Formatter',
  role: 'employee',
  status: 'active',
};

const projects = [
  {
    id: 'p1',
    project_number: 'MH-1001',
    project_title: 'Magazine Two',
    client_name: 'BCH Client',
    status: 'In Progress',
    project_status: 'active',
    current_stage: 'Design Concept',
    waiting_on: 'Manuscript Heaven',
    due_date: dateDaysAgo(4),
    updated_at: isoDaysAgo(1),
    total_price: 2200,
    advance_paid: 500,
    remaining_balance: 1700,
    invoiced: false,
    invoice_id: null,
    assigned_to: 'team-1',
  },
  {
    id: 'p2',
    project_number: 'MH-1002',
    project_title: 'Annual Report',
    client_name: 'BCH Client',
    status: 'Awaiting Client Approval',
    project_status: 'active',
    current_stage: 'Concept Approval',
    waiting_on: 'Client',
    due_date: new Date(now + 3 * 86_400_000).toISOString().slice(0, 10),
    updated_at: isoDaysAgo(5),
    total_price: 1400,
    advance_paid: 400,
    remaining_balance: 1000,
    invoiced: false,
    invoice_id: null,
    assigned_to: 'team-1',
  },
  ...Array.from({ length: 5 }, (_, index) => ({
    id: 'extra-' + index,
    project_number: 'MH-X' + index,
    project_title: 'Extra Project ' + index,
    client_name: 'Other Client',
    status: 'In Progress',
    project_status: 'active',
    current_stage: 'Print Version',
    waiting_on: 'Manuscript Heaven',
    due_date: new Date(now + 10 * 86_400_000).toISOString().slice(0, 10),
    updated_at: isoDaysAgo(1),
    total_price: 500,
    advance_paid: 500,
    remaining_balance: 0,
    invoiced: true,
    invoice_id: 'inv-' + index,
    assigned_to: 'team-1',
  })),
];

const tasks = Array.from({ length: 3 }, (_, index) => ({
  id: 'task-' + index,
  title: 'Overdue Task ' + index,
  status: 'To Do',
  priority: index === 0 ? 'Urgent' : 'Normal',
  assigned_to: 'team-1',
  due_date: dateDaysAgo(index + 1),
  archived_at: null,
}));

const intelligence = buildOperatorIntelligence({
  data: {
    profiles: [admin, formatter],
    projects,
    tasks,
    invoices: [],
  },
  visibleProjects: projects,
  visibleTasks: tasks,
  currentProfile: admin,
  dailySummary: null,
  telemetry,
});

const priorityTypes = new Set(intelligence.priorities.map((item) => item.type));
assert(
  priorityTypes.has('cashflow_risk') &&
    priorityTypes.has('invoice_opportunity') &&
    priorityTypes.has('approval_bottleneck') &&
    priorityTypes.has('team_capacity'),
  'operator intelligence combines finance, approval and workload signals into actionable priorities',
);

const invoiceCommand = intelligence.priorities
  .flatMap((item) => item.commands)
  .find((item) => item.command.includes('Generate invoice for BCH Client'));
assert(
  Boolean(invoiceCommand),
  'cross-signal cashflow intelligence produces a safe pending-invoice command for the affected client',
);

assert(
  priorityTypes.has('ai_reliability'),
  'failed post-action verification is elevated as an operator reliability signal',
);

assert(
  panel.includes('Recommendations open in AI') &&
    panel.includes('sendMessage(command)') &&
    !panel.includes('confirmAction(') &&
    !panel.includes('executeAction('),
  'operator recommendations enter the normal AI flow instead of auto-executing writes',
);

assert(
  context.includes("eventType: 'query_result'") &&
    context.includes("eventType: 'action_confirmed'") &&
    context.includes("eventType: 'action_cancelled'") &&
    context.includes("eventType: 'action_failed'") &&
    context.includes('.then(refreshOperatorIntelligence)'),
  'assistant lifecycle records and refreshes operator telemetry after queries and actions',
);

assert(
  operator.includes("currentProfile.role === 'admin'") &&
    service.includes("profile?.role === 'admin' ? 'workspace' : 'personal'"),
  'workspace-level operator analytics are limited to admin scope while other users remain personal',
);

if (process.exitCode) {
  console.error('AI Operator Intelligence checks failed.');
} else {
  console.log('ALL AI OPERATOR INTELLIGENCE CHECKS PASSED.');
}
