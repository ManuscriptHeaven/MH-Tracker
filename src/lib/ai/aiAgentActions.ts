import type { AIActionPreview, AIToolContext, AIToolResult } from './aiTypes';
import { createBulkInvoice, getEligibleProjectsForClient } from '../invoiceUtils';
import { isClientRole } from '../utils';

function audit(
  ctx: AIToolContext,
  action: string,
  targetType: string,
  targetId?: string,
  targetTitle?: string,
  oldValue?: string | null,
  newValue?: string | null,
  status: 'success' | 'failed' = 'success',
  errorMessage?: string,
) {
  return {
    id: 'audit-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    userId: ctx.currentProfile.id,
    userName: ctx.currentProfile.full_name,
    userRole: ctx.currentProfile.role,
    action,
    targetType,
    targetId,
    targetTitle,
    oldValue: oldValue ? String(oldValue) : null,
    newValue: newValue ? String(newValue) : null,
    timestamp: new Date().toISOString(),
    confirmed: true,
    aiInitiated: true,
    status,
    errorMessage,
  };
}

function resolveInvoiceClient(clientName: string, ctx: AIToolContext) {
  const projects = ctx.visibleProjects || [];
  const exact = projects.find(
    (project) => (project.client_name || '').toLowerCase() === clientName.toLowerCase(),
  );
  if (exact) return { client: exact.client_name, error: null as string | null };

  const query = clientName.toLowerCase();
  const matches = Array.from(new Set(projects.map((project) => project.client_name).filter(Boolean)))
    .filter((client) => client.toLowerCase().includes(query) || query.includes(client.toLowerCase()));

  if (matches.length === 1) return { client: matches[0], error: null as string | null };
  if (matches.length > 1) return { client: null, error: 'ambiguous_client' };
  return { client: null, error: 'client_not_found' };
}

export async function prepareGenerateClientInvoice(
  payload: { clientName: string; month?: number | 'all'; year?: number | 'all'; paymentStatus?: string },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  if (isClientRole(ctx.currentProfile.role)) {
    return {
      success: false,
      toolName: 'generate_client_invoice',
      error: 'permission_denied',
      spokenText: 'Clients cannot generate invoices through the assistant.',
      displayText: '🔒 Only staff and admins can generate client invoices.',
    };
  }

  const resolved = resolveInvoiceClient(payload.clientName, ctx);
  if (!resolved.client) {
    const ambiguous = resolved.error === 'ambiguous_client';
    return {
      success: false,
      toolName: 'generate_client_invoice',
      error: resolved.error || 'client_not_found',
      spokenText: ambiguous
        ? 'I found more than one matching client. Please specify the client more precisely.'
        : 'I could not find that client.',
      displayText: ambiguous
        ? '❓ More than one client matches **' + payload.clientName + '**. Please use the full client name.'
        : '❌ No projects found for client **' + payload.clientName + '**.',
    };
  }

  const month = payload.month ?? 'all';
  const year = payload.year ?? 'all';
  const paymentStatus = payload.paymentStatus || 'pending';
  const projects = ctx.visibleProjects || [];
  const eligible = getEligibleProjectsForClient(projects, resolved.client, month, year, paymentStatus, true);
  const invoiceProjects = eligible.length
    ? eligible
    : projects.filter(
        (project) =>
          (project.client_name || '').toLowerCase() === resolved.client!.toLowerCase() &&
          Number(project.remaining_balance || 0) > 0,
      );

  if (!invoiceProjects.length) {
    return {
      success: true,
      toolName: 'generate_client_invoice',
      spokenText: resolved.client + ' currently has no pending payments. No invoice is required.',
      displayText:
        '### 🧾 Invoice Status for ' + resolved.client +
        '\n\n• **Pending Projects:** 0\n• **Outstanding Balance:** **' +
        ctx.formatMoney(0) + '**\n\nNo invoice is required.',
    };
  }

  const draft = createBulkInvoice(
    resolved.client,
    invoiceProjects[0]?.client_email || '',
    invoiceProjects,
    month,
    year,
  );
  const totalFormatted = ctx.formatMoney(draft.total_due);
  const projectSummary = invoiceProjects
    .slice(0, 10)
    .map((project) => {
      const remaining = Number(
        project.remaining_balance ??
        Math.max(Number(project.total_price || 0) - Number(project.advance_paid || 0), 0),
      );
      return '• ' + project.project_title + ' (' + project.project_number + ') — **' + ctx.formatMoney(remaining) + '** due';
    })
    .join('\n');

  const preview: AIActionPreview = {
    actionId: 'act-' + Date.now(),
    toolName: 'generate_client_invoice',
    category: 'high_risk',
    title: 'Generate Client Invoice',
    description: 'Generate one invoice for all eligible pending payments for ' + resolved.client,
    targetType: 'finance',
    targetTitle: resolved.client,
    clientName: resolved.client,
    changes: [
      { field: 'client', label: 'Client', newValue: resolved.client },
      { field: 'projects', label: 'Pending Projects', newValue: invoiceProjects.length },
      { field: 'total_due', label: 'Total Due', newValue: totalFormatted },
    ],
    payload: {
      clientName: resolved.client,
      month,
      year,
      paymentStatus,
    },
    confirmButtonText: 'Generate Invoice',
    cancelButtonText: 'Cancel',
    spokenPrompt:
      'Generate one invoice for ' + resolved.client + ' covering ' +
      invoiceProjects.length + ' pending ' + (invoiceProjects.length === 1 ? 'project' : 'projects') +
      ' totaling ' + totalFormatted + '? Confirm?',
  };

  return {
    success: true,
    toolName: 'generate_client_invoice',
    spokenText: preview.spokenPrompt,
    displayText:
      '### Invoice Preview\n\n' +
      '• **Client:** **' + resolved.client + '**\n' +
      '• **Projects:** **' + invoiceProjects.length + '**\n' +
      '• **Total Due:** **' + totalFormatted + '**\n\n' +
      projectSummary +
      (invoiceProjects.length > 10 ? '\n• …and ' + (invoiceProjects.length - 10) + ' more' : '') +
      '\n\nNothing has been saved yet. Confirm to generate the invoice.',
    pendingAction: preview,
  };
}

