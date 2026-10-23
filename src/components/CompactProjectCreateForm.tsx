import { FilePlus2, Paperclip, Save, X } from 'lucide-react';
import { type Dispatch, type FormEvent, type SetStateAction, useRef, useState } from 'react';
import { platforms, priorityOptions, serviceTypes } from '../lib/constants';
import { firstName, isClientRole, isManagerRole } from '../lib/utils';
import type { Profile, ProjectDraft } from '../lib/types';
import { errorMessage } from '../lib/utils';
import { validateProjectAttachments } from '../lib/projectAttachments';
import { Button, Field, Modal, SelectField, TextareaField } from './ui';

function serviceCapabilities(value: string) {
  const service = value.trim().toLowerCase();
  if (service.includes('print + ebook') || service.includes('print & ebook')) {
    return { requires_print: true, requires_ebook: true };
  }
  if (service.includes('ebook')) return { requires_print: false, requires_ebook: true };
  return { requires_print: true, requires_ebook: false };
}

export function CompactProjectCreateForm({
  draft,
  setDraft,
  profiles,
  canonical,
  onTimelineChange,
  onClose,
  onSubmit,
}: {
  draft: ProjectDraft;
  setDraft: Dispatch<SetStateAction<ProjectDraft>>;
  profiles: Profile[];
  canonical: boolean;
  onTimelineChange: (updates: Partial<ProjectDraft>) => void;
  onClose: () => void;
  onSubmit: (draft: ProjectDraft, attachments?: File[]) => Promise<void>;
}) {
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const assignable = profiles.filter((p) => !isClientRole(p.role) && p.status !== 'inactive' &&
    !['resigned', 'retired', 'terminated'].includes(p.employment_condition || 'active'));
  const managers = profiles.filter((p) => isManagerRole(p.role));
  const balance = Math.max(0, Number(draft.total_price || 0) - Number(draft.advance_paid || 0));

  function update<K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function selectService(value: string) {
    const changes = { service_type: value, ...serviceCapabilities(value) };
    if (canonical) setDraft((prev) => ({ ...prev, ...changes }));
    else onTimelineChange(changes);
  }

  function addAttachments(files: FileList | null) {
    if (!files) return;
    const next = [...attachments];
    for (const file of Array.from(files)) {
      if (!next.some((existing) => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified)) {
        next.push(file);
      }
    }
    const problem = validateProjectAttachments(next);
    setError(problem);
    if (!problem) setAttachments(next);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    const validation = validateProjectAttachments(attachments);
    if (validation) { setError(validation); return; }
    if (!draft.requires_print && !draft.requires_ebook) {
      setError('Select at least one service capability: Print or eBook.');
      return;
    }
    if (Number(draft.advance_paid) > Number(draft.total_price)) {
      setError('Advance paid cannot exceed the total project price.');
      return;
    }
    setError(null);
    setIsSaving(true);
    try {
      await onSubmit(draft, attachments);
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, 'Could not create this project.'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal title="New Project" width="max-w-2xl" onClose={() => { if (!isSaving) onClose(); }}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <p className="text-sm text-muted">
          Add the essentials now. Workflow dates, stages, delivery details and other settings can be managed in the project later.
        </p>

        <section className="rounded-xl border border-border bg-white p-4">
          <h3 className="mb-3 font-display text-base font-semibold text-ink">Project Details</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Client Name" required value={draft.client_name}
              onChange={(e) => update('client_name', e.target.value)} placeholder="Client or company" />
            <Field label="Project Title" required value={draft.project_title}
              onChange={(e) => update('project_title', e.target.value)} placeholder="Book / project name" />
            <div>
              <datalist id="new-project-service-types">{serviceTypes.map((item) => <option value={item} key={item} />)}</datalist>
              <Field label="Service Type" required list="new-project-service-types" value={draft.service_type}
                onChange={(e) => selectService(e.target.value)} />
            </div>
            <SelectField label="Assigned To" value={draft.assigned_to || ''}
              onChange={(e) => update('assigned_to', e.target.value || null)}>
              <option value="">Unassigned</option>
              {assignable.map((person) => <option key={person.id} value={person.id}>{firstName(person.full_name)}</option>)}
            </SelectField>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 rounded-lg border border-border bg-ivory/50 px-3 py-2">
            <span className="w-full text-xs font-semibold text-muted sm:w-auto">Deliverables</span>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.requires_print === true}
                onChange={(e) => update('requires_print', e.target.checked)} /> Print
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.requires_ebook === true}
                onChange={(e) => update('requires_ebook', e.target.checked)} /> eBook
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-white p-4">
          <h3 className="mb-3 font-display text-base font-semibold text-ink">Pricing <span className="text-xs font-normal text-muted">(USD)</span></h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Total Price" type="number" min="0" step="0.01" value={draft.total_price}
              onChange={(e) => update('total_price', Number(e.target.value))} />
            <Field label="Advance Paid" type="number" min="0" step="0.01" value={draft.advance_paid}
              onChange={(e) => update('advance_paid', Number(e.target.value))} />
            <div className="grid gap-1.5 text-sm font-medium">
              <span>Balance</span>
              <div className="flex min-h-11 items-center rounded-md border border-border bg-ivory px-3 font-semibold text-ink">
                ${balance.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-white p-4">
          <div className="mb-2 flex items-center gap-2">
            <Paperclip className="h-4 w-4 text-gold" />
            <h3 className="font-display text-base font-semibold text-ink">Attachments</h3>
            <span className="text-xs text-muted">Optional</span>
          </div>
          <p className="mb-3 text-xs text-muted">Attach the manuscript, brief, images, or other source files. No delivery links are needed.</p>
          <input ref={fileInput} type="file" multiple className="sr-only"
            aria-label="Choose project attachments" disabled={isSaving || !canonical}
            onChange={(e) => addAttachments(e.target.files)} />
          <button type="button" disabled={isSaving || !canonical}
            onClick={() => fileInput.current?.click()}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gold/60 bg-gold/5 px-3 text-sm font-semibold text-ink transition hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-50">
            <FilePlus2 className="h-4 w-4" />
            {attachments.length ? 'Add more files' : 'Choose attachments'}
          </button>
          {!canonical ? <p className="mt-2 text-xs text-muted">File uploads require a live workspace.</p> : null}
          {attachments.length ? <ul className="mt-3 space-y-2">
            {attachments.map((file) => (
              <li key={`${file.name}-${file.size}-${file.lastModified}`}
                className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-xs">
                <span className="min-w-0 truncate">{file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB</span>
                <button type="button" className="rounded-md p-1 hover:bg-ivory" disabled={isSaving}
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setAttachments((previous) => previous.filter((item) => item !== file))}>
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul> : null}
        </section>

        <TextareaField label="Notes (optional)" value={draft.general_notes}
          onChange={(e) => update('general_notes', e.target.value)}
          placeholder="Important instructions to remember..." />

        <details className="rounded-lg border border-border bg-white px-4 py-3 text-sm">
          <summary className="cursor-pointer font-semibold text-ink">More options (optional)</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Client Email" type="email" value={draft.client_email}
              onChange={(e) => update('client_email', e.target.value)} />
            <SelectField label="Priority" value={draft.priority}
              onChange={(e) => update('priority', e.target.value as ProjectDraft['priority'])}>
              {priorityOptions.map((value) => <option key={value}>{value}</option>)}
            </SelectField>
            <SelectField label="Project Manager" value={draft.project_manager || ''}
              onChange={(e) => update('project_manager', e.target.value || null)}>
              <option value="">Unassigned</option>
              {managers.map((person) => <option key={person.id} value={person.id}>{firstName(person.full_name)}</option>)}
            </SelectField>
            <SelectField label="Publishing Platform" value={draft.platform}
              onChange={(e) => update('platform', e.target.value)}>
              {platforms.map((value) => <option key={value}>{value}</option>)}
            </SelectField>
          </div>
        </details>

        {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-danger">{error}</p> : null}
        <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-border bg-linen pt-3">
          <Button type="button" variant="secondary" disabled={isSaving} onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isSaving}><Save className="h-4 w-4" /> {isSaving ? 'Creating…' : 'Create Project'}</Button>
        </div>
      </form>
    </Modal>
  );
}
