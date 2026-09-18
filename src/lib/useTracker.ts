import { useTracker as useLegacyTracker } from './useTrackerLegacy';
import { supabase } from './supabase';
import type {
  AdminWorkflowOverrideLog,
  Project,
  ProjectDraft,
  ProjectStatus,
  RevisionNote,
  RevisionRequest,
  RevisionRequestDraft,
  RevisionStatus,
  StageSkipRequest,
  TimelineStage,
} from './types';
import type { ApprovalMilestone, OfficialTimelineStage } from './timeline';

type DbWorkflowStage =
  | 'files_received'
  | 'design_concept'
  | 'concept_approval'
  | 'print_version'
  | 'print_approval'
  | 'ebook_version'
  | 'ebook_approval'
  | 'final_delivery';

type DbLifecycle = 'active' | 'on_hold' | 'cancelled' | 'completed' | 'archived';
type DbStageStatus = 'pending' | 'active' | 'awaiting_client' | 'revision_active' | 'paused' | 'completed' | 'skipped';
type DbWaitingOn = 'team' | 'client' | 'none';

type Phase6Project = Project & {
  project_status?: DbLifecycle | null;
  workflow_stage_key?: DbWorkflowStage | null;
  workflow_stage_status_key?: DbStageStatus | null;
  workflow_waiting_on_key?: DbWaitingOn | null;
  workflow_version?: number | string | null;
  requires_print?: boolean | null;
  requires_ebook?: boolean | null;
  service_capability_status?: 'resolved' | 'needs_review' | string | null;
  production_seconds_total?: number | null;
  client_wait_seconds_total?: number | null;
};

type WorkflowMutationResult = {
  project_id: string;
  workflow_version: number | string;
  project_snapshot?: Record<string, unknown> | null;
  affected_entity_ids?: Record<string, unknown> | null;
  history_event_ids?: string[] | null;
  already_applied?: boolean | null;
};

const PROJECT_METADATA_COLUMNS = new Set([
  'assigned_to',
  'client_brief_link',
  'client_email',
  'client_instructions',
  'client_name',
  'client_profile_id',
  'cover_file_link',
  'delivery_notes',
  'drive_folder_link',
  'due_date',
  'final_ebook_link',
  'final_print_pdf_link',
  'general_notes',
  'genre',
  'image_count',
  'internal_deadline',
  'internal_notes',
  'invoice_id',
  'invoiced',
  'invoiced_at',
  'other_links',
  'page_count',
  'platform',
  'priority',
  'project_manager',
  'project_title',
  'proof_pdf_link',
  'qa_notes',
  'service_type',
  'source_file_link',
  'start_date',
  'trim_size',
  'word_count',
]);

const PAYMENT_FIELDS = new Set(['total_price', 'advance_paid', 'payment_status', 'payment_date', 'payment_notes']);

function createUuid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (character) =>
    (Number(character) ^ (Math.random() * 16 >> (Number(character) / 4))).toString(16),
  );
}

function cleanStorageName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'attachment';
}

function toDbStage(stage: TimelineStage | OfficialTimelineStage | string | null | undefined): DbWorkflowStage {
  const normalized = String(stage || '')
    .trim()
    .toLowerCase()
    .replace(/ebook/g, 'ebook')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  const map: Record<string, DbWorkflowStage> = {
    files_received: 'files_received',
    files_required: 'files_received',
    design_concept: 'design_concept',
    design_concept_in_progress: 'design_concept',
    concept_approval: 'concept_approval',
    awaiting_concept_approval: 'concept_approval',
    concept_revisions: 'concept_approval',
    print_version: 'print_version',
    print_version_in_progress: 'print_version',
    print_approval: 'print_approval',
    awaiting_print_approval: 'print_approval',
    print_revisions: 'print_approval',
    ebook_version: 'ebook_version',
    ebook_in_progress: 'ebook_version',
    ebook_approval: 'ebook_approval',
    ebook_review: 'ebook_approval',
    final_delivery: 'final_delivery',
    final_quality_check: 'final_delivery',
    ready_for_delivery: 'final_delivery',
  };

  const mapped = map[normalized];
  if (!mapped) {
    throw new Error(`Unsupported Phase 6 workflow stage: ${String(stage || 'unknown')}`);
  }
  return mapped;
}

