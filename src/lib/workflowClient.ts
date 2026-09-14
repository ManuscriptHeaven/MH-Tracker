import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ProjectLifecycleStatus,
  WorkflowSettings,
  WorkflowStage,
  WorkflowStageStatus,
  WorkflowWaitingOn,
} from './types';

export const CANONICAL_WORKFLOW_RPCS = [
  'workflow_advance_stage',
  'workflow_submit_stage_for_approval',
  'workflow_client_approve_stage',
  'workflow_submit_client_revision',
  'workflow_submit_revised_proof',
  'workflow_request_stage_skip',
  'workflow_respond_stage_skip',
  'workflow_admin_override',
  'workflow_complete_final_delivery',
  'workflow_set_project_lifecycle',
  'workflow_update_project_configuration',
] as const;

export type CanonicalWorkflowRpc = typeof CANONICAL_WORKFLOW_RPCS[number];

export const CANONICAL_WORKFLOW_RPC_PARAMETERS: Record<CanonicalWorkflowRpc, readonly string[]> = {
  workflow_advance_stage: ['p_project_id','p_expected_workflow_version','p_idempotency_key','p_note'],
  workflow_submit_stage_for_approval: ['p_project_id','p_expected_workflow_version','p_idempotency_key','p_note'],
  workflow_client_approve_stage: ['p_project_id','p_expected_workflow_version','p_idempotency_key','p_note'],
  workflow_submit_client_revision: ['p_project_id','p_expected_workflow_version','p_idempotency_key','p_title','p_instructions','p_description','p_priority'],
  workflow_submit_revised_proof: ['p_project_id','p_expected_workflow_version','p_idempotency_key','p_revision_request_id','p_team_response'],
  workflow_request_stage_skip: ['p_project_id','p_expected_workflow_version','p_idempotency_key','p_stage','p_reason'],
  workflow_respond_stage_skip: ['p_project_id','p_expected_workflow_version','p_idempotency_key','p_stage_skip_id','p_decision','p_response_note'],
  workflow_admin_override: ['p_project_id','p_expected_workflow_version','p_idempotency_key','p_target_lifecycle','p_target_stage','p_target_stage_status','p_target_waiting_on','p_reason','p_explanation'],
  workflow_complete_final_delivery: ['p_project_id','p_expected_workflow_version','p_idempotency_key','p_note'],
  workflow_set_project_lifecycle: ['p_project_id','p_expected_workflow_version','p_idempotency_key','p_target_lifecycle','p_reason'],
  workflow_update_project_configuration: ['p_project_id','p_expected_workflow_version','p_idempotency_key','p_requires_print','p_requires_ebook','p_workflow_settings'],
};

export interface WorkflowMutationResult {
  project_id: string;
  workflow_version: number;
  project_snapshot: Partial<Record<string, unknown>>;
  affected_entity_ids: Record<string, unknown>;
  history_event_ids: string[];
  already_applied: boolean;
}

function isWorkflowMutationResult(value: unknown): value is WorkflowMutationResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<WorkflowMutationResult>;
  return typeof result.project_id === 'string' && result.project_id.length > 0 &&
    Number.isInteger(result.workflow_version) && Number(result.workflow_version) >= 0 &&
    typeof result.already_applied === 'boolean';
}

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
  workflow_revision_ambiguous: 'The project has ambiguous active revision records and needs review.',
  workflow_revision_not_found: 'The revision request no longer exists.',
  workflow_invalid_skip_target: 'That stage cannot be skipped from the current workflow state.',
  workflow_skip_already_requested: 'A skip request already exists for that stage.',
  workflow_skip_not_pending: 'That skip request has already been answered.',
  workflow_skip_ambiguous: 'The project has ambiguous skip records and needs review.',
  workflow_invalid_lifecycle_transition: 'That lifecycle change is not allowed from the current project state.',
  workflow_invalid_configuration: 'The workflow configuration is incomplete or invalid.',
  workflow_admin_reason_required: 'An administrative override requires both a reason and explanation.',
  legacy_workflow_trigger_conflict: 'A legacy database trigger changed workflow data during the canonical action. The project was not changed.',
} as const;