export async function executeSubmitStageForApproval(
  payload: { projectId: string; submissionNote?: string; fileUrl?: string },
  ctx: AIToolContext,
): Promise<AIToolResult> {
  if (isClientRole(ctx.currentProfile.role)) {
    return {
      success: false,
      toolName: 'submit_stage_for_approval',
      error: 'permission_denied',
      spokenText: 'Clients cannot submit production stages for approval.',
      displayText: '🔒 Stage submission is restricted to the production team.',
    };
  }

  const project = (ctx.data.projects || ctx.visibleProjects).find((item) => item.id === payload.projectId);
  if (!project) {
    return {
      success: false,
      toolName: 'submit_stage_for_approval',
      error: 'project_not_found',
      spokenText: 'I could not find the project to submit.',
      displayText: '❌ Project not found.',
    };
  }

  const stage = String(project.workflow_stage_key || project.current_stage || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');

  const allowedStages = new Set(['design_concept', 'print_version', 'ebook_version', 'final_delivery']);
  if (!allowedStages.has(stage)) {
    return {
      success: false,
      toolName: 'submit_stage_for_approval',
      error: 'invalid_workflow_stage',
      spokenText: project.project_title + ' is not currently at a production stage that can be submitted.',
      displayText:
        '⚠️ **' + project.project_title + '** is currently at **' +
        (project.current_stage || project.workflow_stage_key || 'an unknown stage') +
        '**. The assistant will not bypass the canonical workflow.',
    };
  }

  const existingDeliverable =
    stage === 'design_concept'
      ? project.cover_file_link || project.proof_pdf_link
      : stage === 'print_version'
        ? project.proof_pdf_link || project.final_print_pdf_link
        : stage === 'ebook_version'
          ? project.final_ebook_link
          : project.final_print_pdf_link || project.other_links;

  if (!payload.fileUrl?.trim() && !existingDeliverable) {
    const label =
      stage === 'design_concept'
        ? 'design concept'
        : stage === 'print_version'
          ? 'print proof'
          : stage === 'ebook_version'
            ? 'eBook file'
            : 'final delivery';
    return {
      success: false,
      toolName: 'submit_stage_for_approval',
      error: 'deliverable_required',
      spokenText: 'Add the required proof or deliverable link before submitting this stage.',
      displayText: '⚠️ **Deliverable required.** Add the ' + label + ' link before submission.',
    };
  }

  if (!ctx.trackerMutations?.submitStageForApproval) {
    return {
      success: false,
      toolName: 'submit_stage_for_approval',
      error: 'mutation_unavailable',
      spokenText: 'Canonical stage submission is not available in this session.',
      displayText: '❌ Canonical stage submission is unavailable. No project data was changed.',
    };
  }

  try {
    await ctx.trackerMutations.submitStageForApproval(
      project.id,
      payload.submissionNote?.trim() || undefined,
      payload.fileUrl?.trim() || undefined,
    );

    const stageLabel =
      stage === 'design_concept'
        ? 'Design Concept'
        : stage === 'print_version'
          ? 'Print Version'
          : stage === 'ebook_version'
            ? 'eBook Version'
            : 'Final Delivery';

    return {
      success: true,
      toolName: 'submit_stage_for_approval',
      spokenText:
        stage === 'final_delivery'
          ? 'Done. Final delivery for ' + project.project_title + ' has been completed.'
          : 'Done. The ' + stageLabel + ' for ' + project.project_title + ' has been submitted for client approval.',
      displayText:
        stage === 'final_delivery'
          ? '### ✅ Final Delivery Completed\n\n• **Project:** ' + project.project_title + ' (' + project.project_number + ')'
          : '### ✅ ' + stageLabel + ' Submitted\n\n• **Project:** ' + project.project_title + ' (' + project.project_number + ')\n• **Client:** ' + project.client_name + '\n• **Status:** Awaiting client approval',
      auditLog: audit(
        ctx,
        'Submitted ' + stageLabel + ' for "' + project.project_title + '"',
        'project',
        project.id,
        project.project_title,
        project.current_stage || stage,
        stage === 'final_delivery' ? 'Final Delivery completed' : stageLabel + ' submitted for client approval',
      ),
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Failed to submit the stage.';
    return {
      success: false,
      toolName: 'submit_stage_for_approval',
      error: errorMsg,
      spokenText: 'I could not submit the stage. ' + errorMsg,
      displayText: '❌ Stage submission failed: ' + errorMsg,
      auditLog: audit(
        ctx,
        'Stage submission failed for "' + project.project_title + '"',
        'project',
        project.id,
        project.project_title,
        project.current_stage || stage,
        null,
        'failed',
        errorMsg,
      ),
    };
  }
}
