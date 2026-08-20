import { DEFAULT_WORKFLOW_SETTINGS, officialTimelineStages, timelineProgressByStage } from './constants';
import { addWorkingDays, daysUntil, formatDate, todayInput, workingDaysBetween } from './date';
import type {
  ClockState,
  OfficialTimelineStage,
  Project,
  ProjectDraft,
  StageData,
  StageHistoryEntry,
  TimelineStage,
  TimelineStatus,
  TimelineWaitingOn,
  WorkflowSettings,
} from './types';

export const PRINT_VERSION_CALENDAR_DAYS = 5;
export const DESIGN_CONCEPT_CALENDAR_DAYS = 3;
export const EBOOK_VERSION_CALENDAR_DAYS = 5;
export const PRINT_ONLY_TIMELINE_DAYS = 8;
export const FULL_PROJECT_TIMELINE_DAYS = 15;

export function addCalendarDays(startDate: string, days: number) {
  return addWorkingDays(startDate, days, true);
}

export function projectRequiresEbook(project: TimelineProject) {
  return true; // All projects follow the 8-stage workflow including Ebook Version
}

export function validateTimelineDates(project: TimelineProject): string[] {
  return [];
}

export function revisionStageForProject(project: TimelineProject): TimelineStage {
  const norm = normalizeStage(project.current_stage || project.status);
  if (norm === 'Design Concept' || norm === 'Concept Approval') return 'Concept Approval';
  if (norm === 'Print Version' || norm === 'Print Approval') return 'Print Approval';
  if (norm === 'Ebook Version' || norm === 'Ebook Approval') return 'Ebook Approval';
  return 'Concept Approval';
}

export function approvalUpdateForMilestone(milestone: ApprovalMilestone) {
  const today = todayInput();
  if (milestone === 'concept') return { design_concept_approval_date: today };
  if (milestone === 'print') return { print_version_approval_date: today };
  return { ebook_approval_date: today };
}

export function timelineUpdateForStage(project: TimelineProject, stage: TimelineStage): Partial<Project> {
  const norm = normalizeStage(stage);
  const now = new Date().toISOString();
  const settings = getWorkflowSettings(project);
  const duration = getStageDurationDays(norm, settings, false);
  const due = calculateStageDueDate(now, duration, settings);

  if (norm === 'Completed') {
    return {
      status: 'Completed' as Project['status'],
      current_stage: 'Final Delivery',
      stage_status: 'COMPLETED',
      timeline_status: 'Completed',
      waiting_on: 'None',
      stage_completed_at: now,
      final_delivery_date: now.slice(0, 10),
      delivery_date: now.slice(0, 10),
      client_action_required: '',
      updated_at: now,
    };
  }

  if (norm === 'On Hold') {
    return {
      status: 'On Hold' as Project['status'],
      current_stage: 'On Hold',
      stage_status: 'COMPLETED',
      timeline_status: 'On Hold',
      waiting_on: 'None',
      client_action_required: '',
      updated_at: now,
    };
  }

  if (norm === 'Cancelled') {
    return {
      status: 'Cancelled' as Project['status'],
      current_stage: 'Cancelled',
      stage_status: 'COMPLETED',
      timeline_status: 'Cancelled',
      waiting_on: 'None',
      client_action_required: '',
      updated_at: now,
    };
  }

  const isApproval = isClientApprovalStage(norm);
  const standardStatus = isApproval
    ? ('Awaiting Client Approval' as Project['status'])
    : norm === 'Files Received'
      ? ('Active' as Project['status'])
      : norm === 'Final Delivery'
        ? ('Final Delivery' as Project['status'])
        : ('In Progress' as Project['status']);

  return {
    status: standardStatus,
    current_stage: norm as TimelineStage,
    stage_status: isApproval ? 'PAUSED_CLIENT_REVIEW' : 'ACTIVE',
    timeline_status: isApproval ? 'Paused' : 'Active',
    waiting_on: isApproval ? 'Client' : 'Manuscript Heaven',
    client_action_required: isApproval
      ? norm === 'Concept Approval'
        ? 'Review and approve the design concept'
        : norm === 'Print Approval'
          ? 'Review and approve the print version'
          : 'Review and approve the eBook version'
      : '',
    stage_started_at: now,
    stage_due_at: isApproval ? null : due,
    updated_at: now,
  };
}

type TimelineProject = Partial<Project | ProjectDraft>;

