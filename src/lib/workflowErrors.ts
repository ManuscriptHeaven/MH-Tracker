import type { RevisionRequest } from './types';

export const WORKFLOW_DOMAIN_MESSAGES = {
  workflow_unauthenticated: 'Please sign in again before changing the workflow.',
  workflow_actor_inactive_or_invalid: 'Your active profile no longer permits this workflow action.',
  workflow_forbidden: 'You do not have permission to perform this workflow action.',
  workflow_project_not_found: 'The project no longer exists or is unavailable.',
  workflow_stale_version: 'This project changed in another session. Fresh project data has been loaded; review it before trying again.',
  idempotency_key_reused: 'This request key was already used for different workflow input. Start the action again.',
  workflow_invalid_state: 'The project is no longer in a state that permits this action.',
  service_capabilities_unresolved: 'Confirm whether this project requires print, ebook, or both before continuing.',
  workflow_invalid_capabilities: 'The selected service capabilities are invalid for this workflow.',
  workflow_revision_not_ready: 'The current revision is not ready for this action.',
  workflow_revision_ambiguous: 'Legacy revision history for this project needs Admin review before this workflow action can continue.',
  workflow_revision_not_found: 'The revision request no longer exists.',
  workflow_invalid_skip_target: 'That stage cannot be skipped from the current workflow state.',
  workflow_skip_already_requested: 'A skip request already exists for that stage.',
  workflow_skip_not_pending: 'That skip request has already been answered.',
  workflow_skip_ambiguous: 'The project has ambiguous skip records and needs review.',
  workflow_invalid_lifecycle_transition: 'That lifecycle change is not allowed from the current project state.',
  workflow_lifecycle_reason_required: 'A meaningful reason is required to cancel or archive this project.',
  workflow_invalid_configuration: 'The workflow configuration is incomplete or invalid.',
  workflow_admin_reason_required: 'An administrative override requires a reason summary (at least 10 characters) and a detailed explanation.',
  workflow_missing_concept_deliverable: 'Add a design concept proof or deliverable link before sending this stage to the client.',
  workflow_missing_print_proof: 'Add the print proof before sending this stage to the client.',
  workflow_missing_ebook_proof: 'Add the eBook/EPUB proof before sending this stage to the client.',
  workflow_missing_final_print_file: 'Add the final print-ready PDF before completing delivery.',
  workflow_missing_final_ebook_file: 'Add the final eBook/EPUB file before completing delivery.',
  legacy_workflow_trigger_conflict: 'A legacy database trigger changed workflow data during the canonical action. The project was not changed.',
} as const;

export const WORKFLOW_ERROR_MAP = WORKFLOW_DOMAIN_MESSAGES;
export type WorkflowDomainCode = keyof typeof WORKFLOW_DOMAIN_MESSAGES;

export class WorkflowDomainError extends Error {
  readonly domainCode: WorkflowDomainCode;
  readonly original: unknown;
  constructor(domainCode: WorkflowDomainCode, original: unknown) {
    super(WORKFLOW_DOMAIN_MESSAGES[domainCode]);
    this.domainCode = domainCode;
    this.original = original;
    this.name = 'WorkflowDomainError';
    (this as Error & { cause?: unknown }).cause = original;
  }
}

export function errorMessageLoose(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error || '');
  const value = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  return [value.code, value.message, value.details, value.hint].filter(Boolean).join(' ').toLowerCase();
}

export function domainCodeFrom(error: unknown): WorkflowDomainCode | null {
  const candidate = errorMessageLoose(error);
  for (const code of Object.keys(WORKFLOW_DOMAIN_MESSAGES) as WorkflowDomainCode[]) {
    if (candidate.split(/[^a-z0-9_]+/).includes(code)) return code;
  }
  return null;
}

export function formatWorkflowErrorMessage(error: unknown, fallback = 'Workflow operation failed.'): string {
  if (error instanceof WorkflowDomainError) {
    return error.message;
  }

  const code = domainCodeFrom(error);
  if (code && WORKFLOW_DOMAIN_MESSAGES[code]) {
    return WORKFLOW_DOMAIN_MESSAGES[code];
  }

  const rawCandidate = error instanceof Error ? error.message : typeof error === 'string' ? error : (error as { message?: unknown })?.message;
  if (typeof rawCandidate === 'string' && rawCandidate.trim()) {
    const raw = rawCandidate.trim();
    // Guard against leaking PostgreSQL error details or stack traces
    if (/violates row-level security/i.test(raw) || /permission denied/i.test(raw)) {
      return 'You do not have permission to perform this action.';
    }
    if (/P0001|PL\/pgSQL|SQLSTATE/i.test(raw)) {
      return fallback;
    }
    return raw;
  }

  return fallback;
}
