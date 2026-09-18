import type { AIToolContext, AIToolResult, AIActionPreview } from './aiTypes';
import type { Project, RevisionRequest } from '../types';
import { formatDate } from '../date';
import { isManagerRole } from '../utils';

export type ClientCommunicationKind =
  | 'approval_reminder'
  | 'payment_reminder'
  | 'files_required'
  | 'revision_received'
  | 'project_completed'
  | 'final_delivery';

export type ClientCommunicationTone = 'professional' | 'friendly' | 'firm';

function detectTone(query: string): ClientCommunicationTone {
  const lower = query.toLowerCase();
  if (/\bfirm\b|\bstrict\b|\bdirect\b/.test(lower)) return 'firm';
  if (/\bfriendly\b|\bwarm\b|\bcasual\b/.test(lower)) return 'friendly';
  return 'professional';
}

function detectKind(query: string): ClientCommunicationKind | null {
  const lower = query.toLowerCase();
  if (/final delivery|final files?|send final/.test(lower)) return 'final_delivery';
  if (/project completed|project complete|completion message|completed project/.test(lower)) return 'project_completed';
  if (/revision received|received revision|revision acknowledgement|acknowledge revision|revision request received/.test(lower)) return 'revision_received';
  if (/files required|missing files|send files|need files|waiting for files|file reminder/.test(lower)) return 'files_required';
  if (/payment reminder|overdue payment|pending payment|outstanding balance|payment due|invoice reminder|payment follow[- ]?up/.test(lower)) return 'payment_reminder';
  if (/approval reminder|client approval|waiting for approval|awaiting approval|approval follow[- ]?up/.test(lower)) return 'approval_reminder';
  return null;
}

export function isClientCommunicationRequest(query: string) {
  const lower = query.toLowerCase();
  const communicationVerb =
    /\bdraft\b|\bwrite\b|\bprepare\b|\bcompose\b|\bsend\b|\bnotify\b|\bmessage\b|\bemail\b|\breminder\b|\bfollow[- ]?up\b/.test(lower);
  return communicationVerb && Boolean(detectKind(query));
}

function resolveProject(query: string, ctx: AIToolContext): { project?: Project; candidates?: Project[] } {
  const lower = query.toLowerCase();
  const visible = ctx.visibleProjects || [];

  const selectedProject = (ctx as any).selectedProject as Project | null | undefined;
  if (selectedProject && /\b(this project|current project|this client)\b/i.test(query)) {
    const selected = visible.find((project) => project.id === selectedProject.id);
    if (selected) return { project: selected };
  }

  const direct = visible.filter((project) => {
    const number = String(project.project_number || '').toLowerCase();
    const title = String(project.project_title || '').toLowerCase();
    return (number && lower.includes(number)) || (title.length >= 2 && lower.includes(title));
  });
  if (direct.length === 1) return { project: direct[0] };
  if (direct.length > 1) return { candidates: direct.slice(0, 6) };

  const clients = Array.from(new Set(visible.map((project) => project.client_name).filter(Boolean)));
  const clientName = clients.find((name) => lower.includes(String(name).toLowerCase()));
  if (!clientName) return {};

  const byClient = visible.filter(
    (project) => project.client_name.toLowerCase() === String(clientName).toLowerCase(),
  );
  if (byClient.length === 1) return { project: byClient[0] };
  if (byClient.length > 1) return { candidates: byClient.slice(0, 6) };
  return {};
}

function money(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(amount);
}

function balance(project: Project) {
  return Math.max(
    Number(project.remaining_balance || 0),
    Number(project.total_price || 0) - Number(project.advance_paid || 0),
    0,
  );
}

function opening(project: Project, tone: ClientCommunicationTone) {
  return tone === 'friendly' ? 'Hi ' + project.client_name + ',' : 'Hello ' + project.client_name + ',';
}

function signoff(tone: ClientCommunicationTone) {
  if (tone === 'friendly') return 'Thank you!\nManuscript Heaven';
  if (tone === 'firm') return 'Please respond at your earliest convenience.\nManuscript Heaven';
  return 'Kind regards,\nManuscript Heaven';
}

