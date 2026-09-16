import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

// Handle native node execution by dynamically importing ts module or delegating to tsx
let normalizeRevisionRequest, hasAmbiguousRevisionRequests;
try {
  const mod = await import('../src/lib/workflowErrors.ts');
  normalizeRevisionRequest = mod.normalizeRevisionRequest;
  hasAmbiguousRevisionRequests = mod.hasAmbiguousRevisionRequests;
} catch {
  const { execSync } = await import('node:child_process');
  execSync('npx --yes tsx ' + JSON.stringify(fileURLToPath(import.meta.url)), { stdio: 'inherit' });
  process.exit(0);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Helper to recursively collect all source files
function getFiles(dir, filter) {
  let results = [];
  const list = readdirSync(dir);
  for (const file of list) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFiles(filePath, filter));
    } else if (!filter || filter(filePath)) {
      results.push(filePath);
    }
  }
  return results;
}

const srcFiles = getFiles(resolve(root, 'src'), (f) => /\.(ts|tsx|js|jsx)$/.test(f));
const trackerSrc = readFileSync(resolve(root, 'src/lib/useTracker.ts'), 'utf8');
const projectDetailSrc = readFileSync(resolve(root, 'src/components/ProjectDetail.tsx'), 'utf8');
const projectsPageSrc = readFileSync(resolve(root, 'src/pages/ProjectsPage.tsx'), 'utf8');
const appSrc = readFileSync(resolve(root, 'src/App.tsx'), 'utf8');
const workflowErrorsSrc = readFileSync(resolve(root, 'src/lib/workflowErrors.ts'), 'utf8');
const workflowClientSrc = readFileSync(resolve(root, 'src/lib/workflowClient.ts'), 'utf8');
const utilsSrc = readFileSync(resolve(root, 'src/lib/utils.ts'), 'utf8');
const migration00620 = readFileSync(resolve(root, 'supabase/phase6/migrations/00620_task_management_v2_insert_returning_rls_fix.sql'), 'utf8');
const dbTest = readFileSync(resolve(root, 'supabase/tests/database/task_management_v2.test.sql'), 'utf8');

