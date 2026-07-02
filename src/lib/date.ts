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

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`));
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
