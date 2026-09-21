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

const migration = read('supabase/migrations/20260921000500_schedule_accountability_reminders.sql');
const resolverMigration = read('supabase/migrations/20260921000600_resolve_client_reminder_rpc.sql');
const timeline = read('src/lib/timeline.ts');
const tracker = read('src/lib/useTracker.ts');
const workflowErrors = read('src/lib/workflowErrors.ts');
const accountability = read('src/components/ScheduleAccountability.tsx');
const projectDetail = read('src/components/ProjectDetail.tsx');
const dashboard = read('src/pages/DashboardPage.tsx');
const app = read('src/App.tsx');

console.log('--- Schedule Accountability Regression Tests ---');

assert(
  migration.includes('add column if not exists original_due_at') &&
    migration.includes('preserve_project_original_due') &&
    timeline.includes('originalProjectDueDate') &&
    accountability.includes('Original Due') &&
    accountability.includes('Current Due'),
  'original committed due date is preserved and displayed beside the current shifted due date',
);

assert(
  migration.includes('array[24,48,72]') &&
    migration.includes('project_client_reminders') &&
    migration.includes('mh-client-reminder-generator') &&
    migration.includes('17 * * * *') &&
    accountability.includes('Review & Send') &&
    accountability.includes('Confirm & Send'),
  '24h/48h/72h client reminder drafts are generated hourly but require explicit send confirmation',
);

assert(
  !migration.includes('insert into public.messages') &&
    accountability.includes('await onSendMessage') &&
    accountability.includes("await onResolveReminder(selectedReminder.id, 'sent')"),
  'scheduled reminder generation never auto-sends a client message',
);

assert(
  resolverMigration.includes('resolve_project_client_reminder') &&
    resolverMigration.includes("p_status not in ('sent','dismissed')") &&
    tracker.includes("'resolve_project_client_reminder'"),
  'reminder draft resolution is atomic and restricted to explicit sent or dismissed states',
);

assert(
  migration.includes('get_project_delay_metrics') &&
    accountability.includes('MH Production') &&
    accountability.includes('Client Waiting') &&
    accountability.includes('Internal Overdue') &&
    app.includes('projectDelayMetrics?.find'),
  'project details show production, client-wait, and internal-overdue attribution',
);

assert(
  timeline.includes("diffSeconds <= 8 * 3600") &&
    timeline.includes("diffSeconds <= 24 * 3600") &&
    timeline.includes("'red'") &&
    timeline.includes("'amber'") &&
    dashboard.includes("id: 'at_risk'") &&
    dashboard.includes('At Risk'),
  'production stages receive 24h amber and 8h red risk alerts and dashboard filtering',
);

assert(
  migration.includes('workflow_submission_gate') &&
    migration.includes('workflow_missing_concept_deliverable') &&
    migration.includes('workflow_missing_print_proof') &&
    migration.includes('workflow_missing_ebook_proof') &&
    migration.includes('workflow_missing_final_print_file') &&
    migration.includes('workflow_missing_final_ebook_file') &&
    workflowErrors.includes('workflow_missing_concept_deliverable'),
  'submission and final-delivery actions fail closed when required proof/deliverable files are missing',
);

assert(
  tracker.includes('files_received_days: 0') &&
    !projectDetail.includes('Submit Files Received'),
  'Files Received remains a client-owned zero-production-time action with no team advance button',
);

assert(
  !dashboard.includes('mobileFiltersOpen') &&
    !dashboard.includes('label="Assigned To"') &&
    !dashboard.includes('label="Client"') &&
    !dashboard.includes('label="Priority"') &&
    dashboard.includes('Assigned to <span className="font-semibold text-charcoal">') &&
    dashboard.includes('w-[45%] border-b border-border px-3 py-3">Timeline'),
  'dashboard removes redundant advanced filters and combines client/assignee metadata under the project title',
);

if (process.exitCode) {
  console.error('Schedule accountability regression checks failed.');
} else {
  console.log('ALL SCHEDULE ACCOUNTABILITY CHECKS PASSED.');
}