export type ApprovalMilestone = 'concept' | 'print' | 'ebook';

export type TimelineHealth =
  | 'On Track'
  | 'Due Today'
  | 'Due Tomorrow'
  | 'Overdue'
  | 'Waiting for Client'
  | 'Revision Required'
  | 'On Hold'
  | 'Completed';

export interface TimelineSummary {
  stage: TimelineStage;
  officialStage: OfficialTimelineStage | 'Completed' | 'On Hold' | 'Cancelled';
  stageStatus: ClockState;
  progress: number;
  timelineStatus: TimelineStatus;
  waitingOn: TimelineWaitingOn;
  nextMilestone: string;
  dueDate: string | null;
  finalDueDate: string | null;
  clientActionRequired: string | null;
  daysRemaining: number | null;
  health: TimelineHealth;
  isOverdue: boolean;
  revisionCount: number;
}

export interface TimelineMilestone {
  key: string;
  label: string;
  stageName: OfficialTimelineStage;
  date: string | null;
  state: 'completed' | 'current' | 'future' | 'paused' | 'revision' | 'overdue';
  isApproval: boolean;
  durationDays: number;
}

export function normalizeStage(stage?: string | null): OfficialTimelineStage | 'Completed' | 'On Hold' | 'Cancelled' {
  switch (stage) {
    case 'Files Required':
    case 'Files Received':
    case 'New':
    case 'Waiting for Files':
    case 'Ready to Start':
      return 'Files Received';
    case 'Design Concept in Progress':
    case 'Design Concept':
      return 'Design Concept';
    case 'Awaiting Concept Approval':
    case 'Concept Approval':
    case 'Concept Revisions':
      return 'Concept Approval';
    case 'Print Version in Progress':
    case 'Print Version':
      return 'Print Version';
    case 'Awaiting Print Approval':
    case 'Print Approval':
    case 'Print Revisions':
      return 'Print Approval';
    case 'eBook in Progress':
    case 'eBook Conversion':
    case 'Ebook Version':
    case 'eBook Version':
      return 'Ebook Version';
    case 'eBook Review':
    case 'Ebook Approval':
      return 'Ebook Approval';
    case 'Final Quality Check':
    case 'Final Delivery':
    case 'Ready for Delivery':
    case 'Final QA':
      return 'Final Delivery';
    case 'Completed':
    case 'Delivered':
      return 'Completed';
    case 'On Hold':
      return 'On Hold';
    case 'Cancelled':
    case 'Archived':
      return 'Cancelled';
    default:
      return 'Files Received';
  }
}

export function isClientApprovalStage(stage?: string | null): boolean {
  const norm = normalizeStage(stage);
  return norm === 'Concept Approval' || norm === 'Print Approval' || norm === 'Ebook Approval';
}

export function isProductionStage(stage?: string | null): boolean {
  const norm = normalizeStage(stage);
  return (
    norm === 'Files Received' ||
    norm === 'Design Concept' ||
    norm === 'Print Version' ||
    norm === 'Ebook Version' ||
    norm === 'Final Delivery'
  );
}

export function getWorkflowSettings(project: TimelineProject): WorkflowSettings {
  return project.workflow_settings || DEFAULT_WORKFLOW_SETTINGS;
}

export function getStageDurationDays(
  stage: TimelineStage,
  settings: WorkflowSettings = DEFAULT_WORKFLOW_SETTINGS,
  isRevision: boolean = false,
): number {
  const norm = normalizeStage(stage);

  if (isClientApprovalStage(norm)) {
    return isRevision ? 2 : 0; // Client approval stages do NOT consume production time; revisions allocate 2 working days
  }

  switch (norm) {
    case 'Files Received':
      return settings.files_received_days ?? 2;
    case 'Design Concept':
      return isRevision
        ? (settings.design_concept_revision_days ?? 2)
        : (settings.design_concept_days ?? 3);
    case 'Print Version':
      return isRevision
        ? (settings.print_version_revision_days ?? 2)
        : (settings.print_version_days ?? 5);
    case 'Ebook Version':
      return isRevision
        ? (settings.ebook_version_revision_days ?? 2)
        : (settings.ebook_version_days ?? 5);
    case 'Final Delivery':
      return settings.final_delivery_days ?? 2;
    default:
      return 0;
  }
}

