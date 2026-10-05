import { CheckCircle2, FileCheck, History, Paperclip, Save, Send } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, EmptyState, Modal, SelectField, TextareaField } from '../components/ui';
import { formatDate } from '../lib/date';
import { cn, errorMessage, isClientRole } from '../lib/utils';
import { getRevisionView, parseRevisionTextIntoItems, sendRevisionForReview, type ChecklistItemData, type ChecklistItemStatus } from '../lib/revisionWorkflow';
import type { Profile, Project, RevisionActivity, RevisionAttachment, RevisionItem, RevisionRequest } from '../lib/types';

export { parseRevisionTextIntoItems } from '../lib/revisionWorkflow';
type RequestMetadata = Partial<Pick<RevisionRequest, 'assigned_to' | 'priority' | 'team_response'>>;
interface RevisionPageProps {
  revisionRequests: RevisionRequest[];
  revisionItems: RevisionItem[];
  revisionAttachments: RevisionAttachment[];
  revisionActivity: RevisionActivity[];
  projects: Project[];
  profiles: Profile[];
  currentProfile: Profile;
  canManageAll: boolean;
  onUpdateRequest: (requestId: string, updates: RequestMetadata) => Promise<void>;
  onUpdateItem: (itemId: string, updates: Partial<RevisionItem>) => Promise<void>;
  onUploadRevisedProof: (requestId: string, file: File, teamResponse?: string) => Promise<void>;
  onGetAttachmentUrl: (attachmentId: string) => Promise<string>;
}

function checklistStatus(status: RevisionItem['status']): ChecklistItemStatus {
  return status === 'Completed' ? 'Resolved' : status === 'Under Review' ? 'Needs Clarification' : status === 'In Progress' ? 'In Progress' : 'Pending';
}