function latestRevision(projectId: string, ctx: AIToolContext): RevisionRequest | null {
  return (
    (ctx.data.revisionRequests || [])
      .filter((request) => request.project_id === projectId)
      .sort(
        (a, b) =>
          new Date(b.submitted_at || b.created_at).getTime() -
          new Date(a.submitted_at || a.created_at).getTime(),
      )[0] || null
  );
}

function draftApproval(project: Project, tone: ClientCommunicationTone) {
  const stage = project.current_stage || project.status || 'current project stage';
  const due = project.due_date ? ' The project due date is ' + formatDate(project.due_date) + '.' : '';
  const text =
    tone === 'friendly'
      ? 'Your ' + stage + ' for "' + project.project_title + '" is ready for review. When you have a moment, please let us know if you approve it or would like any changes.' + due
      : tone === 'firm'
        ? 'The ' + stage + ' for "' + project.project_title + '" is awaiting approval. Please review it and send your approval or revision notes so we can keep the project on schedule.' + due
        : 'The ' + stage + ' for "' + project.project_title + '" is awaiting your approval. Please review it and let us know whether it is approved or if revisions are required.' + due;
  return {
    subject: 'Approval required: ' + project.project_title,
    body: opening(project, tone) + '\n\n' + text + '\n\n' + signoff(tone),
  };
}

function draftPayment(project: Project, tone: ClientCommunicationTone) {
  const due = balance(project);
  if (due <= 0.005) return null;
  const amount = money(due);
  const text =
    tone === 'friendly'
      ? 'Just a friendly reminder that ' + amount + ' remains outstanding for "' + project.project_title + '". Please let us know once payment has been arranged, or if you need the invoice or payment details resent.'
      : tone === 'firm'
        ? 'This is a payment reminder for the outstanding balance of ' + amount + ' on "' + project.project_title + '". Please arrange payment promptly so the account can be brought up to date.'
        : 'This is a reminder that an outstanding balance of ' + amount + ' remains on "' + project.project_title + '". Please arrange payment when convenient, or let us know if you need the invoice or payment details again.';
  return {
    subject: 'Payment reminder: ' + project.project_title + ' — ' + amount + ' due',
    body: opening(project, tone) + '\n\n' + text + '\n\n' + signoff(tone),
  };
}

function draftFiles(project: Project, tone: ClientCommunicationTone) {
  const needed =
    (project.client_action_required || project.client_instructions || '').trim() ||
    'the remaining source files/materials needed to continue';
  const text =
    tone === 'friendly'
      ? 'We’re ready to continue with "' + project.project_title + '". Could you please send ' + needed + '? Once we have them, we can move ahead with the next stage.'
      : tone === 'firm'
        ? 'Work on "' + project.project_title + '" is waiting on client materials. Please send ' + needed + ' so production can continue without further delay.'
        : 'To continue work on "' + project.project_title + '", we still need ' + needed + '. Please send the required files/materials when available so we can proceed.';
  return {
    subject: 'Files required: ' + project.project_title,
    body: opening(project, tone) + '\n\n' + text + '\n\n' + signoff(tone),
  };
}

function draftRevision(project: Project, tone: ClientCommunicationTone, ctx: AIToolContext) {
  const revision = latestRevision(project.id, ctx);
  const label = revision?.revision_round ? 'revision round ' + revision.revision_round : 'revision request';
  const text =
    tone === 'friendly'
      ? 'Thanks — we’ve received your ' + label + ' for "' + project.project_title + '". Our team will review the requested changes and continue from there.'
      : 'We confirm receipt of your ' + label + ' for "' + project.project_title + '". Our team will review the requested changes and continue through the revision workflow.';
  return {
    subject: 'Revision received: ' + project.project_title,
    body: opening(project, tone) + '\n\n' + text + '\n\n' + signoff(tone),
  };
}

