import { CheckCircle2, Clock3, ListChecks, Plus } from 'lucide-react';
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

function projectName(projects: Project[], id?: string | null) {
  const project = projects.find((item) => item.id === id);
  return project ? `${project.project_number} - ${project.project_title}` : 'No project';
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

export function TasksPage({
  tasks,
  projects,
  profiles,
  currentProfile,
  searchTerm,
  onCreateTask,
  onUpdateTask,
}: {
  tasks: Task[];
  projects: Project[];
  profiles: Profile[];
  currentProfile: Profile;
  searchTerm: string;
  onCreateTask: (draft: TaskDraft) => Promise<void>;
  onUpdateTask: (taskId: string, updates: Partial<Task>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<TaskDraft>(() => defaultDraft(currentProfile));
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const teamProfiles = profiles.filter((profile) => !isClientRole(profile.role));
  const normalizedSearch = searchTerm.trim().toLowerCase();

  const filteredTasks = useMemo(() => {
    return tasks
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
      .sort((a, b) => {
        if (a.status === 'Done' && b.status !== 'Done') {
          return 1;
        }
        if (a.status !== 'Done' && b.status === 'Done') {
          return -1;
        }

        const aDate = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER;
        const bDate = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER;
        return aDate - bDate || new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [normalizedSearch, profiles, projects, tasks]);

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
        title: draft.title.trim(),
        description: draft.description.trim(),
      });
      setDraft(defaultDraft(currentProfile));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Task could not be saved.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <form onSubmit={submitTask} className="space-y-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-display text-2xl font-semibold">Add Task</h2>
              <p className="mt-1 text-sm text-muted">{filteredTasks.length} visible task{filteredTasks.length === 1 ? '' : 's'}</p>
            </div>
            <Button type="submit" disabled={isSaving}>
              <Plus className="h-4 w-4" />
              {isSaving ? 'Adding' : 'Add Task'}
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr_0.8fr]">
            <Field
              label="Task"
              required
              value={draft.title}
              onChange={(event) => update('title', event.target.value)}
            />
            <SelectField
              label="Assign To"
              value={draft.assigned_to || ''}
              onChange={(event) => update('assigned_to', event.target.value || null)}
            >
              <option value="">Unassigned</option>
              {teamProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {firstName(profile.full_name)}
                </option>
              ))}
            </SelectField>
            <Field
              label="Due Date"
              type="date"
              value={draft.due_date || ''}
              onChange={(event) => update('due_date', event.target.value || null)}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_220px_220px]">
            <SelectField
              label="Project"
              value={draft.project_id || ''}
              onChange={(event) => update('project_id', event.target.value || null)}
            >
              <option value="">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.project_number} - {project.project_title}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Priority"
              value={draft.priority}
              onChange={(event) => update('priority', event.target.value as TaskDraft['priority'])}
            >
              {priorityOptions.map((priority) => (
                <option key={priority}>{priority}</option>
              ))}
            </SelectField>
            <SelectField
              label="Status"
              value={draft.status}
              onChange={(event) => update('status', event.target.value as TaskStatus)}
            >
              {taskStatuses.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </SelectField>
          </div>

          <TextareaField
            label="Details"
            value={draft.description}
            onChange={(event) => update('description', event.target.value)}
            className="min-h-24"
          />

          {formError ? <p className="rounded-md bg-red-50 p-3 text-sm text-danger">{formError}</p> : null}
        </form>
      </Card>

      {filteredTasks.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {filteredTasks.map((task) => (
            <Card key={task.id}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <TaskStatusBadge status={task.status} />
                    <PriorityBadge priority={task.priority} />
                  </div>
                  <h3 className="font-display text-xl font-semibold">{task.title}</h3>
                  <p className="mt-2 text-sm text-muted">{projectName(projects, task.project_id)}</p>
                  {task.description ? (
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-charcoal">{task.description}</p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant={task.status === 'Done' ? 'secondary' : 'primary'}
                  onClick={() => onUpdateTask(task.id, { status: task.status === 'Done' ? 'To Do' : 'Done' })}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {task.status === 'Done' ? 'Reopen' : 'Done'}
                </Button>
              </div>

              <div className="mt-4 grid gap-3 rounded-md border border-border bg-ivory p-3 text-sm md:grid-cols-3">
                <div>
                  <p className="text-muted">Assigned To</p>
                  <p className="font-semibold">{profileName(profiles, task.assigned_to)}</p>
                </div>
                <div>
                  <p className="text-muted">Due Date</p>
                  <p className={`flex items-center gap-1 font-semibold ${taskDeadlineTone(task)}`}>
                    <Clock3 className="h-4 w-4" />
                    {formatDate(task.due_date)}
                  </p>
                </div>
                <SelectField
                  label="Status"
                  value={task.status}
                  onChange={(event) => onUpdateTask(task.id, { status: event.target.value as TaskStatus })}
                >
                  {taskStatuses.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </SelectField>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No tasks yet"
          message="Add a task above to track work that is separate from the full project list."
          action={<ListChecks className="mx-auto h-8 w-8 text-gold" />}
        />
      )}
    </div>
  );
}