export function calculateStageDueDate(
  startDate: string,
  days: number,
  settings: WorkflowSettings = DEFAULT_WORKFLOW_SETTINGS,
): string {
  if (days <= 0) return startDate.slice(0, 10);
  return addWorkingDays(startDate, days, settings.exclude_weekends ?? true);
}

export function approvalStageForProductionStage(stage: OfficialTimelineStage): OfficialTimelineStage | null {
  switch (stage) {
    case 'Design Concept':
      return 'Concept Approval';
    case 'Print Version':
      return 'Print Approval';
    case 'Ebook Version':
      return 'Ebook Approval';
    default:
      return null;
  }
}

export function nextStageAfterApproval(stage: OfficialTimelineStage): OfficialTimelineStage | 'Completed' {
  switch (stage) {
    case 'Files Received':
      return 'Design Concept';
    case 'Design Concept':
    case 'Concept Approval':
      return 'Print Version';
    case 'Print Version':
    case 'Print Approval':
      return 'Ebook Version';
    case 'Ebook Version':
    case 'Ebook Approval':
      return 'Final Delivery';
    case 'Final Delivery':
      return 'Completed';
    default:
      return 'Completed';
  }
}

export function milestoneForApprovalStage(stage: TimelineStage): ApprovalMilestone | null {
  const norm = normalizeStage(stage);
  if (norm === 'Concept Approval') return 'concept';
  if (norm === 'Print Approval') return 'print';
  if (norm === 'Ebook Approval') return 'ebook';
  return null;
}

export function estimatedFinalDueDate(project: TimelineProject): string | null {
  if (project.final_due_at) return project.final_due_at.slice(0, 10);
  if (project.final_delivery_date) return project.final_delivery_date.slice(0, 10);
  if (project.due_date) return project.due_date.slice(0, 10);

  const startDate = project.files_received_date || project.start_date || todayInput();
  const settings = getWorkflowSettings(project);
  const totalDays =
    (settings.files_received_days ?? 2) +
    (settings.design_concept_days ?? 3) +
    (settings.print_version_days ?? 5) +
    (settings.ebook_version_days ?? 5) +
    (settings.final_delivery_days ?? 2);

  return calculateStageDueDate(startDate, totalDays, settings);
}

export function deriveProjectTimeline<T extends TimelineProject>(
  project: T,
  options: { syncStatus?: boolean } = {},
): T {
  const next = { ...project } as T;
  const syncStatus = Boolean(options.syncStatus);
  const settings = getWorkflowSettings(next);

  // If explicitly on hold or cancelled
  if (next.status === 'On Hold' || next.current_stage === 'On Hold') {
    next.status = 'On Hold';
    next.current_stage = 'On Hold';
    next.stage_status = 'COMPLETED';
    next.timeline_status = 'On Hold';
    next.waiting_on = 'None';
    next.client_action_required = '';
    next.progress_percentage = 0;
    return next;
  }

  if (next.status === 'Cancelled' || next.status === 'Archived' || next.current_stage === 'Cancelled') {
    next.status = 'Cancelled';
    next.current_stage = 'Cancelled';
    next.stage_status = 'COMPLETED';
    next.timeline_status = 'Cancelled';
    next.waiting_on = 'None';
    next.client_action_required = '';
    next.progress_percentage = 0;
    return next;
  }

  // A project is ONLY genuinely completed if Final Delivery was completed
  const isGenuinelyCompleted = Boolean(
    next.final_delivery_date ||
    (next.status === 'Completed' && (next.current_stage === 'Final Delivery' || next.current_stage === 'Completed' || next.delivery_date))
  );

  if (isGenuinelyCompleted) {
    next.status = 'Completed';
    next.current_stage = 'Final Delivery';
    next.stage_status = 'COMPLETED';
    next.timeline_status = 'Completed';
    next.waiting_on = 'None';
    next.client_action_required = '';
    next.progress_percentage = 100;
    return next;
  }

  // Recalculate normalized stage
  const rawStage = next.current_stage || next.status;
  const normStage = normalizeStage(rawStage === 'Completed' ? 'Print Approval' : rawStage);

  next.current_stage = (normStage === 'Completed' ? 'Final Delivery' : normStage) as TimelineStage;
  next.progress_percentage = timelineProgressByStage[next.current_stage as TimelineStage] || 10;

  if (isClientApprovalStage(next.current_stage)) {
    if (next.stage_status === 'REVISION_ACTIVE') {
      next.status = 'In Revision';
      next.timeline_status = 'Revision Required';
      next.waiting_on = 'Manuscript Heaven';
      next.client_action_required = '';
      if (!next.stage_due_at) {
        const revStart = next.stage_started_at || todayInput();
        const revDays = getStageDurationDays(next.current_stage, settings, true);
        next.stage_due_at = calculateStageDueDate(revStart, revDays, settings);
      }
    } else {
      next.stage_status = 'PAUSED_CLIENT_REVIEW';
      next.timeline_status = 'Paused';
      next.waiting_on = 'Client';
      next.status = 'Awaiting Client Approval';
      next.client_action_required =
        next.current_stage === 'Concept Approval'
          ? 'Review and approve the design concept'
          : next.current_stage === 'Print Approval'
            ? 'Review and approve the print version'
            : 'Review and approve the eBook version';
      next.stage_due_at = null; // Production clock is paused
    }
  } else {
    // Production Stage: Files Received, Design Concept, Print Version, Ebook Version, Final Delivery
    next.stage_status = 'ACTIVE';
    next.timeline_status = 'Active';
    next.waiting_on = 'Manuscript Heaven';
    next.client_action_required = '';

    if (!next.stage_due_at) {
      const stageStart = next.stage_started_at || next.files_received_date || todayInput();
      const duration = getStageDurationDays(next.current_stage, settings, false);
      next.stage_due_at = calculateStageDueDate(stageStart, duration, settings);
    }

    if (next.current_stage === 'Files Received') {
      next.status = 'Active';
    } else if (next.current_stage === 'Final Delivery') {
      next.status = 'Final Delivery';
    } else {
      next.status = 'In Progress';
    }
  }

  const finalDue = estimatedFinalDueDate(next);
  if (finalDue) {
    next.due_date = finalDue;
    next.internal_deadline = finalDue;
    next.final_due_at = finalDue;
  }

  return next;
}

