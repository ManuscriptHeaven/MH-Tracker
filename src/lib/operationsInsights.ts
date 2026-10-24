import type { AttendanceBreak, AttendanceSession, Profile, Project, Task } from './types';

export type PresenceLabel =
  | 'On Duty'
  | 'On Break'
  | 'Not Tracking'
  | 'On Leave'
  | 'On Holiday'
  | 'Leave Scheduled'
  | 'Holiday Scheduled';

export interface MemberWorkload {
  profile: Profile;
  openCount: number;
  inProgressCount: number;
  queuedCount: number;
  blockedCount: number;
  overdueCount: number;
  estimatedMinutes: number;
  unestimatedCount: number;
  focusTask: Task | null;
  presence: PresenceLabel;
}

export interface OperationsSnapshot {
  openTasks: Task[];
  attentionTasks: Task[];
  inProgressCount: number;
  blockedCount: number;
  unassignedCount: number;
  members: MemberWorkload[];
  projectTaskCounts: Record<string, { open: number; inProgress: number; blocked: number }>;
}

const closedProjectStatuses = new Set(['Completed', 'Delivered', 'Cancelled', 'Archived']);
const departedConditions = new Set(['resigned', 'retired', 'terminated']);

function presenceFor(
  profile: Profile,
  sessions: AttendanceSession[],
  breaks: AttendanceBreak[],
  today: string,
  nowMs: number,
): PresenceLabel {
  const condition = profile.employment_condition || 'active';
  if (condition === 'leave' || condition === 'holiday') {
    const scheduled = !!profile.condition_start_date && today < profile.condition_start_date;
    const ended = !!profile.condition_end_date && today > profile.condition_end_date;
    if (!ended) {
      if (condition === 'leave') return scheduled ? 'Leave Scheduled' : 'On Leave';
      return scheduled ? 'Holiday Scheduled' : 'On Holiday';
    }
  }

  const live = sessions.find((session) =>
    session.user_id === profile.id && session.status === 'active' && !session.clock_out);
  if (!live?.last_app_heartbeat_at) return 'Not Tracking';
  const elapsed = nowMs - Date.parse(live.last_app_heartbeat_at);
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 120000) return 'Not Tracking';
  if (breaks.some((item) => item.session_id === live.id && !item.ended_at)) return 'On Break';
  return 'On Duty';
}

function attentionRank(task: Task, today: string): number {
  if (!task.assigned_to) return 0;
  if (task.status === 'Blocked') return 1;
  if (task.due_date && task.due_date < today) return 2;
  if (task.due_date === today) return 3;
  if (task.priority === 'Urgent') return 4;
  return 5;
}

function compareAttention(a: Task, b: Task, today: string): number {
  const byRank = attentionRank(a, today) - attentionRank(b, today);
  if (byRank) return byRank;
  return (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31') ||
    a.title.localeCompare(b.title);
}

/**
 * Read-only operational snapshot. Tasks/projects must already be scoped by the caller's
 * existing permissions. No synthetic utilization percentage is computed from task counts.
 */
export function buildOperationsSnapshot({
  projects,
  tasks,
  profiles,
  attendanceSessions = [],
  attendanceBreaks = [],
  today,
  nowMs = Date.now(),
}: {
  projects: Project[];
  tasks: Task[];
  profiles: Profile[];
  attendanceSessions?: AttendanceSession[];
  attendanceBreaks?: AttendanceBreak[];
  today: string;
  nowMs?: number;
}): OperationsSnapshot {
  const activeProjectIds = new Set(
    projects.filter((project) => !closedProjectStatuses.has(project.status)).map((project) => project.id),
  );
  const openTasks = tasks.filter((task) =>
    !task.archived_at &&
    task.status !== 'Done' &&
    task.visibility !== 'private' &&
    (!task.project_id || activeProjectIds.has(task.project_id)),
  );
  const attentionTasks = openTasks
    .filter((task) =>
      !task.assigned_to ||
      task.status === 'Blocked' ||
      (task.due_date !== null && task.due_date <= today) ||
      task.priority === 'Urgent',
    )
    .sort((a, b) => compareAttention(a, b, today));

  const projectTaskCounts: OperationsSnapshot['projectTaskCounts'] = {};
  for (const task of openTasks) {
    if (!task.project_id) continue;
    const counts = projectTaskCounts[task.project_id] || { open: 0, inProgress: 0, blocked: 0 };
    counts.open += 1;
    if (task.status === 'In Progress') counts.inProgress += 1;
    if (task.status === 'Blocked') counts.blocked += 1;
    projectTaskCounts[task.project_id] = counts;
  }

  const members = profiles
    .filter((profile) =>
      profile.role !== 'client' &&
      profile.status !== 'inactive' &&
      !departedConditions.has(profile.employment_condition || 'active'),
    )
    .map((profile): MemberWorkload => {
      // Primary assignee is counted once; collaborators do not inflate capacity.
      const assigned = openTasks.filter((task) => task.assigned_to === profile.id);
      const inProgress = assigned.filter((task) => task.status === 'In Progress');
      const queued = assigned.filter((task) => task.status === 'To Do');
      const focusTask = [...inProgress, ...queued].sort((a, b) => compareAttention(a, b, today))[0] || null;
      return {
        profile,
        openCount: assigned.length,
        inProgressCount: inProgress.length,
        queuedCount: queued.length,
        blockedCount: assigned.filter((task) => task.status === 'Blocked').length,
        overdueCount: assigned.filter((task) => !!task.due_date && task.due_date < today).length,
        estimatedMinutes: assigned.reduce((sum, task) => sum + Math.max(0, task.estimated_minutes || 0), 0),
        unestimatedCount: assigned.filter((task) => task.estimated_minutes == null).length,
        focusTask,
        presence: presenceFor(profile, attendanceSessions, attendanceBreaks, today, nowMs),
      };
    })
    .sort((a, b) => {
      const aManager = ['admin', 'manager', 'project_manager'].includes(a.profile.role) ? 1 : 0;
      const bManager = ['admin', 'manager', 'project_manager'].includes(b.profile.role) ? 1 : 0;
      return aManager - bManager ||
        b.inProgressCount - a.inProgressCount ||
        b.openCount - a.openCount ||
        a.profile.full_name.localeCompare(b.profile.full_name);
    });

  return {
    openTasks,
    attentionTasks,
    inProgressCount: openTasks.filter((task) => task.status === 'In Progress').length,
    blockedCount: openTasks.filter((task) => task.status === 'Blocked').length,
    unassignedCount: openTasks.filter((task) => !task.assigned_to).length,
    members,
    projectTaskCounts,
  };
}