function RevisionCard({ request, ...props }: RevisionPageProps & { request: RevisionRequest }) {
  const { projects, profiles, currentProfile, canManageAll, onUpdateItem, onUpdateRequest, onUploadRevisedProof } = props;
  const project = projects.find((p) => p.id === request.project_id);
  const view = getRevisionView(request, project, props.revisionRequests, currentProfile, canManageAll);
  const parsed = useMemo(() => parseRevisionTextIntoItems(request.instructions || request.description || request.title, request.id), [request]);
  const dbItems = useMemo(() => props.revisionItems.filter((i) => i.revision_request_id === request.id).sort((a, b) => a.sort_order - b.sort_order), [props.revisionItems, request.id]);
  const attachments = props.revisionAttachments.filter((a) => a.revision_request_id === request.id);
  const activities = props.revisionActivity.filter((a) => a.revision_request_id === request.id);
  const storageKey = `mh_rev_items_${request.id}`;

  function readItems(): ChecklistItemData[] {
    if (dbItems.length) return dbItems.map((i, index) => ({ id: i.id, itemNumber: index + 1, instruction: i.instruction, page_reference: i.page_reference, status: checklistStatus(i.status), internal_note: i.internal_note || '', client_attachment_url: i.client_attachment_url, isDbItem: true }));
    let cached: Record<string, { status?: ChecklistItemStatus; internal_note?: string }> = {};
    try { cached = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch { /* Malformed cache never blocks the request. */ }
    return parsed.items.map((i) => ({ ...i,
      status: ['Pending', 'In Progress', 'Resolved', 'Needs Clarification'].includes(cached[i.id]?.status || '') ? cached[i.id].status! : i.status,
      internal_note: typeof cached[i.id]?.internal_note === 'string' ? cached[i.id].internal_note! : '',
    }));
  }
  const [items, setItems] = useState(readItems);
  useEffect(() => { setItems(readItems()); }, [dbItems, parsed, storageKey]);
  const [reply, setReply] = useState(request.team_response || '');
  const replyTouched = useRef(false);
  useEffect(() => { if (!replyTouched.current) setReply(request.team_response || ''); }, [request.team_response]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [sent, setSent] = useState(false);
  const [filter, setFilter] = useState<'all' | 'open'>('all');
  const doneCount = items.filter((i) => i.status === 'Resolved').length;
  const checklistDone = doneCount === items.length;
  const canEdit = view.canEdit && !sent;
  const ready = canEdit && checklistDone && Boolean(file?.size);
  const stage = !checklistDone ? 1 : !file ? 2 : 3;
  const historyOnly = !view.canEdit || sent;
  const name = (id: string | null) => profiles.find((p) => p.id === id)?.full_name || 'Unassigned';

  function storeItems(updated: ChecklistItemData[]) {
    const cache = Object.fromEntries(updated.filter((i) => !i.isDbItem).map((i) => [i.id, { status: i.status, internal_note: i.internal_note }]));
    try { localStorage.setItem(storageKey, JSON.stringify(cache)); } catch {
      setNotice('Checklist progress could not be saved on this device. Keep this screen open until you send.');
    }
  }

  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null); setNotice(null);
    try { await action(); } catch (failure) { setError(errorMessage(failure, 'This change could not be saved. Please try again.')); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function updateItem(item: ChecklistItemData, updates: Partial<ChecklistItemData>) {
    if (!canEdit) return;
    await run(async () => {
      if (item.isDbItem) await onUpdateItem(item.id, {
        ...(updates.status ? { status: updates.status === 'Resolved' ? 'Completed' : updates.status === 'Needs Clarification' ? 'Under Review' : updates.status === 'In Progress' ? 'In Progress' : 'Open' } : {}),
        ...(updates.internal_note !== undefined ? { internal_note: updates.internal_note } : {}),
      });
      const updated = items.map((i) => i.id === item.id ? { ...i, ...updates } : i);
      setItems(updated); storeItems(updated);
    });
  }
  async function saveDraft() {
    if (!canEdit) return;
    await run(async () => {
      await onUpdateRequest(request.id, { team_response: reply.trim() || null });
      replyTouched.current = false;
      storeItems(items);
      setNotice('Reply saved. Nothing has been sent to the client. The selected file stays on this screen until you send.');
    });
  }
  async function send() {
    await run(async () => {
      await sendRevisionForReview(view.canSend && !sent, checklistDone, file, reply,
        (proof, response) => onUploadRevisedProof(request.id, proof, response));
      setSent(true); setConfirm(false); setFile(null);
      replyTouched.current = false;
      setNotice('Revision sent. Waiting for the client’s approval or feedback.');
    });
  }

  return (
    <Card className="space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gold">{project?.project_title || 'Project'} · {request.revision_round ? `Revision ${request.revision_round}` : 'Revision request'}</p>
          <h3 className="mt-1 font-display text-xl font-semibold text-ink">{request.title || 'Requested changes'}</h3>
          <p className="mt-1 text-xs text-muted">Requested {formatDate(request.submitted_at)} · Assigned to {name(request.assigned_to)} · {request.priority} priority</p>
        </div>
        <span className="rounded-full border border-border bg-ivory px-3 py-1 text-xs font-semibold">{sent ? 'Waiting for client' : view.label}</span>
      </header>

      {error && !confirm && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-ink">{notice}</p>}

      {!historyOnly ? (
        <div className="rounded-lg border border-gold/30 bg-ivory p-4">
          <ol aria-label="Revision steps" className="grid gap-3 text-sm sm:grid-cols-3">
            {['Check the changes', 'Prepare updated file', 'Review & send'].map((label, index) => (
              <li key={label} aria-current={stage === index + 1 ? 'step' : undefined} className={cn('flex items-center gap-2', stage === index + 1 ? 'font-semibold text-ink' : 'text-muted')}>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-white">{index + 1}</span>{label}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-sm text-ink">{!checklistDone ? 'Next: make each requested change, then tick it Done below.' : !file ? 'Changes checked. Next: choose the updated proof file below.' : 'Ready: review the file and reply, then confirm sending to the client.'}</p>
        </div>
      ) : <p className="rounded-lg border border-border bg-ivory p-3 text-sm text-muted">{sent ? 'The revised proof has been sent. The client will approve it or request more changes.' : view.hint}</p>}

      <section className="space-y-3" aria-label="Requested changes">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-2 font-semibold text-ink"><FileCheck className="h-4 w-4 text-gold" />{historyOnly ? 'Requested changes' : '1. Check the changes'}</h4>
          <span className="text-xs text-muted">{doneCount} of {items.length} done</span>
        </div>
        {parsed.preamble && <p className="whitespace-pre-wrap text-sm text-charcoal">{parsed.preamble}</p>}
        {!dbItems.length && canEdit && <p className="text-xs text-muted">These checkboxes are a working checklist saved on this device. The client’s original request is kept unchanged.</p>}
        {items.length > 3 && <button type="button" onClick={() => setFilter(filter === 'all' ? 'open' : 'all')} className="text-sm text-gold underline">{filter === 'all' ? 'Show unfinished changes only' : 'Show all changes'}</button>}
        <ul className="space-y-2">
          {items.filter((i) => filter === 'all' || i.status !== 'Resolved').map((item) => (
            <li key={item.id} className={cn('rounded-lg border p-3', item.status === 'Resolved' ? 'border-green-200 bg-green-50/40' : 'border-border')}>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" aria-label={`Done: change ${item.itemNumber}`} checked={item.status === 'Resolved'} disabled={!canEdit || busy} onChange={() => updateItem(item, { status: item.status === 'Resolved' ? 'Pending' : 'Resolved' })} className="mt-1 h-4 w-4 shrink-0 accent-green-600" />
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{item.page_reference && <span className="mr-2 text-xs font-semibold text-muted">Page {item.page_reference}</span>}{item.instruction}</span>
                <span className="text-xs font-semibold text-muted">{item.status === 'Resolved' ? 'Done' : 'To do'}</span>
              </label>
              <details className="ml-7 mt-2 text-xs text-muted">
                <summary className="cursor-pointer">Notes & details{item.status === 'Needs Clarification' ? ' · Needs clarification' : ''}</summary>
                <div className="mt-2 space-y-2">
                  {item.client_attachment_url && <a href={item.client_attachment_url} target="_blank" rel="noreferrer" className="block break-all text-gold underline">Client reference file</a>}
                  {canEdit ? <>
                    <SelectField label="Work status" value={item.status} disabled={busy} onChange={(e) => updateItem(item, { status: e.target.value as ChecklistItemStatus })}>
                      <option value="Pending">To do</option><option value="In Progress">Working on it</option><option value="Resolved">Done</option><option value="Needs Clarification">Need clarification</option>
                    </SelectField>
                    <ItemNote key={`${item.id}-${item.internal_note}`} initialNote={item.internal_note} disabled={busy} onSave={(note) => updateItem(item, { internal_note: note })} />
                  </> : item.internal_note && <p className="whitespace-pre-wrap">Team note: {item.internal_note}</p>}
                </div>
              </details>
            </li>
          ))}
        </ul>
        {!items.length && <p className="text-sm text-muted">No individual changes listed. Read the client’s request before preparing the revised proof.</p>}
        {attachments.filter((a) => a.file_type !== 'revised_proof').length > 0 && <FileList attachments={attachments.filter((a) => a.file_type !== 'revised_proof')} onGetUrl={props.onGetAttachmentUrl} />}
      </section>

      {canEdit && <section className="space-y-4 border-t border-border pt-4" aria-label="Updated file and reply">
        <h4 className="font-semibold text-ink">2. Prepare the updated file</h4>
        <label className="grid gap-2 text-sm font-medium text-ink">
          Updated proof file
          <input type="file" disabled={busy} onChange={(e) => { setFile(e.target.files?.[0] || null); setError(null); }} className="w-full min-w-0 rounded-md border border-border p-2 text-sm" />
        </label>
        <p className="text-xs text-muted">{file ? `Selected: ${file.name}. ` : ''}Choosing a file does not upload or send it. It will be sent only after confirmation.</p>
        <TextareaField label="Reply to client (optional)" rows={3} value={reply} disabled={busy} onChange={(e) => { replyTouched.current = true; setReply(e.target.value); }} placeholder="Briefly explain what you changed and ask the client to review the updated file." />
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-ivory p-3">
          <p className="text-xs text-muted">Save your reply for later, or review and send when the changes are done.</p>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button type="button" variant="secondary" disabled={busy} onClick={saveDraft}><Save className="h-4 w-4" />Save reply draft</Button>
            <Button type="button" disabled={!ready || busy} onClick={() => { setError(null); setConfirm(true); }}><Send className="h-4 w-4" />Review & send</Button>
          </div>
        </div>
        {!ready && <p className="text-xs text-muted">{!checklistDone ? 'Finish the checklist to continue.' : 'Choose a non-empty updated proof file to continue.'}</p>}
      </section>}

      <details className="border-t border-border pt-3 text-sm">
        <summary className="cursor-pointer font-medium text-muted">Assignment, saved files & history</summary>
        <div className="mt-3 space-y-4">
          {canManageAll && canEdit && <SelectField label="Assigned team member" value={request.assigned_to || ''} disabled={busy} onChange={(e) => run(() => onUpdateRequest(request.id, { assigned_to: e.target.value || null }))}>
            <option value="">Unassigned</option>{profiles.filter((p) => !isClientRole(p.role)).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </SelectField>}
          {historyOnly && request.team_response && <div><p className="font-semibold">Saved reply</p><p className="mt-1 whitespace-pre-wrap text-muted">{request.team_response}</p></div>}
          <FileList attachments={attachments} onGetUrl={props.onGetAttachmentUrl} />
          <div><h4 className="flex items-center gap-2 font-semibold"><History className="h-4 w-4" />History</h4>
            {activities.length ? <ul className="mt-2 space-y-2">{[...activities].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((a) => <li key={a.id} className="border-b border-border pb-2 text-xs"><p>{a.action}</p><p className="text-muted">{a.previous_value ? `${a.previous_value} → ` : ''}{a.new_value} · {name(a.user_id)} · {formatDate(a.created_at)}</p></li>)}</ul> : <p className="mt-1 text-xs text-muted">No additional activity recorded.</p>}
          </div>
        </div>
      </details>

      {confirm && <Modal title="Review & send revision" width="max-w-lg" onClose={() => { if (!busyRef.current) setConfirm(false); }}>
        <div className="space-y-4">
          <p className="text-sm text-muted">This sends the updated proof for client approval and pauses the production clock. It does not mark the revision client-approved.</p>
          <div className="rounded-lg border border-border bg-ivory p-3 text-sm"><p className="font-semibold">{project?.project_title}</p><p className="mt-1">{doneCount} of {items.length} changes checked</p><p className="mt-1 break-words">File: {file?.name}</p><p className="mt-2 whitespace-pre-wrap">{reply.trim() || 'No additional reply.'}</p></div>
          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-danger">{error}</p>}
          <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row"><Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirm(false)}>Back to changes</Button><Button type="button" disabled={busy || !ready} onClick={send}><Send className="h-4 w-4" />{busy ? 'Sending…' : 'Send for client approval'}</Button></div>
        </div>
      </Modal>}
    </Card>
  );
}

function ItemNote({ initialNote, disabled, onSave }: { initialNote: string; disabled: boolean; onSave: (note: string) => Promise<void> }) {
  const [note, setNote] = useState(initialNote);
  return <div className="space-y-2"><TextareaField label="Private team note" value={note} disabled={disabled} onChange={(e) => setNote(e.target.value)} rows={2} /><Button type="button" variant="secondary" disabled={disabled || note === initialNote} onClick={() => onSave(note)}>Save note</Button></div>;
}

function FileList({ attachments, onGetUrl }: { attachments: RevisionAttachment[]; onGetUrl: (id: string) => Promise<string> }) {
  return <div><h4 className="flex items-center gap-2 text-sm font-semibold"><Paperclip className="h-4 w-4 text-gold" />Saved files</h4>{attachments.length ? <ul className="mt-2 space-y-2">{attachments.map((a) => <li key={a.id} className="break-words text-sm"><RevisionFile attachment={a} onGetUrl={onGetUrl} /><span className="ml-2 text-xs text-muted">{a.file_type === 'revised_proof' ? 'Revised proof' : 'Client reference'}</span></li>)}</ul> : <p className="mt-1 text-xs text-muted">No saved files for this request.</p>}</div>;
}

function RevisionFile({ attachment, onGetUrl }: { attachment: RevisionAttachment; onGetUrl: (id: string) => Promise<string> }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <span>{url ? <a href={url} target="_blank" rel="noreferrer" className="text-gold underline">Open {attachment.file_name}</a> : <button type="button" disabled={busy} className="text-gold underline" onClick={async () => {
    setBusy(true); setError(null);
    try { setUrl(await onGetUrl(attachment.id)); } catch (failure) { setError(errorMessage(failure, 'File could not be opened.')); } finally { setBusy(false); }
  }}>{busy ? 'Preparing secure link…' : attachment.file_name}</button>}{error && <span role="alert" className="ml-2 text-xs text-danger">{error}</span>}</span>;
}

export function RevisionRequestsPage(props: RevisionPageProps) {
  const visible = props.revisionRequests.filter((r) => props.projects.some((p) => p.id === r.project_id) && (props.canManageAll || r.assigned_to === props.currentProfile.id || props.projects.some((p) => p.id === r.project_id && (p.assigned_to === props.currentProfile.id || p.project_manager === props.currentProfile.id))));
  const active = visible.filter((r) => ['editing', 'waiting'].includes(getRevisionView(r, props.projects.find((p) => p.id === r.project_id), props.revisionRequests, props.currentProfile, props.canManageAll).state));
  const historical = visible.filter((r) => !active.includes(r));
  if (!visible.length) return <EmptyState title="No revision requests" message="Client requests will appear here when they ask for changes." />;
  return <div className="space-y-5">{active.map((r) => <RevisionCard key={r.id} {...props} request={r} />)}
    {historical.length > 0 && <details open={!active.length} className="rounded-lg border border-border p-4"><summary className="cursor-pointer text-sm font-semibold text-muted">Other requests & revision history ({historical.length})</summary><div className="mt-4 space-y-5">{historical.map((r) => <RevisionCard key={r.id} {...props} request={r} />)}</div></details>}
  </div>;
}
