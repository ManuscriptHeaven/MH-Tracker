import { timelineProgressByStage } from './constants';
import { daysUntil, formatDate, todayInput, toDateInput } from './date';
import type { Project, ProjectDraft, TimelineStage, TimelineStatus, TimelineWaitingOn } from './types';

export const publicHolidayDates = new Set<string>();
export const DESIGN_CONCEPT_CALENDAR_DAYS = 3;
export const PRINT_VERSION_CALENDAR_DAYS = 5;
export const EBOOK_VERSION_CALENDAR_DAYS = 2;
export const PRINT_ONLY_TIMELINE_DAYS = DESIGN_CONCEPT_CALENDAR_DAYS + PRINT_VERSION_CALENDAR_DAYS;
export const FULL_PROJECT_TIMELINE_DAYS = PRINT_ONLY_TIMELINE_DAYS + EBOOK_VERSION_CALENDAR_DAYS;

const timelineDateFields = [
  'files_received_date',
  'design_concept_due_date',
  'design_concept_submitted_date',
  'design_concept_approval_date',
  'concept_revision_due_date',
  'print_version_due_date',
  'print_version_submitted_date',
  'print_version_approval_date',
  'print_revision_due_date',
  'ebook_due_date',
  'ebook_submitted_date',
  'ebook_approval_date',
  'final_delivery_date',
] as const;

type TimelineProject = Partial<Project | ProjectDraft>;

export type ApprovalMilestone = 'concept' | 'print' | 'ebook';

export type TimelineHealth =
  | 'On Track'
  | 'Due Today'
  | 'Due Tomorrow'
  | 'Overdue'
  | 'Waiting for Client'
  | 'On Hold'
  | 'Completed';

export interface TimelineSummary {
  stage: TimelineStage;
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
}

export interface TimelineMilestone {
  key: string;
  label: string;
  date: string | null;
  state: 'completed' | 'current' | 'future' | 'paused' | 'overdue';
}

