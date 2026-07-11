import { FileUp, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { Project, RevisionRequestDraft } from '../lib/types';
import { Button, IconButton, Modal, SelectField, TextareaField } from './ui';

const allowedAttachmentTypes = '.pdf,.jpg,.jpeg,.png,.doc,.docx';

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
  const [instructions, setInstructions] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId),
    [projectId, projects],
  );

  function addAttachments(files: FileList | null) {
    if (!files?.length) {
      return;
    }

    setAttachments((previous) => {
      const next = [...previous];
      Array.from(files).forEach((file) => {
        const exists = next.some(
          (item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified,
        );
        if (!exists) {
          next.push(file);
        }
      });
      return next;
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function submit() {
    if (isSaving) {
      return;
    }

    setFormError(null);
    const cleanInstructions = instructions.trim();

    if (!projectId) {
      setFormError('Please select a project.');
      return;
    }

    if (!cleanInstructions) {
      setFormError('Please add revision instructions before submitting.');
      return;
    }

    setIsSaving(true);
    try {
      await onSubmit({
        project_id: projectId,
        instructions: cleanInstructions,
        attachments,
      });
      setInstructions('');
      setAttachments([]);
      onClose();
    } catch (error) {
      console.error('Revision request submission failed:', error);
      setFormError('Revision request could not be submitted. Please check your connection and try again.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal title="Request Revision" onClose={onClose} width="max-w-3xl">
      <div className="space-y-5">
        <SelectField label="Project" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.project_title}
            </option>
          ))}
        </SelectField>

        {selectedProject ? (
          <div className="rounded-md border border-border bg-ivory p-4 text-sm text-muted">
            Revision request for <span className="font-semibold text-ink">{selectedProject.project_title}</span>
          </div>
        ) : null}

        <TextareaField
          label="Revision Instructions"
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder="Please describe all required revisions clearly. You may include page numbers, chapter names, section names, or any other relevant details."
          className="min-h-56"
        />

        <label className="grid gap-1.5 text-sm font-medium text-ink">
          <span>Request Attachments</span>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={allowedAttachmentTypes}
            onChange={(event) => addAttachments(event.target.files)}
            className="rounded-md border border-border bg-white px-3 py-2 text-sm"
          />
        </label>

        {attachments.length ? (
          <div className="rounded-md border border-border bg-white p-4">
            <div className="mb-3 flex items-center gap-2 font-semibold">
              <FileUp className="h-4 w-4 text-gold" />
              Selected files
            </div>
            <div className="space-y-2">
              {attachments.map((file) => (
                <div key={`${file.name}-${file.lastModified}`} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{file.name}</span>
                  <IconButton
                    title="Remove file"
                    onClick={() => setAttachments((previous) => previous.filter((item) => item !== file))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {formError ? <p className="rounded-md bg-red-50 p-3 text-sm text-danger">{formError}</p> : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={isSaving}>
            {isSaving ? 'Submitting' : 'Submit Revision Request'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
