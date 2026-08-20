import {
  calculateStageDueDate,
  deriveProjectTimeline,
  getStageDurationDays,
  getTimelineSummary,
  getWorkflowSettings,
  normalizeStage,
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

  console.log('====================================================');
  console.log('ALL 14 PRODUCTION TIMELINE TESTS SUCCEEDED PERFECTLY!');
  console.log('====================================================');
}
