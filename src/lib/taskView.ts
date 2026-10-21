import type { Task } from './types';

export type TaskQuickFilter = 'active' | 'in_progress' | 'mine' | 'due_today' | 'overdue' | 'blocked' | 'done' | 'all';
export type TaskSort = 'attention' | 'due' | 'priority' | 'recent' | 'project' | 'status';

export function isOpenTask(task: Task): boolean {
  return !task.archived_at && task.status !== 'Done';
}

export function isTaskOverdue(task: Task, today: string): boolean {
  return isOpenTask(task) && !!task.due_date && task.due_date < today;
}

export function matchesTaskQuickFilter(task: Task, filter: TaskQuickFilter, isMine: boolean, today: string): boolean {
  if (task.archived_at) return false;
  switch (filter) {
    case 'active': return isOpenTask(task);
    case 'in_progress': return task.status === 'In Progress';
    case 'mine': return isMine && isOpenTask(task);
    case 'due_today': return isOpenTask(task) && task.due_date === today;
    case 'overdue': return isTaskOverdue(task, today);
    case 'blocked': return task.status === 'Blocked';
    case 'done': return task.status === 'Done';
    case 'all': return true;
  }
}

const priorityRank: Record<Task['priority'], number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };
const statusRank: Record<Task['status'], number> = { 'In Progress': 0, 'Blocked': 1, 'To Do': 2, Done: 3 };

/** Actions first: in-progress, blocked, to-do; within each group show overdue and urgent work first. */
export function compareTaskAttention(a: Task, b: Task, today: string): number {
  const byStatus = statusRank[a.status] - statusRank[b.status];
  if (byStatus) return byStatus;
  const byOverdue = Number(isTaskOverdue(b, today)) - Number(isTaskOverdue(a, today));
  if (byOverdue) return byOverdue;
  const byPriority = priorityRank[a.priority] - priorityRank[b.priority];
  if (byPriority) return byPriority;
  const byDueDate = (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31');
  if (byDueDate) return byDueDate;
  return b.created_at.localeCompare(a.created_at);
}

/** Keep completed items at the bottom even when All is selected with another sort. */
export function compareTaskCompletion(a: Task, b: Task): number {
  return Number(a.status === 'Done') - Number(b.status === 'Done');
}