function productionStageForSkip(stage: TimelineStage | OfficialTimelineStage | string): DbWorkflowStage {
  const dbStage = toDbStage(stage);
  if (dbStage === 'concept_approval') return 'design_concept';
  if (dbStage === 'print_approval') return 'print_version';
  if (dbStage === 'ebook_approval') return 'ebook_version';
  if (dbStage === 'design_concept' || dbStage === 'print_version' || dbStage === 'ebook_version') return dbStage;
  throw new Error('Only Design Concept, Print Version, or eBook Version can be skipped.');
}

function lifecycleFromStatus(status: ProjectStatus | string | undefined): DbLifecycle | null {
  if (!status) return null;
  const normalized = String(status).toLowerCase();
  if (normalized === 'on hold') return 'on_hold';
  if (normalized === 'cancelled') return 'cancelled';
  if (normalized === 'archived') return 'archived';
  if (normalized === 'completed' || normalized === 'delivered') return 'completed';
  return 'active';
}

function capabilitiesForServiceType(serviceType: string) {
  const normalized = serviceType.trim().toLowerCase().replace(/&/g, '+');
  const hasPrint = normalized.includes('print');
  const hasEbook = normalized.includes('ebook') || normalized.includes('e-book');

  if (hasPrint || hasEbook) {
    return {
      requires_print: hasPrint,
      requires_ebook: hasEbook,
      service_capability_status: 'resolved' as const,
    };
  }

  // Legacy MH Tracker routes non-format-specific packages through the full
  // print + eBook timeline. Preserve that behavior at cutover instead of
  // silently removing a stage for Cover Design, Children's Book, Magazine,
  // Revision Only, Other, and similar existing UI choices.
  return {
    requires_print: true,
    requires_ebook: true,
    service_capability_status: 'resolved' as const,
  };
}

function canonicalTupleForOverride(project: Phase6Project, newStage: TimelineStage) {
  const normalized = String(newStage).toLowerCase();
  if (normalized === 'completed') {
    return {
      lifecycle: 'completed' as DbLifecycle,
      stage: 'final_delivery' as DbWorkflowStage,
      stageStatus: 'completed' as DbStageStatus,
      waitingOn: 'none' as DbWaitingOn,
    };
  }
  if (normalized === 'on hold') {
    return {
      lifecycle: 'on_hold' as DbLifecycle,
      stage: (project.workflow_stage_key || 'files_received') as DbWorkflowStage,
      stageStatus: 'paused' as DbStageStatus,
      waitingOn: 'none' as DbWaitingOn,
    };
  }
  if (normalized === 'cancelled') {
    return {
      lifecycle: 'cancelled' as DbLifecycle,
      stage: (project.workflow_stage_key || 'files_received') as DbWorkflowStage,
      stageStatus: 'paused' as DbStageStatus,
      waitingOn: 'none' as DbWaitingOn,
    };
  }

  const stage = toDbStage(newStage);
  const isApproval = stage === 'concept_approval' || stage === 'print_approval' || stage === 'ebook_approval';
  return {
    lifecycle: 'active' as DbLifecycle,
    stage,
    stageStatus: isApproval ? ('awaiting_client' as DbStageStatus) : ('active' as DbStageStatus),
    waitingOn: isApproval ? ('client' as DbWaitingOn) : ('team' as DbWaitingOn),
  };
}

