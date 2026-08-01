import { closedStatuses } from './constants';
import type { Project } from './types';

export function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(days: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return toDateInput(date);
}

export function todayInput() {
  return addDays(0);
}

export function formatDate(value?: string | null) {
  if (!value) {
    return 'Not set';
  }

  // Strip to date-only portion (handles both "2026-08-01" and "2026-08-01T15:00:00Z")
  const datePart = value.slice(0, 10);

  const parsed = new Date(`${datePart}T12:00:00`);
  if (isNaN(parsed.getTime())) {
    return 'Not set';
  }

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
}

export function daysUntil(value: string) {
  const today = new Date(todayInput());
  const due = new Date(value);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((due.getTime() - today.getTime()) / msPerDay);
}

export function isClosed(project: Project) {
  return closedStatuses.includes(project.status);
}

export function isOverdue(project: Project) {
  if (project.timeline_status || project.waiting_on || project.current_stage) {
    const dueDate =
      project.current_stage === 'Design Concept in Progress'
        ? project.design_concept_due_date
        : project.current_stage === 'Concept Revisions'
          ? project.concept_revision_due_date || project.design_concept_due_date
          : project.current_stage === 'Print Version in Progress'
            ? project.print_version_due_date
            : project.current_stage === 'Print Revisions'
              ? project.print_revision_due_date || project.print_version_due_date
              : project.current_stage === 'eBook in Progress'
                ? project.ebook_due_date
                : project.current_stage === 'Final Quality Check'
                  ? project.final_delivery_date || project.due_date
                  : null;

    return (
      project.timeline_status === 'Active' &&
      project.waiting_on === 'Manuscript Heaven' &&
      Boolean(dueDate) &&
      daysUntil(dueDate as string) < 0
    );
  }

  return !isClosed(project) && daysUntil(project.due_date) < 0;
}

export function isDueToday(project: Project) {
  return !isClosed(project) && daysUntil(project.due_date) === 0;
}

export function isDueThisWeek(project: Project) {
  const days = daysUntil(project.due_date);
  return !isClosed(project) && days >= 0 && days <= 7;
}

export function deadlineLabel(project: Project) {
  if (isClosed(project)) {
    return project.status;
  }

  const days = daysUntil(project.due_date);
  if (days === 0) {
    return 'Due today';
  }

  if (days < 0) {
    return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
  }

  return `${days} day${days === 1 ? '' : 's'} left`;
}

export function deadlineClass(project: Project) {
  const days = daysUntil(project.due_date);

  if (isClosed(project)) {
    return 'text-success';
  }

  if (days < 0) {
    return 'text-danger';
  }

  if (days === 0) {
    return 'text-warning';
  }

  if (days <= 3) {
    return 'text-yellow-700';
  }

  return 'text-muted';
}
