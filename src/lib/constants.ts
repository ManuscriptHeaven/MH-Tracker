import type {
  ClientRevisionPriority,
  ClientRevisionStatus,
  PaymentStatus,
  Priority,
  ProjectStatus,
  RevisionItemStatus,
  RevisionStatus,
  Role,
  TaskStatus,
  TimelineStage,
} from './types';

export const roleLabels: Record<Role, string> = {
  admin: 'Admin',
  manager: 'Manager',
  project_manager: 'Project Manager',
  employee: 'Employee / Designer',
  junior_assistant: 'Junior Assistant',
  client: 'Client',
};

export const serviceTypes = [
  'Print Formatting',
  'eBook Formatting',
  'Cover Design',
  'Print + eBook',
  "Children's Book",
  'Workbook / Journal',
  'Magazine',
  'Revision Only',
  'Other',
];

export const platforms = [
  'Amazon KDP',
  'IngramSpark',
  'Lulu',
  'Barnes & Noble',
  'Draft2Digital',
  'Other',
];

export const priorityOptions: Priority[] = ['Low', 'Normal', 'High', 'Urgent'];

export const paymentStatuses: PaymentStatus[] = [
  'Not Started',
  'Advance Paid',
  'Partially Paid',
  'Fully Paid',
  'Pending',
  'Refunded',
];

export const revisionStatuses: RevisionStatus[] = ['Pending', 'In Progress', 'Completed'];

export const clientRevisionPriorityOptions: ClientRevisionPriority[] = ['Normal', 'Important', 'Urgent'];

export const clientRevisionStatuses: ClientRevisionStatus[] = [
  'Submitted',
  'Under Review',
  'In Progress',
  'Ready for Client Review',
  'Approved',
  'Completed',
];

export const revisionItemStatuses: RevisionItemStatus[] = ['Open', 'Under Review', 'In Progress', 'Completed'];

export const taskStatuses: TaskStatus[] = ['To Do', 'In Progress', 'Done'];

export const allProjectStatuses: ProjectStatus[] = [
  'New',
  'Waiting for Files',
  'Files Required',
  'Files Received',
  'Design Concept in Progress',
  'Awaiting Concept Approval',
  'Concept Revisions',
  'Print Version in Progress',
  'Awaiting Print Approval',
  'Print Revisions',
  'eBook in Progress',
  'eBook Review',
  'Final Quality Check',
  'Completed',
  'Ready to Start',
  'In Progress',
  'Formatting',
  'Cover Design',
  'eBook Conversion',
  'First Proof Ready',
  'Sent to Client',
  'Client Review',
  'Revision Requested',
  'In Revision',
  'Final QA',
  'Ready for Delivery',
  'Delivered',
  'On Hold',
  'Archived',
  'Cancelled',
];

export const statusOptions: ProjectStatus[] = [
  'Files Required',
  'Files Received',
  'Design Concept in Progress',
  'Awaiting Concept Approval',
  'Concept Revisions',
  'Print Version in Progress',
  'Awaiting Print Approval',
  'Print Revisions',
  'eBook in Progress',
  'eBook Review',
  'Final Quality Check',
  'Completed',
  'On Hold',
  'Cancelled',
];

export function isProjectStatus(value: string): value is ProjectStatus {
  return allProjectStatuses.includes(value as ProjectStatus);
}

export function projectStatusChoices(currentStatus?: string | null): ProjectStatus[] {
  if (currentStatus && isProjectStatus(currentStatus) && !statusOptions.includes(currentStatus)) {
    return [currentStatus, ...statusOptions];
  }

  return statusOptions;
}

export const closedStatuses: ProjectStatus[] = ['Delivered', 'Completed', 'Cancelled', 'Archived'];

export const activeClientProjectStatuses: ProjectStatus[] = [
  'New',
  'Files Required',
  'Files Received',
  'Design Concept in Progress',
  'Awaiting Concept Approval',
  'Concept Revisions',
  'Print Version in Progress',
  'Awaiting Print Approval',
  'Print Revisions',
  'eBook in Progress',
  'eBook Review',
  'Final Quality Check',
  'Ready to Start',
  'In Progress',
  'Client Review',
  'Revision Requested',
  'In Revision',
  'Ready for Delivery',
];

