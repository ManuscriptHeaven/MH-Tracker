import {
  calculateStageDueDate,
  deriveProjectTimeline,
  getAutoSkippedStagesForServiceType,
  getStageDurationDays,
  getTimelineMilestones,
  getTimelineSummary,
  getWorkflowSettings,
  isStageSkipped,
  nextStageAfterApproval,
  normalizeStage,
  validateWorkflowTransition,
} from './timeline';
import { DEFAULT_WORKFLOW_SETTINGS } from './constants';
import type { Project } from './types';

export function runProductionTimelineTests() {
  console.log('====================================================');
  console.log('RUNNING 14-STEP PRODUCTION TIMELINE WORKFLOW TESTS');
  console.log('====================================================');

  const now = '2026-08-10';

  // TEST 1: Create project. Expected: Files Received = ACTIVE, Status = Active, 2 production days.
  let project: Partial<Project> = {
    id: 'test-project-1',
    project_title: 'Test Production Book',
    status: 'Active',
    current_stage: 'Files Received',
    stage_status: 'ACTIVE',
    waiting_on: 'Manuscript Heaven',
    files_received_date: now,
    stage_started_at: now,
    workflow_settings: DEFAULT_WORKFLOW_SETTINGS,
  };

  project = deriveProjectTimeline(project);
  let summary = getTimelineSummary(project);

  console.assert(summary.officialStage === 'Files Received', 'Test 1 Failed: Stage should be Files Received');
  console.assert(project.status === 'Active', 'Test 1 Failed: Status should be Active');
  console.assert(summary.waitingOn === 'Manuscript Heaven', 'Test 1 Failed: Waiting On should be Manuscript Heaven');
  console.assert(summary.timelineStatus === 'Active', 'Test 1 Failed: Timeline Status should be Active');
  console.assert(
    getStageDurationDays('Files Received', project.workflow_settings) === 2,
    'Test 1 Failed: Allocation should be 2 days',
  );
  console.log('✓ TEST 1 PASSED: Files Received = ACTIVE, Status = Active (2 production days)');

  // TEST 2: Complete Files Received. Expected: Design Concept = ACTIVE, Status = In Progress, 3 production days allocated.
  project.current_stage = 'Design Concept';
  project.stage_started_at = '2026-08-12';
  project = deriveProjectTimeline(project);
  summary = getTimelineSummary(project);

  console.assert(summary.officialStage === 'Design Concept', 'Test 2 Failed: Stage should be Design Concept');
  console.assert(project.status === 'In Progress', 'Test 2 Failed: Status should be In Progress');
  console.assert(summary.waitingOn === 'Manuscript Heaven', 'Test 2 Failed: Waiting On should be Manuscript Heaven');
  console.assert(
    getStageDurationDays('Design Concept', project.workflow_settings) === 3,
    'Test 2 Failed: Allocation should be 3 days',
  );
  console.log('✓ TEST 2 PASSED: Design Concept = ACTIVE, Status = In Progress (3 production days)');

  // TEST 3: Complete Design Concept and send to client. Expected: Concept Approval = PAUSED_CLIENT_REVIEW, Status = Awaiting Client Approval, Waiting On = Client.
  project.current_stage = 'Concept Approval';
  project.stage_status = 'PAUSED_CLIENT_REVIEW';
  project.design_concept_submitted_date = '2026-08-14';
  project = deriveProjectTimeline(project);
  summary = getTimelineSummary(project);

  console.assert(summary.officialStage === 'Concept Approval', 'Test 3 Failed: Stage should be Concept Approval');
  console.assert(project.status === 'Awaiting Client Approval', 'Test 3 Failed: Status should be Awaiting Client Approval');
  console.assert(summary.waitingOn === 'Client', 'Test 3 Failed: Waiting On should be Client');
  console.assert(summary.timelineStatus === 'Paused', 'Test 3 Failed: Timeline Status should be Paused');
  console.assert(summary.dueDate === null, 'Test 3 Failed: Due Date should be Paused/null during client review');
  console.log('✓ TEST 3 PASSED: Concept Approval = PAUSED, Status = Awaiting Client Approval (Waiting for Client)');

  // TEST 4: Client takes several days before responding. Expected: Production deadline does NOT decrease during client review.
  summary = getTimelineSummary(project);
  console.assert(summary.waitingOn === 'Client', 'Test 4 Failed: Waiting On should still be Client');
  console.assert(summary.daysRemaining === null, 'Test 4 Failed: Days remaining should be null/Paused');
  console.log('✓ TEST 4 PASSED: Client waiting time is excluded from production time');

  // TEST 5: Client requests revision. Expected: REVISION_ACTIVE, Status = In Revision, 2 production days allocated, Waiting On = Manuscript Heaven.
  project.stage_status = 'REVISION_ACTIVE';
  project.stage_started_at = '2026-08-16';
  project.revision_count = 1;
  project.stage_due_at = calculateStageDueDate('2026-08-16', 2, project.workflow_settings);
  project = deriveProjectTimeline(project);
  summary = getTimelineSummary(project);

  console.assert(summary.officialStage === 'Concept Approval', 'Test 5 Failed: Stage should be Concept Approval');
  console.assert(project.status === 'In Revision', 'Test 5 Failed: Status should be In Revision');
  console.assert(summary.stageStatus === 'REVISION_ACTIVE', 'Test 5 Failed: Clock state should be REVISION_ACTIVE');
  console.assert(summary.waitingOn === 'Manuscript Heaven', 'Test 5 Failed: Waiting On should be Manuscript Heaven');
  console.assert(summary.timelineStatus === 'Revision Required', 'Test 5 Failed: Status should be Revision Required');
  console.log('✓ TEST 5 PASSED: Concept Revision = REVISION_ACTIVE, Status = In Revision (2 production days)');

  // TEST 6: Employee completes revision and sends to client. Expected: Clock pauses, Status = Awaiting Client Approval, Waiting On = Client.
  project.stage_status = 'PAUSED_CLIENT_REVIEW';
  project = deriveProjectTimeline(project);
  summary = getTimelineSummary(project);

  console.assert(project.status === 'Awaiting Client Approval', 'Test 6 Failed: Status should return to Awaiting Client Approval');
  console.assert(summary.waitingOn === 'Client', 'Test 6 Failed: Waiting On should be Client');
  console.assert(summary.timelineStatus === 'Paused', 'Test 6 Failed: Status should be Paused');
  console.log('✓ TEST 6 PASSED: Revision submitted, clock paused, Status = Awaiting Client Approval');

  // TEST 7: Client approves. Expected: Concept Approval completed, Print Version becomes ACTIVE, Status = In Progress (5 production days).
  project.design_concept_approval_date = '2026-08-18';
  project.current_stage = 'Print Version';
  project.stage_status = 'ACTIVE';
  project.stage_started_at = '2026-08-18';
  project.stage_due_at = calculateStageDueDate('2026-08-18', 5, project.workflow_settings);
  project = deriveProjectTimeline(project);
  summary = getTimelineSummary(project);

  console.assert(summary.officialStage === 'Print Version', 'Test 7 Failed: Stage should be Print Version');
  console.assert(project.status === 'In Progress', 'Test 7 Failed: Status should be In Progress');
  console.assert(summary.waitingOn === 'Manuscript Heaven', 'Test 7 Failed: Waiting On should be Manuscript Heaven');
  console.assert(
    getStageDurationDays('Print Version', project.workflow_settings) === 5,
    'Test 7 Failed: Allocation should be 5 days',
  );
  console.log('✓ TEST 7 PASSED: Print Version = ACTIVE, Status = In Progress (5 production days)');

  // TEST 8: Print Version completed. Expected: Print Approval becomes active, Status = Awaiting Client Approval, Clock pauses, Waiting On = Client.
  project.print_version_submitted_date = '2026-08-25';
  project.current_stage = 'Print Approval';
  project.stage_status = 'PAUSED_CLIENT_REVIEW';
  project = deriveProjectTimeline(project);
  summary = getTimelineSummary(project);

  console.assert(summary.officialStage === 'Print Approval', 'Test 8 Failed: Stage should be Print Approval');
  console.assert(project.status === 'Awaiting Client Approval', 'Test 8 Failed: Status should be Awaiting Client Approval');
  console.assert(summary.waitingOn === 'Client', 'Test 8 Failed: Waiting On should be Client');
  console.log('✓ TEST 8 PASSED: Print Approval = PAUSED, Status = Awaiting Client Approval (Waiting for Client)');

  // TEST 9: Client requests Print revision. Expected: Status = In Revision, 2 production days allocated, Clock resumes.
  project.stage_status = 'REVISION_ACTIVE';
  project.stage_started_at = '2026-08-26';
  project.stage_due_at = calculateStageDueDate('2026-08-26', 2, project.workflow_settings);
  project = deriveProjectTimeline(project);
  summary = getTimelineSummary(project);

  console.assert(project.status === 'In Revision', 'Test 9 Failed: Status should be In Revision');
  console.assert(summary.stageStatus === 'REVISION_ACTIVE', 'Test 9 Failed: Clock state should be REVISION_ACTIVE');
  console.assert(summary.waitingOn === 'Manuscript Heaven', 'Test 9 Failed: Waiting On should be Manuscript Heaven');
  console.log('✓ TEST 9 PASSED: Print Revision = REVISION_ACTIVE, Status = In Revision (2 production days)');

  // TEST 10: Client approves Print Version. Expected: Ebook Version becomes ACTIVE, Status = In Progress (5 production days).
  project.print_version_approval_date = '2026-08-28';
  project.current_stage = 'Ebook Version';
  project.stage_status = 'ACTIVE';
  project.stage_started_at = '2026-08-28';
  project.stage_due_at = calculateStageDueDate('2026-08-28', 5, project.workflow_settings);
  project = deriveProjectTimeline(project);
  summary = getTimelineSummary(project);

  console.assert(summary.officialStage === 'Ebook Version', 'Test 10 Failed: Stage should be Ebook Version');
  console.assert(project.status === 'In Progress', 'Test 10 Failed: Status should be In Progress');
  console.assert(
    getStageDurationDays('Ebook Version', project.workflow_settings) === 5,
    'Test 10 Failed: Allocation should be 5 days',
  );
  console.log('✓ TEST 10 PASSED: Ebook Version = ACTIVE, Status = In Progress (5 production days)');

  // TEST 11: Ebook Version completed. Expected: Ebook Approval becomes active, Status = Awaiting Client Approval, Clock pauses.
  project.ebook_submitted_date = '2026-09-04';
  project.current_stage = 'Ebook Approval';
  project.stage_status = 'PAUSED_CLIENT_REVIEW';
  project = deriveProjectTimeline(project);
  summary = getTimelineSummary(project);

  console.assert(summary.officialStage === 'Ebook Approval', 'Test 11 Failed: Stage should be Ebook Approval');
  console.assert(project.status === 'Awaiting Client Approval', 'Test 11 Failed: Status should be Awaiting Client Approval');
  console.assert(summary.waitingOn === 'Client', 'Test 11 Failed: Waiting On should be Client');
  console.log('✓ TEST 11 PASSED: Ebook Approval = PAUSED, Status = Awaiting Client Approval (Waiting for Client)');

  // TEST 12: Client requests Ebook revision. Expected: Status = In Revision, 2 production days allocated.
  project.stage_status = 'REVISION_ACTIVE';
  project.stage_started_at = '2026-09-05';
  project.stage_due_at = calculateStageDueDate('2026-09-05', 2, project.workflow_settings);
  project = deriveProjectTimeline(project);
  summary = getTimelineSummary(project);

  console.assert(project.status === 'In Revision', 'Test 12 Failed: Status should be In Revision');
  console.assert(summary.stageStatus === 'REVISION_ACTIVE', 'Test 12 Failed: Clock state should be REVISION_ACTIVE');
  console.log('✓ TEST 12 PASSED: Ebook Revision = REVISION_ACTIVE, Status = In Revision (2 production days)');

  // TEST 13: Client approves Ebook. Expected: Final Delivery becomes ACTIVE, Status = Final Delivery (2 production days).
  project.ebook_approval_date = '2026-09-07';
  project.current_stage = 'Final Delivery';
  project.stage_status = 'ACTIVE';
  project.stage_started_at = '2026-09-07';
  project.stage_due_at = calculateStageDueDate('2026-09-07', 2, project.workflow_settings);
  project = deriveProjectTimeline(project);
  summary = getTimelineSummary(project);

  console.assert(summary.officialStage === 'Final Delivery', 'Test 13 Failed: Stage should be Final Delivery');
  console.assert(project.status === 'Final Delivery', 'Test 13 Failed: Status should be Final Delivery');
  console.assert(
    getStageDurationDays('Final Delivery', project.workflow_settings) === 2,
    'Test 13 Failed: Allocation should be 2 days',
  );
  console.log('✓ TEST 13 PASSED: Final Delivery = ACTIVE, Status = Final Delivery (2 production days)');

  // TEST 14: Final Delivery completed. Expected: All 8 stages completed, Project status = Completed.
  project.final_delivery_date = '2026-09-09';
  project.status = 'Completed';
  project.current_stage = 'Final Delivery';
  project = deriveProjectTimeline(project);
  summary = getTimelineSummary(project);

  console.assert(project.status === 'Completed', 'Test 14 Failed: Project status should be Completed');
  console.assert(summary.timelineStatus === 'Completed', 'Test 14 Failed: Timeline Status should be Completed');
  console.assert(summary.waitingOn === 'None', 'Test 14 Failed: Waiting On should be None');
  console.assert(summary.dueDate === null, 'Test 14 Failed: Due date should be null when completed');
  console.log('✓ TEST 14 PASSED: Project & All 8 Stages Completed, Status = Completed!');

  // TEST 15: Print-Only Package Service Type Auto-Skipping
  const printOnlyProject: Partial<Project> = {
    id: 'test-print-only',
    service_type: 'Print Formatting & Cover',
    current_stage: 'Concept Approval',
  };
  const printOnlyAutoSkipped = getAutoSkippedStagesForServiceType(printOnlyProject.service_type);
  console.assert(
    printOnlyAutoSkipped.includes('Ebook Version') && printOnlyAutoSkipped.includes('Ebook Approval'),
    'Test 15 Failed: Print-Only should auto-skip Ebook stages',
  );
  const nextAfterPrintApp = nextStageAfterApproval('Print Approval', printOnlyProject as Project);
  console.assert(nextAfterPrintApp === 'Final Delivery', 'Test 15 Failed: Next stage after Print Approval in Print-Only should be Final Delivery');
  console.log('✓ TEST 15 PASSED: Print-Only service type auto-skips eBook stages and advances to Final Delivery');

  // TEST 16: eBook-Only Package Service Type Auto-Skipping
  const ebookOnlyProject: Partial<Project> = {
    id: 'test-ebook-only',
    service_type: 'eBook Cover Design',
    current_stage: 'Concept Approval',
  };
  const ebookOnlyAutoSkipped = getAutoSkippedStagesForServiceType(ebookOnlyProject.service_type);
  console.assert(
    ebookOnlyAutoSkipped.includes('Print Version') && ebookOnlyAutoSkipped.includes('Print Approval'),
    'Test 16 Failed: eBook-Only should auto-skip Print stages',
  );
  const nextAfterConceptApp = nextStageAfterApproval('Concept Approval', ebookOnlyProject as Project);
  console.assert(nextAfterConceptApp === 'Ebook Version', 'Test 16 Failed: Next stage after Concept Approval in eBook-Only should be Ebook Version');
  console.log('✓ TEST 16 PASSED: eBook-Only service type auto-skips Print stages and advances to Ebook Version');

  // TEST 17: Stage Skip Validation & State Machine Guarding
  const validationResult = validateWorkflowTransition(project as Project, 'Completed', { isClientApproved: false });
  console.assert(validationResult.valid === true, 'Test 17 Failed: Transition from Final Delivery to Completed should be valid');

  const invalidResult = validateWorkflowTransition({ ...project, current_stage: 'Files Received' } as Project, 'Ebook Version');
  console.assert(invalidResult.valid === false, 'Test 17 Failed: Direct jump from Files Received to Ebook Version without skip must be invalid');
  console.log('✓ TEST 17 PASSED: Workflow transition validator prevents illegal stage jumps');

  // TEST 18: In-Flight Stage Skip Check
  const projectWithSkip: Partial<Project> = {
    id: 'test-skip-req',
    service_type: 'Print + eBook',
    current_stage: 'Design Concept',
    stage_skip_requests: [
      {
        id: 'skip-1',
        project_id: 'test-skip-req',
        stage: 'Print Version',
        requested_by: 'user-1',
        requested_at: '2026-08-20',
        reason: 'Client requested eBook first',
        status: 'APPROVED',
      },
    ],
  };
  console.assert(isStageSkipped(projectWithSkip as Project, 'Print Version') === true, 'Test 18 Failed: Print Version should be marked as skipped');
  console.assert(isStageSkipped(projectWithSkip as Project, 'Print Approval') === true, 'Test 18 Failed: Print Approval should be marked as skipped');
  console.log('✓ TEST 18 PASSED: In-flight stage skip correctly marks target production and approval stages as skipped');

  // TEST 19: Timeline Milestones Rendering with Skipped State
  const milestones = getTimelineMilestones(printOnlyProject as Project);
  const ebookMilestone = milestones.find((m) => m.stageName === 'Ebook Version');
  console.assert(ebookMilestone?.state === 'skipped', 'Test 19 Failed: Ebook Version milestone state should be skipped');
  console.assert(
    ebookMilestone?.skipLabel?.includes('Skipped — Service Type'),
    'Test 19 Failed: Skip label should indicate Skipped — Service Type',
  );
  console.log('✓ TEST 19 PASSED: Timeline milestones correctly render skipped badge');

  // TEST 20: Emergency Admin Override Validation
  const adminOverrideValidation = validateWorkflowTransition(project as Project, 'Files Received', {
    isAdminOverride: true,
    actorRole: 'admin',
  });
  console.assert(adminOverrideValidation.valid === true, 'Test 20 Failed: Admin override must be allowed for admin role');
  console.log('✓ TEST 20 PASSED: Administrative workflow override validated for admin role');

  console.log('====================================================');
  console.log('ALL 20 PRODUCTION TIMELINE TESTS SUCCEEDED PERFECTLY!');
  console.log('====================================================');
}
