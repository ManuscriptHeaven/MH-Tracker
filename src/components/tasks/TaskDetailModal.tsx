import { Archive, Check, MessageSquare, Plus, Trash2, Users } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { priorityOptions, taskStatuses } from '../../lib/constants';
import { formatDate } from '../../lib/date';
import type {
  Profile,
  Project,
  Task,
  TaskAssignee,
  TaskChecklistItem,
  TaskComment,
  TaskDependency,
  TaskDraft,
  TaskStatus,
  TaskVisibility,
} from '../../lib/types';
import { firstName, isClientRole, isManagerRole } from '../../lib/utils';
import { Button, Card, Field, Modal, SelectField, TextareaField } from '../ui';

type Props = {
  task: Task;
  tasks: Task[];
  projects: Project[];
  profiles: Profile[];
  currentProfile: Profile;
  assignees: TaskAssignee[];
  comments: TaskComment[];
  checklistItems: TaskChecklistItem[];
  dependencies: TaskDependency[];
  onClose: () => void;
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
};

function editState(task: Task) {
  return {
    title: task.title,
    description: task.description,
    project_id: task.project_id || '',
    assigned_to: task.assigned_to || '',
    status: task.status,
    priority: task.priority,
    start_date: task.start_date || '',
    due_date: task.due_date || '',
    estimated_minutes: task.estimated_minutes?.toString() || '',
    actual_minutes: task.actual_minutes?.toString() || '',
    blocked_reason: task.blocked_reason || '',
    visibility: task.visibility,
  };
}

