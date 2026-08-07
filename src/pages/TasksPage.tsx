import { CheckCircle2, Clock3, ExternalLink, ListChecks, Plus, X } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { PriorityBadge, TaskStatusBadge } from '../components/Badges';
import { Button, Card, EmptyState, Field, SelectField, TextareaField } from '../components/ui';
import { priorityOptions, taskStatuses } from '../lib/constants';
import { deadlineClass, formatDate, todayInput } from '../lib/date';
import { firstName, isClientRole } from '../lib/utils';
import type { Profile, Project, Task, TaskDraft, TaskStatus } from '../lib/types';

function defaultDraft(currentProfile: Profile): TaskDraft {
  return {
    title: '',
    description: '',
    project_id: null,
    assigned_to: currentProfile.id,
    status: 'To Do',
    priority: 'Normal',
    due_date: todayInput(),
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
    <div className="rounded-xl border border-border bg-white p-4 shadow-sm transition hover:shadow-md">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-2 text-3xl font-extrabold ${colorClass || 'text-ink'}`}>{value}</p>
    </div>
  );
}

export function TasksPage({
  tasks,
  projects,
  profiles,
  currentProfile,
  mode,
  searchTerm,
  onCreateTask,
  onUpdateTask,
  onSelectProject,
}: {
  tasks: Task[];
  projects: Project[];
  profiles: Profile[];
  currentProfile: Profile;
  mode: 'personal' | 'team';
  searchTerm: string;
  onCreateTask: (draft: TaskDraft) => Promise<void>;
  onUpdateTask: (taskId: string, updates: Partial<Task>) => Promise<void>;
  onSelectProject?: (project: Project) => void;
}) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [draft, setDraft] = useState<TaskDraft>(() => defaultDraft(currentProfile));
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  
  const [quickFilter, setQuickFilter] = useState<'all' | 'todo' | 'progress' | 'urgent' | 'overdue' | 'done'>('all');
  const [sortBy, setSortBy] = useState<'due' | 'priority' | 'recent' | 'project' | 'status'>('due');
  const [employeeFilter, setEmployeeFilter] = useState<string>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');

  const teamProfiles = profiles.filter((profile) => !isClientRole(profile.role));
  const normalizedSearch = searchTerm.trim().toLowerCase();

  // Mode restriction check:
  // In personal mode, strictly filter tasks assigned to current user.
  const personalTasks = useMemo(() => {
    return tasks.filter((task) => mode === 'team' || task.assigned_to === currentProfile.id);
  }, [tasks, mode, currentProfile.id]);

  const filteredTasks = useMemo(() => {
    return personalTasks
      .filter((task) => {
        if (mode === 'team' && employeeFilter !== 'all') {
          if (task.assigned_to !== employeeFilter) return false;
        }
        if (projectFilter !== 'all') {
          if (task.project_id !== projectFilter) return false;
        }
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
        if (quickFilter === 'todo') return task.status === 'To Do';
        if (quickFilter === 'progress') return task.status === 'In Progress';
        if (quickFilter === 'urgent') return task.priority === 'Urgent';
        if (quickFilter === 'overdue') {
          return task.status !== 'Done' && task.due_date !== null && new Date(`${task.due_date}T23:59:59`) < new Date();
        }
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
  }, [personalTasks, mode, employeeFilter, projectFilter, projects, profiles, normalizedSearch, quickFilter, sortBy]);

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

  const counts = useMemo(() => {
    const list = personalTasks;
    return {
      all: list.length,
      todo: list.filter((t) => t.status === 'To Do').length,
      progress: list.filter((t) => t.status === 'In Progress').length,
      urgent: list.filter((t) => t.priority === 'Urgent').length,
      overdue: list.filter((t) => t.status !== 'Done' && t.due_date && new Date(`${t.due_date}T23:59:59`) < new Date()).length,
      done: list.filter((t) => t.status === 'Done').length,
    };
  }, [personalTasks]);

  return (
    <div className="space-y-6">
      {/* Top Banner / Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-border bg-gradient-to-r from-ink via-ink/95 to-ink/90 p-6 text-white shadow-md">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-gold">
            {mode === 'personal' ? 'Personal Workspace' : 'Team Workspace'}
          </p>
          <h2 className="mt-1 font-display text-3xl font-bold tracking-tight">
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
          className="shadow-md hover:scale-[1.02] active:scale-[0.98] transition"
        >
          <Plus className="h-4 w-4" />
          Add Task
        </Button>
      </div>

      {/* Summary Metrics Row */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total Tasks" value={counts.all} />
        <SummaryCard label="To Do" value={counts.todo} colorClass="text-amber-600" />
        <SummaryCard label="In Progress" value={counts.progress} colorClass="text-blue-600" />
        <SummaryCard label="Overdue" value={counts.overdue} colorClass="text-rose-600" />
      </section>

      {/* Filter and Control Bar */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-white p-4 shadow-sm xl:flex-row xl:items-center xl:justify-between">
        {/* Quick Filter Tabs */}
        <div className="flex flex-wrap gap-1.5">
          {([
            ['all', 'All', counts.all],
            ['todo', 'To Do', counts.todo],
            ['progress', 'In Progress', counts.progress],
            ['urgent', 'Urgent', counts.urgent],
            ['overdue', 'Overdue', counts.overdue],
            ['done', 'Completed', counts.done],
          ] as const).map(([id, label, count]) => {
            const active = quickFilter === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setQuickFilter(id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
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
        <div className="flex flex-wrap items-center gap-3">
          {mode === 'team' ? (
            <>
              <SelectField
                value={employeeFilter}
                onChange={(event) => setEmployeeFilter(event.target.value)}
                className="w-full sm:w-44 text-xs"
              >
                <option value="all">All Employees</option>
                {teamProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {firstName(profile.full_name)}
                  </option>
                ))}
              </SelectField>

              <SelectField
                value={projectFilter}
                onChange={(event) => setProjectFilter(event.target.value)}
                className="w-full sm:w-44 text-xs"
              >
                <option value="all">All Projects</option>
                {projects.map((proj) => (
                  <option key={proj.id} value={proj.id}>
                    {proj.project_number}
                  </option>
                ))}
              </SelectField>
            </>
          ) : null}

          <div className="flex items-center gap-2 min-w-44">
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

      {/* Task List */}
      {filteredTasks.length ? (
        <div className="space-y-3">
          {filteredTasks.map((task) => {
            const project = getProject(projects, task.project_id);
            const dotColor = getStatusDotColor(task);
            const dueDateText = getDueDateText(task.due_date, task.status);

            return (
              <div
                key={task.id}
                className="group relative overflow-hidden rounded-xl border border-border bg-white p-5 shadow-sm transition duration-200 hover:border-gold/50 hover:shadow-md"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  {/* Left Main Information */}
                  <div className="flex items-start gap-3.5 min-w-0 flex-1">
                    {/* Status Dot */}
                    <div className="mt-1.5 flex shrink-0 items-center justify-center">
                      <span className={`h-3 w-3 rounded-full shadow-sm ${dotColor}`} />
                    </div>

                    <div className="min-w-0 flex-1">
                      {/* Header line: Title, Priority, Due Date */}
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-display text-lg font-bold text-ink leading-tight">
                          {task.title}
                        </h3>
                        <PriorityBadge priority={task.priority} />
                        <span className={`text-xs font-semibold ${taskDeadlineTone(task)}`}>
                          {dueDateText}
                        </span>
                      </div>

                      {/* Subtitle line: Project Number & Title */}
                      <p className="mt-1 text-xs font-medium text-muted">
                        {project ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-charcoal">
                            <span>{project.project_number}</span>
                            <span>·</span>
                            <span>{project.project_title}</span>
                          </span>
                        ) : (
                          <span>No project</span>
                        )}
                      </p>

                      {/* Description Snippet */}
                      {task.description ? (
                        <p className="mt-2.5 whitespace-pre-wrap text-sm leading-relaxed text-charcoal/90 bg-ivory/60 rounded-lg p-3 border border-border/40">
                          {task.description}
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
                <div className="mt-4 pt-3 border-t border-border/60 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-xs">
                  <div className="flex flex-wrap items-center gap-4 text-muted">
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

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Status Dropdown */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted font-medium">Status:</span>
                      <SelectField
                        value={task.status}
                        onChange={(e) => onUpdateTask(task.id, { status: e.target.value as TaskStatus })}
                        className="py-1 text-xs h-8 bg-ivory font-medium"
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
                        className="h-8 px-2.5 text-xs gap-1"
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
                      className="h-8 px-3 text-xs"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-border bg-white p-6 shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between border-b border-border pb-4">
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

            <form onSubmit={submitTask} className="mt-4 space-y-4">
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

              <TextareaField
                label="Details"
                placeholder="Add task instructions or notes..."
                value={draft.description}
                onChange={(e) => update('description', e.target.value)}
                className="min-h-24"
              />

              {formError ? <p className="rounded-md bg-rose-50 p-3 text-xs font-semibold text-rose-600 border border-rose-200">{formError}</p> : null}

              <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
                <Button type="button" variant="secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? 'Creating...' : 'Create Task'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