export function deadlineForStage(project: TimelineProject): string | null {
  const derived = deriveProjectTimeline(project);

  if (
    derived.waiting_on === 'Client' ||
    derived.timeline_status === 'Paused' ||
    derived.timeline_status === 'Completed' ||
    derived.current_stage === 'Completed'
  ) {
    return null; // Clock is paused or completed
  }

  return derived.stage_due_at ? derived.stage_due_at.slice(0, 10) : null;
}

export function nextMilestoneForProject(project: TimelineProject): string {
  const derived = deriveProjectTimeline(project);
  const stage = derived.current_stage;

  switch (stage) {
    case 'Files Received':
      return 'Complete initial file setup';
    case 'Design Concept':
      return 'Complete Design Concept & send for approval';
    case 'Concept Approval':
      return derived.stage_status === 'REVISION_ACTIVE'
        ? 'Complete requested Concept Revision'
        : 'Client to approve Design Concept';
    case 'Print Version':
      return 'Complete Print Version & send for approval';
    case 'Print Approval':
      return derived.stage_status === 'REVISION_ACTIVE'
        ? 'Complete requested Print Revision'
        : 'Client to approve Print Version';
    case 'Ebook Version':
      return 'Complete eBook Version & send for approval';
    case 'Ebook Approval':
      return derived.stage_status === 'REVISION_ACTIVE'
        ? 'Complete requested eBook Revision'
        : 'Client to approve eBook Version';
    case 'Final Delivery':
      return 'Complete final project delivery';
    case 'Completed':
      return 'Project Completed';
    case 'On Hold':
      return 'Project On Hold';
    case 'Cancelled':
      return 'Project Cancelled';
    default:
      return 'Next production milestone';
  }
}

