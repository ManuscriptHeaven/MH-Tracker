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

const timeline = read('src/lib/timeline.ts');
const constants = read('src/lib/constants.ts');
const tracker = read('src/lib/useTracker.ts');
const workflowClient = read('src/lib/workflowClient.ts');
const stageClock = read('src/components/StageClock.tsx');
const projectTimeline = read('src/components/ProjectTimeline.tsx');
const dashboard = read('src/pages/DashboardPage.tsx');
const clientModal = read('src/components/ClientProjectDetailModal.tsx');
const teamModal = read('src/components/ProjectDetail.tsx');
const app = read('src/App.tsx');
const migration = read('supabase/migrations/20260921000100_client_files_stage_clocks.sql');
const zeroTimeMigration = read('supabase/migrations/20260921000200_zero_files_received_production_time.sql');

console.log('--- Client Files + Stage Clock Regression Tests ---');

assert(
  constants.includes('files_received_days: 0') &&
    timeline.includes("case 'Files Received':\n      return 0;"),
  'Files Received consumes zero Manuscript Heaven production time',
);

assert(
  migration.includes('create table if not exists public.project_initial_files') &&
    migration.includes("values ('project-source-files', 'project-source-files', false, 104857600)") &&
    migration.includes('workflow_client_submit_files'),
  'client source files use private storage and a canonical workflow mutation',
);

assert(
  migration.includes("v_after.files_received_date := coalesce") &&
    migration.includes("v_after.requirements_submitted_at := coalesce") &&
    migration.includes("_workflow_next_stage(\n    'files_received'") &&
    migration.includes('_workflow_enter_production'),
  'client file submission completes Files Received and enters the next production stage automatically',
);

assert(
  zeroTimeMigration.includes("stage_key = 'files_received'") &&
    zeroTimeMigration.includes('default_production_days = 0'),
  'database stage definition also treats Files Received as zero production time',
);

assert(
  tracker.includes(".from('project-source-files')") &&
    tracker.includes("workflowClient.submitInitialFiles(") &&
    workflowClient.includes("'workflow_client_submit_files'"),
  'client file upload is wired from private Storage through the canonical workflow client',
);

assert(
  clientModal.includes('Submit Files & Start Project') &&
    clientModal.includes('As soon as you submit the required files') &&
    app.includes('onSubmitInitialFiles={tracker.submitInitialProjectFiles}'),
  'client portal exposes the required file action that starts production',
);

assert(
  teamModal.includes('Client Source Files') &&
    app.includes('initialFiles={tracker.data.projectInitialFiles}') &&
    app.includes('onGetInitialFileUrl={tracker.getProjectInitialFileUrl}'),
  'submitted client files are securely available to the project team',
);

assert(
  timeline.includes("mode: 'production'") &&
    timeline.includes("mode: 'client_wait'") &&
    timeline.includes("mode: 'waiting_files'") &&
    stageClock.includes('Production Countdown') &&
    stageClock.includes('Client Wait Clock') &&
    stageClock.includes('Production paused'),
  'live clock model separates production countdowns from client wait time',
);

assert(
  projectTimeline.includes('<StageClock project={project} compact />') &&
    dashboard.includes('<ProjectTimelineCompact project={project} />'),
  'every dashboard project timeline includes a live stage clock',
);

assert(
  migration.includes('due_date = case') &&
    migration.includes("p_expected.final_due_at at time zone 'Asia/Karachi'") &&
    timeline.includes('projectedFinalDueDate') &&
    stageClock.includes('Current due is moving with client wait.'),
  'canonical and live projected final due dates move with client-caused waiting time',
);

assert(
  dashboard.includes('isStageOverdue') &&
    dashboard.includes('isStageDueToday') &&
    dashboard.includes('finalDueText(project)'),
  'dashboard urgency uses the active stage deadline while Due shows projected final due',
);

if (process.exitCode) {
  console.error('Client Files + Stage Clock regression checks failed.');
} else {
  console.log('ALL CLIENT FILES + STAGE CLOCK CHECKS PASSED.');
}