function parseDate(value?: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cleanDate(value?: string | null) {
  return parseDate(value) ? value!.slice(0, 10) : null;
}

export function addCalendarDays(startDate: string, days: number) {
  const date = parseDate(startDate);

  if (!date || days <= 0) {
    return cleanDate(startDate) || todayInput();
  }

  date.setDate(date.getDate() + days);

  return toDateInput(date);
}

function calendarDaysBetween(start?: string | null, end?: string | null) {
  const startDate = parseDate(start);
  const endDate = parseDate(end);

  if (!startDate || !endDate || endDate < startDate) {
    return 0;
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((endDate.getTime() - startDate.getTime()) / msPerDay);
}

function hasAnyTimelineDate(project: TimelineProject) {
  return timelineDateFields.some((field) => Boolean(project[field]));
}

function stageFromLegacyStatus(status?: string | null): TimelineStage {
  switch (status) {
    case 'Waiting for Files':
    case 'New':
      return 'Files Required';
    case 'Ready to Start':
      return 'Files Received';
    case 'Client Review':
    case 'Sent to Client':
    case 'First Proof Ready':
      return 'Awaiting Print Approval';
    case 'Revision Requested':
    case 'In Revision':
      return 'Print Revisions';
    case 'eBook Conversion':
      return 'eBook in Progress';
    case 'Final QA':
    case 'Ready for Delivery':
      return 'Final Quality Check';
    case 'Delivered':
    case 'Completed':
      return 'Completed';
    case 'On Hold':
      return 'On Hold';
    case 'Cancelled':
    case 'Archived':
      return 'Cancelled';
    default:
      return 'Print Version in Progress';
  }
}

export function projectRequiresEbook(project: TimelineProject) {
  const serviceType = (project.service_type || '').toLowerCase();
  return serviceType.includes('ebook') || serviceType.includes('e-book') || serviceType.includes('kindle');
}

export function estimatedFinalDueDate(project: TimelineProject) {
  const needsEbook = projectRequiresEbook(project);
  const finalDeliveryDate = cleanDate(project.final_delivery_date);
  const printApprovalDate = cleanDate(project.print_version_approval_date);
  const designApprovalDate = cleanDate(project.design_concept_approval_date);
  const filesReceivedDate = cleanDate(project.files_received_date);

  if (finalDeliveryDate) {
    return finalDeliveryDate;
  }

  if (printApprovalDate) {
    return needsEbook
      ? addCalendarDays(printApprovalDate, EBOOK_VERSION_CALENDAR_DAYS)
      : cleanDate(project.print_version_due_date) || printApprovalDate;
  }

  if (designApprovalDate) {
    return addCalendarDays(
      designApprovalDate,
      PRINT_VERSION_CALENDAR_DAYS + (needsEbook ? EBOOK_VERSION_CALENDAR_DAYS : 0),
    );
  }

  if (filesReceivedDate) {
    return addCalendarDays(filesReceivedDate, needsEbook ? FULL_PROJECT_TIMELINE_DAYS : PRINT_ONLY_TIMELINE_DAYS);
  }

  return cleanDate(project.due_date);
}

function syncEstimatedFinalDueDate<T extends TimelineProject>(project: T) {
  const finalDueDate = estimatedFinalDueDate(project);

  if (finalDueDate) {
    project.due_date = finalDueDate;
    project.internal_deadline = finalDueDate;
  }
}

function productionDaysUsed(project: TimelineProject) {
  return (
    calendarDaysBetween(project.files_received_date, project.design_concept_submitted_date) +
    calendarDaysBetween(project.design_concept_approval_date, project.print_version_submitted_date) +
    calendarDaysBetween(project.print_version_approval_date, project.ebook_submitted_date) +
    calendarDaysBetween(project.ebook_approval_date, project.final_delivery_date)
  );
}

function applyState<T extends TimelineProject>(
  project: T,
  stage: TimelineStage,
  timelineStatus: TimelineStatus,
  waitingOn: TimelineWaitingOn,
  clientActionRequired: string | null,
  syncStatus: boolean,
) {
  project.current_stage = stage;
  project.progress_percentage = timelineProgressByStage[stage];
  project.timeline_status = timelineStatus;
  project.waiting_on = waitingOn;
  project.client_action_required = clientActionRequired || '';
  project.production_days_used = productionDaysUsed(project);

  if (syncStatus && stage !== 'On Hold' && stage !== 'Cancelled') {
    project.status = stage as Project['status'];
  }
}

export function deriveProjectTimeline<T extends TimelineProject>(project: T, options: { syncStatus?: boolean } = {}) {
  const next = { ...project } as T;
  const syncStatus = Boolean(options.syncStatus);
  next.print_timeline_days = PRINT_VERSION_CALENDAR_DAYS;

  if (next.status === 'On Hold') {
    applyState(next, 'On Hold', 'On Hold', 'None', null, false);
    return next;
  }

  if (next.status === 'Cancelled' || next.status === 'Archived') {
    applyState(next, 'Cancelled', 'Cancelled', 'None', null, false);
    return next;
  }

  if (next.final_delivery_date) {
    syncEstimatedFinalDueDate(next);
    applyState(next, 'Completed', 'Completed', 'None', null, syncStatus);
    next.delivery_date = cleanDate(next.delivery_date) || cleanDate(next.final_delivery_date);
    return next;
  }

  if (next.ebook_approval_date) {
    syncEstimatedFinalDueDate(next);
    applyState(next, 'Final Quality Check', 'Active', 'Manuscript Heaven', null, syncStatus);
    return next;
  }

  if (next.ebook_submitted_date) {
    syncEstimatedFinalDueDate(next);
    applyState(next, 'eBook Review', 'Paused', 'Client', 'Review the eBook version', syncStatus);
    return next;
  }

  if (next.print_version_approval_date) {
    if (!next.print_version_due_date_manual && !next.print_version_due_date && next.design_concept_approval_date) {
      next.print_version_due_date = addCalendarDays(next.design_concept_approval_date, PRINT_VERSION_CALENDAR_DAYS);
    }

    if (projectRequiresEbook(next)) {
      if (!next.ebook_due_date_manual) {
        next.ebook_due_date = addCalendarDays(next.print_version_approval_date, EBOOK_VERSION_CALENDAR_DAYS);
      }
      syncEstimatedFinalDueDate(next);
      applyState(next, 'eBook in Progress', 'Active', 'Manuscript Heaven', null, syncStatus);
      return next;
    }

    if (!next.ebook_due_date_manual) {
      next.ebook_due_date = null;
    }
    syncEstimatedFinalDueDate(next);
    applyState(next, 'Final Quality Check', 'Active', 'Manuscript Heaven', null, syncStatus);
    return next;
  }

  if (next.print_version_submitted_date) {
    syncEstimatedFinalDueDate(next);
    applyState(next, 'Awaiting Print Approval', 'Paused', 'Client', 'Review and approve the complete print version', syncStatus);
    return next;
  }

  if (next.design_concept_approval_date) {
    if (!next.print_version_due_date_manual) {
      next.print_version_due_date = addCalendarDays(next.design_concept_approval_date, PRINT_VERSION_CALENDAR_DAYS);
    }
    syncEstimatedFinalDueDate(next);
    applyState(next, 'Print Version in Progress', 'Active', 'Manuscript Heaven', null, syncStatus);
    return next;
  }

  if (next.design_concept_submitted_date) {
    syncEstimatedFinalDueDate(next);
    applyState(next, 'Awaiting Concept Approval', 'Paused', 'Client', 'Review and approve the design concept', syncStatus);
    return next;
  }

  if (next.files_received_date) {
    if (!next.design_concept_due_date_manual) {
      next.design_concept_due_date = addCalendarDays(next.files_received_date, DESIGN_CONCEPT_CALENDAR_DAYS);
    }
    syncEstimatedFinalDueDate(next);
    applyState(next, 'Design Concept in Progress', 'Active', 'Manuscript Heaven', null, syncStatus);
    return next;
  }

  const stage = next.current_stage || (hasAnyTimelineDate(next) ? 'Files Required' : stageFromLegacyStatus(next.status));
  const timelineStatus: TimelineStatus =
    stage === 'Completed' ? 'Completed' : stage === 'On Hold' ? 'On Hold' : stage === 'Cancelled' ? 'Cancelled' : 'Paused';
  const waitingOn: TimelineWaitingOn = stage === 'Files Required' ? 'Client' : 'None';
  applyState(next, stage, timelineStatus, waitingOn, stage === 'Files Required' ? 'Upload required project files' : null, syncStatus);
  return next;
}

export function deadlineForStage(project: TimelineProject) {
  const stage = project.current_stage || stageFromLegacyStatus(project.status);

  switch (stage) {
    case 'Design Concept in Progress':
      return cleanDate(project.design_concept_due_date) || cleanDate(project.due_date);
    case 'Concept Revisions':
      return cleanDate(project.concept_revision_due_date) || cleanDate(project.design_concept_due_date) || cleanDate(project.due_date);
    case 'Print Version in Progress':
      return cleanDate(project.print_version_due_date) || cleanDate(project.due_date);
    case 'Print Revisions':
      return cleanDate(project.print_revision_due_date) || cleanDate(project.print_version_due_date) || cleanDate(project.due_date);
    case 'eBook in Progress':
      return cleanDate(project.ebook_due_date) || cleanDate(project.due_date);
    case 'Final Quality Check':
      return cleanDate(project.final_delivery_date) || estimatedFinalDueDate(project) || cleanDate(project.due_date);
    default:
      return null;
  }
}

export function nextMilestoneForProject(project: TimelineProject) {
  const stage = project.current_stage || stageFromLegacyStatus(project.status);

  switch (stage) {
    case 'Files Required':
      return 'Receive all required files';
    case 'Files Received':
    case 'Design Concept in Progress':
      return 'Complete Design Concept';
    case 'Awaiting Concept Approval':
      return 'Client to approve design concept';
    case 'Concept Revisions':
      return 'Complete Concept Revisions';
    case 'Print Version in Progress':
      return 'Complete Print Version';
    case 'Awaiting Print Approval':
      return 'Client to approve print version';
    case 'Print Revisions':
      return 'Complete Print Revisions';
    case 'eBook in Progress':
      return 'Complete eBook Version';
    case 'eBook Review':
      return 'Client to approve eBook version';
    case 'Final Quality Check':
      return 'Final delivery';
    case 'Completed':
      return 'Completed';
    case 'On Hold':
      return 'On hold';
    case 'Cancelled':
      return 'Cancelled';
    default:
      return 'Next milestone';
  }
}

export function getTimelineSummary(project: TimelineProject): TimelineSummary {
  const derived = deriveProjectTimeline(project);
  const dueDate = deadlineForStage(derived);
  const finalDueDate = estimatedFinalDueDate(derived);
  const daysRemaining = dueDate ? daysUntil(dueDate) : null;
  const waitingOn = derived.waiting_on || 'None';
  const timelineStatus = derived.timeline_status || 'Paused';
  const isOverdue =
    timelineStatus === 'Active' &&
    waitingOn === 'Manuscript Heaven' &&
    daysRemaining !== null &&
    daysRemaining < 0;

  let health: TimelineHealth = 'On Track';
  if (timelineStatus === 'Completed') {
    health = 'Completed';
  } else if (timelineStatus === 'On Hold' || derived.current_stage === 'On Hold') {
    health = 'On Hold';
  } else if (waitingOn === 'Client' || timelineStatus === 'Paused') {
    health = 'Waiting for Client';
  } else if (isOverdue) {
    health = 'Overdue';
  } else if (daysRemaining === 0) {
    health = 'Due Today';
  } else if (daysRemaining === 1) {
    health = 'Due Tomorrow';
  }

  return {
    stage: derived.current_stage || 'Files Required',
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
  };
}

export function getTimelineMilestones(project: TimelineProject): TimelineMilestone[] {
  const summary = getTimelineSummary(project);
  const currentStage = summary.stage;
  const waitingForClient = summary.waitingOn === 'Client';
  const hasEbookDates = Boolean(project.ebook_due_date || project.ebook_submitted_date || project.ebook_approval_date);
  const includesEbookStage = projectRequiresEbook(project) || hasEbookDates;

  const allSteps: Array<{ key: string; label: string; date: string | null; currentStages: TimelineStage[] }> = [
    { key: 'files', label: 'Files Received', date: cleanDate(project.files_received_date), currentStages: ['Files Required', 'Files Received'] },
    {
      key: 'concept',
      label: 'Design Concept',
      date: cleanDate(project.design_concept_submitted_date),
      currentStages: ['Design Concept in Progress', 'Concept Revisions'],
    },
    {
      key: 'concept-approval',
      label: 'Concept Approval',
      date: cleanDate(project.design_concept_approval_date),
      currentStages: ['Awaiting Concept Approval'],
    },
    {
      key: 'print',
      label: 'Print Version',
      date: cleanDate(project.print_version_submitted_date),
      currentStages: ['Print Version in Progress', 'Print Revisions'],
    },
    {
      key: 'print-approval',
      label: 'Print Approval',
      date: cleanDate(project.print_version_approval_date),
      currentStages: ['Awaiting Print Approval'],
    },
    {
      key: 'ebook',
      label: 'eBook Version',
      date: cleanDate(project.ebook_submitted_date) || cleanDate(project.ebook_approval_date),
      currentStages: ['eBook in Progress', 'eBook Review'],
    },
    { key: 'final', label: 'Final Delivery', date: cleanDate(project.final_delivery_date), currentStages: ['Final Quality Check', 'Completed'] },
  ];

  const steps = allSteps.filter((step) => includesEbookStage || step.key !== 'ebook');

  return steps.map((step) => {
    const isCurrent = step.currentStages.includes(currentStage);
    const state = step.date
      ? 'completed'
      : isCurrent && summary.isOverdue
        ? 'overdue'
        : isCurrent && waitingForClient
          ? 'paused'
          : isCurrent
            ? 'current'
            : 'future';

    return { ...step, state };
  });
}

function compareDates(first?: string | null, second?: string | null) {
  const firstDate = parseDate(first);
  const secondDate = parseDate(second);

  if (!firstDate || !secondDate) {
    return false;
  }

  return firstDate < secondDate;
}

export function validateTimelineDates(project: TimelineProject) {
  const errors: string[] = [];

  if (compareDates(project.design_concept_submitted_date, project.files_received_date)) {
    errors.push('Design concept submitted date cannot be earlier than files received date.');
  }

  if (compareDates(project.design_concept_approval_date, project.design_concept_submitted_date)) {
    errors.push('Design concept approval date cannot be earlier than design concept submitted date.');
  }

  if (compareDates(project.print_version_submitted_date, project.design_concept_approval_date)) {
    errors.push('Print version submitted date cannot be earlier than design concept approval date.');
  }

  if (compareDates(project.print_version_approval_date, project.print_version_submitted_date)) {
    errors.push('Print version approval date cannot be earlier than print version submitted date.');
  }

  if (compareDates(project.ebook_submitted_date, project.print_version_approval_date)) {
    errors.push('eBook submitted date cannot be earlier than print version approval date.');
  }

  if (compareDates(project.ebook_approval_date, project.ebook_submitted_date)) {
    errors.push('eBook approval date cannot be earlier than eBook submitted date.');
  }

  if (compareDates(project.final_delivery_date, project.ebook_approval_date || project.ebook_submitted_date)) {
    errors.push('Final delivery date cannot be earlier than the latest eBook review date.');
  }

  return errors;
}

export function approvalUpdateForMilestone(milestone: ApprovalMilestone) {
  const today = todayInput();

  if (milestone === 'concept') {
    return { design_concept_approval_date: today };
  }

  if (milestone === 'print') {
    return { print_version_approval_date: today };
  }

  return { ebook_approval_date: today };
}

function clearTimelineFrom(stage: TimelineStage): Partial<Project> {
  const fields: Partial<Project> = {};
  const clear = (keys: typeof timelineDateFields[number][]) => {
    keys.forEach((key) => {
      fields[key] = null;
    });
  };

  if (stage === 'Files Required') {
    clear([...timelineDateFields]);
  } else if (stage === 'Files Received' || stage === 'Design Concept in Progress') {
    clear([
      'design_concept_submitted_date',
      'design_concept_approval_date',
      'concept_revision_due_date',
      'print_version_due_date',
      'print_version_submitted_date',
      'print_version_approval_date',
      'print_revision_due_date',
      'ebook_due_date',
      'ebook_submitted_date',
      'ebook_approval_date',
      'final_delivery_date',
    ]);
  } else if (stage === 'Awaiting Concept Approval' || stage === 'Concept Revisions') {
    clear([
      'design_concept_approval_date',
      'print_version_due_date',
      'print_version_submitted_date',
      'print_version_approval_date',
      'print_revision_due_date',
      'ebook_due_date',
      'ebook_submitted_date',
      'ebook_approval_date',
      'final_delivery_date',
    ]);
  } else if (stage === 'Print Version in Progress') {
    clear([
      'print_version_submitted_date',
      'print_version_approval_date',
      'print_revision_due_date',
      'ebook_due_date',
      'ebook_submitted_date',
      'ebook_approval_date',
      'final_delivery_date',
    ]);
  } else if (stage === 'Awaiting Print Approval' || stage === 'Print Revisions') {
    clear([
      'print_version_approval_date',
      'ebook_due_date',
      'ebook_submitted_date',
      'ebook_approval_date',
      'final_delivery_date',
    ]);
  } else if (stage === 'eBook in Progress') {
    clear(['ebook_submitted_date', 'ebook_approval_date', 'final_delivery_date']);
  } else if (stage === 'eBook Review') {
    clear(['ebook_approval_date', 'final_delivery_date']);
  } else if (stage === 'Final Quality Check') {
    clear(['final_delivery_date']);
  }

  return fields;
}

export function timelineUpdateForStage(project: TimelineProject, stage: TimelineStage): Partial<Project> {
  const today = todayInput();
  const needsEbook = projectRequiresEbook(project) || stage === 'eBook in Progress' || stage === 'eBook Review';
  const filesReceivedDate = cleanDate(project.files_received_date) || today;
  const conceptSubmittedDate = cleanDate(project.design_concept_submitted_date) || today;
  const conceptApprovalDate = cleanDate(project.design_concept_approval_date) || today;
  const printSubmittedDate = cleanDate(project.print_version_submitted_date) || today;
  const printApprovalDate = cleanDate(project.print_version_approval_date) || today;
  const ebookSubmittedDate = cleanDate(project.ebook_submitted_date) || today;
  const ebookApprovalDate = cleanDate(project.ebook_approval_date) || today;

  const updates: Partial<Project> = {
    ...clearTimelineFrom(stage),
    status: stage as Project['status'],
    current_stage: stage,
  };

  if (stage === 'On Hold') {
    return {
      status: 'On Hold',
      current_stage: 'On Hold',
      timeline_status: 'On Hold',
      waiting_on: 'None',
      client_action_required: '',
    };
  }

  if (stage === 'Cancelled') {
    return {
      status: 'Cancelled',
      current_stage: 'Cancelled',
      timeline_status: 'Cancelled',
      waiting_on: 'None',
      client_action_required: '',
    };
  }

  if (stage !== 'Files Required') {
    updates.files_received_date = filesReceivedDate;
  }

  if (stage === 'Files Received' || stage === 'Design Concept in Progress') {
    updates.design_concept_due_date = addCalendarDays(filesReceivedDate, DESIGN_CONCEPT_CALENDAR_DAYS);
    updates.design_concept_due_date_manual = false;
  }

  if (stage === 'Awaiting Concept Approval' || stage === 'Concept Revisions') {
    updates.design_concept_submitted_date = conceptSubmittedDate;
    if (stage === 'Concept Revisions') {
      updates.concept_revision_due_date = cleanDate(project.concept_revision_due_date) || addCalendarDays(today, DESIGN_CONCEPT_CALENDAR_DAYS);
    }
  }

  if (
    stage === 'Print Version in Progress' ||
    stage === 'Awaiting Print Approval' ||
    stage === 'Print Revisions' ||
    stage === 'eBook in Progress' ||
    stage === 'eBook Review' ||
    stage === 'Final Quality Check' ||
    stage === 'Completed'
  ) {
    updates.design_concept_submitted_date = conceptSubmittedDate;
    updates.design_concept_approval_date = conceptApprovalDate;
    updates.print_version_due_date = addCalendarDays(conceptApprovalDate, PRINT_VERSION_CALENDAR_DAYS);
    updates.print_version_due_date_manual = false;
  }

  if (
    stage === 'Awaiting Print Approval' ||
    stage === 'Print Revisions' ||
    stage === 'eBook in Progress' ||
    stage === 'eBook Review' ||
    stage === 'Final Quality Check' ||
    stage === 'Completed'
  ) {
    updates.print_version_submitted_date = printSubmittedDate;
    if (stage === 'Print Revisions') {
      updates.print_revision_due_date = cleanDate(project.print_revision_due_date) || addCalendarDays(today, PRINT_VERSION_CALENDAR_DAYS);
    }
  }

  if (
    stage === 'eBook in Progress' ||
    stage === 'eBook Review' ||
    stage === 'Final Quality Check' ||
    stage === 'Completed'
  ) {
    updates.print_version_approval_date = printApprovalDate;
    if (needsEbook) {
      updates.ebook_due_date = addCalendarDays(printApprovalDate, EBOOK_VERSION_CALENDAR_DAYS);
      updates.ebook_due_date_manual = false;
    } else if (!project.ebook_due_date_manual) {
      updates.ebook_due_date = null;
    }
  }

  if (stage === 'eBook Review' || (needsEbook && (stage === 'Final Quality Check' || stage === 'Completed'))) {
    updates.ebook_submitted_date = ebookSubmittedDate;
  }

  if (needsEbook && (stage === 'Final Quality Check' || stage === 'Completed')) {
    updates.ebook_approval_date = ebookApprovalDate;
  }

  if (stage === 'Completed') {
    updates.final_delivery_date = cleanDate(project.final_delivery_date) || today;
    updates.delivery_date = cleanDate(project.delivery_date) || today;
  }

  const finalDueDate = estimatedFinalDueDate({ ...project, ...updates });
  if (finalDueDate) {
    updates.due_date = finalDueDate;
    updates.internal_deadline = finalDueDate;
  }
  updates.print_timeline_days = PRINT_VERSION_CALENDAR_DAYS;

  return updates;
}

export function revisionStageForProject(project: TimelineProject): TimelineStage {
  const stage = project.current_stage || stageFromLegacyStatus(project.status);

  if (stage === 'Awaiting Concept Approval' || stage === 'Design Concept in Progress' || stage === 'Concept Revisions') {
    return 'Concept Revisions';
  }

  return 'Print Revisions';
}

export function timelineDueText(project: TimelineProject) {
  const summary = getTimelineSummary(project);

  if (!summary.dueDate) {
    return 'No active production deadline';
  }

  const prefix = summary.health === 'Overdue' ? 'Overdue since' : 'Due';
  return `${prefix} ${formatDate(summary.dueDate)}`;
}
