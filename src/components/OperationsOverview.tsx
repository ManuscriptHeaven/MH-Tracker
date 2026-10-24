import { useMemo } from 'react';
import { AlertTriangle, ArrowRight, CheckSquare2, Clock3, Plus, Users } from 'lucide-react';
import { UserAvatar } from './UserAvatar';
import { Button, Card } from './ui';
import { formatDate, todayInput } from '../lib/date';
import { buildOperationsSnapshot, type MemberWorkload } from '../lib/operationsInsights';
import type { AttendanceBreak, AttendanceSession, Profile, Project, Task } from '../lib/types';

function presenceTone(label: MemberWorkload['presence']) {
  if (label === 'On Duty') return 'bg-emerald-50 text-emerald-700';
  if (label === 'On Break') return 'bg-amber-50 text-amber-700';
  if (label === 'On Leave' || label === 'On Holiday') return 'bg-violet-50 text-violet-700';
  return 'bg-slate-100 text-slate-600';
}

function attentionLabel(task: Task, today: string) {
  if (!task.assigned_to) return { text: 'Unassigned', color: 'bg-rose-50 text-rose-700' };
  if (task.status === 'Blocked') return { text: 'Blocked', color: 'bg-amber-50 text-amber-800' };
  if (task.due_date && task.due_date < today) return { text: 'Overdue', color: 'bg-rose-50 text-rose-700' };
  if (task.due_date === today) return { text: 'Due today', color: 'bg-amber-50 text-amber-800' };
  return { text: 'Urgent', color: 'bg-violet-50 text-violet-700' };
}

export function OperationsOverview({
  tasks,
  profiles,
  projects,
  attendanceSessions,
  attendanceBreaks,
  onOpenTask,
  onAssignTask,
  onViewTeamTasks,
  onViewMemberTasks,
}: {
  tasks: Task[];
  profiles: Profile[];
  projects: Project[];
  attendanceSessions: AttendanceSession[];
  attendanceBreaks: AttendanceBreak[];
  onOpenTask: (taskId: string) => void;
  onAssignTask: () => void;
  onViewTeamTasks: () => void;
  onViewMemberTasks: (profileId: string) => void;
}) {
  const today = todayInput();
  const snapshot = useMemo(() => buildOperationsSnapshot({
    tasks, profiles, projects, attendanceSessions, attendanceBreaks, today,
  }), [tasks, profiles, projects, attendanceSessions, attendanceBreaks, today]);
  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.project_title])), [projects]);

  return (
    <section aria-label="Operations overview" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink sm:text-2xl">Operations Overview</h2>
          <p className="text-xs text-muted sm:text-sm">Live assignments, team presence, and priority work in one dedicated view.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onViewTeamTasks}>
            <CheckSquare2 className="h-4 w-4" /> Team Tasks
          </Button>
          <Button onClick={onAssignTask}>
            <Plus className="h-4 w-4" /> Assign Task
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="rounded-xl border border-border bg-white p-3 shadow-xs">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted">In Progress</p>
          <p className="mt-1 font-display text-2xl font-bold text-ink">{snapshot.inProgressCount}</p>
        </div>
        <div className="rounded-xl border border-border bg-white p-3 shadow-xs">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Unassigned</p>
          <p className="mt-1 font-display text-2xl font-bold text-amber-700">{snapshot.unassignedCount}</p>
        </div>
        <div className="rounded-xl border border-border bg-white p-3 shadow-xs">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Blocked</p>
          <p className="mt-1 font-display text-2xl font-bold text-rose-700">{snapshot.blockedCount}</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card className="min-w-0 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
                <Users className="h-4 w-4 text-gold" /> Team Workload
              </h3>
              <p className="mt-0.5 text-[11px] text-muted">Assigned team tasks, separate from attendance and schedule availability.</p>
            </div>
            <button type="button" onClick={onViewTeamTasks} className="shrink-0 text-xs font-semibold text-[#7a5518] hover:underline">
              All tasks <ArrowRight className="inline h-3 w-3" />
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {snapshot.members.length ? snapshot.members.slice(0, 8).map((member) => (
              <div key={member.profile.id} className="flex min-w-0 items-start gap-3 rounded-xl border border-border/80 bg-white p-3">
                <UserAvatar profile={member.profile} size="sm" showRoleRing />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-ink">{member.profile.full_name}</p>
                    <span className={'rounded-full px-2 py-0.5 text-[10px] font-semibold ' + presenceTone(member.presence)}>
                      {member.presence}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-muted" title={member.focusTask?.title || ''}>
                    {member.focusTask
                      ? (member.focusTask.status === 'In Progress' ? 'In progress: ' : 'Next: ') + member.focusTask.title
                      : 'No active team task'}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
                    <span>{member.openCount} open · {member.inProgressCount} in progress</span>
                    {member.blockedCount > 0 ? <span className="font-semibold text-amber-700">{member.blockedCount} blocked</span> : null}
                    {member.overdueCount > 0 ? <span className="font-semibold text-rose-700">{member.overdueCount} overdue</span> : null}
                    <span>
                      {member.estimatedMinutes > 0 ? (member.estimatedMinutes / 60).toFixed(1) + 'h estimated' : 'No time estimate'}
                      {member.unestimatedCount > 0 ? ' · ' + member.unestimatedCount + ' unestimated' : ''}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onViewMemberTasks(member.profile.id)}
                    className="mt-2 text-[11px] font-semibold text-[#7a5518] hover:underline"
                  >
                    View assigned tasks <ArrowRight className="inline h-3 w-3" />
                  </button>
                </div>
              </div>
            )) : (
              <p className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted">No active team members found.</p>
            )}
          </div>
          <p className="mt-3 text-[10px] text-muted">
            No open task does not necessarily mean available. Estimated hours are not an eight-hour capacity percentage.
          </p>
        </Card>

        <Card className="min-w-0 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-600" />
            <div>
              <h3 className="font-display text-lg font-semibold text-ink">Tasks Requiring Action</h3>
              <p className="mt-0.5 text-[11px] text-muted">Unassigned, blocked, overdue, due today or urgent tasks.</p>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {snapshot.attentionTasks.length ? snapshot.attentionTasks.slice(0, 6).map((task) => {
              const attention = attentionLabel(task, today);
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onOpenTask(task.id)}
                  className="w-full rounded-xl border border-border bg-white p-3 text-left transition hover:border-gold/60 hover:shadow-xs"
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-xs font-semibold text-ink">{task.title}</p>
                    <span className={'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ' + attention.color}>
                      {attention.text}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1 text-[10px] text-muted">
                    <span className="max-w-full truncate">{task.project_id ? projectNames.get(task.project_id) || 'Project task' : 'General task'}</span>
                    {task.due_date ? <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" />{formatDate(task.due_date)}</span> : null}
                  </div>
                </button>
              );
            }) : (
              <p className="rounded-xl border border-dashed border-border bg-[#faf9f6] p-5 text-center text-xs text-muted">
                No team tasks require immediate action.
              </p>
            )}
          </div>
          {snapshot.attentionTasks.length > 6 ? (
            <button type="button" onClick={onViewTeamTasks} className="mt-3 text-xs font-semibold text-[#7a5518] hover:underline">
              View all {snapshot.attentionTasks.length} priority tasks <ArrowRight className="inline h-3 w-3" />
            </button>
          ) : null}
        </Card>
      </div>
    </section>
  );
}