function draftCompleted(project: Project, tone: ClientCommunicationTone) {
  const text =
    tone === 'friendly'
      ? 'Great news — "' + project.project_title + '" has been completed. Thank you for working with us on this project.'
      : tone === 'firm'
        ? '"' + project.project_title + '" has now been completed. Please review any final account or delivery items that may still require your attention.'
        : 'We’re pleased to confirm that "' + project.project_title + '" has been completed. Thank you for trusting Manuscript Heaven with your project.';
  return {
    subject: 'Project completed: ' + project.project_title,
    body: opening(project, tone) + '\n\n' + text + '\n\n' + signoff(tone),
  };
}

function draftDelivery(project: Project, tone: ClientCommunicationTone) {
  const links = [
    project.final_print_pdf_link ? 'Print PDF: ' + project.final_print_pdf_link : null,
    project.final_ebook_link ? 'eBook file: ' + project.final_ebook_link : null,
    project.cover_file_link ? 'Cover file: ' + project.cover_file_link : null,
    project.drive_folder_link ? 'Project folder: ' + project.drive_folder_link : null,
  ].filter(Boolean);
  const files =
    links.length > 0
      ? '\n\nFinal files:\n' + links.map((value) => '• ' + value).join('\n')
      : '\n\nYour final files are ready in the project delivery area.';
  const text =
    tone === 'friendly'
      ? 'Your final delivery for "' + project.project_title + '" is ready. It’s been a pleasure working on this with you.' + files
      : tone === 'firm'
        ? 'The final delivery for "' + project.project_title + '" is ready.' + files + '\n\nPlease download and review the final files promptly.'
        : 'We’re pleased to share the final delivery for "' + project.project_title + '".' + files + '\n\nPlease review the delivered files and let us know if you have any final questions.';
  return {
    subject: 'Final delivery: ' + project.project_title,
    body: opening(project, tone) + '\n\n' + text + '\n\n' + signoff(tone),
  };
}

function buildDraft(
  kind: ClientCommunicationKind,
  project: Project,
  tone: ClientCommunicationTone,
  ctx: AIToolContext,
) {
  if (kind === 'approval_reminder') return draftApproval(project, tone);
  if (kind === 'payment_reminder') return draftPayment(project, tone);
  if (kind === 'files_required') return draftFiles(project, tone);
  if (kind === 'revision_received') return draftRevision(project, tone, ctx);
  if (kind === 'project_completed') return draftCompleted(project, tone);
  return draftDelivery(project, tone);
}

function label(kind: ClientCommunicationKind) {
  const labels: Record<ClientCommunicationKind, string> = {
    approval_reminder: 'Approval Reminder',
    payment_reminder: 'Payment Reminder',
    files_required: 'Files Required',
    revision_received: 'Revision Received',
    project_completed: 'Project Completed',
    final_delivery: 'Final Delivery',
  };
  return labels[kind];
}

