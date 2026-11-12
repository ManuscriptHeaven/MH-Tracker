import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Mic, ShieldCheck, Square, X } from 'lucide-react';
import type { Priority, Profile, Project } from '../../lib/types';
import type { ProjectCreationMemoryDraft } from '../../lib/ai/aiTypes';
import type { AICreationRequest, TaskCreationFormDraft } from '../../lib/ai/creationForms';
import { useAIContext } from '../../lib/ai/aiContext';
import { SERVICE_TYPES } from '../../lib/ai/projectCreationWizard';
import { isClientRole, isManagerRole } from '../../lib/utils';
import { todayInput } from '../../lib/date';

export interface CreationFormSelection {
  kind: 'task' | 'project';
  draft?: Partial<TaskCreationFormDraft> | ProjectCreationMemoryDraft;
}

export function AICreationForm({
  selection,
  projects,
  profiles,
  onClose,
}: {
  selection: CreationFormSelection;
  projects: Project[];
  profiles: Profile[];
  onClose: () => void;
}) {
  const {
    sendMessage,
    startDictation,
    stopVoice,
    isListening,
    isProcessing,
    voiceError,
    clearVoiceError,
    settings,
    setActiveTab,
  } = useAIContext();
  const task = selection.kind === 'task';
  const taskDraft = (selection.draft || {}) as Partial<TaskCreationFormDraft>;
  const projectDraft = (selection.draft || {}) as ProjectCreationMemoryDraft;
  const [title, setTitle] = useState(
    task ? taskDraft.title || '' : projectDraft.projectTitle || '',
  );
  const [description, setDescription] = useState(
    task ? taskDraft.description || '' : projectDraft.notes || '',
  );
  const [assignee, setAssignee] = useState(selection.draft?.assignedToId || '');
  const [projectId, setProjectId] = useState(taskDraft.projectId || '');
  const [dueDate, setDueDate] = useState(selection.draft?.dueDate || '');
  const [priority, setPriority] = useState<Priority>(selection.draft?.priority || 'Normal');
  const [client, setClient] = useState(projectDraft.clientName || '');
  const [email, setEmail] = useState(projectDraft.clientEmail || '');
  const [service, setService] = useState(projectDraft.serviceType || '');
  const [price, setPrice] = useState(
    projectDraft.totalPrice === undefined ? '' : String(projectDraft.totalPrice),
  );
  const [advance, setAdvance] = useState(String(projectDraft.advancePaid || 0));
  const [startDate, setStartDate] = useState(projectDraft.startDate || todayInput());
  const [manager, setManager] = useState(projectDraft.projectManagerId || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [recording, setRecording] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const team = profiles.filter(
    (profile) => !isClientRole(profile.role) && profile.status !== 'inactive',
  );
  const clients = [
    ...new Set([
      ...projects.map((project) => project.client_name),
      ...profiles
        .filter((profile) => isClientRole(profile.role))
        .map((profile) => profile.full_name),
    ]),
  ].filter(Boolean);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector('input')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const fields = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select, textarea',
        ) || []),
      ];
      if (!fields.length) return;
      if (event.shiftKey && document.activeElement === fields[0]) {
        event.preventDefault();
        fields[fields.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === fields[fields.length - 1]) {
        event.preventDefault();
        fields[0].focus();
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => {
      stopVoice();
      document.removeEventListener('keydown', keyboard);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [onClose, stopVoice]);

  function dictate(field: string, update: (text: string) => void) {
    if (recording === field && isListening) {
      stopVoice();
      setRecording(null);
      return;
    }
    clearVoiceError();
    setRecording(field);
    startDictation((text, final) => {
      update(text);
      if (final) setRecording(null);
    });
  }
  function microphone(field: string, label: string, update: (text: string) => void) {
    const active = recording === field && isListening;
    return (
      <button
        type="button"
        className={`ai-field-mic ${active ? 'is-recording' : ''}`}
        aria-label={active ? `Stop dictating ${label}` : `Dictate ${label}`}
        disabled={isProcessing || !settings.voiceEnabled}
        onClick={() => dictate(field, update)}
      >
        {active ? <Square size={14} /> : <Mic size={15} />}
        {active ? 'Stop' : 'Speak'}
      </button>
    );
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || isProcessing) return;
    stopVoice();
    setRecording(null);
    setError('');
    setSubmitting(true);
    const request: AICreationRequest = task
      ? {
          kind: 'task',
          draft: {
            title,
            description,
            assignedToId: assignee,
            projectId: projectId || undefined,
            dueDate: dueDate || undefined,
            priority,
          },
        }
      : {
          kind: 'project',
          draft: {
            projectTitle: title,
            clientName: client,
            clientEmail: email.trim(),
            serviceType: service,
            totalPrice: Number(price),
            advancePaid: Number(advance),
            startDate,
            dueDate,
            assignedToId: assignee || undefined,
            projectManagerId: manager || undefined,
            priority,
            notes: description,
          },
        };
    try {
      setActiveTab('chat');
      const result = await sendMessage(`Review new ${selection.kind}: ${title.trim()}`, request);
      if (result?.pendingAction) onClose();
      else setError(result?.displayText || 'The preview could not be prepared. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="ai-creation-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-creation-title"
        aria-describedby="ai-creation-help"
        className="ai-creation-dialog"
      >
        <header>
          <div>
            <span className="ai-eyebrow">ADD DETAILS · REVIEW · CONFIRM</span>
            <h2 id="ai-creation-title">{task ? 'New Task' : 'New Project'}</h2>
          </div>
          <button
            type="button"
            className="ai-icon-button"
            aria-label="Close creation form"
            disabled={submitting}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <p id="ai-creation-help">
          Fill in the details below. Use Speak beside a field to dictate just that field. Nothing is
          saved until you review and confirm.
        </p>
        <form onSubmit={submit}>
          <div className="ai-creation-fields">
            <div className="ai-form-field ai-field-wide">
              <label htmlFor="ai-create-title">
                {task ? 'Task title' : 'Project title'} <span>*</span>
              </label>
              <div className="ai-dictation-input">
                <input
                  id="ai-create-title"
                  required
                  minLength={3}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={task ? 'e.g. Prepare ebook' : 'e.g. The Quiet Atlas'}
                />
                {microphone('title', task ? 'task title' : 'project title', setTitle)}
              </div>
            </div>
            {!task && (
              <>
                <div className="ai-form-field">
                  <label htmlFor="ai-create-client">
                    Client name <span>*</span>
                  </label>
                  <input
                    id="ai-create-client"
                    list="ai-known-clients"
                    required
                    value={client}
                    onChange={(event) => {
                      const value = event.target.value;
                      setClient(value);
                      setEmail(
                        projects.find((project) => project.client_name === value)?.client_email ||
                          profiles.find(
                            (profile) => isClientRole(profile.role) && profile.full_name === value,
                          )?.email ||
                          '',
                      );
                    }}
                    placeholder="Choose or enter a client"
                  />
                  <datalist id="ai-known-clients">
                    {clients.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </div>
                <div className="ai-form-field">
                  <label htmlFor="ai-create-email">Client email</label>
                  <input
                    id="ai-create-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="client@example.com"
                  />
                </div>
                <div className="ai-form-field ai-field-wide">
                  <label htmlFor="ai-create-service">
                    Service type <span>*</span>
                  </label>
                  <select
                    id="ai-create-service"
                    required
                    value={service}
                    onChange={(event) => setService(event.target.value)}
                  >
                    <option value="">Choose a service</option>
                    {SERVICE_TYPES.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </div>
                <div className="ai-form-field">
                  <label htmlFor="ai-create-price">
                    Total price (USD) <span>*</span>
                  </label>
                  <input
                    id="ai-create-price"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                  />
                </div>
                <div className="ai-form-field">
                  <label htmlFor="ai-create-advance">Advance paid (USD)</label>
                  <input
                    id="ai-create-advance"
                    type="number"
                    min="0"
                    max={price || undefined}
                    step="0.01"
                    value={advance}
                    onChange={(event) => setAdvance(event.target.value)}
                  />
                </div>
              </>
            )}
            <div className="ai-form-field">
              <label htmlFor="ai-create-assignee">Assigned to {task && <span>*</span>}</label>
              <select
                id="ai-create-assignee"
                required={task}
                value={assignee}
                onChange={(event) => setAssignee(event.target.value)}
              >
                <option value="">{task ? 'Choose a team member' : 'Unassigned'}</option>
                {team.map((profile) => (
                  <option value={profile.id} key={profile.id}>
                    {profile.full_name}
                  </option>
                ))}
              </select>
            </div>
            {task ? (
              <div className="ai-form-field">
                <label htmlFor="ai-create-project">Project</label>
                <select
                  id="ai-create-project"
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                >
                  <option value="">No project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.project_number} · {project.project_title}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="ai-form-field">
                <label htmlFor="ai-create-manager">Project manager</label>
                <select
                  id="ai-create-manager"
                  value={manager}
                  onChange={(event) => setManager(event.target.value)}
                >
                  <option value="">Not assigned</option>
                  {team
                    .filter((profile) => isManagerRole(profile.role))
                    .map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.full_name}
                      </option>
                    ))}
                </select>
              </div>
            )}
            {!task && (
              <div className="ai-form-field">
                <label htmlFor="ai-create-start">
                  Start date <span>*</span>
                </label>
                <input
                  id="ai-create-start"
                  type="date"
                  required
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </div>
            )}
            <div className="ai-form-field">
              <label htmlFor="ai-create-due">Due date {!task && <span>*</span>}</label>
              <input
                id="ai-create-due"
                type="date"
                required={!task}
                min={task ? undefined : startDate}
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
            <div className="ai-form-field">
              <label htmlFor="ai-create-priority">Priority</label>
              <select
                id="ai-create-priority"
                value={priority}
                onChange={(event) => setPriority(event.target.value as Priority)}
              >
                {['Low', 'Normal', 'High', 'Urgent'].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </div>
            <div className="ai-form-field ai-field-wide">
              <div className="ai-field-label">
                <label htmlFor="ai-create-description">
                  {task ? 'Description / instructions' : 'Project notes'}
                </label>
                {microphone(
                  'description',
                  task ? 'task description' : 'project notes',
                  setDescription,
                )}
              </div>
              <textarea
                id="ai-create-description"
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Anything the team needs to know…"
              />
            </div>
          </div>
          {recording && isListening && (
            <p className="ai-form-notice" role="status">
              Listening into the selected field…
            </p>
          )}
          {voiceError && (
            <p role="alert" className="ai-form-error">
              {voiceError}
            </p>
          )}
          {error && (
            <p role="alert" className="ai-form-error">
              {error}
            </p>
          )}
          <footer>
            <p>
              <ShieldCheck size={14} /> You review every detail before saving.
            </p>
            <div>
              <button
                type="button"
                className="ai-outline-button"
                disabled={submitting}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="ai-speak-button"
                disabled={submitting || isProcessing}
              >
                {submitting ? 'Preparing preview…' : task ? 'Review Task' : 'Review Project'}
                <ArrowRight size={15} />
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}
