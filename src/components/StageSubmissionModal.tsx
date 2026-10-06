import { useRef, useState } from 'react';
import { Paperclip, Send } from 'lucide-react';
import { Button, Field, Modal, TextareaField } from './ui';
import { privateProjectFileName, validateProofFile } from '../lib/stageSubmission';
import { formatWorkflowErrorMessage } from '../lib/workflowErrors';

export function StageSubmissionModal({ title, initialUrl = '', onSubmit, onClose }: {
  title: string;
  initialUrl?: string;
  onSubmit: (note: string, fileUrl: string, file?: File) => Promise<void>;
  onClose: () => void;
}) {
  const savedFile = privateProjectFileName(initialUrl);
  const [note, setNote] = useState('');
  const [link, setLink] = useState(savedFile ? '' : initialUrl);
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  async function submit() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(note.trim(), link.trim(), file);
      onClose();
    } catch (failure) {
      setError(formatWorkflowErrorMessage(failure, 'Submission could not be completed. Please try again.'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return <Modal title={title} width="max-w-lg" onClose={() => { if (!busyRef.current) onClose(); }}>
    <div className="space-y-4">
      <TextareaField label="Note (optional)" value={note} disabled={busy} onChange={event => setNote(event.target.value)} rows={4} />
      <label className="grid gap-1.5 text-sm font-medium">
        Attach File
        <input type="file" disabled={busy} className="block w-full min-w-0 rounded-md border border-border p-2 text-sm"
          onChange={event => {
            const selected = event.target.files?.[0];
            event.target.value = '';
            if (!selected) return;
            const validationError = validateProofFile(selected);
            if (validationError) { setError(validationError); return; }
            setFile(selected); setLink(''); setError(null);
          }} />
      </label>
      {file ? <div className="flex items-center justify-between gap-2 text-sm">
        <span className="min-w-0 break-all"><Paperclip className="mr-1 inline h-4 w-4" />{file.name}</span>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => setFile(undefined)}>Remove</Button>
      </div> : savedFile && !link ? <p className="break-all text-sm text-muted">Current attachment: {savedFile}</p> : null}
      <Field label="File link (optional)" value={link} disabled={busy || Boolean(file)} onChange={event => setLink(event.target.value)} />
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button type="button" disabled={busy} onClick={() => void submit()}><Send className="h-4 w-4" />{busy ? 'Submitting…' : 'Submit & Notify Client'}</Button>
      </div>
    </div>
  </Modal>;
}
