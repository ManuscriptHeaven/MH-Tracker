import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CalendarDays, CheckSquare2, Clock3, FolderOpen, ListFilter, Plus, RotateCcw, Users } from 'lucide-react';
import { UserAvatar } from './UserAvatar';
import { Button, Card } from './ui';
import { formatDate, todayInput } from '../lib/date';
import { buildOperationsSnapshot, type MemberWorkload } from '../lib/operationsInsights';
import type { AttendanceBreak, AttendanceSession, Profile, Project, Task } from '../lib/types';

type KpiFilter = 'open' | 'inProgress' | 'unassigned' | 'blocked' | null;
const inputStyle = 'mt-1 min-h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-ink outline-none focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/30 dark:bg-slate-900 dark:text-slate-100';

function presenceTone(label: MemberWorkload['presence']) {
  if (label === 'On Duty') return 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200';
  if (label === 'On Break') return 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200';
  if (label === 'On Leave' || label === 'On Holiday' || label === 'Leave Scheduled' || label === 'Holiday Scheduled') {
    return 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-200';
  }
  return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
}

function taskStatusTone(status: Task['status']) {
  if (status === 'Done') return 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200';
  if (status === 'Blocked') return 'bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-200';
  if (status === 'In Progress') return 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200';
  return 'bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200';
}