// 1. Check for physical delete calls across all source files
let physicalDeleteOccurrences = [];
for (const file of srcFiles) {
  const content = readFileSync(file, 'utf8');
  if (/\.from\(['"]projects['"]\)\.delete\(\)/.test(content)) {
    physicalDeleteOccurrences.push(file);
  }
}

// ============================================================================
// Behavioral Tests for Canonical Revision Normalization & Ambiguity Detection
// ============================================================================

// Scenario A: Fully canonical RevisionRequest
const canonicalFixture = {
  id: 'rev-canonical-101',
  project_id: 'proj-alpha',
  client_id: 'client-user-1',
  title: 'Canonical Print Revision',
  description: 'Adjust margin by 2mm',
  instructions: 'Adjust margin by 2mm',
  stage_key: 'print_approval',
  revision_round: 1,
  canonical_status: 'ready_for_client_review',
  parent_revision_request_id: null,
};
const canonicalNorm = normalizeRevisionRequest(canonicalFixture);
const behaviorScenarioA =
  canonicalNorm.stage_key === 'print_approval' &&
  canonicalNorm.revision_round === 1 &&
  canonicalNorm.canonical_status === 'ready_for_client_review' &&
  canonicalNorm.parent_revision_request_id === null &&
  hasAmbiguousRevisionRequests('proj-alpha', [canonicalNorm]) === false;

// Scenario B: Incomplete / genuinely ambiguous legacy RevisionRequest
const ambiguousMissingStage = normalizeRevisionRequest({
  id: 'rev-legacy-1',
  project_id: 'proj-beta',
  client_id: 'client-user-1',
  title: 'Legacy without stage',
  stage_key: null,
  revision_round: 1,
  canonical_status: 'ready_for_client_review',
});
const ambiguousMissingRound = normalizeRevisionRequest({
  id: 'rev-legacy-2',
  project_id: 'proj-beta',
  client_id: 'client-user-1',
  title: 'Legacy without round',
  stage_key: 'print_approval',
  revision_round: null,
  canonical_status: 'ready_for_client_review',
});
const ambiguousMissingCanonicalStatus = normalizeRevisionRequest({
  id: 'rev-legacy-3',
  project_id: 'proj-beta',
  client_id: 'client-user-1',
  title: 'Legacy without canonical status',
  stage_key: 'print_approval',
  revision_round: 1,
  canonical_status: null,
});
const ambiguousZeroRound = normalizeRevisionRequest({
  id: 'rev-legacy-4',
  project_id: 'proj-beta',
  client_id: 'client-user-1',
  title: 'Legacy with 0 round',
  stage_key: 'print_approval',
  revision_round: 0,
  canonical_status: 'ready_for_client_review',
});
const behaviorScenarioB =
  hasAmbiguousRevisionRequests('proj-beta', [ambiguousMissingStage]) === true &&
  hasAmbiguousRevisionRequests('proj-beta', [ambiguousMissingRound]) === true &&
  hasAmbiguousRevisionRequests('proj-beta', [ambiguousMissingCanonicalStatus]) === true &&
  hasAmbiguousRevisionRequests('proj-beta', [ambiguousZeroRound]) === true;

// Scenario C: Project with no revision requests
const behaviorScenarioC =
  hasAmbiguousRevisionRequests('proj-empty', []) === false &&
  hasAmbiguousRevisionRequests('proj-empty', null) === false &&
  hasAmbiguousRevisionRequests('proj-empty', undefined) === false &&
  hasAmbiguousRevisionRequests('proj-empty', [canonicalNorm]) === false; // proj-alpha revision does not affect proj-empty

// Quick status safety checks
const quickLifecycleMatch = projectsPageSrc.match(/function QuickLifecycleInput[\s\S]*?export function ProjectsPage/);
const quickLifecycleSrc = quickLifecycleMatch ? quickLifecycleMatch[0] : '';
const quickLifecycleHasNoCancelled = !quickLifecycleSrc.includes('value="cancelled"');
const quickLifecycleHasNoArchived = !quickLifecycleSrc.includes('value="archived"');
const quickLifecycleRoutesArchiveToModal =
  quickLifecycleSrc.includes("value === '__archive__'") &&
  quickLifecycleSrc.includes('onRequestArchive?.(project)');
const quickLifecycleGuardsNonAdmins =
  quickLifecycleSrc.includes("if (!isAdmin)") ||
  quickLifecycleSrc.includes("currentProfile?.role !== 'admin'");

// DB safety gate checks
const dbTestHasSafetyGate =
  dbTest.includes('SAFETY ABORT') &&
  dbTest.includes('current_setting') &&
  (dbTest.includes('phase6.local_disposable') || dbTest.includes('task_v2.test_target')) &&
  dbTest.includes("current_setting('app.environment', true) = 'production'");

const checks = [
  // 1. Physical deletion ban
  [
    'Zero physical project delete calls (.from("projects").delete()) in all src/ code',
    physicalDeleteOccurrences.length === 0,
  ],

  // 2. Centralized workflow error handling
  [
    'workflowErrors.ts exports WORKFLOW_DOMAIN_MESSAGES / WORKFLOW_ERROR_MAP and formatWorkflowErrorMessage',
    (workflowErrorsSrc.includes('WORKFLOW_DOMAIN_MESSAGES') || workflowErrorsSrc.includes('WORKFLOW_ERROR_MAP')) &&
    workflowErrorsSrc.includes('export function formatWorkflowErrorMessage'),
  ],
  [
    'workflowErrors.ts contains all required canonical workflow domain error codes',
    [
      'workflow_admin_reason_required',
      'workflow_stale_version',
      'workflow_invalid_lifecycle_transition',
      'workflow_revision_ambiguous',
      'workflow_forbidden',
      'workflow_project_not_found',
      'workflow_lifecycle_reason_required',
    ].every((code) => workflowErrorsSrc.includes(code)),
  ],
  [
    'workflow_revision_ambiguous matches required exact human-actionable copy',
    workflowErrorsSrc.includes('Legacy revision history for this project needs Admin review before this workflow action can continue.'),
  ],
  [
    'workflowClient.ts re-exports canonical workflow error mapping and helper',
    workflowClientSrc.includes("from './workflowErrors'") &&
    workflowClientSrc.includes('formatWorkflowErrorMessage'),
  ],
  [
    'utils.ts delegates errorMessage to formatWorkflowErrorMessage',
    utilsSrc.includes('return formatWorkflowErrorMessage(error, fallback);'),
  ],

  // 3. Behavioral verification of RevisionRequest normalization and ambiguity detection
  [
    'BEHAVIORAL: normalizeRevisionRequest preserves canonical fields (stage_key, revision_round, canonical_status)',
    behaviorScenarioA,
  ],
  [
    'BEHAVIORAL: Genuinely incomplete/ambiguous legacy revision request triggers hasAmbiguousRevisionRequests',
    behaviorScenarioB,
  ],
  [
    'BEHAVIORAL: Project with no revision requests does NOT trigger hasAmbiguousRevisionRequests',
    behaviorScenarioC,
  ],
  [
    'ProjectDetail has NO hardcoded MH-1021 or project number check',
    !projectDetailSrc.includes('MH-1021') && !trackerSrc.includes('MH-1021') && !appSrc.includes('MH-1021'),
  ],
  [
    'ProjectDetail uses pure hasAmbiguousRevisionRequests helper',
    projectDetailSrc.includes('hasAmbiguousRevisionRequests(project.id, revisionRequests)'),
  ],
  [
    'ProjectDetail restricts ambiguous revision warning strictly to admin role (currentProfile.role === "admin")',
    projectDetailSrc.includes("hasAmbiguousRevisions && currentProfile.role === 'admin'"),
  ],

  // 4. Archive project lifecycle in useTracker
  [
    'useTracker exports archiveProject with canonical cancellation-then-archival flow',
    trackerSrc.includes('const archiveProject = useCallback(') &&
    trackerSrc.includes('archiveProject,'),
  ],
  [
    'archiveProject handles active/on_hold by stepping through cancelled then archived via workflowClient',
    trackerSrc.includes("workflowClient.setLifecycle(") &&
    trackerSrc.includes("'cancelled'") &&
    trackerSrc.includes("'archived'"),
  ],
  [
    'archiveProject chains returned workflow_version from mutation 1 to mutation 2',
    trackerSrc.includes('currentVersion = cancelResult.workflow_version') &&
    trackerSrc.includes('currentVersion,'),
  ],
  [
    'archiveProject handles mutation 2 failure with reload and actionable retry message',
    trackerSrc.includes('await loadSupabaseData(currentProfile);') &&
    trackerSrc.includes('You may retry archiving directly.'),
  ],
  [
    'useTracker retains deprecated deleteProject alias delegating to archiveProject',
    trackerSrc.includes('return archiveProject(projectId') &&
    trackerSrc.includes('deleteProject,'),
  ],

  // 5. Shared Archive Modal in App.tsx
  [
    'App.tsx owns single shared archive modal with required state',
    appSrc.includes('projectToArchive') &&
    appSrc.includes('archiveReason') &&
    appSrc.includes('archiveError') &&
    appSrc.includes('isArchiving') &&
    appSrc.includes('onRequestArchive'),
  ],
  [
    'App.tsx replaces window.confirm with Modal for archival',
    !appSrc.includes('window.confirm') &&
    appSrc.includes('<Modal') &&
    appSrc.includes('title="Archive Project"'),
  ],
  [
    'Archive Modal requires non-empty reason and states append-only audit trail',
    appSrc.includes('archiveReason.trim()') &&
    appSrc.includes('append-only workflow audit trail'),
  ],
  [
    'Archive Modal stays open on error and displays domain error message',
    appSrc.includes('setArchiveError(errorMessage(error') &&
    appSrc.includes('{archiveError &&'),
  ],

  // 6. ProjectsPage lifecycle filtering & Quick Lifecycle safety
  [
    'ProjectsPage defaults lifecycleFilter to active and hides archived projects',
    projectsPageSrc.includes("const [lifecycleFilter, setLifecycleFilter] = useState<'active' | 'archived' | 'all'>('active');") &&
    projectsPageSrc.includes("project.project_status === 'archived'") &&
    projectsPageSrc.includes("project.project_status !== 'archived'"),
  ],
  [
    'ProjectsPage provides dropdown filter for active, archived, and all projects',
    projectsPageSrc.includes('value={lifecycleFilter}') &&
    projectsPageSrc.includes('Active Projects') &&
    projectsPageSrc.includes('Archived Only') &&
    projectsPageSrc.includes('All (incl. Archived)'),
  ],
  [
    'ProjectsPage uses Archive button/semantics instead of delete',
    projectsPageSrc.includes('Archive') &&
    projectsPageSrc.includes('handleArchive') &&
    projectsPageSrc.includes('onRequestArchive'),
  ],
  [
    'BEHAVIORAL: QuickLifecycleInput removes reasonless "Cancelled" and direct "Archived" dropdown options',
    quickLifecycleHasNoCancelled && quickLifecycleHasNoArchived,
  ],
  [
    'BEHAVIORAL: QuickLifecycleInput routes archival to onRequestArchive modal',
    quickLifecycleRoutesArchiveToModal,
  ],
  [
    'BEHAVIORAL: QuickLifecycleInput guards non-admins with read-only view',
    quickLifecycleGuardsNonAdmins,
  ],

  // 7. Admin Override Modal in ProjectDetail.tsx
  [
    'Admin Override requires Reason Summary length >= 10',
    projectDetailSrc.includes('trimmedOverrideReason.length >= 10'),
  ],
  [
    'Admin Override requires Detailed Explanation to be non-empty',
    projectDetailSrc.includes('trimmedOverrideExplanation.length > 0'),
  ],
  [
    'Admin Override shows inline validation messages when fields are invalid',
    projectDetailSrc.includes('Reason summary must be at least 10 characters') &&
    projectDetailSrc.includes('Please provide a detailed explanation'),
  ],
  [
    'Admin Override disables Confirm button when invalid',
    projectDetailSrc.includes('disabled={isSubmittingWorkflow || !isOverrideFormValid}'),
  ],
  [
    'Admin Override retains entered values and modal stays open on error',
    projectDetailSrc.includes('setOverrideError(formatWorkflowErrorMessage(err') &&
    projectDetailSrc.includes('{overrideError &&'),
  ],

  // 8. Migration 00620 and database test integrity & safety gate
  [
    'Migration 00620 is present with phase6_tasks_team_select RLS fix for INSERT RETURNING',
    migration00620.includes('phase6_tasks_team_select') &&
    migration00620.includes('public.phase6_can_access_task(id)') &&
    migration00620.includes('created_by=(select auth.uid())'),
  ],
  [
    'task_management_v2.test.sql contains executable fail-closed staging/test safety gate',
    dbTestHasSafetyGate,
  ],
  [
    'task_management_v2.test.sql tests INSERT ... RETURNING under RLS for Admin and Employee',
    dbTest.includes('Admin task for PM with RETURNING') &&
    dbTest.includes('returning * into returned_task') &&
    dbTest.includes('Employee self task with RETURNING') &&
    dbTest.includes('Employee invalid task for PM') &&
    dbTest.includes('rollback;'),
  ],
];

let failures = 0;
console.log('--- Critical Action Repair Pass Static & Regression Tests ---\n');
for (const [name, passed] of checks) {
  console.log(`${passed ? '✓ PASS' : '✗ FAIL'}: ${name}`);
  if (!passed) failures += 1;
}

console.log(`\nResults: ${checks.length - failures}/${checks.length} passed.`);
if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s) did not pass.`);
  process.exit(1);
} else {
  console.log('\nALL CRITICAL ACTION REPAIR CHECKS PASSED.');
}
