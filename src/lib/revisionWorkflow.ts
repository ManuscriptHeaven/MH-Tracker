import type { Profile, Project, RevisionRequest } from './types';

export type ChecklistItemStatus = 'Pending' | 'In Progress' | 'Resolved' | 'Needs Clarification';
export interface ChecklistItemData {
  id: string;
  itemNumber: number;
  instruction: string;
  page_reference?: string;
  status: ChecklistItemStatus;
  internal_note: string;
  client_attachment_url?: string | null;
  isDbItem: boolean;
}

/** Preserve the original checklist parser and cache IDs for existing revisions. */
export function parseRevisionTextIntoItems(text: string, requestId: string): { preamble?: string; items: ChecklistItemData[] } {
  if (!text?.trim()) return { items: [] };
  const cleanText = text.trim();
  const numberPattern = /(?:^|\n|\s+)(?:(\d+)\s*[\.\)]\s+)/g;
  const matches: { index: number; length: number; num: number }[] = [];
  let match;
  while ((match = numberPattern.exec(cleanText)) !== null) {
    const num = parseInt(match[1], 10);
    if (num > 0 && num < 1000) matches.push({ index: match.index, length: match[0].length, num });
  }
  function item(id: string, itemNumber: number, instruction: string): ChecklistItemData {
    return { id, itemNumber, instruction, status: 'Pending', internal_note: '', isDbItem: false };
  }
  if (matches.length) {
    const preamble = cleanText.substring(0, matches[0].index).trim() || undefined;
    const items = matches.map((m, index) => item(`${requestId}-parsed-${m.num}`, m.num,
      cleanText.substring(m.index + m.length, matches[index + 1]?.index ?? cleanText.length).trim())).filter((i) => i.instruction);
    if (items.length) return { preamble, items };
  }
  const bulletLines = cleanText.split('\n').filter((line) => line.trim().length > 0);
  if (bulletLines.length > 1 && bulletLines.every((line) => /^[-*•]\s+/.test(line.trim()))) {
    return { items: bulletLines.map((line, idx) => item(`${requestId}-bullet-${idx + 1}`, idx + 1, line.replace(/^[-*•]\s+/, '').trim())) };
  }
  const paragraphs = cleanText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length > 1) return { items: paragraphs.map((p, idx) => item(`${requestId}-para-${idx + 1}`, idx + 1, p)) };
  return { items: [item(`${requestId}-single-1`, 1, cleanText)] };
}

const openStatuses = ['submitted', 'under_review', 'in_progress', 'changes_requested'];

// Mirror the backend's operational-leaf checks. Never pick "latest" merely
// because several unlinked open rounds have different dates or round numbers.
export function revisionWorkflowIssue(projectId: string, stage: string | null | undefined, requests: RevisionRequest[]): string | null {
  const projectRequests = requests.filter((r) => r.project_id === projectId);
  const stageRequests = projectRequests.filter((r) => r.stage_key === stage);
  if (projectRequests.some((r) => !r.stage_key) || stageRequests.some((r) => !r.canonical_status || !Number.isInteger(r.revision_round) || (r.revision_round || 0) < 1)) {
    return 'Some revision records are missing workflow details. A manager must review their history before sending.';
  }
  if (new Set(stageRequests.map((r) => r.revision_round)).size !== stageRequests.length || stageRequests.some((r) => requests.some((child) => child.parent_revision_request_id === r.id && (child.project_id !== r.project_id || child.stage_key !== r.stage_key || child.revision_round !== r.revision_round! + 1)))) {
    return 'Revision round links conflict. A manager must review their history before sending.';
  }
  const leaves = stageRequests.filter((r) => !['approved', 'cancelled'].includes(r.canonical_status || '') && !requests.some((child) => child.parent_revision_request_id === r.id));
  if (leaves.length > 1) return 'Several revision rounds are still open and unlinked. A manager must review their history before one can be sent. No records have been changed.';
  return null;
}
export function revisionFileLocation(value: string): { url?: string; path?: string } {
  if (/^https?:\/\//i.test(value)) return { url: new URL(value).href };
  const path = value.replace(/^revision-files\//, '');
  if (!path || /[:\\]/.test(path) || path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('This file has an invalid storage link. Ask the team to check the attachment.');
  }
  return { path };
}
export function getRevisionView(request: RevisionRequest, project: Project | undefined, requests: RevisionRequest[], profile: Profile, canManageAll: boolean) {
  const status = request.canonical_status;
  const hasChild = requests.some((r) => r.parent_revision_request_id === request.id);
  if (hasChild) return { state: 'history', label: 'Earlier request', canEdit: false, canSend: false, hint: 'Continue with the newer revision request below.' } as const;
  if (status === 'approved' || (!status && ['Approved', 'Completed'].includes(request.status)))
    return { state: 'approved', label: 'Client approved', canEdit: false, canSend: false, hint: 'This revision is approved. Its files, reply, and history are kept here.' } as const;
  if (status === 'cancelled') return { state: 'history', label: 'Closed', canEdit: false, canSend: false, hint: 'This request is closed. Its history is preserved.' } as const;
  if (status === 'ready_for_client_review' || (!status && request.status === 'Ready for Client Review'))
    return { state: 'waiting', label: 'Waiting for client', canEdit: false, canSend: false, hint: 'The revised proof has been sent. The next step is the client’s approval or feedback.' } as const;
  const canWork = profile.role !== 'client' && (canManageAll || request.assigned_to === profile.id || project?.assigned_to === profile.id || project?.project_manager === profile.id);
  const issue = revisionWorkflowIssue(request.project_id, request.stage_key, requests);
  if (issue) return { state: 'unavailable', label: 'Needs workflow review', canEdit: false, canSend: false, hint: issue } as const;
  const active = project?.project_status === 'active' && project.workflow_stage_status_key === 'revision_active'
    && project.workflow_waiting_on_key === 'team' && ['concept_approval', 'print_approval', 'ebook_approval'].includes(project.workflow_stage_key || '')
    && request.stage_key === project.workflow_stage_key && openStatuses.includes(status || '');
  return { state: active ? 'editing' : 'unavailable', label: active ? 'Changes in progress' : 'Not an active revision',
    canEdit: Boolean(active && canWork), canSend: Boolean(active && canWork),
    hint: active ? (canWork ? 'Make the requested changes, then send the updated file for client approval.' : 'The assigned team member will prepare and send the updated file.')
      : 'This request cannot be sent from the current project stage. Reload the project or ask a manager to check its workflow.' } as const;
}

/** Selection is local only; this explicit confirmation is the only send action. */
export async function sendRevisionForReview(
  canSend: boolean, checklistDone: boolean, file: File | null, response: string,
  send: (file: File, response?: string) => Promise<void>,
) {
  if (!canSend) throw new Error('This revision cannot be sent from the current project stage or with your permissions.');
  if (!checklistDone) throw new Error('Mark each requested change done before sending the revised file.');
  if (!file || file.size <= 0) throw new Error('Choose a non-empty updated proof file before sending.');
  await send(file, response.trim() || undefined);
}