export function getTimelineSummary(project: TimelineProject): TimelineSummary {
  const derived = deriveProjectTimeline(project);
  const settings = getWorkflowSettings(derived);
  const officialStage = normalizeStage(derived.current_stage);
  const stageStatus = derived.stage_status || (derived.waiting_on === 'Client' ? 'PAUSED_CLIENT_REVIEW' : 'ACTIVE');
  const waitingOn = derived.waiting_on || 'None';
  const timelineStatus = derived.timeline_status || 'Active';

  const dueDate = deadlineForStage(derived);
  const finalDueDate = estimatedFinalDueDate(derived);

  let daysRemaining: number | null = null;
  let isOverdue = false;

  if (waitingOn === 'Manuscript Heaven' && dueDate) {
    const today = todayInput();
    daysRemaining = workingDaysBetween(today, dueDate, settings.exclude_weekends ?? true);

    if (daysUntil(dueDate) < 0) {
      daysRemaining = daysUntil(dueDate); // Negative days if past due date
      isOverdue = true;
    }
  }

  let health: TimelineHealth = 'On Track';
  if (timelineStatus === 'Completed') {
    health = 'Completed';
  } else if (timelineStatus === 'On Hold') {
    health = 'On Hold';
  } else if (waitingOn === 'Client' || timelineStatus === 'Paused') {
    health = 'Waiting for Client';
  } else if (stageStatus === 'REVISION_ACTIVE') {
    health = 'Revision Required';
  } else if (isOverdue) {
    health = 'Overdue';
  } else if (daysRemaining === 0) {
    health = 'Due Today';
  } else if (daysRemaining === 1) {
    health = 'Due Tomorrow';
  }

  return {
    stage: (derived.current_stage || 'Files Received') as TimelineStage,
    officialStage,
    stageStatus,
    progress: Number(derived.progress_percentage || 0),
    timelineStatus,
    waitingOn,
    nextMilestone: nextMilestoneForProject(derived),
    dueDate,
    finalDueDate,
    clientActionRequired: derived.client_action_required || null,
    daysRemaining,
    health,
    isOverdue,
    revisionCount: Number(derived.revision_count || 0),
  };
}

export function getTimelineMilestones(project: TimelineProject): TimelineMilestone[] {
  const summary = getTimelineSummary(project);
  const settings = getWorkflowSettings(project);
  const currentNorm = normalizeStage(summary.stage);
  const currentIdx = officialTimelineStages.indexOf(currentNorm as OfficialTimelineStage);

  const stageDateMap: Record<OfficialTimelineStage, string | null> = {
    'Files Received': project.files_received_date || null,
    'Design Concept': project.design_concept_submitted_date || null,
    'Concept Approval': project.design_concept_approval_date || null,
    'Print Version': project.print_version_submitted_date || null,
    'Print Approval': project.print_version_approval_date || null,
    'Ebook Version': project.ebook_submitted_date || null,
    'Ebook Approval': project.ebook_approval_date || null,
    'Final Delivery': project.final_delivery_date || null,
  };

  return officialTimelineStages.map((stageName, index) => {
    const isApproval = isClientApprovalStage(stageName);
    const durationDays = getStageDurationDays(stageName, settings, false);
    const date = stageDateMap[stageName];

    let state: TimelineMilestone['state'] = 'future';

    if (summary.officialStage === 'Completed' || (currentIdx >= 0 && index < currentIdx)) {
      state = 'completed';
    } else if (index === currentIdx) {
      if (summary.health === 'Overdue') {
        state = 'overdue';
      } else if (summary.stageStatus === 'REVISION_ACTIVE') {
        state = 'revision';
      } else if (summary.waitingOn === 'Client' || summary.stageStatus === 'PAUSED_CLIENT_REVIEW') {
        state = 'paused';
      } else {
        state = 'current';
      }
    }

    return {
      key: `stage-${index + 1}-${stageName.toLowerCase().replace(/\s+/g, '-')}`,
      label: stageName,
      stageName,
      date,
      state,
      isApproval,
      durationDays,
    };
  });
}

export function timelineDueText(project: TimelineProject): string {
  const summary = getTimelineSummary(project);

  if (summary.waitingOn === 'Client' || summary.timelineStatus === 'Paused') {
    return 'Clock Paused (Waiting for Client)';
  }

  if (!summary.dueDate) {
    return 'No active production deadline';
  }

  const prefix = summary.health === 'Overdue' ? 'Overdue since' : 'Due';
  return `${prefix} ${formatDate(summary.dueDate)}`;
}

export function createStageHistoryEntry(
  project: Project,
  action: string,
  actorId?: string | null,
  notes?: string | null,
): StageHistoryEntry {
  const now = new Date().toISOString();
  return {
    id: `history-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    project_id: project.id,
    stage: project.current_stage || 'Files Received',
    status: project.stage_status || 'ACTIVE',
    started_at: project.stage_started_at || project.created_at || now,
    paused_at: project.stage_status === 'PAUSED_CLIENT_REVIEW' ? now : null,
    due_at: project.stage_due_at || null,
    active_seconds: project.production_time_used || 0,
    client_wait_seconds: project.client_wait_time || 0,
    actor_id: actorId || null,
    action,
    notes: notes || null,
    created_at: now,
  };
}