function phase6Error(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error && 'message' in error
        ? String((error as { message?: unknown }).message || '')
        : String(error || 'Phase 6 workflow action failed.');

  if (message.includes('workflow_version_conflict')) {
    return new Error('This project changed in another session. Refresh the tracker and try again.');
  }
  if (message.includes('workflow_forbidden')) {
    return new Error('You do not have permission to perform this workflow action.');
  }
  if (message.includes('workflow_admin_reason_required')) {
    return new Error('Admin override requires a reason of at least 10 characters and a detailed explanation.');
  }
  if (message.includes('workflow_final_delivery_required')) {
    return new Error('Complete the project through Final Delivery so delivery evidence and timestamps remain consistent.');
  }
  if (message.includes('workflow_invalid_state')) {
    return new Error('This workflow action is not valid for the project’s current stage. Refresh and try again.');
  }
  return new Error(message || 'Phase 6 workflow action failed.');
}

function phase6Version(project: Phase6Project) {
  const value = Number(project.workflow_version);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('Phase 6 workflow version is missing. Refresh the tracker before continuing.');
  }
  return value;
}

function paymentMonthParts(dueDate: string | null | undefined) {
  const clean = dueDate ? dueDate.slice(0, 10) : null;
  return {
    due_date: clean,
    payment_month: clean ? clean.slice(0, 7) : null,
    payment_year: clean ? Number(clean.slice(0, 4)) : null,
  };
}