export function prepareClientCommunication(query: string, ctx: AIToolContext): AIToolResult | null {
  if (!isClientCommunicationRequest(query)) return null;

  if (!isManagerRole(ctx.currentProfile.role)) {
    return {
      success: false,
      toolName: 'draft_client_communication',
      error: 'permission_denied',
      spokenText: "I can't prepare client-facing communication with your current permissions.",
      displayText: '🔒 AI client communication is restricted to Admin and Project Manager roles.',
    };
  }

  const kind = detectKind(query);
  if (!kind) return null;

  const resolved = resolveProject(query, ctx);
  if (!resolved.project) {
    if (resolved.candidates?.length) {
      const options = resolved.candidates
        .map((project) => '• **' + project.project_title + '** (' + project.project_number + ')')
        .join('\n');
      return {
        success: false,
        toolName: 'draft_client_communication',
        error: 'project_required',
        spokenText: 'I found more than one matching project. Please tell me which one this message is for.',
        displayText:
          '### Choose the Project\n\nI found multiple matches:\n' +
          options +
          '\n\nRepeat the request with the project title or project number.',
      };
    }

    return {
      success: false,
      toolName: 'draft_client_communication',
      error: 'project_required',
      spokenText: 'Please tell me which project this client communication is for.',
      displayText:
        '### Project Required\n\nPlease include the project title, project number, or a client with only one matching project.',
    };
  }

  const project = resolved.project;
  const tone = detectTone(query);
  const draft = buildDraft(kind, project, tone, ctx);

  if (!draft && kind === 'payment_reminder') {
    return {
      success: false,
      toolName: 'draft_client_communication',
      error: 'no_outstanding_balance',
      spokenText: project.project_title + ' has no outstanding balance, so I did not prepare a payment reminder.',
      displayText:
        '### No Payment Reminder Needed\n\n**' + project.project_title + '** has no outstanding balance.',
    };
  }
  if (!draft) return null;

  if (/\bemail\b/i.test(query)) {
    return {
      success: true,
      toolName: 'draft_client_communication',
      spokenText:
        'I drafted a ' + tone + ' ' + label(kind).toLowerCase() + ' email for ' + project.client_name + '. Email delivery is not connected, so nothing has been sent.',
      displayText:
        '### ' + label(kind) + ' — Email Draft\n\n' +
        '• **Client:** ' + project.client_name + '\n' +
        '• **Project:** ' + project.project_title + ' (' + project.project_number + ')\n' +
        '• **Tone:** ' + tone + '\n' +
        '• **Email:** ' + (project.client_email || 'No client email saved') + '\n\n' +
        '**Subject:** ' + draft.subject + '\n\n' +
        draft.body + '\n\n' +
        '> Email delivery is not connected in MH Tracker. Nothing has been sent.',
      data: {
        projectId: project.id,
        clientName: project.client_name,
        clientEmail: project.client_email || '',
        subject: draft.subject,
        body: draft.body,
        tone,
        communicationKind: kind,
        channel: 'email',
      },
    };
  }

  const preview: AIActionPreview = {
    actionId: 'act-' + Date.now(),
    toolName: 'send_client_message',
    category: 'high_risk',
    title: label(kind),
    description: 'Send ' + tone + ' ' + label(kind).toLowerCase() + ' to ' + project.client_name,
    targetType: 'message',
    targetId: project.id,
    targetTitle: project.project_title,
    clientName: project.client_name,
    changes: [
      { field: 'client', label: 'Client', newValue: project.client_name },
      { field: 'project', label: 'Project', newValue: project.project_title },
      { field: 'tone', label: 'Tone', newValue: tone },
      { field: 'channel', label: 'Channel', newValue: 'Client project conversation' },
      { field: 'subject', label: 'Subject', newValue: draft.subject },
      { field: 'message', label: 'Message', newValue: draft.body },
    ],
    payload: {
      projectId: project.id,
      clientName: project.client_name,
      clientEmail: project.client_email || '',
      subject: draft.subject,
      body: draft.body,
      tone,
      communicationKind: kind,
      channel: 'project_client',
    },
    confirmButtonText: 'Send to Client',
    cancelButtonText: 'Keep as Draft',
    spokenPrompt:
      'I prepared a ' + tone + ' ' + label(kind).toLowerCase() + ' for ' + project.client_name + ' about ' + project.project_title + '. Send it to the client conversation?',
    requiresStrongConfirmation: true,
  };

  return {
    success: true,
    toolName: 'draft_client_communication',
    spokenText: preview.spokenPrompt,
    displayText:
      '### ' + label(kind) + ' Draft\n\n' +
      '• **Client:** **' + project.client_name + '**\n' +
      '• **Project:** ' + project.project_title + ' (' + project.project_number + ')\n' +
      '• **Tone:** ' + tone + '\n' +
      '• **Channel:** Client project conversation\n\n' +
      '**Subject:** ' + draft.subject + '\n\n' +
      draft.body + '\n\n' +
      'Nothing will be sent until you confirm.',
    pendingAction: preview,
    data: {
      projectId: project.id,
      clientName: project.client_name,
      subject: draft.subject,
      body: draft.body,
      tone,
      communicationKind: kind,
      channel: 'project_client',
    },
  };
}
