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
          <p className="mt-1 text-muted">Final file links are optional. Completing delivery marks the project Completed, records the delivery date, and notifies the client.</p>
        </div>

        {error && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-danger">{error}</div>}

        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink"><FileCheck className="h-4 w-4 text-gold" /> Final Files (optional)</p>
          {project.requires_print && (
            <div className="space-y-1.5">
              <Field label="Final Print-Ready PDF URL (optional)" type="url" placeholder="https://drive.google.com/..." value={printUrl} readOnly={!canEditFiles} disabled={isSubmitting} onChange={(event) => setPrintUrl(event.target.value)} />
              {!project.final_print_pdf_link?.trim() && project.proof_pdf_link?.trim() && (
                <p className="text-xs text-muted">An Interior Proof PDF is saved. You may add a separate final print-ready link, or complete delivery without one.</p>
              )}
            </div>
          )}
          {project.requires_ebook && (
            <Field label="Final eBook / EPUB URL (optional)" type="url" placeholder="https://drive.google.com/..." value={ebookUrl} readOnly={!canEditFiles} disabled={isSubmitting} onChange={(event) => setEbookUrl(event.target.value)} />
          )}
          <p className="text-xs text-muted">Leave links blank to complete without adding files. Existing saved links are kept.</p>
        </div>

        <TextareaField label="Delivery Note (optional)" rows={3} value={note} disabled={isSubmitting} onChange={(event) => setNote(event.target.value)} placeholder="Instructions for the final delivery..." />
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="secondary" disabled={isSubmitting} onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isSubmitting} className="bg-success text-white hover:bg-green-700">
            <CheckCircle2 className="h-4 w-4" />
            {isSubmitting ? 'Completing Delivery...' : 'Confirm Final Delivery'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