export function TaskDetailModal(props: Props) {
  const { task, tasks, projects, profiles, currentProfile } = props;
  const [form, setForm] = useState(() => editState(task));
  const [comment, setComment] = useState('');
  const [checklistTitle, setChecklistTitle] = useState('');
  const [collaboratorId, setCollaboratorId] = useState('');
  const [dependencyId, setDependencyId] = useState('');
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setForm(editState(task)), [task]);

  const teamProfiles = profiles.filter((profile) => !isClientRole(profile.role) && profile.status !== 'inactive');
  const collaborators = props.assignees.filter((item) => item.task_id === task.id && item.assignment_role !== 'primary');
  const taskComments = props.comments.filter((item) => item.task_id === task.id);
  const checklist = props.checklistItems.filter((item) => item.task_id === task.id).sort((a, b) => a.position - b.position);
  const taskDependencies = props.dependencies.filter((item) => item.task_id === task.id);
  const subtasks = tasks.filter((item) => item.parent_task_id === task.id && !item.archived_at);
  const collaboratorIds = new Set(props.assignees.filter((item) => item.task_id === task.id).map((item) => item.profile_id));
  const availableDependencies = tasks.filter((item) =>
    item.id !== task.id && item.parent_task_id !== task.id && !item.archived_at &&
    !taskDependencies.some((dependency) => dependency.depends_on_task_id === item.id));
  const canManageComments = isManagerRole(currentProfile.role);
  const canReassign = isManagerRole(currentProfile.role);

  const checklistProgress = useMemo(() => ({
    done: checklist.filter((item) => item.completed).length,
    total: checklist.length,
  }), [checklist]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try { await action(); } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Task change could not be saved.');
    } finally { setBusy(false); }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form.title.trim()) return setError('Task title is required.');
    await run(() => props.onUpdateTask(task.id, {
      title: form.title.trim(),
      description: form.description.trim(),
      project_id: form.project_id || null,
      assigned_to: form.assigned_to || null,
      status: form.status,
      priority: form.priority,
      start_date: form.start_date || null,
      due_date: form.due_date || null,
      estimated_minutes: form.estimated_minutes === '' ? null : Number(form.estimated_minutes),
      actual_minutes: form.actual_minutes === '' ? null : Number(form.actual_minutes),
      blocked_reason: form.status === 'Blocked' ? form.blocked_reason.trim() || null : null,
      visibility: form.visibility,
    }));
  }

  return (
    <Modal title={`Task · ${task.title}`} onClose={props.onClose} width="max-w-6xl">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.85fr)]">
        <div className="space-y-5">
          <Card>
            <form className="space-y-4" onSubmit={save}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />
                <SelectField label="Status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as TaskStatus })}>
                  {taskStatuses.map((status) => <option key={status}>{status}</option>)}
                </SelectField>
              </div>
              <TextareaField label="Description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <SelectField label="Project" disabled={!canReassign} value={form.project_id} onChange={(event) => setForm({ ...form, project_id: event.target.value })}>
                  <option value="">No project</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.project_number} · {project.project_title}</option>)}
                </SelectField>
                <SelectField label="Primary assignee" disabled={!canReassign} value={form.assigned_to} onChange={(event) => setForm({ ...form, assigned_to: event.target.value })}>
                  <option value="">Unassigned</option>
                  {teamProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name}</option>)}
                </SelectField>
                <SelectField label="Priority" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as Task['priority'] })}>
                  {priorityOptions.map((priority) => <option key={priority}>{priority}</option>)}
                </SelectField>
                <Field label="Start date" type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} />
                <Field label="Due date" type="date" value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} />
                <SelectField label="Visibility" value={form.visibility} onChange={(event) => setForm({ ...form, visibility: event.target.value as TaskVisibility })}>
                  <option value="team">Team</option><option value="private">Private</option>
                </SelectField>
                <Field label="Estimated minutes" type="number" min="0" value={form.estimated_minutes} onChange={(event) => setForm({ ...form, estimated_minutes: event.target.value })} />
                <Field label="Actual minutes" type="number" min="0" value={form.actual_minutes} onChange={(event) => setForm({ ...form, actual_minutes: event.target.value })} />
              </div>
              {form.status === 'Blocked' ? (
                <TextareaField label="Blocked reason" value={form.blocked_reason} onChange={(event) => setForm({ ...form, blocked_reason: event.target.value })} placeholder="What is preventing progress?" />
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button type="button" variant="danger" disabled={busy} onClick={() => {
                  if (window.confirm('Archive this task? It will leave active task views but remain recoverable in the database.')) {
                    void run(async () => { await props.onArchiveTask(task.id); props.onClose(); });
                  }
                }}><Archive className="h-4 w-4" />Archive</Button>
                <Button type="submit" disabled={busy}><Check className="h-4 w-4" />Save task</Button>
              </div>
            </form>
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-3">
              <div><h3 className="font-display text-lg font-semibold text-ink">Checklist</h3><p className="text-xs text-muted">{checklistProgress.done} of {checklistProgress.total} complete</p></div>
              <span className="text-sm font-bold text-ink">{checklistProgress.total ? Math.round(checklistProgress.done / checklistProgress.total * 100) : 0}%</span>
            </div>
            <div className="mt-4 space-y-2">
              {checklist.map((item) => (
                <div key={item.id} className="flex items-center gap-3 rounded-md border border-border bg-white p-3">
                  <input type="checkbox" checked={item.completed} onChange={(event) => void run(() => props.onToggleChecklistItem(item.id, event.target.checked))} />
                  <span className={`flex-1 text-sm ${item.completed ? 'text-muted line-through' : 'text-ink'}`}>{item.title}</span>
                  <button type="button" className="text-muted hover:text-danger" onClick={() => void run(() => props.onDeleteChecklistItem(item.id))}><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void run(async () => { await props.onAddChecklistItem(task.id, checklistTitle); setChecklistTitle(''); }); }}>
                <input className="min-h-10 flex-1 rounded-md border border-border px-3 text-sm" value={checklistTitle} onChange={(event) => setChecklistTitle(event.target.value)} placeholder="Add checklist item" />
                <Button type="submit" disabled={!checklistTitle.trim() || busy}><Plus className="h-4 w-4" />Add</Button>
              </form>
            </div>
          </Card>

          <Card>
            <h3 className="font-display text-lg font-semibold text-ink">Subtasks</h3>
            <div className="mt-3 space-y-2">
              {subtasks.map((subtask) => (
                <div key={subtask.id} className="grid gap-1 rounded-md border border-border p-3 text-sm sm:grid-cols-[1fr_auto_auto_auto]">
                  <span className="font-medium text-ink">{subtask.title}</span>
                  <span className="text-muted">{subtask.status}</span>
                  <span className="text-muted">{profiles.find((profile) => profile.id === subtask.assigned_to)?.full_name || 'Unassigned'}</span>
                  <span className="text-muted">{subtask.due_date ? formatDate(subtask.due_date) : 'No due date'}</span>
                </div>
              ))}
              <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void run(async () => {
                await props.onCreateSubtask(task.id, {
                  title: subtaskTitle, description: '', project_id: task.project_id, assigned_to: task.assigned_to,
                  status: 'To Do', priority: task.priority, due_date: task.due_date,
                }); setSubtaskTitle('');
              }); }}>
                <input className="min-h-10 flex-1 rounded-md border border-border px-3 text-sm" value={subtaskTitle} onChange={(event) => setSubtaskTitle(event.target.value)} placeholder="New subtask title" />
                <Button type="submit" disabled={!subtaskTitle.trim() || busy}><Plus className="h-4 w-4" />Create</Button>
              </form>
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-ink"><Users className="h-4 w-4" />Collaborators</h3>
            <div className="mt-3 space-y-2">
              {collaborators.map((assignment) => {
                const profile = profiles.find((item) => item.id === assignment.profile_id);
                return <div key={assignment.id} className="flex items-center justify-between rounded-md bg-ivory p-2 text-sm"><span>{profile?.full_name || 'Team member'} · {assignment.assignment_role}</span><button type="button" onClick={() => void run(() => props.onRemoveCollaborator(task.id, assignment.profile_id))}><Trash2 className="h-4 w-4 text-muted hover:text-danger" /></button></div>;
              })}
              <div className="flex gap-2">
                <SelectField value={collaboratorId} onChange={(event) => setCollaboratorId(event.target.value)} className="min-w-0 flex-1">
                  <option value="">Select teammate</option>
                  {teamProfiles.filter((profile) => !collaboratorIds.has(profile.id)).map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name}</option>)}
                </SelectField>
                <Button type="button" disabled={!collaboratorId || busy} onClick={() => void run(async () => { await props.onAssignCollaborator(task.id, collaboratorId); setCollaboratorId(''); })}>Add</Button>
              </div>
            </div>
          </Card>

          <Card>
            <h3 className="font-display text-lg font-semibold text-ink">Blocked by / depends on</h3>
            <div className="mt-3 space-y-2">
              {taskDependencies.map((dependency) => {
                const dependencyTask = tasks.find((item) => item.id === dependency.depends_on_task_id);
                return <div key={dependency.id} className="flex items-center justify-between rounded-md bg-ivory p-2 text-sm"><span>{dependencyTask?.title || 'Unavailable task'}</span><button type="button" onClick={() => void run(() => props.onRemoveDependency(dependency.id))}><Trash2 className="h-4 w-4 text-muted hover:text-danger" /></button></div>;
              })}
              <div className="flex gap-2">
                <SelectField value={dependencyId} onChange={(event) => setDependencyId(event.target.value)} className="min-w-0 flex-1"><option value="">Select task</option>{availableDependencies.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</SelectField>
                <Button type="button" disabled={!dependencyId || busy} onClick={() => void run(async () => { await props.onAddDependency(task.id, dependencyId); setDependencyId(''); })}>Add</Button>
              </div>
            </div>
          </Card>

          <Card>
            <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-ink"><MessageSquare className="h-4 w-4" />Comments</h3>
            <div className="mt-3 space-y-3">
              {taskComments.map((item) => {
                const author = profiles.find((profile) => profile.id === item.user_id);
                const canModify = item.user_id === currentProfile.id || canManageComments;
                return <div key={item.id} className="rounded-md border border-border bg-white p-3"><div className="flex justify-between gap-3"><p className="text-xs font-semibold text-ink">{author ? firstName(author.full_name) : 'Team member'}</p>{canModify ? <div className="flex gap-2"><button type="button" className="text-xs font-medium text-muted hover:text-ink" onClick={() => { const next = window.prompt('Edit comment', item.comment); if (next !== null) void run(() => props.onUpdateComment(item.id, next)); }}>Edit</button><button type="button" onClick={() => void run(() => props.onDeleteComment(item.id))}><Trash2 className="h-3.5 w-3.5 text-muted hover:text-danger" /></button></div> : null}</div><p className="mt-1 whitespace-pre-wrap text-sm text-charcoal">{item.comment}</p></div>;
              })}
              <form onSubmit={(event) => { event.preventDefault(); void run(async () => { await props.onAddComment(task.id, comment); setComment(''); }); }}>
                <textarea className="min-h-24 w-full rounded-md border border-border p-3 text-sm" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add a comment" />
                <Button className="mt-2 w-full" type="submit" disabled={!comment.trim() || busy}>Post comment</Button>
              </form>
            </div>
          </Card>
        </div>
      </div>
      {error ? <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-700">{error}</p> : null}
    </Modal>
  );
}
