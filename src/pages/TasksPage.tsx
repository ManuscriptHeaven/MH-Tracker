import { CheckCircle2, Clock3, ExternalLink, ListChecks, Plus, UserRound, X } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { PriorityBadge, TaskStatusBadge } from '../components/Badges';
import { TaskDetailModal } from '../components/tasks/TaskDetailModal';
import { ActiveProjectPicker } from '../components/tasks/ActiveProjectPicker';
import { Button, Card, EmptyState, Field, SelectField, TextareaField } from '../components/ui';
import { priorityOptions, taskStatuses } from '../lib/constants';
import { deadlineClass, formatDate, todayInput } from '../lib/date';
import { compareTaskAttention, compareTaskCompletion, isOpenTask, isTaskOverdue, matchesTaskQuickFilter, type TaskQuickFilter, type TaskSort } from '../lib/taskView';
import { firstName, isClientRole } from '../lib/utils';
import type { Profile, Project, Task, TaskAssignee, TaskChecklistItem, TaskComment, TaskDependency, TaskDraft, TaskIncentive, TaskStatus } from '../lib/types';

function defaultDraft(currentProfile: Profile): TaskDraft {
  return {
    title: '',
    description: '',
    project_id: null,
    assigned_to: currentProfile.id,
    status: 'To Do',
    priority: 'Normal',
    start_date: todayInput(),
    due_date: todayInput(),
    estimated_minutes: null,
    actual_minutes: null,
    blocked_reason: null,
    visibility: 'team',
  };
}

function profileName(profiles: Profile[], id?: string | null) {
  const profile = profiles.find((item) => item.id === id);
  return profile ? firstName(profile.full_name) : 'Unassigned';
}

function getProject(projects: Project[], id?: string | null) {
  return projects.find((item) => item.id === id) || null;
}

function projectLabel(project: Project | null) {
  return project ? `${project.project_number} · ${project.project_title}` : 'No project';
}

function getStatusDotColor(task: Task) {
  if (task.status === 'Done') return 'bg-emerald-500 shadow-emerald-200';
  if (task.priority === 'Urgent') return 'bg-rose-500 shadow-rose-200';
  if (task.due_date && new Date(`${task.due_date}T23:59:59`) < new Date()) {
    return 'bg-red-500 shadow-red-200 animate-pulse';
  }
  if (task.status === 'In Progress') return 'bg-blue-500 shadow-blue-200';
  return 'bg-amber-500 shadow-amber-200';
}

