import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { clientRevisionPriorityOptions } from '../lib/constants';
import type { ClientRevisionPriority, Project, RevisionRequestDraft, RevisionRequestItemDraft } from '../lib/types';
import { Button, Field, IconButton, Modal, SelectField, TextareaField } from './ui';

type DraftPoint = RevisionRequestItemDraft & {
  id: string;
};

function newPoint(): DraftPoint {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    page_reference: '',
    instruction: '',
    client_attachment_url: '',
    attachment_file: null,
  };
}

export function RevisionRequestModal({
  projects,
  initialProjectId,
  onClose,
  onSubmit,
}: {
  projects: Project[];
  initialProjectId?: string;
  onClose: () => void;
  onSubmit: (draft: RevisionRequestDraft) => Promise<void>;
}) {
  const [projectId, setProjectId] = useState(initialProjectId || projects[0]?.id || '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<ClientRevisionPriority>('Normal');
  const [points, setPoints] = useState<DraftPoint[]>([newPoint()]);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId),
    [projectId, projects],
  );

  function updatePoint(id: string, updates: Partial<DraftPoint>) {
    setPoints((previous) => previous.map((point) => (point.id === id ? { ...point, ...updates } : point)));
  }

  function movePoint(id: string, direction: -1 | 1) {
    setPoints((previous) => {
      const index = previous.findIndex((point) => point.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= previous.length) {
        return previous;
      }

      const next = [...previous];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  }

  async function submit() {
    setFormError(null);

    if (!projectId || !title.trim()) {
      setFormError('Select a project and add a revision title.');
      return;
    }

    const cleanPoints = points.filter((point) => point.page_reference.trim() || point.instruction.trim());

    if (!cleanPoints.length) {
      setFormError('Add at least one revision point.');
      return;
    }

    const confirmed = window.confirm(`Submit revision request for ${selectedProject?.project_title || 'this project'}?`);
    if (!confirmed) {
      return;
    }

    setIsSaving(true);
    try {
      await onSubmit({
        project_id: projectId,
        title: title.trim(),
        description: description.trim(),
        priority,
        attachments,
        items: cleanPoints.map(({ id, ...point }) => {
          void id;
          return point;
        }),
      });
      onClose();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Revision request could not be submitted.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal title="Request Revision" onClose={onClose} width="max-w-5xl">
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label="Project" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.project_title}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Priority"
            value={priority}
            onChange={(event) => setPriority(event.target.value as ClientRevisionPriority)}
          >
            {clientRevisionPriorityOptions.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </SelectField>
        </div>

        <Field
          label="Revision request title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Example: Final proof changes"
        />
        <TextareaField
          label="General instructions"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Add the overall context for this revision request."
        />

        <label className="grid gap-1.5 text-sm font-medium text-ink">
          <span>Request attachments</span>
          <input
            type="file"
            multiple
            onChange={(event) => setAttachments(Array.from(event.target.files || []))}
            className="rounded-md border border-border bg-white px-3 py-2 text-sm"
          />
        </label>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-xl font-semibold">Revision Points</h3>
            <Button type="button" variant="secondary" onClick={() => setPoints((previous) => [...previous, newPoint()])}>
              <Plus className="h-4 w-4" />
              Add Point
            </Button>
          </div>

          {points.map((point, index) => (
            <section key={point.id} className="rounded-lg border border-border bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="font-semibold">Point {index + 1}</p>
                <div className="flex items-center gap-2">
                  <IconButton title="Move up" onClick={() => movePoint(point.id, -1)} disabled={index === 0}>
                    <ArrowUp className="h-4 w-4" />
                  </IconButton>
                  <IconButton title="Move down" onClick={() => movePoint(point.id, 1)} disabled={index === points.length - 1}>
                    <ArrowDown className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    title="Remove point"
                    onClick={() => setPoints((previous) => previous.filter((item) => item.id !== point.id))}
                    disabled={points.length === 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              </div>

              <div className="grid gap-4">
                <Field
                  label="Page, chapter, or section"
                  value={point.page_reference}
                  onChange={(event) => updatePoint(point.id, { page_reference: event.target.value })}
                  placeholder="Example: Page 48 or Chapter 3"
                />
                <TextareaField
                  label="Detailed instruction"
                  value={point.instruction}
                  onChange={(event) => updatePoint(point.id, { instruction: event.target.value })}
                  placeholder="Describe exactly what should be changed."
                />
                <label className="grid gap-1.5 text-sm font-medium text-ink">
                  <span>Point attachment</span>
                  <input
                    type="file"
                    onChange={(event) =>
                      updatePoint(point.id, {
                        attachment_file: event.target.files?.[0] || null,
                      })
                    }
                    className="rounded-md border border-border bg-white px-3 py-2 text-sm"
                  />
                </label>
              </div>
            </section>
          ))}
        </div>

        {formError ? <p className="rounded-md bg-red-50 p-3 text-sm text-danger">{formError}</p> : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={isSaving}>
            {isSaving ? 'Submitting' : 'Submit Revision'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