function attentionLabel(task: Task, today: string) {
  if (task.status === 'Blocked') return { text: 'Blocked', color: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200' };
  if (task.due_date && task.due_date < today) return { text: 'Overdue', color: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200' };
  if (!task.assigned_to) return { text: 'Unassigned', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200' };
  if (task.due_date === today) return { text: 'Due today', color: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200' };
  return { text: 'Urgent', color: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200' };
}

function matchesKpi(task: Task, filter: KpiFilter) {
  if (filter === 'open') return task.status !== 'Done';
  if (filter === 'inProgress') return task.status === 'In Progress';
  if (filter === 'unassigned') return task.status !== 'Done' && !task.assigned_to;
  if (filter === 'blocked') return task.status === 'Blocked';
  return true;
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
  const [kpiFilter, setKpiFilter] = useState<KpiFilter>(null);
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [memberFilter, setMemberFilter] = useState('all');

  const snapshot = useMemo(() => buildOperationsSnapshot({
    tasks, profiles, projects, attendanceSessions, attendanceBreaks, today,
  }), [tasks, profiles, projects, attendanceSessions, attendanceBreaks, today]);
  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.project_title])), [projects]);
  const profileNames = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile.full_name])), [profiles]);

  const visibleProjects = useMemo(() => {
    const ids = new Set(snapshot.visibleTasks.map((task) => task.project_id).filter(Boolean));
    return projects.filter((project) => ids.has(project.id)).sort((a, b) => a.project_title.localeCompare(b.project_title));
  }, [projects, snapshot.visibleTasks]);

  const filtersActive = !!kpiFilter || employeeFilter !== 'all' || statusFilter !== 'all' ||
    priorityFilter !== 'all' || projectFilter !== 'all' || !!dueFrom || !!dueTo;
  const filteredTasks = useMemo(() => snapshot.visibleTasks.filter((task) => {
    if (!matchesKpi(task, kpiFilter)) return false;
    if (employeeFilter !== 'all' && (employeeFilter === 'unassigned'
      ? !!task.assigned_to : task.assigned_to !== employeeFilter)) return false;
    if (statusFilter !== 'all' && task.status !== statusFilter) return false;
    if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false;
    if (projectFilter !== 'all' && (projectFilter === 'general'
      ? !!task.project_id : task.project_id !== projectFilter)) return false;
    if (dueFrom && (!task.due_date || task.due_date < dueFrom)) return false;
    if (dueTo && (!task.due_date || task.due_date > dueTo)) return false;
    return true;
  }), [snapshot.visibleTasks, kpiFilter, employeeFilter, statusFilter, priorityFilter, projectFilter, dueFrom, dueTo]);

  const filteredIds = useMemo(() => new Set(filteredTasks.map((task) => task.id)), [filteredTasks]);
  const recentTasks = useMemo(() => [...filteredTasks]
    .sort((a, b) => (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || '') ||
      a.title.localeCompare(b.title)).slice(0, 8), [filteredTasks]);
  const attentionTasks = useMemo(() => snapshot.attentionTasks.filter((task) => filteredIds.has(task.id)).slice(0, 8),
    [snapshot.attentionTasks, filteredIds]);
  const memberCards = snapshot.members.filter((member) => memberFilter === 'all' || member.profile.id === memberFilter);
  const activeProjectCount = visibleProjects.length;

  function clearFilters() {
    setKpiFilter(null);
    setEmployeeFilter('all');
    setStatusFilter('all');
    setPriorityFilter('all');
    setProjectFilter('all');
    setDueFrom('');
    setDueTo('');
  }

  const kpiItems: Array<{ id: Exclude<KpiFilter, null>; title: string; value: number; surface: string; text: string; caption: string }> = [
    { id: 'open', title: 'Open Tasks', value: snapshot.openTasks.length, surface: 'bg-blue-50 dark:bg-slate-900', text: 'text-blue-700 dark:text-blue-300', caption: 'Not completed' },
    { id: 'inProgress', title: 'In Progress', value: snapshot.inProgressCount, surface: 'bg-amber-50 dark:bg-slate-900', text: 'text-amber-700 dark:text-amber-300', caption: 'Currently assigned work' },
    { id: 'unassigned', title: 'Unassigned', value: snapshot.unassignedCount, surface: 'bg-slate-100 dark:bg-slate-900', text: 'text-slate-700 dark:text-slate-300', caption: 'Needs an owner' },
    { id: 'blocked', title: 'Blocked', value: snapshot.blockedCount, surface: 'bg-rose-50 dark:bg-slate-900', text: 'text-rose-700 dark:text-rose-300', caption: 'Needs resolution' },
  ];

  return (
    <section aria-label="Operations overview" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-[#9a6d26] dark:text-amber-300">Team Operations</p>
          <h2 className="mt-0.5 font-display text-2xl font-semibold text-ink sm:text-3xl">Operations Overview</h2>
          <p className="mt-1 text-sm text-muted">Assignments, priorities, and team capacity — organized for daily decisions.</p>
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Organization-wide task counts">
        {kpiItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setKpiFilter((current) => current === item.id ? null : item.id)}
            aria-pressed={kpiFilter === item.id}
            aria-label={item.title + ': ' + item.value + '. Filter visible tasks.'}
            className={'min-w-0 rounded-2xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ' +
              (kpiFilter === item.id ? 'border-gold ring-2 ring-gold/40 ' : 'border-border ') + item.surface}
          >
            <p className="text-xs font-bold uppercase tracking-wide text-muted">{item.title}</p>
            <p className={'mt-2 font-display text-3xl font-bold tabular-nums ' + item.text}>{item.value}</p>
            <p className="mt-1 text-xs text-muted">{item.caption}</p>
          </button>
        ))}
      </div>

      <Card className="rounded-2xl border border-border bg-white p-4 shadow-sm dark:bg-slate-900 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-bold text-ink"><ListFilter className="h-4 w-4 text-gold" /> Task filters</h3>
          {filtersActive && (
            <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-[#7a5518] hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-slate-800">
              <RotateCcw className="h-3.5 w-3.5" /> Clear filters
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <label className="min-w-0 text-xs font-semibold text-muted">
            Employee
            <select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)} className={inputStyle}>
              <option value="all">All employees</option>
              <option value="unassigned">Unassigned</option>
              {snapshot.members.map((member) => <option key={member.profile.id} value={member.profile.id}>{member.profile.full_name}</option>)}
            </select>
          </label>
          <label className="min-w-0 text-xs font-semibold text-muted">
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={inputStyle}>
              <option value="all">All statuses</option>
              {['To Do', 'In Progress', 'Blocked', 'Done'].map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label className="min-w-0 text-xs font-semibold text-muted">
            Priority
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className={inputStyle}>
              <option value="all">All priorities</option>
              {['Low', 'Normal', 'High', 'Urgent'].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
            </select>
          </label>
          <label className="min-w-0 text-xs font-semibold text-muted">
            Project
            <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className={inputStyle}>
              <option value="all">All active projects</option>
              <option value="general">General tasks</option>
              {visibleProjects.map((project) => <option key={project.id} value={project.id}>{project.project_title}</option>)}
            </select>
          </label>
          <label className="min-w-0 text-xs font-semibold text-muted">
            Due from
            <input type="date" value={dueFrom} max={dueTo || undefined} onChange={(event) => setDueFrom(event.target.value)} className={inputStyle} />
          </label>
          <label className="min-w-0 text-xs font-semibold text-muted">
            Due through
            <input type="date" value={dueTo} min={dueFrom || undefined} onChange={(event) => setDueTo(event.target.value)} className={inputStyle} />
          </label>
        </div>
        <p className="mt-3 text-xs text-muted" role="status">
          {filtersActive ? String(filteredTasks.length) + ' matching tasks' : 'Showing recent and priority tasks'} across {activeProjectCount} projects with tasks.
          {' '}Summary cards remain organization-wide; filters affect the task panels only.
        </p>
      </Card>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card className="min-w-0 rounded-2xl border border-border bg-white p-4 shadow-sm dark:bg-slate-900 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-2 font-display text-xl font-semibold text-ink">
                <CheckSquare2 className="h-5 w-5 text-blue-600" /> Recent Team Tasks
              </h3>
              <p className="mt-1 text-xs text-muted">{filtersActive ? 'Latest matching tasks, ordered by most recent update.' : 'Latest eight active-project or general tasks.'}</p>
            </div>
            <button type="button" onClick={onViewTeamTasks} className="inline-flex items-center gap-1 text-xs font-semibold text-[#7a5518] hover:underline dark:text-amber-300">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-4 space-y-2">
            {recentTasks.length ? recentTasks.map((task) => {
              const assignee = profiles.find((person) => person.id === task.assigned_to);
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onOpenTask(task.id)}
                  className="w-full rounded-xl border border-border bg-white p-3 text-left transition hover:border-blue-300 hover:bg-blue-50/40 hover:shadow-sm dark:bg-slate-900 dark:hover:bg-slate-800"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-ink" title={task.title}>{task.title}</p>
                    <span className={'shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ' + taskStatusTone(task.status)}>{task.status}</span>
                  </div>
                  <p className="mt-1.5 flex items-center gap-1.5 truncate text-xs text-muted">
                    <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                    {task.project_id ? projectNames.get(task.project_id) || 'Project task' : 'General task'}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-2">
                    <div className="flex min-w-0 items-center gap-2">
                      {assignee ? <UserAvatar profile={assignee} size="sm" /> : <Users className="h-4 w-4 text-muted" />}
                      <span className="truncate text-xs text-muted">{assignee?.full_name || 'Unassigned'}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={'rounded px-1.5 py-0.5 font-medium ' + (task.priority === 'Urgent' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600')}>{task.priority}</span>
                      <span className="inline-flex items-center gap-1 text-muted"><CalendarDays className="h-3.5 w-3.5" />{task.due_date ? formatDate(task.due_date) : 'No due date'}</span>
                    </div>
                  </div>
                </button>
              );
            }) : (
              <p className="rounded-xl border border-dashed border-border bg-ivory p-6 text-center text-sm text-muted dark:bg-slate-900">
                No tasks match the current filters. Clear filters or assign a new task.
              </p>
            )}
          </div>
          {filteredTasks.length > 8 && <button type="button" onClick={onViewTeamTasks} className="mt-3 text-xs font-semibold text-[#7a5518] hover:underline dark:text-amber-300">Open task workspace <ArrowRight className="inline h-3 w-3" /></button>}
        </Card>

        <Card className="min-w-0 rounded-2xl border border-border bg-rose-50/30 p-4 shadow-sm dark:bg-slate-900 sm:p-5">
          <div>
            <h3 className="flex items-center gap-2 font-display text-xl font-semibold text-ink">
              <AlertTriangle className="h-5 w-5 text-rose-600" /> Tasks Requiring Action
            </h3>
            <p className="mt-1 text-xs text-muted">Blocked first, then overdue, unassigned, due today, and urgent tasks.</p>
          </div>
          <div className="mt-4 space-y-2">
            {attentionTasks.length ? attentionTasks.map((task) => {
              const attention = attentionLabel(task, today);
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onOpenTask(task.id)}
                  className="w-full rounded-xl border border-rose-100 bg-white p-3 text-left transition hover:border-rose-300 hover:shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-ink">{task.title}</p>
                    <span className={'shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ' + attention.color}>{attention.text}</span>
                  </div>
                  <p className="mt-2 truncate text-xs text-muted">{task.project_id ? projectNames.get(task.project_id) || 'Project task' : 'General task'} {' · '} {task.assigned_to ? profileNames.get(task.assigned_to) || 'Team member' : 'Needs assignment'}</p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 text-muted"><Clock3 className="h-3.5 w-3.5" />{task.due_date ? formatDate(task.due_date) : 'No due date'}</span>
                    <span className="font-semibold text-[#7a5518] dark:text-amber-300">{!task.assigned_to ? 'Assign in task details' : 'Open task'} <ArrowRight className="inline h-3 w-3" /></span>
                  </div>
                </button>
              );
            }) : (
              <p className="rounded-xl border border-dashed border-rose-200 bg-white p-6 text-center text-sm text-muted dark:border-slate-700 dark:bg-slate-900">
                No urgent tasks match your filters.
              </p>
            )}
          </div>
          {snapshot.attentionTasks.filter((task) => filteredIds.has(task.id)).length > 8 && (
            <button type="button" onClick={onViewTeamTasks} className="mt-3 text-xs font-semibold text-[#7a5518] hover:underline dark:text-amber-300">
              View all priority tasks <ArrowRight className="inline h-3 w-3" />
            </button>
          )}
        </Card>
      </div>

      <Card className="min-w-0 rounded-2xl border border-border bg-white p-4 shadow-sm dark:bg-slate-900 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 font-display text-xl font-semibold text-ink">
              <Users className="h-5 w-5 text-[#b68a3a]" /> Team Workload
            </h3>
            <p className="mt-1 text-xs text-muted">Team assignments and presence signals, separate from verified hours and payroll.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-semibold text-muted">
              <span className="sr-only">Filter team workload by employee</span>
              <select value={memberFilter} onChange={(event) => setMemberFilter(event.target.value)} aria-label="Filter team workload by employee" className="min-h-9 rounded-lg border border-border bg-white px-3 text-xs text-ink dark:bg-slate-900 dark:text-slate-100">
                <option value="all">All team members</option>
                {snapshot.members.map((member) => <option key={member.profile.id} value={member.profile.id}>{member.profile.full_name}</option>)}
              </select>
            </label>
            <button type="button" onClick={onViewTeamTasks} className="inline-flex items-center gap-1 text-xs font-semibold text-[#7a5518] hover:underline dark:text-amber-300">
              All team tasks <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {memberCards.length ? memberCards.map((member) => (
            <article key={member.profile.id} className="min-w-0 rounded-2xl border border-border bg-[#fcfbf8] p-4 dark:bg-slate-900">
              <div className="flex min-w-0 items-start gap-3">
                <UserAvatar profile={member.profile} size="sm" showRoleRing />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-ink">{member.profile.full_name}</p>
                  <p className="mt-0.5 text-xs text-muted">{member.profile.role.replace(/_/g, ' ')}</p>
                </div>
                <span className={'shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ' + presenceTone(member.presence)}>{member.presence}</span>
              </div>
              <p className="mt-3 min-h-[36px] text-xs leading-relaxed text-muted" title={member.focusTask?.title || ''}>
                <span className="font-semibold text-ink">{member.focusTask?.status === 'In Progress' ? 'In progress' : 'Next task'}:</span>{' '}
                {member.focusTask?.title || 'No active task'}
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-blue-50 p-2 text-center dark:bg-slate-800">
                  <p className="text-lg font-bold tabular-nums text-blue-700 dark:text-blue-300">{member.openCount}</p><p className="text-[11px] text-muted">Open</p>
                </div>
                <div className="rounded-lg bg-amber-50 p-2 text-center dark:bg-slate-800">
                  <p className="text-lg font-bold tabular-nums text-amber-700 dark:text-amber-300">{member.inProgressCount}</p><p className="text-[11px] text-muted">In progress</p>
                </div>
                <div className="rounded-lg bg-rose-50 p-2 text-center dark:bg-slate-800">
                  <p className="text-lg font-bold tabular-nums text-rose-700 dark:text-rose-300">{member.overdueCount}</p><p className="text-[11px] text-muted">Overdue</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                {member.blockedCount > 0 && <span className="font-semibold text-rose-700">{member.blockedCount} blocked</span>}
                <span>{member.estimatedMinutes > 0 ? (member.estimatedMinutes / 60).toFixed(1) + 'h estimated' : 'No task estimate'}</span>
                {member.unestimatedCount > 0 && <span>{member.unestimatedCount} without estimates</span>}
              </div>
              <button type="button" onClick={() => onViewMemberTasks(member.profile.id)}
                className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[#7a5518] hover:underline dark:text-amber-300">
                View assigned tasks <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </article>
          )) : (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">No team member matches this filter.</p>
          )}
        </div>
        <p className="mt-3 text-xs text-muted">On Duty reflects a recent attendance heartbeat, not proof of continuous work. No tasks does not mean free capacity; task counts are not utilization percentages.</p>
      </Card>
    </section>
  );
}