export const statusBadgeClasses: Record<ProjectStatus, string> = {
  New: 'bg-blue-50 text-info border-blue-100',
  'Waiting for Files': 'bg-stone-100 text-stone-700 border-stone-200',
  'Files Required': 'bg-stone-100 text-stone-700 border-stone-200',
  'Files Received': 'bg-blue-50 text-info border-blue-100',
  'Design Concept in Progress': 'bg-blue-50 text-blue-700 border-blue-100',
  'Awaiting Concept Approval': 'bg-amber-50 text-amber-800 border-amber-200',
  'Concept Revisions': 'bg-orange-50 text-orange-700 border-orange-100',
  'Print Version in Progress': 'bg-sky-50 text-sky-700 border-sky-100',
  'Awaiting Print Approval': 'bg-amber-50 text-amber-800 border-amber-200',
  'Print Revisions': 'bg-orange-50 text-orange-700 border-orange-100',
  'eBook in Progress': 'bg-indigo-50 text-indigo-700 border-indigo-100',
  'eBook Review': 'bg-amber-50 text-amber-800 border-amber-200',
  'Final Quality Check': 'bg-yellow-50 text-yellow-800 border-yellow-200',
  Completed: 'bg-green-50 text-success border-green-100',
  'Ready to Start': 'bg-blue-50 text-info border-blue-100',
  'In Progress': 'bg-amber-50 text-amber-800 border-amber-200',
  Formatting: 'bg-amber-50 text-amber-800 border-amber-200',
  'Cover Design': 'bg-purple-50 text-purple-700 border-purple-100',
  'eBook Conversion': 'bg-indigo-50 text-indigo-700 border-indigo-100',
  'First Proof Ready': 'bg-blue-50 text-blue-700 border-blue-100',
  'Sent to Client': 'bg-cyan-50 text-cyan-700 border-cyan-100',
  'Client Review': 'bg-orange-50 text-orange-700 border-orange-100',
  'Revision Requested': 'bg-red-50 text-danger border-red-100',
  'In Revision': 'bg-orange-50 text-orange-700 border-orange-100',
  'Final QA': 'bg-yellow-50 text-yellow-800 border-yellow-200',
  'Ready for Delivery': 'bg-green-50 text-success border-green-100',
  Delivered: 'bg-green-50 text-success border-green-100',
  'On Hold': 'bg-stone-100 text-stone-700 border-stone-200',
  Archived: 'bg-stone-100 text-stone-700 border-stone-200',
  Cancelled: 'bg-red-50 text-danger border-red-100',
};

export const priorityBadgeClasses: Record<Priority, string> = {
  Low: 'bg-stone-100 text-stone-700 border-stone-200',
  Normal: 'bg-blue-50 text-info border-blue-100',
  High: 'bg-orange-50 text-orange-700 border-orange-100',
  Urgent: 'bg-red-50 text-danger border-red-100',
};

export const taskStatusBadgeClasses: Record<TaskStatus, string> = {
  'To Do': 'bg-stone-100 text-stone-700 border-stone-200',
  'In Progress': 'bg-amber-50 text-amber-800 border-amber-200',
  Done: 'bg-green-50 text-success border-green-100',
};

export const paymentBadgeClasses: Record<PaymentStatus, string> = {
  'Not Started': 'bg-stone-100 text-stone-700 border-stone-200',
  'Advance Paid': 'bg-blue-50 text-info border-blue-100',
  'Partially Paid': 'bg-amber-50 text-amber-800 border-amber-200',
  'Fully Paid': 'bg-green-50 text-success border-green-100',
  Pending: 'bg-orange-50 text-orange-700 border-orange-100',
  Refunded: 'bg-red-50 text-danger border-red-100',
};

export const timelineStages: TimelineStage[] = [
  'Files Required',
  'Files Received',
  'Design Concept in Progress',
  'Awaiting Concept Approval',
  'Concept Revisions',
  'Print Version in Progress',
  'Awaiting Print Approval',
  'Print Revisions',
  'eBook in Progress',
  'eBook Review',
  'Final Quality Check',
  'Completed',
  'On Hold',
  'Cancelled',
];

export const timelineProgressByStage: Record<TimelineStage, number> = {
  'Files Required': 0,
  'Files Received': 10,
  'Design Concept in Progress': 20,
  'Awaiting Concept Approval': 30,
  'Concept Revisions': 35,
  'Print Version in Progress': 50,
  'Awaiting Print Approval': 70,
  'Print Revisions': 75,
  'eBook in Progress': 85,
  'eBook Review': 90,
  'Final Quality Check': 95,
  Completed: 100,
  'On Hold': 0,
  Cancelled: 0,
};
