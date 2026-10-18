import { useRef, useState } from 'react';
import { RECEIVED_FILE_SOURCES, receivedFilesNote, type ReceivedFileSource } from '../lib/clientFileSubmission';
import { formatWorkflowErrorMessage } from '../lib/workflowErrors';
import type { Project } from '../lib/types';
import { Button, Modal, SelectField, TextareaField } from './ui';

export function ReceivedFilesModal({ project, onClose, onConfirm }: {
  project: Project;
  onClose: () => void;
  onConfirm: (source: ReceivedFileSource, note: string) => Promise<void>;
}) {
  const [source, setSource] = useState<ReceivedFileSource>('Email');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  async function submit() {
    if (submitting.current) return;
    setError(null);
    try {
      receivedFilesNote(source, note);
      submitting.current = true;
      setBusy(true);
      await onConfirm(source, note);
      onClose();
    } catch (err) {
      setError(formatWorkflowErrorMessage(err, 'Could not confirm receipt of the files.'));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal title="Files Already Received" width="max-w-lg" onClose={() => { if (!busy) onClose(); }}>
      <div className="space-y-4">
        <p className="text-sm text-charcoal">
          Confirm that you have the required files for <strong>{project.project_title}</strong>.
          This skips the client upload and starts the design concept timeline. Progress stays at 0% until the concept is submitted.
        </p>
        <SelectField label="Files received through" value={source} disabled={busy}
          onChange={(event) => { setSource(event.target.value as ReceivedFileSource); setError(null); }}>
          {RECEIVED_FILE_SOURCES.map((item) => <option key={item} value={item}>{item}</option>)}
        </SelectField>
        <TextareaField label={source === 'Other' ? 'Where were the files received?' : 'Receipt details (optional)'}
          placeholder="For example: manuscript and images received on October 18."
          value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} />
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy || (source === 'Other' && !note.trim())} onClick={() => void submit()}>
            {busy ? 'Starting…' : 'Start Design Concept'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
