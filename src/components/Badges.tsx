import type { ReactNode } from 'react';
import {
  paymentBadgeClasses,
  priorityBadgeClasses,
  roleLabels,
  statusBadgeClasses,
  taskStatusBadgeClasses,
} from '../lib/constants';
import { cn } from '../lib/utils';
import type { PaymentStatus, Priority, ProjectStatus, Role, TaskStatus } from '../lib/types';

function Badge({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span
      className={cn(
        'inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-semibold',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge className={statusBadgeClasses[status]}>{status}</Badge>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge className={priorityBadgeClasses[priority]}>{priority}</Badge>;
}

export function PaymentBadge({ status }: { status: PaymentStatus | string }) {
  const badgeClass =
    paymentBadgeClasses[status as PaymentStatus] ||
    'bg-amber-50 text-amber-800 border-amber-200';
  return <Badge className={badgeClass}>{status || 'Pending'}</Badge>;
}

export function RoleBadge({ role }: { role: Role }) {
  return <Badge className="border-gold/40 bg-gold/10 text-ink">{roleLabels[role]}</Badge>;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Badge className={taskStatusBadgeClasses[status]}>{status}</Badge>;
}

export function PayrollStatusBadge({ status }: { status: string }) {
  let badgeClass = 'bg-blue-50 text-blue-800 border-blue-200';
  if (status === 'Paid') {
    badgeClass = 'bg-emerald-50 text-emerald-800 border-emerald-200';
  } else if (status === 'Partially Paid' || status === 'Partial') {
    badgeClass = 'bg-amber-50 text-amber-800 border-amber-200';
  } else if (status === 'Overdue') {
    badgeClass = 'bg-rose-50 text-rose-800 border-rose-200';
  } else if (status === 'Pending') {
    badgeClass = 'bg-sky-50 text-sky-800 border-sky-200';
  }
  return <Badge className={badgeClass}>{status || 'Pending'}</Badge>;
}
