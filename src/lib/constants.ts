import type {
  ClientRevisionPriority,
  ClientRevisionStatus,
  PaymentStatus,
  Priority,
  ProjectStatus,
  RevisionItemStatus,
  RevisionStatus,
  Role,
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
  'Assigned',
  'In Progress',
  'Ready for Client Review',
  'Additional Revision Required',
  'Approved',
  'Completed',
];

export const revisionItemStatuses: RevisionItemStatus[] = ['Open', 'Under Review', 'In Progress', 'Completed'];

export const statusOptions: ProjectStatus[] = [
  'New',
  'Waiting for Files',
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
  'Cancelled',
];

export const closedStatuses: ProjectStatus[] = ['Delivered', 'Cancelled'];

export const statusBadgeClasses: Record<ProjectStatus, string> = {
  New: 'bg-blue-50 text-info border-blue-100',
  'Waiting for Files': 'bg-stone-100 text-stone-700 border-stone-200',
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
  Cancelled: 'bg-red-50 text-danger border-red-100',
};

export const priorityBadgeClasses: Record<Priority, string> = {
  Low: 'bg-stone-100 text-stone-700 border-stone-200',
  Normal: 'bg-blue-50 text-info border-blue-100',
  High: 'bg-orange-50 text-orange-700 border-orange-100',
  Urgent: 'bg-red-50 text-danger border-red-100',
};

export const paymentBadgeClasses: Record<PaymentStatus, string> = {
  'Not Started': 'bg-stone-100 text-stone-700 border-stone-200',
  'Advance Paid': 'bg-blue-50 text-info border-blue-100',
  'Partially Paid': 'bg-amber-50 text-amber-800 border-amber-200',
  'Fully Paid': 'bg-green-50 text-success border-green-100',
  Pending: 'bg-orange-50 text-orange-700 border-orange-100',
  Refunded: 'bg-red-50 text-danger border-red-100',
};