function getDueDateText(due_date: string | null, status: TaskStatus) {
  if (!due_date) return 'No due date';
  if (status === 'Done') return `Due ${formatDate(due_date)}`;

  const today = todayInput();
  if (due_date === today) return 'Due Today';

  const diffDays = Math.ceil((new Date(`${due_date}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / (1000 * 3600 * 24));
  if (diffDays < 0) return `Overdue by ${Math.abs(diffDays)} day${Math.abs(diffDays) > 1 ? 's' : ''}`;
  if (diffDays === 1) return 'Due Tomorrow';
  return `Due ${formatDate(due_date)}`;
}

function taskDeadlineTone(task: Task) {
  if (!task.due_date || task.status === 'Done') {
    return 'text-muted';
  }

  return deadlineClass({
    status: 'In Progress',
    due_date: task.due_date,
  } as Project);
}

function SummaryCard({ label, value, colorClass }: { label: string; value: number; colorClass?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-white p-3 shadow-sm transition hover:shadow-md sm:p-4">
      <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted sm:text-xs">{label}</p>
      <p className={`mt-1.5 text-2xl font-extrabold sm:mt-2 sm:text-3xl ${colorClass || 'text-ink'}`}>{value}</p>
    </div>
  );
}

export function TasksPage({
  tasks,
  taskAssignees,
  taskComments,
  taskChecklistItems,
  taskDependencies,
  taskIncentives,
  onSaveTaskIncentive,
  onApproveTaskIncentive,
  projects,
  profiles,
  currentProfile,
  mode,
  searchTerm,
  initialTaskId,
  initialCreate,
  initialEmployeeId,
  onCreateTask,
  onUpdateTask,
  onArchiveTask,
  onAssignCollaborator,
  onRemoveCollaborator,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
  onAddChecklistItem,
  onToggleChecklistItem,
  onDeleteChecklistItem,
  onAddDependency,
  onRemoveDependency,
  onCreateSubtask,
  onSelectProject,
}: {
  tasks: Task[];
  taskAssignees: TaskAssignee[];
  taskComments: TaskComment[];
  taskChecklistItems: TaskChecklistItem[];
  taskDependencies: TaskDependency[];
  taskIncentives: TaskIncentive[];
  onSaveTaskIncentive: (taskId: string, employeeId: string, amount: number) => Promise<void>;
  onApproveTaskIncentive: (taskId: string) => Promise<void>;
  projects: Project[];
  profiles: Profile[];
  currentProfile: Profile;
  mode: 'personal' | 'team';
  searchTerm: string;
  initialTaskId?: string;
  initialCreate?: boolean;
  initialEmployeeId?: string;
  onCreateTask: (draft: TaskDraft) => Promise<Task>;
  onUpdateTask: (taskId: string, updates: Partial<Task>) => Promise<void>;
  onArchiveTask: (taskId: string) => Promise<void>;
  onAssignCollaborator: (taskId: string, profileId: string) => Promise<void>;
  onRemoveCollaborator: (taskId: string, profileId: string) => Promise<void>;
  onAddComment: (taskId: string, comment: string) => Promise<void>;
  onUpdateComment: (commentId: string, comment: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onAddChecklistItem: (taskId: string, title: string) => Promise<void>;
  onToggleChecklistItem: (itemId: string, completed: boolean) => Promise<void>;
  onDeleteChecklistItem: (itemId: string) => Promise<void>;
  onAddDependency: (taskId: string, dependsOnTaskId: string) => Promise<void>;
  onRemoveDependency: (dependencyId: string) => Promise<void>;
  onCreateSubtask: (parentTaskId: string, draft: TaskDraft) => Promise<void>;
  onSelectProject?: (project: Project) => void;
}) {
  const [showAddModal, setShowAddModal] = useState(Boolean(initialCreate && mode === 'team'));
  const [draft, setDraft] = useState<TaskDraft>(() => defaultDraft(currentProfile));
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [taskBonus, setTaskBonus] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() =>
    mode === 'team' && initialTaskId && tasks.some((task) => task.id === initialTaskId) ? initialTaskId : null,
  );
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  
  const [quickFilter, setQuickFilter] = useState<TaskQuickFilter>('active');
  const [sortBy, setSortBy] = useState<TaskSort>('attention');
  const [employeeFilter, setEmployeeFilter] = useState<string>(mode === 'team' && initialEmployeeId ? initialEmployeeId : 'all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');

  const teamProfiles = profiles.filter((profile) => !isClientRole(profile.role));
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const today = todayInput();

  // Mode restriction check:
  // In personal mode, strictly filter tasks assigned to current user.
  const personalTasks = useMemo(() => {
    const mine = new Set(taskAssignees.filter((item) => item.profile_id === currentProfile.id).map((item) => item.task_id));
    return tasks.filter((task) => !task.archived_at && (mode === 'team' || task.assigned_to === currentProfile.id || mine.has(task.id)));
  }, [tasks, taskAssignees, mode, currentProfile.id]);

  const filteredTasks = useMemo(() => {
    return personalTasks
      .filter((task) => {
        if (mode === 'team' && employeeFilter !== 'all') {
          const hasAssignment = task.assigned_to === employeeFilter || taskAssignees.some((item) => item.task_id === task.id && item.profile_id === employeeFilter);
          if (!hasAssignment) return false;
        }
        if (projectFilter !== 'all') {
          if (task.project_id !== projectFilter) return false;
        }
        if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false;
        return true;
      })
      .filter((task) => {
        const project = projects.find((item) => item.id === task.project_id);
        const assignee = profiles.find((item) => item.id === task.assigned_to);
        const haystack = [
          task.title,
          task.description,
          task.status,
          task.priority,
          project?.project_title,
          project?.project_number,
          assignee?.full_name,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return !normalizedSearch || haystack.includes(normalizedSearch);
      })
      .filter((task) => matchesTaskQuickFilter(
        task,
        quickFilter,
        task.assigned_to === currentProfile.id ||
          taskAssignees.some((item) => item.task_id === task.id && item.profile_id === currentProfile.id),
        today,
      ))
      .sort((a, b) => {
        // Completed tasks never jump ahead of open work, even with custom sorting.
        const completion = compareTaskCompletion(a, b);
        if (completion) return completion;
        if (sortBy === 'attention') return compareTaskAttention(a, b, today);
        if (sortBy === 'priority') {
          return ({ Urgent: 0, High: 1, Normal: 2, Low: 3 }[a.priority] - { Urgent: 0, High: 1, Normal: 2, Low: 3 }[b.priority]);
        }
        if (sortBy === 'recent') return b.created_at.localeCompare(a.created_at);
        if (sortBy === 'project') {
          return projectLabel(getProject(projects, a.project_id)).localeCompare(projectLabel(getProject(projects, b.project_id)));
        }
        if (sortBy === 'status') return a.status.localeCompare(b.status);
        return (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31') ||
          b.created_at.localeCompare(a.created_at);
      });
  }, [personalTasks, mode, employeeFilter, projectFilter, priorityFilter, projects, profiles, normalizedSearch, quickFilter, sortBy, taskAssignees, currentProfile.id, today]);

  function update<K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
  }

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!draft.title.trim()) {
      setFormError('Task title is required.');
      return;
    }

    if (taskBonus.trim() && (
      mode !== 'team' || currentProfile.role !== 'admin' ||
      !draft.project_id || !draft.assigned_to ||
      !profiles.some((profile) => profile.id === draft.assigned_to && ['employee','junior_assistant'].includes(profile.role))
    )) {
      setFormError('A task bonus needs a project and a production employee as the primary assignee.');
      return;
    }
    const proposedAmount = Number(taskBonus);
    if (taskBonus.trim() && (!Number.isFinite(proposedAmount) || proposedAmount <= 0 ||
      Math.abs(proposedAmount * 100 - Math.round(proposedAmount * 100)) > 0.000001)) {
      setFormError('Enter a positive USD bonus with no more than 2 decimal places.');
      return;
    }
    setIsSaving(true);
    let taskCreated = false;
    try {
      const created = await onCreateTask({
        ...draft,
        assigned_to: mode === 'personal' ? currentProfile.id : (draft.assigned_to || currentProfile.id),
        title: draft.title.trim(),
        description: draft.description.trim(),
      });
      taskCreated = true;
      if (taskBonus.trim()) await onSaveTaskIncentive(created.id, created.assigned_to!, proposedAmount);
      setTaskBonus('');
      setDraft(defaultDraft(currentProfile));
      setShowAddModal(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Task could not be saved.';
      if (taskCreated) {
        setShowAddModal(false);
        setTaskBonus('');
        setListError('The task was created, but its bonus was not saved. Open Task Details to set it. ' + message);
      } else {
        setFormError(message);
      }
    } finally {
      setIsSaving(false);
    }
  }

  const counts = useMemo(() => ({
    all: personalTasks.length,
    active: personalTasks.filter(isOpenTask).length,
    inProgress: personalTasks.filter((task) => task.status === 'In Progress').length,
    dueToday: personalTasks.filter((task) => isOpenTask(task) && task.due_date === today).length,
    overdue: personalTasks.filter((task) => isTaskOverdue(task, today)).length,
    blocked: personalTasks.filter((task) => task.status === 'Blocked').length,
    done: personalTasks.filter((task) => task.status === 'Done').length,
    mine: personalTasks.filter((task) => isOpenTask(task) &&
      (task.assigned_to === currentProfile.id ||
        taskAssignees.some((item) => item.task_id === task.id && item.profile_id === currentProfile.id))).length,
  }), [personalTasks, taskAssignees, currentProfile.id, today]);

  async function updateTaskStatus(taskId: string, status: TaskStatus) {
    if (statusUpdatingId) return;
    setStatusUpdatingId(taskId);
    setListError(null);
    try {
      await onUpdateTask(taskId, { status });
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'Task status could not be updated.');
    } finally {
      setStatusUpdatingId(null);
    }
  }

  return (
    <div className="min-w-0 space-y-4 sm:space-y-6">
      {/* Compact workspace banner with primary action */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-gradient-to-r from-ink via-ink/95 to-ink/90 p-4 text-white shadow-md sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-gold">
            {mode === 'personal' ? 'Personal Workspace' : 'Team Workspace'}
          </p>
          <h2 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">
            {mode === 'personal' ? 'My Tasks' : 'Team Tasks'}
          </h2>
          <p className="mt-1 text-xs text-white/70 sm:text-sm">
            Focus on active work. Completed tasks are available in the history filters.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setDraft(defaultDraft(currentProfile));
            setTaskBonus('');
            setFormError(null);
            setShowAddModal(true);
          }}
          className="w-full shadow-md sm:w-auto"
        >
          <Plus className="h-4 w-4" />
          Add Task
        </Button>
      </div>

      {/* Workload at a glance: completed work stays in history */}
      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 xl:grid-cols-5" aria-label="Task overview">
        <SummaryCard label="Active Tasks" value={counts.active} />
        <SummaryCard label="In Progress" value={counts.inProgress} colorClass="text-blue-700" />
        <SummaryCard label="Overdue" value={counts.overdue} colorClass="text-rose-600" />
        <SummaryCard label="Blocked" value={counts.blocked} colorClass="text-orange-700" />
        <SummaryCard label="Completed" value={counts.done} colorClass="text-emerald-700" />
      </section>

      <div className="min-w-0 rounded-xl border border-border bg-white p-3 shadow-sm sm:p-4">
        <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          {/* Active is the initial view. Tabs remain available for history and exceptions. */}
          <div className="-mx-1 flex min-w-0 snap-x items-center gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-thin" role="group" aria-label="Task views">
            {([
              ['active', 'Active', counts.active],
              ['in_progress', 'In Progress', counts.inProgress],
              ['mine', 'My Tasks', counts.mine],
              ['due_today', 'Due Today', counts.dueToday],
              ['overdue', 'Overdue', counts.overdue],
              ['blocked', 'Blocked', counts.blocked],
              ['done', 'Completed', counts.done],
              ['all', 'All', counts.all],
            ] as const).map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                onClick={() => setQuickFilter(id)}
                aria-pressed={quickFilter === id}
                className={`flex shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold ${
                  quickFilter === id
                    ? 'bg-ink text-white shadow-sm'
                    : 'bg-ivory text-charcoal hover:bg-gold/15 hover:text-ink'
                }`}
              >
                <span>{label}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                  quickFilter === id ? 'bg-gold text-ink font-bold' : 'bg-black/5 text-muted'
                }`}>{count}</span>
              </button>
            ))}
          </div>

          {/* Secondary filters. All filters apply without resetting the chosen task view. */}
          <div className="grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2 xl:flex xl:flex-wrap xl:items-center xl:gap-3">
            {mode === 'team' ? (
              <SelectField aria-label="Filter team member" value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)} className="w-full min-w-0 text-xs sm:w-full xl:w-36">
                <option value="all">All Team Members</option>
                {teamProfiles.map((profile) => <option key={profile.id} value={profile.id}>{firstName(profile.full_name)}</option>)}
              </SelectField>
            ) : null}
            <SelectField aria-label="Filter project" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className="w-full min-w-0 text-xs xl:w-36">
              <option value="all">All Projects</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.project_number} · {project.project_title}</option>)}
            </SelectField>
            <SelectField aria-label="Filter priority" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className="w-full min-w-0 text-xs xl:w-32">
              <option value="all">All Priorities</option>
              {priorityOptions.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
            </SelectField>
            <div className="flex min-w-0 items-center gap-2 sm:col-span-2 xl:col-span-1 xl:min-w-40">
              <span className="shrink-0 text-xs font-medium text-muted">Sort:</span>
              <SelectField aria-label="Sort tasks" value={sortBy} onChange={(event) => setSortBy(event.target.value as TaskSort)} className="w-full min-w-0 text-xs">
                <option value="attention">Needs Attention</option>
                <option value="due">Due Date</option>
                <option value="priority">Priority</option>
                <option value="recent">Recently Added</option>
                <option value="project">Project</option>
                <option value="status">Status</option>
              </SelectField>
            </div>
          </div>
        </div>
      </div>

      {/* Compact, scannable rows instead of expanded task cards */}
      <section className="space-y-2.5" aria-label="Task list">
        <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
          <h3 className="text-sm font-bold text-ink">
            {quickFilter === 'active' ? 'Active work' : quickFilter === 'done' ? 'Completed history' : quickFilter === 'all' ? 'All tasks' : 'Filtered tasks'}
            <span className="ml-2 font-normal text-muted">({filteredTasks.length})</span>
          </h3>
          <p className="text-xs text-muted">Select a task to see full details</p>
        </div>
        {listError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{listError}</p> : null}
        {filteredTasks.length ? filteredTasks.map((task) => {
          const project = getProject(projects, task.project_id);
          const dotColor = getStatusDotColor(task);
          const dueDateText = getDueDateText(task.due_date, task.status);
          const updating = statusUpdatingId === task.id;

          return (
            <article
              key={task.id}
              className="group relative min-w-0 overflow-hidden rounded-xl border border-border bg-white px-3 py-3 shadow-sm transition hover:border-gold/60 hover:shadow-md sm:px-4"
            >
              <div className="flex min-w-0 flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full shadow-sm ${dotColor}`} aria-hidden="true" />
                    <button
                      type="button"
                      onClick={() => setSelectedTaskId(task.id)}
                      className="min-w-0 break-words font-display text-base font-bold leading-snug text-ink text-left hover:text-gold focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
                    >
                      {task.title}
                    </button>
                    <PriorityBadge priority={task.priority} />
                    <TaskStatusBadge status={task.status} />
                  </div>
                  <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                    <span className="min-w-0 break-words" title={project ? project.project_title : 'No linked project'}>
                      {project ? `${project.project_number} · ${project.project_title}` : 'No project'}
                    </span>
                    {mode === 'team' ? (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap">
                        <UserRound className="h-3 w-3" />
                        {profileName(profiles, task.assigned_to)}
                      </span>
                    ) : null}
                    <span className={`inline-flex items-center gap-1 whitespace-nowrap font-medium ${taskDeadlineTone(task)}`}>
                      <Clock3 className="h-3 w-3" />
                      {dueDateText}
                    </span>
                  </div>
                  {task.description ? (
                    <p className="mt-1.5 line-clamp-1 break-words text-xs leading-relaxed text-charcoal/80" title={task.description}>{task.description}</p>
                  ) : null}
                  {task.status === 'Blocked' && task.blocked_reason ? (
                    <p className="mt-1.5 line-clamp-1 text-xs font-medium text-rose-700" title={task.blocked_reason}>
                      Blocked: {task.blocked_reason}
                    </p>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center lg:shrink-0 lg:justify-end">
                  <div className="col-span-2 flex min-w-0 items-center gap-1.5 sm:col-span-1">
                    <SelectField
                      aria-label={`Change status of ${task.title}`}
                      value={task.status}
                      disabled={statusUpdatingId !== null}
                      onChange={(event) => void updateTaskStatus(task.id, event.target.value as TaskStatus)}
                      className="!min-h-9 w-full min-w-0 bg-ivory px-2 text-xs font-medium sm:w-32"
                    >
                      {taskStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                    </SelectField>
                  </div>
                  <Button type="button" variant="secondary" onClick={() => setSelectedTaskId(task.id)} className="!min-h-9 h-9 w-full gap-1 px-2.5 text-xs sm:w-auto">
                    <ListChecks className="h-3.5 w-3.5" />
                    Details
                  </Button>
                  {project && onSelectProject ? (
                    <Button
                      type="button"
                      variant="secondary"
                      title={`Open project ${project.project_number}`}
                      onClick={() => onSelectProject(project)}
                      className="!min-h-9 h-9 w-full gap-1 px-2.5 text-xs sm:w-auto"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Project
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant={task.status === 'Done' ? 'secondary' : 'primary'}
                    disabled={statusUpdatingId !== null}
                    onClick={() => void updateTaskStatus(task.id, task.status === 'Done' ? 'To Do' : 'Done')}
                    className="!min-h-9 h-9 w-full gap-1 px-2.5 text-xs sm:w-auto"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {updating ? 'Saving…' : task.status === 'Done' ? 'Reopen' : 'Done'}
                  </Button>
                </div>
              </div>
            </article>
          );
        }) : (
          <EmptyState
            title={quickFilter === 'active' ? 'No active tasks' : 'No tasks found'}
            message={quickFilter === 'active'
              ? 'All caught up, or no active tasks match the selected filters.'
              : 'No tasks match the selected filters or search.'}
            action={
              <Button
                type="button"
                variant="secondary"
                onClick={() => { setQuickFilter('all'); setProjectFilter('all'); setEmployeeFilter('all'); setPriorityFilter('all'); }}
              >
                View All Tasks
              </Button>
            }
          />
        )}
      </section>

      {/* Task Creation Modal */}
      {showAddModal ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="flex max-h-[100dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-border bg-white shadow-2xl animate-in fade-in zoom-in duration-200 sm:max-h-[92dvh] sm:rounded-2xl">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-4 sm:items-center sm:px-6 sm:py-5">
              <div>
                <h3 className="font-display text-xl font-bold text-ink">Add Task</h3>
                <p className="text-xs text-muted">
                  {mode === 'personal'
                    ? 'Task will be automatically assigned to you.'
                    : 'Create and assign a task to a team member.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="rounded-lg p-1.5 text-muted hover:bg-ivory hover:text-ink transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={submitTask} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
              <Field
                label="Task Title"
                required
                placeholder="e.g. Complete design concept"
                value={draft.title}
                onChange={(e) => update('title', e.target.value)}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <ActiveProjectPicker
                  projects={projects}
                  value={draft.project_id}
                  onChange={(projectId) => update('project_id', projectId)}
                />

                <Field
                  label="Start Date"
                  type="date"
                  value={draft.start_date || ''}
                  onChange={(e) => update('start_date', e.target.value || null)}
                />

                <Field
                  label="Due Date"
                  type="date"
                  value={draft.due_date || ''}
                  onChange={(e) => update('due_date', e.target.value || null)}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  label="Priority"
                  value={draft.priority}
                  onChange={(e) => update('priority', e.target.value as TaskDraft['priority'])}
                >
                  {priorityOptions.map((pr) => (
                    <option key={pr} value={pr}>
                      {pr}
                    </option>
                  ))}
                </SelectField>

                {mode === 'team' ? (
                  <SelectField
                    label="Assign To"
                    value={draft.assigned_to || ''}
                    onChange={(e) => update('assigned_to', e.target.value || null)}
                  >
                    {teamProfiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {firstName(p.full_name)}
                      </option>
                    ))}
                  </SelectField>
                ) : (
                  <div className="flex flex-col justify-end">
                    <p className="text-xs font-semibold text-muted mb-1">Assigned To</p>
                    <div className="h-10 rounded-md border border-border bg-ivory px-3 flex items-center text-xs font-bold text-ink">
                      {firstName(currentProfile.full_name)} (You)
                    </div>
                  </div>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <SelectField label="Status" value={draft.status} onChange={(e) => update('status', e.target.value as TaskStatus)}>
                  {taskStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                </SelectField>
                <Field label="Estimated Minutes" type="number" min="0" value={draft.estimated_minutes ?? ''} onChange={(e) => update('estimated_minutes', e.target.value === '' ? null : Number(e.target.value))} />
                <SelectField label="Visibility" value={draft.visibility || 'team'} onChange={(e) => update('visibility', e.target.value as TaskDraft['visibility'])}>
                  <option value="team">Team</option><option value="private">Private</option>
                </SelectField>
              </div>

              {mode === 'team' && currentProfile.role === 'admin' ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                  <Field label="Private task bonus (USD) — optional" type="number" min="0.01" step="0.01"
                    value={taskBonus} onChange={(event) => setTaskBonus(event.target.value)}
                    placeholder="Set this task's bonus amount" />
                  <p className="mt-1 text-xs text-muted">Visible only to Admin. Completion does not trigger payment until you approve the work.</p>
                </div>
              ) : null}

              {draft.status === 'Blocked' ? (
                <TextareaField label="Blocked Reason" value={draft.blocked_reason || ''} onChange={(e) => update('blocked_reason', e.target.value || null)} placeholder="What is preventing progress?" />
              ) : null}

              <TextareaField
                label="Details"
                placeholder="Add task instructions or notes..."
                value={draft.description}
                onChange={(e) => update('description', e.target.value)}
                className="min-h-24"
              />

              {formError ? <p className="rounded-md bg-rose-50 p-3 text-xs font-semibold text-rose-600 border border-rose-200">{formError}</p> : null}

              <div className="grid grid-cols-2 gap-2 border-t border-border pt-4 sm:flex sm:items-center sm:justify-end sm:gap-3">
                <Button type="button" variant="secondary" onClick={() => setShowAddModal(false)} className="w-full sm:w-auto">
                  Cancel
                </Button>
                <Button type="submit" disabled={isSaving} className="w-full sm:w-auto">
                  {isSaving ? 'Creating...' : 'Create Task'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {selectedTaskId && tasks.find((task) => task.id === selectedTaskId) ? (
        <TaskDetailModal
          task={tasks.find((task) => task.id === selectedTaskId)!}
          tasks={tasks}
          projects={projects}
          profiles={profiles}
          currentProfile={currentProfile}
          assignees={taskAssignees}
          comments={taskComments}
          checklistItems={taskChecklistItems}
          dependencies={taskDependencies}
          taskIncentive={taskIncentives.find((item) => item.task_id === selectedTaskId) || null}
          onSaveTaskIncentive={onSaveTaskIncentive}
          onApproveTaskIncentive={onApproveTaskIncentive}
          onClose={() => setSelectedTaskId(null)}
          onUpdateTask={onUpdateTask}
          onArchiveTask={onArchiveTask}
          onAssignCollaborator={onAssignCollaborator}
          onRemoveCollaborator={onRemoveCollaborator}
          onAddComment={onAddComment}
          onUpdateComment={onUpdateComment}
          onDeleteComment={onDeleteComment}
          onAddChecklistItem={onAddChecklistItem}
          onToggleChecklistItem={onToggleChecklistItem}
          onDeleteChecklistItem={onDeleteChecklistItem}
          onAddDependency={onAddDependency}
          onRemoveDependency={onRemoveDependency}
          onCreateSubtask={onCreateSubtask}
        />
      ) : null}
    </div>
  );
}
