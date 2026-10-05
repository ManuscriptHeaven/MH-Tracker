import { useRef, useState } from 'react';
import { CheckCircle2, FileCheck } from 'lucide-react';
import type { Project, ProjectMetadataUpdate } from '../lib/types';
import { FinalDeliveryFilesSavedError, submitFinalDeliveryWithFiles } from '../lib/finalDelivery';
import { formatWorkflowErrorMessage } from '../lib/workflowErrors';
import { Button, Field, Modal, TextareaField } from './ui';

export function FinalDeliveryModal({
  project,
  canEditFiles,
  onSaveFiles,
  onComplete,
  onClose,
}: {
  project: Project;
  canEditFiles: boolean;
  onSaveFiles: (updates: ProjectMetadataUpdate) => Promise<void>;
  onComplete: (note?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [printUrl, setPrintUrl] = useState(project.final_print_pdf_link || '');
  const [ebookUrl, setEbookUrl] = useState(project.final_ebook_link || '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const missingFiles = (project.requires_print && !printUrl.trim()) || (project.requires_ebook && !ebookUrl.trim());

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      await submitFinalDeliveryWithFiles(
        project,
        { final_print_pdf_link: printUrl, final_ebook_link: ebookUrl },
        canEditFiles ? onSaveFiles : undefined,
        () => onComplete(note.trim() || 'Final delivery completed from the project workflow view.'),
      );
      onClose();
    } catch (failure) {
      setError(failure instanceof FinalDeliveryFilesSavedError
        ? `${failure.message} ${formatWorkflowErrorMessage(failure.completionError, 'Final delivery could not be completed. Please try again.')}`
        : formatWorkflowErrorMessage(failure, 'Final delivery could not be completed. Please try again.'));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Complete Final Delivery" width="max-w-lg" onClose={() => { if (!submittingRef.current) onClose(); }}>
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-lg border border-success/20 bg-green-50 p-3 text-sm">
          <p className="font-semibold text-ink">{project.project_title} · {project.project_number}</p>
          <p className="mt-1 text-muted">Review the final files before completing delivery. This marks the project Completed, records the delivery date, and notifies the client.</p>
        </div>

        {error && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-danger">{error}</div>}

        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink"><FileCheck className="h-4 w-4 text-gold" /> Required Final Files</p>
          {project.requires_print && (
            <div className="space-y-1.5">
              <Field label="Final Print-Ready PDF URL" type="url" required placeholder="https://drive.google.com/..." value={printUrl} readOnly={!canEditFiles} disabled={isSubmitting} onChange={(event) => setPrintUrl(event.target.value)} />
              {!project.final_print_pdf_link?.trim() && project.proof_pdf_link?.trim() && (
                <p className="text-xs text-muted">An Interior Proof PDF is saved. Add the final print-ready file link here to use it for delivery.</p>
              )}
            </div>
          )}
          {project.requires_ebook && (
            <Field label="Final eBook / EPUB URL" type="url" required placeholder="https://drive.google.com/..." value={ebookUrl} readOnly={!canEditFiles} disabled={isSubmitting} onChange={(event) => setEbookUrl(event.target.value)} />
          )}
          {missingFiles && <p className="text-sm text-warning" role="status">{canEditFiles ? 'Add the required final file links to enable completion.' : 'A manager needs to add the required final file links before you can complete delivery.'}</p>}
        </div>

        <TextareaField label="Delivery Note (optional)" rows={3} value={note} disabled={isSubmitting} onChange={(event) => setNote(event.target.value)} placeholder="Instructions for the final delivery..." />
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="secondary" disabled={isSubmitting} onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isSubmitting || Boolean(missingFiles)} className="bg-success text-white hover:bg-green-700">
            <CheckCircle2 className="h-4 w-4" />
            {isSubmitting ? 'Completing Delivery...' : 'Confirm Final Delivery'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
