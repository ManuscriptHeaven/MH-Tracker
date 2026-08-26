import { closedStatuses } from './constants';
import type { Project } from './types';

export function toDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(days: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return toDateInput(date);
}

export function isWeekend(date: Date) {
  const day = date.getDay();
  return day === 0 || day === 6; // Sunday = 0, Saturday = 6
}

export function parseNaturalDate(inputStr?: string | null): string | null {
  if (!inputStr) return null;
  const str = inputStr.trim().toLowerCase();

  if (str === 'today') return todayInput();
  if (str === 'tomorrow') return addDays(1);
  if (str === 'day after tomorrow') return addDays(2);

  const inDaysMatch = str.match(/(?:in\s+)?(\d+)\s+days?/);
  if (inDaysMatch) {
    return addDays(parseInt(inDaysMatch[1], 10));
  }

  const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayIndex = daysOfWeek.indexOf(str.replace(/^next\s+/, ''));
  if (dayIndex !== -1) {
    const today = new Date();
    const currentDay = today.getDay();
    let diff = dayIndex - currentDay;
    if (diff <= 0) diff += 7;
    return addDays(diff);
  }

  // Try parsing direct date formats e.g. "August 30", "Aug 30", "2026-08-30"
  try {
    // If year is not specified, append current year
    const hasYear = /\d{4}/.test(str);
    const dateToParse = hasYear ? str : `${str}, ${new Date().getFullYear()}`;
    const parsed = new Date(dateToParse);
    if (!isNaN(parsed.getTime())) {
      parsed.setHours(12, 0, 0, 0);
      return toDateInput(parsed);
    }
  } catch (e) {}

  return null;
}

export function addWorkingDays(startDateStr: string, days: number, excludeWeekends: boolean = true) {
  if (!startDateStr || days <= 0) {
    return startDateStr ? startDateStr.slice(0, 10) : todayInput();
  }

  const date = new Date(`${startDateStr.slice(0, 10)}T12:00:00`);
  if (isNaN(date.getTime())) {
    return todayInput();
  }

  let added = 0;
  while (added < days) {
    date.setDate(date.getDate() + 1);
    if (!excludeWeekends || !isWeekend(date)) {
      added++;
    }
  }

  return toDateInput(date);
}

export function workingDaysBetween(startStr?: string | null, endStr?: string | null, excludeWeekends: boolean = true) {
  if (!startStr || !endStr) return 0;
  const start = new Date(`${startStr.slice(0, 10)}T12:00:00`);
  const end = new Date(`${endStr.slice(0, 10)}T12:00:00`);

  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) {
    return 0;
  }

  let count = 0;
  const curr = new Date(start);
  while (curr < end) {
    curr.setDate(curr.getDate() + 1);
    if (!excludeWeekends || !isWeekend(curr)) {
      count++;
    }
  }

  return count;
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
  if (isClosed(project)) {
    return false;
  }

  // Check stage-specific due date if waiting on Manuscript Heaven
  if (project.waiting_on === 'Manuscript Heaven' && project.current_stage) {
    const stage = project.current_stage;
    const stageDueDate =
      stage === 'Design Concept' || stage === 'Design Concept in Progress'
        ? project.design_concept_due_date
        : stage === 'Concept Revisions'
          ? project.concept_revision_due_date || project.design_concept_due_date
          : stage === 'Print Version' || stage === 'Print Version in Progress'
            ? project.print_version_due_date
            : stage === 'Print Revisions'
              ? project.print_revision_due_date || project.print_version_due_date
              : stage === 'Ebook Version' || stage === 'eBook in Progress'
                ? project.ebook_due_date
                : stage === 'Final Delivery' || stage === 'Final Quality Check'
                  ? project.final_delivery_date || project.due_date
                  : null;

    if (stageDueDate && daysUntil(stageDueDate) < 0) {
      return true;
    }
  }

  // Fallback to overall project due_date
  return Boolean(project.due_date) && daysUntil(project.due_date) < 0;
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
