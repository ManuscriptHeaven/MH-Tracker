import { CheckCircle2, Clock3, Columns3, ExternalLink, List, ListChecks, Plus, X } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { PriorityBadge, TaskStatusBadge } from '../components/Badges';
import { TaskDetailModal } from '../components/tasks/TaskDetailModal';
import { Button, Card, EmptyState, Field, SelectField, TextareaField } from '../components/ui';
import { priorityOptions, taskStatuses } from '../lib/constants';
import { deadlineClass, formatDate, todayInput } from '../lib/date';
import { firstName, isClientRole } from '../lib/utils';
import type { Profile, Project, Task, TaskAssignee, TaskAttachment, TaskChecklistItem, TaskComment, TaskDependency, TaskDraft, TaskStatus } from '../lib/types';

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
  if (status === 'Done') return `Completed · ${formatDate(due_date)}`;

  const today = new Date().toISOString().slice(0, 10);
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
  taskAttachments,
  projects,
  profiles,
  currentProfile,
  mode,
  searchTerm,
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
  onUploadAttachment,
  onGetAttachmentUrl,
  onCreateSubtask,
  onSelectProject,
}: {
  tasks: Task[];
  taskAssignees: TaskAssignee[];
  taskComments: TaskComment[];
  taskChecklistItems: TaskChecklistItem[];
  taskDependencies: TaskDependency[];
  taskAttachments: TaskAttachment[];
  projects: Project[];
  profiles: Profile[];
  currentProfile: Profile;
  mode: 'personal' | 'team';
  searchTerm: string;
  onCreateTask: (draft: TaskDraft) => Promise<void>;
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
  onUploadAttachment: (taskId: string, file: File, logicalFileId?: string) => Promise<TaskAttachment>;
  onGetAttachmentUrl: (attachment: TaskAttachment) => Promise<string>;
  onCreateSubtask: (parentTaskId: string, draft: TaskDraft) => Promise<void>;
  onSelectProject?: (project: Project) => void;
}) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [draft, setDraft] = useState<TaskDraft>(() => defaultDraft(currentProfile));
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  
  const [quickFilter, setQuickFilter] = useState<'all' | 'mine' | 'due_today' | 'overdue' | 'blocked' | 'done'>('all');
  const [sortBy, setSortBy] = useState<'due' | 'priority' | 'recent' | 'project' | 'status'>('due');
  const [employeeFilter, setEmployeeFilter] = useState<string>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');

  const teamProfiles = profiles.filter((profile) => !isClientRole(profile.role));
  const normalizedSearch = searchTerm.trim().toLowerCase();

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
      .filter((task) => {
        if (quickFilter === 'all') return true;
        if (quickFilter === 'mine') return task.assigned_to === currentProfile.id || taskAssignees.some((item) => item.task_id === task.id && item.profile_id === currentProfile.id);
        if (quickFilter === 'due_today') return task.status !== 'Done' && task.due_date === new Date().toISOString().slice(0, 10);
        if (quickFilter === 'overdue') {
          return task.status !== 'Done' && task.due_date !== null && new Date(`${task.due_date}T23:59:59`) < new Date();
        }
        if (quickFilter === 'blocked') return task.status === 'Blocked';
        if (quickFilter === 'done') return task.status === 'Done';
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'priority') {
          return ({ Urgent: 0, High: 1, Normal: 2, Low: 3 }[a.priority] - { Urgent: 0, High: 1, Normal: 2, Low: 3 }[b.priority]);
        }
        if (sortBy === 'recent') {
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        }
        if (sortBy === 'project') {
          return projectLabel(getProject(projects, a.project_id)).localeCompare(projectLabel(getProject(projects, b.project_id)));
        }
        if (sortBy === 'status') {
          return a.status.localeCompare(b.status);
        }
        if (a.status === 'Done' && b.status !== 'Done') return 1;
        if (a.status !== 'Done' && b.status === 'Done') return -1;

        const aDate = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER;
        const bDate = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER;
        return aDate - bDate || new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [personalTasks, mode, employeeFilter, projectFilter, priorityFilter, projects, profiles, normalizedSearch, quickFilter, sortBy, taskAssignees, currentProfile.id]);

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

    setIsSaving(true);
    try {
      await onCreateTask({
        ...draft,
        assigned_to: mode === 'personal' ? currentProfile.id : (draft.assigned_to || currentProfile.id),
        title: draft.title.trim(),
        description: draft.description.trim(),
      });
      setDraft(defaultDraft(currentProfile));
      setShowAddModal(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Task could not be saved.');
    } finally {
      setIsSaving(false);
    }
  }

  async function moveKanbanTask(status: TaskStatus) {
    if (!draggedTaskId) return;
    const task = tasks.find((item) => item.id === draggedTaskId);
    if (!task) return;
    const columnTasks = filteredTasks.filter((item) => item.status === status && item.id !== draggedTaskId);
    const nextOrder = columnTasks.reduce((maximum, item) => Math.max(maximum, item.sort_order || 0), 0) + 100;
    setDraggedTaskId(null);
    await onUpdateTask(task.id, { status, sort_order: nextOrder });
  }

  const counts = useMemo(() => {
    const list = personalTasks;
    return {
      all: list.length,
      open: list.filter((t) => t.status !== 'Done').length,
      dueToday: list.filter((t) => t.status !== 'Done' && t.due_date === new Date().toISOString().slice(0, 10)).length,
      overdue: list.filter((t) => t.status !== 'Done' && t.due_date && new Date(`${t.due_date}T23:59:59`) < new Date()).length,
      blocked: list.filter((t) => t.status === 'Blocked').length,
      done: list.filter((t) => t.status === 'Done').length,
    };
  }, [personalTasks]);

  return (
    <div className="min-w-0 space-y-4 sm:space-y-6">
      {/* Top Banner / Header */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-gradient-to-r from-ink via-ink/95 to-ink/90 p-4 text-white shadow-md sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-gold">
            {mode === 'personal' ? 'Personal Workspace' : 'Team Workspace'}
          </p>
          <h2 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">
            {mode === 'personal' ? 'My Tasks' : 'Team Tasks'}
          </h2>
          <p className="mt-1 text-sm text-white/70">
            {mode === 'personal'
              ? 'Personal task list for your assigned workload.'
              : 'Overview and management of tasks across all team members.'}
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setDraft(defaultDraft(currentProfile));
            setFormError(null);
            setShowAddModal(true);
          }}
          className="w-full shadow-md transition hover:scale-[1.02] active:scale-[0.98] sm:w-auto"
        >
          <Plus className="h-4 w-4" />
          Add Task
        </Button>
      </div>

      {/* Summary Metrics Row */}
      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 xl:grid-cols-5">
        <SummaryCard label="Open" value={counts.open} />
        <SummaryCard label="Due Today" value={counts.dueToday} colorClass="text-orange-600" />
        <SummaryCard label="Overdue" value={counts.overdue} colorClass="text-rose-600" />
        <SummaryCard label="Blocked" value={counts.blocked} colorClass="text-red-700" />
        <SummaryCard label="Completed" value={counts.done} colorClass="text-emerald-700" />
      </section>

      {/* Filter and Control Bar */}
      <div className="min-w-0 rounded-xl border border-border bg-white p-3 shadow-sm sm:p-4">
        <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        {/* Quick Filter Tabs */}
        <div className="-mx-1 flex min-w-0 snap-x items-center gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-thin">
          {([
            ['all', 'All', counts.all],
            ['mine', 'My Tasks', personalTasks.filter((task) => task.assigned_to === currentProfile.id || taskAssignees.some((item) => item.task_id === task.id && item.profile_id === currentProfile.id)).length],
            ['due_today', 'Due Today', counts.dueToday],
            ['overdue', 'Overdue', counts.overdue],
            ['blocked', 'Blocked', counts.blocked],
            ['done', 'Completed', counts.done],
          ] as const).map(([id, label, count]) => {
            const active = quickFilter === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setQuickFilter(id)}
                className={`flex shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  active
                    ? 'bg-ink text-white shadow-sm'
                    : 'bg-ivory text-charcoal hover:bg-gold/15 hover:text-ink'
                }`}
              >
                <span>{label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                    active ? 'bg-gold text-ink font-bold' : 'bg-black/5 text-muted'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Filters & Sorting Controls */}
        <div className="grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2 xl:flex xl:flex-wrap xl:items-center xl:gap-3">
          {mode === 'team' ? (
              <SelectField
                value={employeeFilter}
                onChange={(event) => setEmployeeFilter(event.target.value)}
                className="w-full min-w-0 text-xs sm:w-full xl:w-44"
              >
                <option value="all">All Employees</option>
                {teamProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {firstName(profile.full_name)}
                  </option>
                ))}
              </SelectField>
          ) : null}

          <SelectField value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className="w-full min-w-0 text-xs sm:w-full xl:w-44">
            <option value="all">All Projects</option>
            {projects.map((proj) => <option key={proj.id} value={proj.id}>{proj.project_number}</option>)}
          </SelectField>
          <SelectField value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className="w-full min-w-0 text-xs sm:w-full xl:w-36">
            <option value="all">All Priorities</option>
            {priorityOptions.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
          </SelectField>

          <div className="flex min-w-0 items-center gap-2 sm:col-span-2 xl:col-span-1 xl:min-w-44">
            <span className="text-xs font-medium text-muted">Sort:</span>
            <SelectField
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as typeof sortBy)}
              className="w-full text-xs"
            >
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

      <div className="flex justify-end">
        <div className="inline-flex rounded-lg border border-border bg-white p-1 shadow-sm">
          <button type="button" onClick={() => setViewMode('list')} className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition ${viewMode === 'list' ? 'bg-ink text-white' : 'text-muted hover:bg-ivory hover:text-ink'}`}>
            <List className="h-3.5 w-3.5" />List
          </button>
          <button type="button" onClick={() => setViewMode('board')} className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition ${viewMode === 'board' ? 'bg-ink text-white' : 'text-muted hover:bg-ivory hover:text-ink'}`}>
            <Columns3 className="h-3.5 w-3.5" />Kanban
          </button>
        </div>
      </div>

      {/* Task List / Kanban */}
      {viewMode === 'board' ? (
        <div className="grid auto-cols-[minmax(270px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2 xl:grid-flow-row xl:grid-cols-4">
          {taskStatuses.map((status) => {
            const columnTasks = filteredTasks
              .filter((task) => task.status === status)
              .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            return (
              <section
                key={status}
                className="min-h-[220px] rounded-xl border border-border bg-ivory/60 p-3"
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => void moveKanbanTask(status)}
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <TaskStatusBadge status={status} />
                  <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-muted shadow-sm">{columnTasks.length}</span>
                </div>
                <div className="space-y-2">
                  {columnTasks.map((task) => {
                    const project = getProject(projects, task.project_id);
                    return (
                      <article
                        key={task.id}
                        draggable
                        onDragStart={() => setDraggedTaskId(task.id)}
                        onDragEnd={() => setDraggedTaskId(null)}
                        className={`cursor-grab rounded-lg border bg-white p-3 shadow-sm transition hover:border-gold/50 hover:shadow-md active:cursor-grabbing ${draggedTaskId === task.id ? 'opacity-50' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button type="button" onClick={() => setSelectedTaskId(task.id)} className="min-w-0 flex-1 text-left">
                            <p className="break-words text-sm font-bold text-ink">{task.title}</p>
                            {project ? <p className="mt-1 truncate text-[11px] font-medium text-muted">{project.project_number} · {project.project_title}</p> : null}
                          </button>
                          <PriorityBadge priority={task.priority} />
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                          <span>{profileName(profiles, task.assigned_to)}</span>
                          <span className={taskDeadlineTone(task)}>{getDueDateText(task.due_date, task.status)}</span>
                        </div>
                        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                          <SelectField
                            value={task.status}
                            onChange={(event) => void onUpdateTask(task.id, { status: event.target.value as TaskStatus })}
                            className="h-8 min-w-0 text-xs"
                          >
                            {taskStatuses.map((nextStatus) => <option key={nextStatus}>{nextStatus}</option>)}
                          </SelectField>
                          <Button type="button" variant="secondary" onClick={() => setSelectedTaskId(task.id)} className="h-8 px-2 text-xs">Details</Button>
                        </div>
                      </article>
                    );
                  })}
                  {!columnTasks.length ? <div className="rounded-lg border border-dashed border-border bg-white/70 p-5 text-center text-xs text-muted">Drop task here</div> : null}
                </div>
              </section>
            );
          })}
        </div>
      ) : filteredTasks.length ? (
        <div className="space-y-3">
          {filteredTasks.map((task) => {
            const project = getProject(projects, task.project_id);
            const dotColor = getStatusDotColor(task);
            const dueDateText = getDueDateText(task.due_date, task.status);

            return (
              <div
                key={task.id}
                className="group relative min-w-0 overflow-hidden rounded-xl border border-border bg-white p-3.5 shadow-sm transition duration-200 hover:border-gold/50 hover:shadow-md sm:p-5"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  {/* Left Main Information */}
                  <div className="flex min-w-0 flex-1 items-start gap-2.5 sm:gap-3.5">
                    {/* Status Dot */}
                    <div className="mt-1.5 flex shrink-0 items-center justify-center">
                      <span className={`h-3 w-3 rounded-full shadow-sm ${dotColor}`} />
                    </div>

                    <div className="min-w-0 flex-1">
                      {/* Header line: Title, Priority, Due Date */}
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="min-w-0 break-words font-display text-base font-bold leading-tight text-ink sm:text-lg">
                          {task.title}
                        </h3>
                        <PriorityBadge priority={task.priority} />
                        <span className={`text-xs font-semibold ${taskDeadlineTone(task)}`}>
                          {dueDateText}
                        </span>
                      </div>

                      {/* Subtitle line: Project Number & Title */}
                      <p className="mt-1 min-w-0 text-xs font-medium text-muted">
                        {project ? (
                          <span className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 font-semibold text-charcoal">
                            <span>{project.project_number}</span>
                            <span>·</span>
                            <span className="min-w-0 break-words">{project.project_title}</span>
                          </span>
                        ) : (
                          <span>No project</span>
                        )}
                      </p>

                      {/* Description Snippet */}
                      {task.description ? (
                        <p className="mt-2.5 break-words whitespace-pre-wrap rounded-lg border border-border/40 bg-ivory/60 p-3 text-sm leading-relaxed text-charcoal/90">
                          {task.description}
                        </p>
                      ) : null}
                      {task.status === 'Blocked' && task.blocked_reason ? (
                        <p className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs font-medium text-red-700">
                          Blocked: {task.blocked_reason}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {/* Top Right Quick Action (Mobile/Desktop) */}
                  <div className="flex shrink-0 items-center gap-2 self-start">
                    <TaskStatusBadge status={task.status} />
                  </div>
                </div>

                {/* Card Footer Divider & Action Controls */}
                <div className="mt-4 flex flex-col gap-3 border-t border-border/60 pt-3 text-xs lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted">
                    {mode === 'team' ? (
                      <p>
                        Assigned: <strong className="text-ink">{profileName(profiles, task.assigned_to)}</strong>
                      </p>
                    ) : null}

                    {task.due_date ? (
                      <p className="flex items-center gap-1">
                        <Clock3 className="h-3.5 w-3.5 text-muted" />
                        <span>Due: {formatDate(task.due_date)}</span>
                      </p>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                    <Button type="button" variant="secondary" onClick={() => setSelectedTaskId(task.id)} className="h-9 w-full gap-1 px-2.5 text-xs sm:h-8 sm:w-auto">
                      <ListChecks className="h-3.5 w-3.5" />Details
                    </Button>
                    {/* Status Dropdown */}
                    <div className="col-span-2 flex min-w-0 items-center gap-1.5 sm:col-span-1">
                      <span className="shrink-0 text-muted font-medium">Status:</span>
                      <SelectField
                        value={task.status}
                        onChange={(e) => onUpdateTask(task.id, { status: e.target.value as TaskStatus })}
                        className="h-9 min-w-0 flex-1 bg-ivory py-1 text-xs font-medium sm:h-8 sm:w-36"
                      >
                        {taskStatuses.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </SelectField>
                    </div>

                    {/* Open Project Link Button */}
                    {project && onSelectProject ? (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => onSelectProject(project)}
                        className="h-9 w-full gap-1 px-2.5 text-xs sm:h-8 sm:w-auto"
                      >
                        Open Project
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    ) : null}

                    {/* Done / Reopen Toggle Button */}
                    <Button
                      type="button"
                      variant={task.status === 'Done' ? 'secondary' : 'primary'}
                      onClick={() => onUpdateTask(task.id, { status: task.status === 'Done' ? 'To Do' : 'Done' })}
                      className="h-9 w-full px-3 text-xs sm:h-8 sm:w-auto"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {task.status === 'Done' ? 'Reopen' : 'Done'}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="No tasks found"
          message="No tasks match your current filter or search criteria."
          action={
            <Button
              type="button"
              onClick={() => {
                setDraft(defaultDraft(currentProfile));
                setShowAddModal(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Add Task
            </Button>
          }
        />
      )}

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
                <SelectField
                  label="Project"
                  value={draft.project_id || ''}
                  onChange={(e) => update('project_id', e.target.value || null)}
                >
                  <option value="">Select Project (Optional)</option>
                  {projects.map((proj) => (
                    <option key={proj.id} value={proj.id}>
                      {proj.project_number} - {proj.project_title}
                    </option>
                  ))}
                </SelectField>

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
          attachments={taskAttachments}
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
          onUploadAttachment={onUploadAttachment}
          onGetAttachmentUrl={onGetAttachmentUrl}
          onCreateSubtask={onCreateSubtask}
        />
      ) : null}
    </div>
  );
}
