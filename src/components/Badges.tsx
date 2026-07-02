import type { ReactNode } from 'react';
import { paymentBadgeClasses, priorityBadgeClasses, roleLabels, statusBadgeClasses } from '../lib/constants';
import { cn } from '../lib/utils';
import type { PaymentStatus, Priority, ProjectStatus, Role } from '../lib/types';

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

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  return <Badge className={paymentBadgeClasses[status]}>{status}</Badge>;
}

export function RoleBadge({ role }: { role: Role }) {
  return <Badge className="border-gold/40 bg-gold/10 text-ink">{roleLabels[role]}</Badge>;
}