async function uploadRevisionFile({
  clientId,
  projectId,
  requestId,
  file,
}: {
  clientId: string;
  projectId: string;
  requestId: string;
  file: File;
}) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const safeName = cleanStorageName(file.name);
  const path = `${clientId}/${projectId}/${requestId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from('revision-files').upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}

export function useTracker() {
  const legacy = useLegacyTracker();

  const currentProfile = legacy.currentProfile;
  const data = legacy.data;
  const isPhase6Live = legacy.mode === 'supabase' && Boolean(supabase);

  const findProject = (projectId: string) => {
    const project = data.projects.find((item) => item.id === projectId) as Phase6Project | undefined;
    if (!project) throw new Error('Project not found.');
    return project;
  };

  const refresh = async () => {
    if (currentProfile) {
      await legacy.loadSupabaseData(currentProfile);
    }
  };

  const callWorkflow = async (name: string, args: Record<string, unknown>) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { data: rpcData, error } = await supabase.rpc(name, args);
    if (error) throw phase6Error(error);
    return rpcData as WorkflowMutationResult;
  };

  const createProject = async (draft: ProjectDraft) => {
    if (!isPhase6Live) return legacy.createProject(draft);
    const capabilities = capabilitiesForServiceType(draft.service_type || '');
    const phase6Draft = {
      ...draft,
      status: 'In Progress',
      current_stage: 'Files Received',
      stage_status: 'ACTIVE',
      waiting_on: 'Manuscript Heaven',
      timeline_status: 'Active',
      project_status: 'active',
      workflow_stage_key: 'files_received',
      workflow_stage_status_key: 'active',
      workflow_waiting_on_key: 'team',
      workflow_version: 0,
      production_seconds_total: 0,
      client_wait_seconds_total: 0,
      ...capabilities,
    };
    return legacy.createProject(phase6Draft as ProjectDraft);
  };

  const duplicateProject = async (project: Project) => {
    if (!isPhase6Live) return legacy.duplicateProject(project);
    const source = project as Phase6Project & Record<string, unknown>;
    const draft = { ...source } as Record<string, unknown>;
    for (const key of [
      'id', 'project_number', 'created_at', 'updated_at', 'remaining_balance',
      'project_status', 'workflow_stage_key', 'workflow_stage_status_key', 'workflow_waiting_on_key',
      'workflow_version', 'production_seconds_total', 'client_wait_seconds_total',
      'capabilities_resolved_at', 'capabilities_resolved_by', 'service_capability_status',
      'requires_print', 'requires_ebook', 'delivered_at',
      'files_received_date', 'design_concept_due_date', 'design_concept_submitted_date',
      'design_concept_approval_date', 'concept_revision_due_date', 'print_version_due_date',
      'print_version_submitted_date', 'print_version_approval_date', 'print_revision_due_date',
      'ebook_due_date', 'ebook_submitted_date', 'ebook_approval_date', 'final_delivery_date',
      'current_stage', 'stage_status', 'stage_started_at', 'stage_due_at', 'stage_completed_at',
      'final_due_at', 'production_time_used', 'client_wait_time', 'revision_count',
      'stage_skip_requests', 'admin_workflow_overrides', 'stage_states', 'stage_history',
      'progress_percentage', 'waiting_on', 'timeline_status', 'production_days_used',
      'delay_reason', 'client_action_required',
    ]) {
      delete draft[key];
    }
    draft.project_title = `${project.project_title} Copy`;
    draft.status = 'New';
    draft.delivery_date = null;
    return createProject(draft as ProjectDraft);
  };

  const updateProject = async (projectId: string, updates: Partial<Project>) => {
    if (!isPhase6Live || !supabase) return legacy.updateProject(projectId, updates);
    if (!currentProfile) throw new Error('No signed-in profile found.');

    const project = findProject(projectId);
    const updateRecord = updates as Record<string, unknown>;

    let version = phase6Version(project);
    const nextCapabilities =
      'service_type' in updateRecord
        ? capabilitiesForServiceType(String(updateRecord.service_type || project.service_type || ''))
        : null;
    const wantsConfiguration =
      'workflow_settings' in updateRecord ||
      'requires_print' in updateRecord ||
      'requires_ebook' in updateRecord ||
      Boolean(nextCapabilities);
    if (wantsConfiguration) {
      const result = await callWorkflow('workflow_update_project_configuration', {
        p_project_id: projectId,
        p_expected_workflow_version: version,
        p_idempotency_key: createUuid(),
        p_requires_print: Boolean(updateRecord.requires_print ?? nextCapabilities?.requires_print ?? project.requires_print),
        p_requires_ebook: Boolean(updateRecord.requires_ebook ?? nextCapabilities?.requires_ebook ?? project.requires_ebook),
        p_workflow_settings: updateRecord.workflow_settings ?? project.workflow_settings ?? {},
      });
      version = Number(result.workflow_version);
    }

    const metadata: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updateRecord)) {
      if (PROJECT_METADATA_COLUMNS.has(key)) metadata[key] = value;
    }
    if (Object.keys(metadata).length) {
      metadata.updated_at = new Date().toISOString();
      const { error } = await supabase.from('projects').update(metadata).eq('id', projectId);
      if (error) throw error;
    }

    if ([...PAYMENT_FIELDS].some((key) => key in updateRecord) || 'due_date' in updateRecord) {
      const totalPrice = Number(updates.total_price ?? project.total_price ?? 0);
      const advancePaid = Number(updates.advance_paid ?? project.advance_paid ?? 0);
      const dueDate = String(updates.due_date ?? project.due_date ?? '') || null;
      const paymentPayload = {
        project_id: projectId,
        total_price: totalPrice,
        advance_paid: advancePaid,
        payment_status: updates.payment_status ?? project.payment_status ?? 'Not Started',
        payment_date: updates.payment_date ?? project.payment_date ?? null,
        notes: updates.payment_notes ?? project.payment_notes ?? '',
        ...paymentMonthParts(dueDate),
        updated_by: currentProfile.id,
      };
      const { error } = await supabase.from('project_payments').upsert(paymentPayload, { onConflict: 'project_id' });
      if (error) throw error;
    }

    const lifecycle = lifecycleFromStatus(updates.status);
    if (lifecycle && lifecycle !== project.project_status) {
      const result = await callWorkflow('workflow_set_project_lifecycle', {
        p_project_id: projectId,
        p_expected_workflow_version: version,
        p_idempotency_key: createUuid(),
        p_target_lifecycle: lifecycle,
        p_reason: `Updated from tracker project editor (${String(updates.status)})`,
      });
      version = Number(result.workflow_version);
      void version;
    }

    await refresh();
    return { ...project, ...updates, updated_at: new Date().toISOString() } as Project;
  };

  const addRevision = async (projectId: string, note: string, status: RevisionStatus) => {
    if (!isPhase6Live || !supabase) return legacy.addRevision(projectId, note, status);
    if (!currentProfile) throw new Error('No signed-in profile found.');
    const revisionNumber = data.revisionNotes.filter((item) => item.project_id === projectId).length + 1;
    const { data: inserted, error } = await supabase
      .from('revision_notes')
      .insert({ project_id: projectId, revision_number: revisionNumber, note, status, added_by: currentProfile.id })
      .select()
      .single();
    if (error) throw error;
    await refresh();
    return inserted as RevisionNote;
  };

  const createRevisionRequest = async (draft: RevisionRequestDraft) => {
    if (!isPhase6Live || !supabase) return legacy.createRevisionRequest(draft);
    if (!currentProfile) throw new Error('No signed-in profile found.');
    const project = findProject(draft.project_id);
    const instructions = draft.instructions?.trim() || draft.description?.trim() || '';
    if (!instructions) throw new Error('Please add revision instructions before submitting.');

    const result = await callWorkflow('workflow_submit_client_revision', {
      p_project_id: draft.project_id,
      p_expected_workflow_version: phase6Version(project),
      p_idempotency_key: createUuid(),
      p_title: draft.title?.trim() || `Revision request for ${project.project_title}`,
      p_instructions: instructions,
      p_description: draft.description?.trim() || instructions,
      p_priority: draft.priority || 'Normal',
    });

    const requestId = String(result.affected_entity_ids?.revision_request_id || '');
    if (!requestId) throw new Error('Phase 6 revision request was created without a request id.');

    for (const file of draft.attachments || []) {
      const fileUrl = await uploadRevisionFile({
        clientId: currentProfile.id,
        projectId: draft.project_id,
        requestId,
        file,
      });
      const { error } = await supabase.from('revision_attachments').insert({
        revision_request_id: requestId,
        revision_item_id: null,
        file_name: file.name,
        file_url: fileUrl,
        file_type: 'client_attachment',
        uploaded_by: currentProfile.id,
      });
      if (error) throw error;
    }

    const { data: request, error: fetchError } = await supabase
      .from('revision_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    await refresh();
    return request as RevisionRequest;
  };

  const updateRevisionRequest = async (requestId: string, updates: Partial<RevisionRequest>) => {
    if (!isPhase6Live || !supabase) return legacy.updateRevisionRequest(requestId, updates);
    const payload: Record<string, unknown> = {};
    if ('assigned_to' in updates) payload.assigned_to = updates.assigned_to;
    if ('priority' in updates) payload.priority = updates.priority;
    if ('team_response' in updates) payload.team_response = updates.team_response;
    if (Object.keys(payload).length) {
      const { error } = await supabase.from('revision_requests').update(payload).eq('id', requestId);
      if (error) throw error;
    }
    await refresh();
  };

  const uploadRevisedProof = async (requestId: string, file: File) => {
    if (!isPhase6Live || !supabase) return legacy.uploadRevisedProof(requestId, file);
    if (!currentProfile) throw new Error('No signed-in profile found.');
    const request = data.revisionRequests.find((item) => item.id === requestId);
    if (!request) throw new Error('Revision request not found.');
    const project = findProject(request.project_id);

    const fileUrl = await uploadRevisionFile({
      clientId: request.client_id,
      projectId: request.project_id,
      requestId,
      file,
    });
    const { error: attachmentError } = await supabase.from('revision_attachments').insert({
      revision_request_id: requestId,
      revision_item_id: null,
      file_name: file.name,
      file_url: fileUrl,
      file_type: 'revised_proof',
      uploaded_by: currentProfile.id,
    });
    if (attachmentError) throw attachmentError;

    await callWorkflow('workflow_submit_revised_proof', {
      p_project_id: request.project_id,
      p_expected_workflow_version: phase6Version(project),
      p_idempotency_key: createUuid(),
      p_revision_request_id: requestId,
      p_team_response: request.team_response || `Revised proof uploaded: ${file.name}`,
    });
    await refresh();
  };

  const respondToRevisionRequest = async (
    requestId: string,
    decision: Extract<RevisionRequest['status'], 'Approved'>,
  ) => {
    if (!isPhase6Live || !supabase) return legacy.respondToRevisionRequest(requestId, decision);
    const request = data.revisionRequests.find((item) => item.id === requestId);
    if (!request) throw new Error('Revision request not found.');
    const project = findProject(request.project_id);
    await callWorkflow('workflow_client_approve_stage', {
      p_project_id: project.id,
      p_expected_workflow_version: phase6Version(project),
      p_idempotency_key: createUuid(),
      p_note: `Client approved revised proof ${requestId}`,
    });
    await refresh();
  };

  const approveProjectMilestone = async (projectId: string, milestone: ApprovalMilestone) => {
    if (!isPhase6Live || !supabase) return legacy.approveProjectMilestone(projectId, milestone);
    const project = findProject(projectId);
    const expectedStage: Record<ApprovalMilestone, DbWorkflowStage> = {
      concept: 'concept_approval',
      print: 'print_approval',
      ebook: 'ebook_approval',
    };
    if (project.workflow_stage_key && project.workflow_stage_key !== expectedStage[milestone]) {
      throw new Error('The selected milestone does not match the project’s current approval stage. Refresh and try again.');
    }
    await callWorkflow('workflow_client_approve_stage', {
      p_project_id: projectId,
      p_expected_workflow_version: phase6Version(project),
      p_idempotency_key: createUuid(),
      p_note: `Client approved ${milestone} milestone`,
    });
    await refresh();
  };

  const submitStageForApproval = async (projectId: string, submissionNote?: string, fileUrl?: string) => {
    if (!isPhase6Live || !supabase) return legacy.submitStageForApproval(projectId, submissionNote, fileUrl);
    const project = findProject(projectId);
    const stage = project.workflow_stage_key || toDbStage(project.current_stage || project.status);

    if (fileUrl?.trim()) {
      let fileColumn = 'proof_pdf_link';
      if (stage === 'ebook_version' || stage === 'ebook_approval') fileColumn = 'final_ebook_link';
      if (stage === 'final_delivery') fileColumn = 'final_print_pdf_link';
      const metadata: Record<string, unknown> = { [fileColumn]: fileUrl.trim(), updated_at: new Date().toISOString() };
      if (submissionNote?.trim()) metadata.delivery_notes = submissionNote.trim();
      const { error } = await supabase.from('projects').update(metadata).eq('id', projectId);
      if (error) throw error;
    } else if (submissionNote?.trim()) {
      const { error } = await supabase
        .from('projects')
        .update({ delivery_notes: submissionNote.trim(), updated_at: new Date().toISOString() })
        .eq('id', projectId);
      if (error) throw error;
    }

    if (stage === 'files_received') {
      await callWorkflow('workflow_advance_stage', {
        p_project_id: projectId,
        p_expected_workflow_version: phase6Version(project),
        p_idempotency_key: createUuid(),
        p_note: submissionNote?.trim() || 'Files received; advance workflow',
      });
    } else if (stage === 'final_delivery') {
      await callWorkflow('workflow_complete_final_delivery', {
        p_project_id: projectId,
        p_expected_workflow_version: phase6Version(project),
        p_idempotency_key: createUuid(),
        p_note: submissionNote?.trim() || 'Final delivery completed',
      });
    } else if (
      (stage === 'concept_approval' || stage === 'print_approval' || stage === 'ebook_approval') &&
      project.workflow_stage_status_key === 'revision_active'
    ) {
      const request = data.revisionRequests.find(
        (item) => item.project_id === projectId && !['Approved', 'Completed'].includes(item.status),
      );
      if (!request) throw new Error('No active revision request was found for this approval stage.');
      await callWorkflow('workflow_submit_revised_proof', {
        p_project_id: projectId,
        p_expected_workflow_version: phase6Version(project),
        p_idempotency_key: createUuid(),
        p_revision_request_id: request.id,
        p_team_response: submissionNote?.trim() || request.team_response || 'Revised proof submitted for client review',
      });
    } else {
      await callWorkflow('workflow_submit_stage_for_approval', {
        p_project_id: projectId,
        p_expected_workflow_version: phase6Version(project),
        p_idempotency_key: createUuid(),
        p_note: submissionNote?.trim() || null,
      });
    }
    await refresh();
  };

  const requestStageSkip = async (projectId: string, stage: OfficialTimelineStage, reason: string) => {
    if (!isPhase6Live || !supabase) return legacy.requestStageSkip(projectId, stage, reason);
    if (!currentProfile) throw new Error('No signed-in profile found.');
    const project = findProject(projectId);
    const result = await callWorkflow('workflow_request_stage_skip', {
      p_project_id: projectId,
      p_expected_workflow_version: phase6Version(project),
      p_idempotency_key: createUuid(),
      p_stage: productionStageForSkip(stage),
      p_reason: reason.trim(),
    });
    const skipId = String(result.affected_entity_ids?.stage_skip_id || '');
    let row: StageSkipRequest | null = null;
    if (skipId) {
      const { data: skipRow } = await supabase.from('project_stage_skips').select('*').eq('id', skipId).maybeSingle();
      row = skipRow as StageSkipRequest | null;
    }
    await refresh();
    return row;
  };

  const respondToStageSkip = async (requestId: string, approved: boolean, clientNotes?: string) => {
    if (!isPhase6Live || !supabase) return legacy.respondToStageSkip(requestId, approved, clientNotes);
    const skip =
      (data.stageSkipRequests || []).find((item) => item.id === requestId) ||
      data.projects.flatMap((item) => item.stage_skip_requests || []).find((item) => item.id === requestId);
    if (!skip) throw new Error('Skip request not found.');
    const project = findProject(skip.project_id);
    await callWorkflow('workflow_respond_stage_skip', {
      p_project_id: project.id,
      p_expected_workflow_version: phase6Version(project),
      p_idempotency_key: createUuid(),
      p_stage_skip_id: requestId,
      p_decision: approved ? 'approved' : 'rejected',
      p_response_note: clientNotes?.trim() || null,
    });
    await refresh();
  };

  const adminWorkflowOverride = async (
    projectId: string,
    newStage: TimelineStage,
    reason: string,
    explanation: string,
  ) => {
    if (!isPhase6Live || !supabase) return legacy.adminWorkflowOverride(projectId, newStage, reason, explanation);
    if (!currentProfile || currentProfile.role !== 'admin') {
      throw new Error('Administrative Workflow Override is strictly restricted to Admin users.');
    }
    const project = findProject(projectId);
    const target = canonicalTupleForOverride(project, newStage);
    const result = await callWorkflow('workflow_admin_override', {
      p_project_id: projectId,
      p_expected_workflow_version: phase6Version(project),
      p_idempotency_key: createUuid(),
      p_target_lifecycle: target.lifecycle,
      p_target_stage: target.stage,
      p_target_stage_status: target.stageStatus,
      p_target_waiting_on: target.waitingOn,
      p_reason: reason.trim(),
      p_explanation: explanation.trim(),
    });
    const overrideId = String(result.affected_entity_ids?.admin_override_id || '');
    let row: AdminWorkflowOverrideLog | null = null;
    if (overrideId) {
      const { data: overrideRow } = await supabase
        .from('admin_workflow_overrides')
        .select('*')
        .eq('id', overrideId)
        .maybeSingle();
      row = overrideRow as AdminWorkflowOverrideLog | null;
    }
    await refresh();
    return row;
  };

  return {
    ...legacy,
    createProject,
    duplicateProject,
    updateProject,
    addRevision,
    createRevisionRequest,
    updateRevisionRequest,
    uploadRevisedProof,
    respondToRevisionRequest,
    approveProjectMilestone,
    submitStageForApproval,
    requestStageSkip,
    respondToStageSkip,
    adminWorkflowOverride,
  };
}