export type WorkflowDomainCode = keyof typeof WORKFLOW_DOMAIN_MESSAGES;

export class WorkflowDomainError extends Error {
  constructor(public readonly domainCode: WorkflowDomainCode, public readonly original: unknown) {
    super(WORKFLOW_DOMAIN_MESSAGES[domainCode]);
    this.name = 'WorkflowDomainError';
    (this as Error & { cause?: unknown }).cause = original;
  }
}

function domainCodeFrom(error: unknown): WorkflowDomainCode | null {
  const candidate = errorMessageLoose(error);
  for (const code of Object.keys(WORKFLOW_DOMAIN_MESSAGES) as WorkflowDomainCode[]) {
    if (candidate.split(/[^a-z0-9_]+/).includes(code)) return code;
  }
  return null;
}

function errorMessageLoose(error: unknown) {
  if (!error || typeof error !== 'object') return String(error || '');
  const value = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  return [value.code, value.message, value.details, value.hint].filter(Boolean).join(' ').toLowerCase();
}

function freshUuid() {
  if (typeof crypto === 'undefined' || !crypto.randomUUID) {
    throw new Error('This browser does not support crypto.randomUUID(), which is required for safe workflow retries.');
  }
  return crypto.randomUUID();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key)=>`${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

type RpcArgs = Record<string, unknown> & {
  p_project_id: string;
  p_expected_workflow_version: number;
  p_idempotency_key?: string;
};

export class CanonicalWorkflowClient {
  private readonly pendingRequests = new Map<string, { idempotencyKey: string; argsFingerprint: string }>();

  constructor(
    private readonly client: SupabaseClient,
    private readonly refreshProjectData: () => Promise<void>,
  ) {}

  private async mutate(rpc: CanonicalWorkflowRpc, logicalActionKey: string, args: RpcArgs) {
    const retryKey = `${rpc}:${logicalActionKey}`;
    const argsFingerprint = stableJson(args);
    const pending = this.pendingRequests.get(retryKey);
    if (pending && pending.argsFingerprint !== argsFingerprint) {
      throw new Error('This workflow retry no longer matches the original pending request. Review the refreshed project state and start a new action.');
    }
    const idempotencyKey = pending?.idempotencyKey || freshUuid();
    this.pendingRequests.set(retryKey, { idempotencyKey, argsFingerprint });
    const requestArgs = { ...args, p_idempotency_key: idempotencyKey };
    const actualParameters = Object.keys(requestArgs).sort();
    const expectedParameters = [...CANONICAL_WORKFLOW_RPC_PARAMETERS[rpc]].sort();
    if (JSON.stringify(actualParameters) !== JSON.stringify(expectedParameters)) {
      this.pendingRequests.delete(retryKey);
      throw new Error(`${rpc} frontend arguments do not match the accepted PostgreSQL signature.`);
    }
    const { data, error } = await this.client.rpc(rpc, requestArgs);
    if (error) {
      const code = domainCodeFrom(error);
      if (code) {
        this.pendingRequests.delete(retryKey);
        if (code === 'workflow_stale_version') await this.refreshProjectData();
        throw new WorkflowDomainError(code, error);
      }
      // Keep the UUID for an uncertain transport/server response. Repeating the
      // same logical action reuses it and reaches receipt replay if it committed.
      throw error;
    }
    const result = Array.isArray(data) ? data[0] : data;
    if (!isWorkflowMutationResult(result)) {
      // A successful database response with an unusable payload is uncertain:
      // preserve the UUID so an identical retry reaches receipt replay.
      throw new Error(`${rpc} returned a malformed canonical workflow result; retry the same action to recover its committed result.`);
    }
    this.pendingRequests.delete(retryKey);
    return result;
  }

  advanceStage(projectId: string, version: number, note: string | null = null) {
    return this.mutate('workflow_advance_stage', `${projectId}:${note || ''}`, {
      p_project_id: projectId, p_expected_workflow_version: version, p_note: note,
    });
  }
  submitStageForApproval(projectId: string, version: number, note: string | null = null) {
    return this.mutate('workflow_submit_stage_for_approval', `${projectId}:${note || ''}`, {
      p_project_id: projectId, p_expected_workflow_version: version, p_note: note,
    });
  }
  approveStage(projectId: string, version: number, note: string | null = null) {
    return this.mutate('workflow_client_approve_stage', `${projectId}:${note || ''}`, {
      p_project_id: projectId, p_expected_workflow_version: version, p_note: note,
    });
  }
  submitClientRevision(projectId: string, version: number, input: { title: string; instructions: string; description?: string; priority?: string }) {
    return this.mutate('workflow_submit_client_revision', `${projectId}:${JSON.stringify(input)}`, {
      p_project_id: projectId, p_expected_workflow_version: version, p_title: input.title,
      p_instructions: input.instructions, p_description: input.description || '', p_priority: input.priority || 'Normal',
    });
  }
  submitRevisedProof(projectId: string, version: number, revisionRequestId: string, teamResponse: string | null = null) {
    return this.mutate('workflow_submit_revised_proof', `${projectId}:${revisionRequestId}:${teamResponse || ''}`, {
      p_project_id: projectId, p_expected_workflow_version: version,
      p_revision_request_id: revisionRequestId, p_team_response: teamResponse,
    });
  }
  requestStageSkip(projectId: string, version: number, stage: WorkflowStage, reason: string) {
    return this.mutate('workflow_request_stage_skip', `${projectId}:${stage}:${reason}`, {
      p_project_id: projectId, p_expected_workflow_version: version, p_stage: stage, p_reason: reason,
    });
  }
  respondStageSkip(projectId: string, version: number, stageSkipId: string, decision: 'approved' | 'rejected', responseNote: string | null = null) {
    return this.mutate('workflow_respond_stage_skip', `${projectId}:${stageSkipId}:${decision}:${responseNote || ''}`, {
      p_project_id: projectId, p_expected_workflow_version: version, p_stage_skip_id: stageSkipId,
      p_decision: decision, p_response_note: responseNote,
    });
  }
  adminOverride(projectId: string, version: number, target: { lifecycle: ProjectLifecycleStatus; stage: WorkflowStage; stageStatus: WorkflowStageStatus; waitingOn: WorkflowWaitingOn; reason: string; explanation: string }) {
    return this.mutate('workflow_admin_override', `${projectId}:${JSON.stringify(target)}`, {
      p_project_id: projectId, p_expected_workflow_version: version, p_target_lifecycle: target.lifecycle,
      p_target_stage: target.stage, p_target_stage_status: target.stageStatus, p_target_waiting_on: target.waitingOn,
      p_reason: target.reason, p_explanation: target.explanation,
    });
  }
  completeFinalDelivery(projectId: string, version: number, note: string | null = null) {
    return this.mutate('workflow_complete_final_delivery', `${projectId}:${note || ''}`, {
      p_project_id: projectId, p_expected_workflow_version: version, p_note: note,
    });
  }
  setLifecycle(projectId: string, version: number, lifecycle: ProjectLifecycleStatus, reason: string | null = null) {
    return this.mutate('workflow_set_project_lifecycle', `${projectId}:${lifecycle}:${reason || ''}`, {
      p_project_id: projectId, p_expected_workflow_version: version, p_target_lifecycle: lifecycle, p_reason: reason,
    });
  }
  updateConfiguration(projectId: string, version: number, requiresPrint: boolean, requiresEbook: boolean, settings: WorkflowSettings) {
    return this.mutate('workflow_update_project_configuration', `${projectId}:${requiresPrint}:${requiresEbook}:${JSON.stringify(settings)}`, {
      p_project_id: projectId, p_expected_workflow_version: version, p_requires_print: requiresPrint,
      p_requires_ebook: requiresEbook, p_workflow_settings: settings,
    });
  }
}
