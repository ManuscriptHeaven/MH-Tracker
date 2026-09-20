import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { sampleData, sampleProfiles } from './sampleData';
import { errorMessage, firstName, isClientRole, isManagerRole } from './utils';
import { formatWorkflowErrorMessage } from './workflowErrors';
import { normalizeRevisionRequest } from './revisionUtils';
import {
  fetchNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  subscribeToNotifications,
} from './notifications';
import { notifyWithSoundAndVoice } from './sound';
import {
  deriveProjectTimeline,
  getAutoSkippedStagesForServiceType,
  normalizeStage,
  validateTimelineDates,
  type ApprovalMilestone,
  type OfficialTimelineStage,
} from './timeline';
import type {
  ActivityLog,
  AdminWorkflowOverrideLog,
  ClientInviteDraft,
  ClientProjectAccess,
  EmployeeCompensation,
  EmployeeLedgerEntry,
  EmployeeLedgerType,
  ClientRevisionStatus,
  NotificationItem,
  NoteType,
  Profile,
  Project,
  ProjectDraft,
  ProjectLifecycleStatus,
  ProjectMetadataUpdate,
  ProjectPayment,
  ProjectNote,
  RevisionActivity,
  RevisionAttachment,
  RevisionItem,
  RevisionNote,
  RevisionRequest,
  RevisionRequestDraft,
  RevisionStatus,
  Role,
  StageData,
  StageSkipRequest,
  Task,
  TaskAssignee,
  TaskAssignmentRole,
  TaskChecklistItem,
  TaskComment,
  TaskDependency,
  TaskDraft,
  TrackerData,
  FinanceBudget,
  FinanceTransaction,
  FinanceTransactionDraft,
  FinanceTransactionUpdate,
  Invoice,
  Conversation,
  ConversationMember,
  ChatMessage,
  MessageAttachment,
  MessageReaction,
  MessageMention,
  TimelineStage,
  WorkflowStage,
  WorkflowSettings,
} from './types';
import { CanonicalWorkflowClient } from './workflowClient';

type AuthMode = 'demo' | 'supabase';

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createUuid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (character) =>
    (Number(character) ^ (Math.random() * 16 >> (Number(character) / 4))).toString(16),
  );
}

function calculateBalance(totalPrice: number, advancePaid: number) {
  return Math.max(Number(totalPrice || 0) - Number(advancePaid || 0), 0);
}

function cleanDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : null;
}

function cleanText(value: string | null | undefined) {
  return value || '';
}

function isMissingSchemaError(error: unknown) {
  const message = errorMessage(error, '').toLowerCase();
  return (
    message.includes('does not exist') ||
    message.includes('schema cache') ||
    message.includes('could not find') ||
    message.includes('relation') ||
    message.includes('column')
  );
}

async function safeSelect<T>(
  query: PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ data: T[]; error: null }> {
  const { data, error } = await query;

  if (error) {
    if (isMissingSchemaError(error)) {
      throw new Error('Phase 6 database configuration is incomplete: a required application table or column is unavailable.');
    }

    throw error;
  }

  return { data: data || [], error: null };
}

function paymentMonthParts(dueDate: string | null | undefined) {
  const cleanDueDate = cleanDate(dueDate);

  if (!cleanDueDate) {
    return {
      due_date: null,
      payment_month: null,
      payment_year: null,
    };
  }

  return {
    due_date: cleanDueDate,
    payment_month: cleanDueDate.slice(0, 7),
    payment_year: Number(cleanDueDate.slice(0, 4)),
  };
}

type InvoiceVersionRow = Omit<Invoice, 'logical_invoice_id'> & {
  invoice_id: string;
};

function normalizeInvoiceVersion(row: InvoiceVersionRow): Invoice {
  return {
    ...row,
    id: row.id,
    logical_invoice_id: row.invoice_id,
    version_number: Number(row.version_number || 1),
    month: Number(row.month || 1),
    year: Number(row.year || new Date().getFullYear()),
    subtotal: Number(row.subtotal || 0),
    total_paid: Number(row.total_paid || 0),
    total_due: Number(row.total_due || 0),
    items: Array.isArray(row.items) ? row.items : [],
    notes: row.notes || '',
    change_note: row.change_note || '',
  };
}

function normalizeProject(project: Project): Project {
  const totalPrice = Number(project.total_price || 0);
  const advancePaid = Number(project.advance_paid || 0);

  return {
    ...project,
    total_price: totalPrice,
    advance_paid: advancePaid,
    remaining_balance: calculateBalance(totalPrice, advancePaid),
    payment_status: project.payment_status || 'Not Started',
    payment_date: cleanDate(project.payment_date),
    payment_notes: cleanText(project.payment_notes),
    files_received_date: cleanDate(project.files_received_date),
    design_concept_due_date: cleanDate(project.design_concept_due_date),
    design_concept_due_date_manual: Boolean(project.design_concept_due_date_manual),
    design_concept_submitted_date: cleanDate(project.design_concept_submitted_date),
    design_concept_approval_date: cleanDate(project.design_concept_approval_date),
    concept_revision_due_date: cleanDate(project.concept_revision_due_date),
    print_version_due_date: cleanDate(project.print_version_due_date),
    print_version_due_date_manual: Boolean(project.print_version_due_date_manual),
    print_version_submitted_date: cleanDate(project.print_version_submitted_date),
    print_version_approval_date: cleanDate(project.print_version_approval_date),
    print_revision_due_date: cleanDate(project.print_revision_due_date),
    ebook_due_date: cleanDate(project.ebook_due_date),
    ebook_due_date_manual: Boolean(project.ebook_due_date_manual),
    ebook_submitted_date: cleanDate(project.ebook_submitted_date),
    ebook_approval_date: cleanDate(project.ebook_approval_date),
    final_delivery_date: cleanDate(project.final_delivery_date),
    delay_reason: cleanText(project.delay_reason),
    client_action_required: cleanText(project.client_action_required),
    print_timeline_days: project.print_timeline_days || 5,
  };
}

function normalizeClientProject(project: Partial<Project>): Project {
  return normalizeProject({
    id: project.id || '',
    project_number: project.project_number || '',
    client_name: project.client_name || '',
    client_email: project.client_email || '',
    project_title: project.project_title || 'Untitled Project',
    service_type: project.service_type || '',
    genre: project.genre || '',
    trim_size: '',
    page_count: 0,
    word_count: 0,
    image_count: 0,
    platform: '',
    assigned_to: project.assigned_to || null,
    project_manager: project.project_manager || null,
    priority: 'Normal',
    start_date: '',
    due_date: cleanDate(project.due_date) || '',
    internal_deadline: '',
    delivery_date: null,
    status: project.status || 'New',
    project_status: project.project_status || null,
    workflow_stage_key: project.workflow_stage_key || null,
    workflow_stage_status_key: project.workflow_stage_status_key || null,
    workflow_waiting_on_key: project.workflow_waiting_on_key || null,
    workflow_version: Number(project.workflow_version || 0),
    requires_print: project.requires_print ?? null,
    requires_ebook: project.requires_ebook ?? null,
    service_capability_status: project.service_capability_status || 'needs_review',
    production_seconds_total: Number(project.production_seconds_total || 0),
    client_wait_seconds_total: Number(project.client_wait_seconds_total || 0),
    delivered_at: project.delivered_at || null,
    general_notes: project.general_notes || '',
    internal_notes: '',
    client_instructions: project.client_instructions || '',
    qa_notes: '',
    delivery_notes: project.delivery_notes || '',
    source_file_link: project.source_file_link || '',
    drive_folder_link: project.drive_folder_link || '',
    client_brief_link: project.client_brief_link || '',
    proof_pdf_link: project.proof_pdf_link || '',
    final_print_pdf_link: project.final_print_pdf_link || '',
    final_ebook_link: project.final_ebook_link || '',
    cover_file_link: project.cover_file_link || '',
    other_links: project.other_links || '',
    total_price: 0,
    advance_paid: 0,
    remaining_balance: 0,
    payment_status: 'Not Started',
    payment_date: null,
    payment_notes: '',
    files_received_date: cleanDate(project.files_received_date),
    design_concept_due_date: cleanDate(project.design_concept_due_date),
    design_concept_due_date_manual: Boolean(project.design_concept_due_date_manual),
    design_concept_submitted_date: cleanDate(project.design_concept_submitted_date),
    design_concept_approval_date: cleanDate(project.design_concept_approval_date),
    concept_revision_due_date: cleanDate(project.concept_revision_due_date),
    print_version_due_date: cleanDate(project.print_version_due_date),
    print_version_due_date_manual: Boolean(project.print_version_due_date_manual),
    print_version_submitted_date: cleanDate(project.print_version_submitted_date),
    print_version_approval_date: cleanDate(project.print_version_approval_date),
    print_revision_due_date: cleanDate(project.print_revision_due_date),
    ebook_due_date: cleanDate(project.ebook_due_date),
    ebook_due_date_manual: Boolean(project.ebook_due_date_manual),
    ebook_submitted_date: cleanDate(project.ebook_submitted_date),
    ebook_approval_date: cleanDate(project.ebook_approval_date),
    final_delivery_date: cleanDate(project.final_delivery_date),
    current_stage: project.current_stage,
    stage_status: project.stage_status || 'ACTIVE',
    stage_due_at: project.stage_due_at || null,
    stage_started_at: project.stage_started_at || null,
    revision_count: Number(project.revision_count || 0),
    progress_percentage: Number(project.progress_percentage || 0),
    waiting_on: project.waiting_on,
    timeline_status: project.timeline_status,
    production_days_used: Number(project.production_days_used || 0),
    delay_reason: cleanText(project.delay_reason),
    client_action_required: cleanText(project.client_action_required),
    print_timeline_days: project.print_timeline_days || 5,
    workflow_settings: project.workflow_settings || undefined,
    created_by: null,
    created_at: project.created_at || new Date().toISOString(),
    updated_at: project.updated_at || new Date().toISOString(),
  });
}

export { normalizeRevisionRequest } from './revisionUtils';

function normalizeRevisionItem(item: Partial<RevisionItem>): RevisionItem {
  const now = new Date().toISOString();

  return {
    id: item.id || createId('revision-item'),
    revision_request_id: item.revision_request_id || '',
    sort_order: Number(item.sort_order || 1),
    page_reference: item.page_reference || '',
    instruction: item.instruction || '',
    status: item.status || 'Open',
    client_attachment_url: item.client_attachment_url || null,
    team_response: item.team_response || null,
    internal_note: item.internal_note || null,
    created_at: item.created_at || now,
    updated_at: item.updated_at || now,
  };
}

function normalizeRevisionAttachment(attachment: Partial<RevisionAttachment>): RevisionAttachment {
  return {
    id: attachment.id || createId('revision-attachment'),
    revision_request_id: attachment.revision_request_id || '',
    revision_item_id: attachment.revision_item_id || null,
    file_name: attachment.file_name || 'Attachment',
    file_url: attachment.file_url || '',
    file_type: attachment.file_type || 'client_attachment',
    uploaded_by: attachment.uploaded_by || '',
    created_at: attachment.created_at || new Date().toISOString(),
  };
}

function normalizeRevisionActivity(activity: Partial<RevisionActivity>): RevisionActivity {
  return {
    id: activity.id || createId('revision-activity'),
    revision_request_id: activity.revision_request_id || '',
    user_id: activity.user_id || null,
    action: activity.action || 'Updated',
    previous_value: activity.previous_value || null,
    new_value: activity.new_value || null,
    created_at: activity.created_at || new Date().toISOString(),
  };
}

function normalizeTask(task: Partial<Task>): Task {
  const now = new Date().toISOString();

  return {
    id: task.id || createId('task'),
    title: task.title || 'Untitled task',
    description: task.description || '',
    project_id: task.project_id || null,
    assigned_to: task.assigned_to || null,
    created_by: task.created_by || '',
    status: task.status || 'To Do',
    priority: task.priority || 'Normal',
    start_date: cleanDate(task.start_date),
    due_date: cleanDate(task.due_date),
    parent_task_id: task.parent_task_id || null,
    estimated_minutes: task.estimated_minutes == null ? null : Math.max(0, Number(task.estimated_minutes)),
    actual_minutes: task.actual_minutes == null ? null : Math.max(0, Number(task.actual_minutes)),
    blocked_reason: cleanText(task.blocked_reason) || null,
    sort_order: Number(task.sort_order || 0),
    task_type: task.task_type?.trim() || 'task',
    visibility: task.visibility === 'private' ? 'private' : 'team',
    archived_at: task.archived_at || null,
    completed_at: task.completed_at || null,
    created_at: task.created_at || now,
    updated_at: task.updated_at || now,
  };
}

function taskPayload(task: TaskDraft | Partial<Task>, createdBy?: string) {
  const existingCompletedAt = (task as Partial<Task>).completed_at;

  return {
    title: task.title?.trim() || 'Untitled task',
    description: cleanText(task.description),
    project_id: task.project_id || null,
    assigned_to: task.assigned_to || null,
    status: task.status || 'To Do',
    priority: task.priority || 'Normal',
    start_date: cleanDate(task.start_date),
    due_date: cleanDate(task.due_date),
    parent_task_id: task.parent_task_id || null,
    estimated_minutes: task.estimated_minutes == null ? null : Math.max(0, Number(task.estimated_minutes)),
    actual_minutes: task.actual_minutes == null ? null : Math.max(0, Number(task.actual_minutes)),
    blocked_reason: task.status === 'Blocked' ? cleanText(task.blocked_reason) || null : null,
    sort_order: Number(task.sort_order || 0),
    task_type: task.task_type?.trim() || 'task',
    visibility: task.visibility === 'private' ? 'private' : 'team',
    archived_at: (task as Partial<Task>).archived_at || null,
    completed_at: task.status === 'Done' ? existingCompletedAt || new Date().toISOString() : null,
    ...(createdBy ? { created_by: createdBy } : {}),
  };
}

function projectMetadataPayload(project: ProjectMetadataUpdate | ProjectDraft) {
  return {
    client_name: project.client_name,
    client_email: project.client_email,
    client_profile_id: project.client_profile_id,
    project_title: project.project_title,
    service_type: project.service_type,
    genre: project.genre,
    trim_size: project.trim_size,
    page_count: project.page_count,
    word_count: project.word_count,
    image_count: project.image_count,
    platform: project.platform,
    assigned_to: project.assigned_to,
    project_manager: project.project_manager,
    priority: project.priority,
    start_date: cleanDate(project.start_date),
    due_date: cleanDate(project.due_date),
    internal_deadline: cleanDate(project.internal_deadline),
    general_notes: project.general_notes,
    internal_notes: project.internal_notes,
    client_instructions: project.client_instructions,
    qa_notes: project.qa_notes,
    delivery_notes: project.delivery_notes,
    source_file_link: project.source_file_link,
    drive_folder_link: project.drive_folder_link,
    client_brief_link: project.client_brief_link,
    proof_pdf_link: project.proof_pdf_link,
    final_print_pdf_link: project.final_print_pdf_link,
    final_ebook_link: project.final_ebook_link,
    cover_file_link: project.cover_file_link,
    other_links: project.other_links,
    invoiced: project.invoiced,
    invoice_id: project.invoice_id,
    invoiced_at: project.invoiced_at,
  };
}

function legacyTaskPayload(task: TaskDraft | Partial<Task>, createdBy?: string) {
  const payload = taskPayload(task, createdBy);
  return {
    title: payload.title,
    description: payload.description,
    project_id: payload.project_id,
    assigned_to: payload.assigned_to,
    status: payload.status === 'Blocked' ? 'In Progress' : payload.status,
    priority: payload.priority,
    due_date: payload.due_date,
    completed_at: payload.completed_at,
    ...(createdBy ? { created_by: createdBy } : {}),
  };
}

async function requiredSelect<T>(
  query: PromiseLike<{ data: T[] | null; error: unknown }>,
  label: string,
): Promise<{ data: T[]; error: null }> {
  const { data, error } = await query;
  if (error) {
    if (isMissingSchemaError(error)) {
      const missing = new Error(`Phase 6 database configuration is incomplete: ${label} is unavailable.`);
      (missing as Error & { cause?: unknown }).cause = error;
      throw missing;
    }
    throw error;
  }
  return { data: data || [], error: null };
}

async function optionalV2Select<T>(
  query: PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ data: T[]; error: null }> {
  const { data, error } = await query;
  if (error) {
    if (isMissingSchemaError(error)) return { data: [], error: null };
    throw error;
  }
  return { data: data || [], error: null };
}

function definedValues<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

function canonicalSettings(settings?: WorkflowSettings): WorkflowSettings {
  return {
    exclude_weekends: settings?.exclude_weekends ?? true,
    files_received_days: settings?.files_received_days ?? 2,
    design_concept_days: settings?.design_concept_days ?? 3,
    print_version_days: settings?.print_version_days ?? 5,
    ebook_version_days: settings?.ebook_version_days ?? 5,
    final_delivery_days: settings?.final_delivery_days ?? 2,
    revision_days: settings?.revision_days ?? settings?.design_concept_revision_days ?? 2,
  };
}

const CANONICAL_STAGE_BY_LABEL: Record<OfficialTimelineStage, WorkflowStage> = {
  'Files Received': 'files_received',
  'Design Concept': 'design_concept',
  'Concept Approval': 'concept_approval',
  'Print Version': 'print_version',
  'Print Approval': 'print_approval',
  'Ebook Version': 'ebook_version',
  'Ebook Approval': 'ebook_approval',
  'Final Delivery': 'final_delivery',
};

function toWorkflowStage(stage: TimelineStage): WorkflowStage {
  const normalized = normalizeStage(stage);
  if (normalized === 'Completed' || normalized === 'On Hold' || normalized === 'Cancelled') {
    throw new Error(`${stage} is not a canonical workflow stage.`);
  }
  return CANONICAL_STAGE_BY_LABEL[normalized];
}

function requireWorkflowVersion(project: Project) {
  if (!Number.isSafeInteger(project.workflow_version) || Number(project.workflow_version) < 0) {
    throw new Error('Phase 6 database configuration is incomplete: project workflow_version is unavailable.');
  }
  return Number(project.workflow_version);
}

function paymentPayload(project: ProjectDraft | Partial<Project>) {
  return {
    total_price: Number(project.total_price || 0),
    advance_paid: Number(project.advance_paid || 0),
    payment_status: project.payment_status || 'Not Started',
    ...paymentMonthParts(project.due_date),
    payment_date: cleanDate(project.payment_date),
    notes: cleanText(project.payment_notes),
  };
}

async function upsertProjectPayment(
  projectId: string,
  project: ProjectDraft | Partial<Project>,
) {
  if (!supabase) {
    return;
  }

  const payload = paymentPayload(project);
  const updated = await supabase
    .from('project_payments')
    .update(payload)
    .eq('project_id', projectId)
    .select('id');
  if (updated.error) throw updated.error;
  if ((updated.data || []).length > 0) return;

  const inserted = await supabase.from('project_payments').insert({ project_id: projectId, ...payload });
  if (inserted.error) throw inserted.error;
}

function mergePayments(projects: Project[], payments: ProjectPayment[]) {
  const paymentByProjectId = new Map(payments.map((payment) => [payment.project_id, payment]));

  return projects.map((project) => {
    const payment = paymentByProjectId.get(project.id);

    return normalizeProject({
      ...project,
      total_price: payment?.total_price || 0,
      advance_paid: payment?.advance_paid || 0,
      remaining_balance: payment?.remaining_balance || 0,
      payment_status: payment?.payment_status || 'Not Started',
      payment_date: payment?.payment_date || null,
      payment_notes: payment?.notes || '',
    });
  });
}

function canManageEverything(profile: Profile | null) {
  return isManagerRole(profile?.role);
}

function cleanStorageName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'attachment';
}

async function uploadRevisionFile({
  clientId,
  projectId,
  requestId,
  file,
  itemId,
  objectId,
}: {
  clientId: string;
  projectId: string;
  requestId: string;
  file: File;
  itemId?: string | null;
  objectId?: string;
}) {
  if (!supabase) {
    return '';
  }

  const safeName = cleanStorageName(file.name);
  const itemPath = itemId ? `${itemId}/` : '';
  const path = `${clientId}/${projectId}/${requestId}/${itemPath}${objectId || Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from('revision-files').upload(path, file, {
    upsert: false,
  });

  if (error) {
    const message=errorMessage(error,'').toLowerCase();
    if (!objectId || (!message.includes('already exists') && !message.includes('duplicate') && !message.includes('409'))) throw error;
  }

  return path;
}

async function operationFingerprint(value: unknown) {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('This browser does not support the secure hashing required for safe action retries.');
  }
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fileFingerprint(file: File, index = 0) {
  return `${index}:${file.name}:${file.size}:${file.type}:${file.lastModified}`;
}

type AttachmentRetryProgress = {
  attachmentId: string;
  storagePath?: string;
  uploaded: boolean;
  insertAttempted: boolean;
  inserted: boolean;
};
type RevisionSubmissionRetry = {
  requestId?: string;
  attachments: Map<string, AttachmentRetryProgress>;
  complete: boolean;
};
type RevisedProofRetry = {
  attachment: AttachmentRetryProgress;
  rpcComplete: boolean;
};

async function ensureRevisionAttachment(
  progress: AttachmentRetryProgress,
  payload: Omit<RevisionAttachment,'created_at'>,
) {
  if (!supabase || progress.inserted) return;
  if (progress.insertAttempted) {
    const existing=await supabase.from('revision_attachments').select('id').eq('id',progress.attachmentId).maybeSingle();
    if(existing.error) throw existing.error;
    if(existing.data){progress.inserted=true;return;}
  }
  progress.insertAttempted=true;
  const inserted=await supabase.from('revision_attachments').insert(payload);
  if(!inserted.error){progress.inserted=true;return;}
  const confirmed=await supabase.from('revision_attachments').select('id').eq('id',progress.attachmentId).maybeSingle();
  if(!confirmed.error&&confirmed.data){progress.inserted=true;return;}
  throw inserted.error;
}

function paymentFieldsChanged(previous: Project, next: Project) {
  return (
    Number(previous.total_price || 0) !== Number(next.total_price || 0) ||
    Number(previous.advance_paid || 0) !== Number(next.advance_paid || 0) ||
    previous.payment_status !== next.payment_status ||
    cleanDate(previous.payment_date) !== cleanDate(next.payment_date) ||
    cleanText(previous.payment_notes) !== cleanText(next.payment_notes) ||
    cleanDate(previous.due_date) !== cleanDate(next.due_date)
  );
}

function normalizeLoginValue(value: string) {
  return value.trim().toLowerCase();
}

function profileMatchesLoginName(profile: Profile, loginName: string) {
  const normalizedLogin = normalizeLoginValue(loginName);

  return [profile.email, profile.full_name, firstName(profile.full_name)].some(
    (value) => normalizeLoginValue(value) === normalizedLogin,
  );
}

function loginErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as any).message) : 'Login failed.';

  if (message.toLowerCase().includes('invalid login credentials')) {
    return 'Name or password is incorrect.';
  }

  if (message.includes('find_login_email')) {
    return 'Name login is not set up in Supabase yet. Please run the latest database update.';
  }

  return message;
}

function signupErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as any).message) : 'Sign up failed.';
  const lower = message.toLowerCase();

  if (lower.includes('user already registered') || lower.includes('already registered') || lower.includes('user_already_exists')) {
    return 'An account with this email already exists. Please sign in instead.';
  }

  if (lower.includes('password should be') || lower.includes('weak_password') || lower.includes('at least 6 characters')) {
    return 'Password is too weak. Please use at least 6 characters.';
  }

  if (lower.includes('rate limit') || lower.includes('over_email_send_rate_limit')) {
    return 'Email rate limit reached. Please wait a few minutes before trying again.';
  }

  return message;
}

const AUTH_PROFILE_STORAGE_KEY = 'mh_auth_profile';
const AUTH_MODE_STORAGE_KEY = 'mh_auth_mode';
const TRACKER_DATA_STORAGE_KEY = 'mh_tracker_cache';

function createEmptyTrackerData(profile: Profile | null = null): TrackerData {
  return {
    profiles: profile ? [profile] : [],
    projects: [],
    revisionNotes: [],
    projectNotes: [],
    activityLogs: [],
    notifications: [],
    clientProjectAccess: [],
    tasks: [],
    taskAssignees: [],
    taskComments: [],
    taskChecklistItems: [],
    taskDependencies: [],
    revisionRequests: [],
    revisionItems: [],
    revisionAttachments: [],
    revisionActivity: [],
    employeeCompensation: [],
    employeeLedger: [],
    stageSkipRequests: [],
    financeTransactions: [],
    financeBudgets: [],
    invoices: [],
    projectProfitability: [],
    clientReceivables: [],
    teamPayroll: [],
    conversations: [],
    conversationMembers: [],
    messages: [],
    messageAttachments: [],
    messageReactions: [],
    messageMentions: [],
  };
}

function getStoredProfile(): Profile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AUTH_PROFILE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

function setStoredProfile(profile: Profile | null) {
  if (typeof window === 'undefined') return;
  try {
    if (profile) {
      localStorage.setItem(AUTH_PROFILE_STORAGE_KEY, JSON.stringify(profile));
    } else {
      localStorage.removeItem(AUTH_PROFILE_STORAGE_KEY);
    }
  } catch (err) {
    console.warn('Could not persist profile in localStorage:', err);
  }
}

function getStoredMode(): AuthMode {
  if (typeof window === 'undefined') return supabase ? 'supabase' : 'demo';
  try {
    const raw = localStorage.getItem(AUTH_MODE_STORAGE_KEY) as AuthMode | null;
    if (raw === 'supabase' || raw === 'demo') return raw;
  } catch {
    // fallback
  }
  return supabase ? 'supabase' : 'demo';
}

function setStoredMode(mode: AuthMode | null) {
  if (typeof window === 'undefined') return;
  try {
    if (mode) {
      localStorage.setItem(AUTH_MODE_STORAGE_KEY, mode);
    } else {
      localStorage.removeItem(AUTH_MODE_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

function getStoredTrackerData(): TrackerData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TRACKER_DATA_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TrackerData) : null;
  } catch {
    return null;
  }
}

function setStoredTrackerData(trackerData: TrackerData) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(TRACKER_DATA_STORAGE_KEY, JSON.stringify(trackerData));
  } catch {
    // ignore quota errors
  }
}

function clearStoredAuth() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(AUTH_PROFILE_STORAGE_KEY);
    localStorage.removeItem(AUTH_MODE_STORAGE_KEY);
    localStorage.removeItem(TRACKER_DATA_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function useTracker() {
  const initialProfile = useMemo(() => getStoredProfile(), []);
  const initialMode = useMemo(() => getStoredMode(), []);
  const initialData = useMemo(() => {
    const cachedData = getStoredTrackerData();
    if (cachedData) return cachedData;
    if (!supabase || initialMode === 'demo') return sampleData;
    return createEmptyTrackerData(initialProfile);
  }, [initialMode, initialProfile]);

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(initialProfile);
  const [data, setData] = useState<TrackerData>(initialData);
  // Keep startup gated until Supabase has confirmed the session and loaded live workspace data.
  // This prevents sample/demo projects from flashing before the real projects arrive.
  const [isInitializing, setIsInitializing] = useState<boolean>(() => Boolean(supabase));
  const [isSubmittingLogin, setIsSubmittingLogin] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notificationToast, setNotificationToast] = useState<NotificationItem | null>(null);

  const isRestoringRef = useRef<boolean>(false);
  const revisionSubmissionRetriesRef = useRef(new Map<string, RevisionSubmissionRetry>());
  const revisedProofRetriesRef = useRef(new Map<string, RevisedProofRetry>());

  const loadSupabaseData = useCallback(async (profile: Profile) => {
    if (!supabase) {
      return;
    }

    setIsLoading(true);
    setError(null);

    const profileIsClient = isClientRole(profile.role);
    const canManage = canManageEverything(profile);
    const emptyResult = Promise.resolve({ data: [], error: null });

    const profilesPromise = profileIsClient
      ? requiredSelect<Profile>(supabase.from('profiles').select('*').eq('id', profile.id), 'self profile access')
      : profile.role === 'admin'
        ? requiredSelect<Profile>(supabase.from('profiles').select('*').order('full_name'), 'Admin profile access')
        : requiredSelect<Profile>(supabase.rpc('get_collaboration_directory'), 'get_collaboration_directory()');

    const projectsPromise = profileIsClient
      ? requiredSelect<Partial<Project>>(supabase.rpc('get_client_project_summaries'), 'get_client_project_summaries()')
      : requiredSelect<Project>(supabase.from('projects').select('*').order('created_at', { ascending: false }), 'canonical projects');

    const paymentsPromise = canManage
      ? safeSelect<ProjectPayment>(supabase.from('project_payments').select('*'))
      : emptyResult;

    const revisionNotesPromise = profileIsClient
      ? emptyResult
      : safeSelect<RevisionNote>(supabase.from('revision_notes').select('*').order('created_at', { ascending: false }));

    const projectNotesPromise = profileIsClient
      ? emptyResult
      : safeSelect<ProjectNote>(supabase.from('project_notes').select('*').order('created_at', { ascending: false }));

    const activityPromise = profileIsClient
      ? emptyResult
      : safeSelect<ActivityLog>(supabase.from('activity_logs').select('*').order('created_at', { ascending: false }));

    const tasksPromise = profileIsClient
      ? emptyResult
      : safeSelect<Task>(
          supabase
            .from('tasks')
            .select('*')
            .order('status', { ascending: true })
            .order('due_date', { ascending: true, nullsFirst: false })
            .order('created_at', { ascending: false }),
        );
    const taskAssigneesPromise = profileIsClient
      ? emptyResult
      : optionalV2Select<TaskAssignee>(supabase.from('task_assignees').select('*').order('assigned_at'));
    const taskCommentsPromise = profileIsClient
      ? emptyResult
      : optionalV2Select<TaskComment>(supabase.from('task_comments').select('*').order('created_at'));
    const taskChecklistPromise = profileIsClient
      ? emptyResult
      : optionalV2Select<TaskChecklistItem>(supabase.from('task_checklist_items').select('*').order('position'));
    const taskDependenciesPromise = profileIsClient
      ? emptyResult
      : optionalV2Select<TaskDependency>(supabase.from('task_dependencies').select('*').order('created_at'));

    const clientAccessPromise = profile.role === 'admin'
      ? safeSelect<ClientProjectAccess>(supabase.from('client_project_access').select('*').order('created_at'))
      : emptyResult;

    const revisionRequestsPromise = profileIsClient
      ? requiredSelect<Partial<RevisionRequest>>(supabase.rpc('get_client_revision_requests'), 'get_client_revision_requests()')
      : safeSelect<RevisionRequest>(supabase.from('revision_requests').select('*').order('created_at', { ascending: false }));

    const revisionItemsPromise = profileIsClient
      ? requiredSelect<Partial<RevisionItem>>(supabase.rpc('get_client_revision_items'), 'get_client_revision_items()')
      : safeSelect<RevisionItem>(supabase.from('revision_items').select('*').order('sort_order', { ascending: true }));

    const revisionAttachmentsPromise = profileIsClient
      ? requiredSelect<Partial<RevisionAttachment>>(supabase.rpc('get_client_revision_attachments'), 'get_client_revision_attachments()')
      : safeSelect<RevisionAttachment>(
          supabase.from('revision_attachments').select('*').order('created_at', { ascending: false }),
        );

    const revisionActivityPromise = profileIsClient
      ? requiredSelect<Partial<RevisionActivity>>(supabase.rpc('get_client_revision_activity'), 'get_client_revision_activity()')
      : safeSelect<RevisionActivity>(supabase.from('revision_activity').select('*').order('created_at', { ascending: false }));

    const stageSkipsPromise = profileIsClient
      ? requiredSelect<Partial<StageSkipRequest>>(supabase.rpc('get_client_stage_skips'), 'get_client_stage_skips()')
      : safeSelect<StageSkipRequest>(supabase.from('project_stage_skips').select('*').order('requested_at', { ascending: false }));

    const isEmployee = profile.role === 'employee' || profile.role === 'junior_assistant';
    const employeeCompensationPromise = profile.role === 'admin'
      ? safeSelect<EmployeeCompensation>(supabase.from('employee_compensation').select('*'))
      : isEmployee
        ? safeSelect<EmployeeCompensation>(supabase.from('employee_compensation').select('*').eq('employee_id', profile.id))
        : emptyResult;
    const employeeLedgerPromise = profile.role === 'admin'
      ? safeSelect<EmployeeLedgerEntry>(supabase.from('employee_ledger').select('*').order('paid_at', { ascending: false }))
      : isEmployee
        ? safeSelect<EmployeeLedgerEntry>(supabase.from('employee_ledger').select('*').eq('employee_id', profile.id).order('paid_at', { ascending: false }))
        : emptyResult;
    const financeTransactionsPromise = canManage
      ? safeSelect<FinanceTransaction>(supabase.from('finance_transactions').select('*').order('transaction_date', { ascending: false }))
      : emptyResult;
    const financeBudgetsPromise = canManage
      ? safeSelect<FinanceBudget>(supabase.from('finance_budgets').select('*'))
      : emptyResult;
    const invoiceVersionsPromise = canManage
      ? safeSelect<InvoiceVersionRow>(
          supabase.from('invoice_versions').select('*').order('created_at', { ascending: false }),
        )
      : emptyResult;

    const conversationsPromise = profileIsClient
      ? safeSelect<Conversation>(supabase.from('conversations').select('*').eq('type', 'project_client'))
      : safeSelect<Conversation>(supabase.from('conversations').select('*'));
    const conversationMembersPromise = safeSelect<ConversationMember>(supabase.from('conversation_members').select('*'));
    const messagesPromise = safeSelect<ChatMessage>(supabase.from('messages').select('*').order('created_at', { ascending: true }));
    const messageAttachmentsPromise = safeSelect<MessageAttachment>(supabase.from('message_attachments').select('*'));
    const messageReactionsPromise = safeSelect<MessageReaction>(supabase.from('message_reactions').select('*'));
    const messageMentionsPromise = safeSelect<MessageMention>(supabase.from('message_mentions').select('*'));

    const [
      profilesRes,
      projectsRes,
      paymentsRes,
      revisionsRes,
      notesRes,
      activityRes,
      tasksRes,
      taskAssigneesRes,
      taskCommentsRes,
      taskChecklistRes,
      taskDependenciesRes,
      clientAccessRes,
      revisionRequestsRes,
      revisionItemsRes,
      revisionAttachmentsRes,
      revisionActivityRes,
      stageSkipsRes,
      employeeCompensationRes,
      employeeLedgerRes,
      financeTransactionsRes,
      financeBudgetsRes,
      invoiceVersionsRes,
      conversationsRes,
      conversationMembersRes,
      messagesRes,
      messageAttachmentsRes,
      messageReactionsRes,
      messageMentionsRes,
      notifications,
    ] = await Promise.all([
      profilesPromise,
      projectsPromise,
      paymentsPromise,
      revisionNotesPromise,
      projectNotesPromise,
      activityPromise,
      tasksPromise,
      taskAssigneesPromise,
      taskCommentsPromise,
      taskChecklistPromise,
      taskDependenciesPromise,
      clientAccessPromise,
      revisionRequestsPromise,
      revisionItemsPromise,
      revisionAttachmentsPromise,
      revisionActivityPromise,
      stageSkipsPromise,
      employeeCompensationPromise,
      employeeLedgerPromise,
      financeTransactionsPromise,
      financeBudgetsPromise,
      invoiceVersionsPromise,
      conversationsPromise,
      conversationMembersPromise,
      messagesPromise,
      messageAttachmentsPromise,
      messageReactionsPromise,
      messageMentionsPromise,
      fetchNotifications(profile.id),
    ]);

    const projects = profileIsClient
      ? (projectsRes.data as Partial<Project>[])
          .map(normalizeClientProject)
          .sort(
            (a, b) =>
              new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime(),
          )
      : (projectsRes.data as Project[]).map(normalizeProject);
    const payments = paymentsRes.data as ProjectPayment[];

    const rawConvs = conversationsRes.data as Conversation[];
    const conversations = profileIsClient
      ? rawConvs.filter((c) => c.type === 'project_client')
      : rawConvs;

    const nextData: TrackerData = {
      profiles: (profilesRes.data as Partial<Profile>[]).map((item) => ({
        id: item.id || '', full_name: item.full_name || 'Team member', email: item.email || '',
        role: item.role || 'employee', avatar_url: item.avatar_url || null, phone: item.phone || null,
        status: item.status || 'active', created_at: item.created_at || '',
      })),
      projects: mergePayments(projects, payments),
      revisionNotes: revisionsRes.data as RevisionNote[],
      projectNotes: notesRes.data as ProjectNote[],
      activityLogs: activityRes.data as ActivityLog[],
      tasks: (tasksRes.data as Partial<Task>[]).map(normalizeTask),
      taskAssignees: taskAssigneesRes.data as TaskAssignee[],
      taskComments: taskCommentsRes.data as TaskComment[],
      taskChecklistItems: taskChecklistRes.data as TaskChecklistItem[],
      taskDependencies: taskDependenciesRes.data as TaskDependency[],
      notifications,
      clientProjectAccess: clientAccessRes.data as ClientProjectAccess[],
      revisionRequests: (revisionRequestsRes.data as Partial<RevisionRequest>[]).map(normalizeRevisionRequest),
      revisionItems: (revisionItemsRes.data as Partial<RevisionItem>[]).map(normalizeRevisionItem),
      revisionAttachments: (revisionAttachmentsRes.data as Partial<RevisionAttachment>[]).map(normalizeRevisionAttachment),
      revisionActivity: (revisionActivityRes.data as Partial<RevisionActivity>[]).map(normalizeRevisionActivity),
      stageSkipRequests: (stageSkipsRes.data as Array<Partial<StageSkipRequest> & { created_at?: string; response_note?: string }>).map((item) => ({
        id: item.id || '', project_id: item.project_id || '', stage: item.stage || 'Files Received',
        requested_by: item.requested_by || '', requested_at: item.requested_at || item.created_at || '',
        reason: item.reason || '', status: item.status || 'PENDING',
        client_response_at: item.client_response_at || null,
        client_notes: item.client_notes || item.response_note || null,
      })),
      employeeCompensation: employeeCompensationRes.data as EmployeeCompensation[],
      employeeLedger: employeeLedgerRes.data as EmployeeLedgerEntry[],
      financeTransactions: financeTransactionsRes.data as FinanceTransaction[],
      financeBudgets: financeBudgetsRes.data as FinanceBudget[],
      invoices: (invoiceVersionsRes.data as InvoiceVersionRow[]).map(normalizeInvoiceVersion),
      conversations,
      conversationMembers: conversationMembersRes.data as ConversationMember[],
      messages: messagesRes.data as ChatMessage[],
      messageAttachments: messageAttachmentsRes.data as MessageAttachment[],
      messageReactions: messageReactionsRes.data as MessageReaction[],
      messageMentions: messageMentionsRes.data as MessageMention[],
    };

    setData(nextData);
    setStoredTrackerData(nextData);
    setIsLoading(false);
  }, []);

  const workflowClient = useMemo(
    () => supabase && currentProfile
      ? new CanonicalWorkflowClient(supabase, () => loadSupabaseData(currentProfile))
      : null,
    [currentProfile, loadSupabaseData],
  );

  const fetchProfile = useCallback(async (userId: string) => {
    if (!supabase) {
      return null;
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profileError) {
      throw profileError;
    }

    return profile as Profile;
  }, []);

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      if (!supabase) {
        setIsInitializing(false);
        setIsLoading(false);
        return;
      }

      if (isRestoringRef.current) {
        return;
      }
      isRestoringRef.current = true;

      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (!active) {
          return;
        }

        if (sessionError) {
          console.warn('Session check error:', sessionError);
        }

        if (!session?.user) {
          // If there is no active session on Supabase, clear stored credentials
          clearStoredAuth();
          if (active) {
            setCurrentProfile(null);
          }
          return;
        }

        let profile: Profile | null = null;
        try {
          profile = await fetchProfile(session.user.id);
        } catch (fetchErr) {
          console.warn('Failed to fetch live profile during restore, checking cached profile:', fetchErr);
          const cached = getStoredProfile();
          if (cached && cached.id === session.user.id) {
            profile = cached;
          }
        }

        if (!active) {
          return;
        }

        if (!profile) {
          clearStoredAuth();
          setCurrentProfile(null);
          return;
        }

        setStoredProfile(profile);
        setStoredMode('supabase');
        setMode('supabase');
        setCurrentProfile(profile);

        try {
          await loadSupabaseData(profile);
        } catch (dataErr) {
          console.warn('Background Supabase data load error:', dataErr);
          // Keep the user logged in even if background data sync encounters an issue
        }
      } catch (sessionError) {
        console.warn('Session restoration error:', sessionError);
        if (!getStoredProfile() && active) {
          setCurrentProfile(null);
        }
      } finally {
        isRestoringRef.current = false;
        if (active) {
          setIsInitializing(false);
          setIsLoading(false);
        }
      }
    }

    restoreSession();

    const authListener = supabase?.auth.onAuthStateChange(async (event, session) => {
      if (!active) return;

      if (event === 'SIGNED_OUT' || !session?.user) {
        clearStoredAuth();
        setCurrentProfile(null);
        setIsInitializing(false);
        setIsLoading(false);
        return;
      }

      if (isRestoringRef.current) {
        return;
      }

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        try {
          const profile = await fetchProfile(session.user.id);
          if (!active) return;
          if (profile) {
            setStoredProfile(profile);
            setStoredMode('supabase');
            setMode('supabase');
            setCurrentProfile(profile);
            await loadSupabaseData(profile);
          }
        } catch (authError) {
          console.warn('onAuthStateChange error:', authError);
        } finally {
          if (active) {
            setIsInitializing(false);
            setIsLoading(false);
          }
        }
      }
    });

    return () => {
      active = false;
      authListener?.data.subscription.unsubscribe();
    };
  }, [fetchProfile, loadSupabaseData]);

  useEffect(() => {
    const supabaseClient = supabase;

    if (!supabaseClient || mode !== 'supabase' || !currentProfile) {
      return undefined;
    }

    const subscription = subscribeToNotifications({
      userId: currentProfile.id,
      onInserted: (notification) => {
        setData((previous) => {
          const exists = previous.notifications.some((item) => item.id === notification.id);

          return {
            ...previous,
            notifications: exists
              ? previous.notifications
              : [notification, ...previous.notifications].sort(
                  (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
                ),
          };
        });
        setNotificationToast(notification);
        notifyWithSoundAndVoice('notification', notification.title, notification.message);
      },
      onUpdated: (notification) => {
        setData((previous) => ({
          ...previous,
          notifications: previous.notifications.map((item) => (item.id === notification.id ? notification : item)),
        }));
      },
    });

    return () => {
      if (subscription) {
        supabaseClient.removeChannel(subscription);
      }
    };
  }, [currentProfile, mode]);

  useEffect(() => {
    const supabaseClient = supabase;

    if (!supabaseClient || mode !== 'supabase' || !currentProfile) {
      return undefined;
    }

    // Realtime synchronization for cross-panel messaging.
    // The corresponding tables are included in the Supabase Realtime publication
    // by the complete_role_messaging migration.
    const subscription = supabaseClient
      .channel(`realtime-chat-sync:${currentProfile.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conversations' },
        (payload) => {
          const conversation = payload.new as Conversation;
          if (!conversation?.id) return;
          setData((prev) => ({
            ...prev,
            conversations: (prev.conversations || []).some((item) => item.id === conversation.id)
              ? prev.conversations
              : [...(prev.conversations || []), conversation],
          }));
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const newMsg = payload.new as ChatMessage;
          if (!newMsg?.id) return;

          setData((prev) => {
            const exists = (prev.messages || []).some((m) => m.id === newMsg.id);
            if (exists) return prev;

            if (newMsg.sender_id !== currentProfile.id) {
              const sender = (prev.profiles || []).find((p) => p.id === newMsg.sender_id);
              const senderName = sender?.full_name || 'Team Member';
              notifyWithSoundAndVoice('message', senderName, newMsg.body);
            }

            return {
              ...prev,
              messages: [...(prev.messages || []), newMsg],
            };
          });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversation_members' },
        (payload) => {
          const eventType = payload.eventType;
          const updatedMember = payload.new as ConversationMember;
          const previousMember = payload.old as ConversationMember;
          const member = eventType === 'DELETE' ? previousMember : updatedMember;
          if (!member?.id) return;

          setData((prev) => {
            const members = prev.conversationMembers || [];
            if (eventType === 'DELETE') {
              return {
                ...prev,
                conversationMembers: members.filter((item) => item.id !== member.id),
              };
            }

            const idx = members.findIndex(
              (item) =>
                item.id === member.id ||
                (item.conversation_id === member.conversation_id && item.user_id === member.user_id),
            );
            if (idx >= 0) {
              const next = [...members];
              next[idx] = member;
              return { ...prev, conversationMembers: next };
            }
            return { ...prev, conversationMembers: [...members, member] };
          });

          // A newly-created DM is inserted before its membership rows. When this
          // user's membership arrives, refresh once so the conversation itself
          // and any first message are immediately available in this panel.
          if (
            (eventType === 'INSERT' || eventType === 'DELETE') &&
            member.user_id === currentProfile.id
          ) {
            void loadSupabaseData(currentProfile);
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_attachments' },
        (payload) => {
          const attachment = payload.new as MessageAttachment;
          if (!attachment?.id) return;
          setData((prev) => ({
            ...prev,
            messageAttachments: (prev.messageAttachments || []).some((item) => item.id === attachment.id)
              ? prev.messageAttachments
              : [...(prev.messageAttachments || []), attachment],
          }));
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_mentions' },
        (payload) => {
          const mention = payload.new as MessageMention;
          if (!mention?.id) return;
          setData((prev) => ({
            ...prev,
            messageMentions: (prev.messageMentions || []).some((item) => item.id === mention.id)
              ? prev.messageMentions
              : [...(prev.messageMentions || []), mention],
          }));
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_reactions' },
        () => {
          void safeSelect<MessageReaction>(supabaseClient.from('message_reactions').select('*')).then((res) => {
            if (res.data) {
              setData((prev) => ({ ...prev, messageReactions: res.data }));
            }
          });
        },
      )
      .subscribe();

    return () => {
      supabaseClient.removeChannel(subscription);
    };
  }, [currentProfile, loadSupabaseData, mode]);

  useEffect(() => {
    const supabaseClient = supabase;

    if (!supabaseClient || mode !== 'supabase' || !currentProfile) {
      return undefined;
    }

    // A client submits a revision in a separate session. Refresh the project
    // list when either the request or its project is changed so dashboard cards
    // immediately show the new revision stage for admin, managers, and staff.
    const subscription = supabaseClient
      .channel(`project-revision-sync:${currentProfile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'revision_requests' }, () => {
        void loadSupabaseData(currentProfile);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'projects' }, () => {
        void loadSupabaseData(currentProfile);
      })
      .subscribe();

    return () => {
      supabaseClient.removeChannel(subscription);
    };
  }, [currentProfile, loadSupabaseData, mode]);

  const login = useCallback(
    async (loginName: string, password: string) => {
      setError(null);
      const cleanLoginName = loginName.trim();

      if (!cleanLoginName) {
        const message = 'Please enter your first name.';
        setError(message);
        throw new Error(message);
      }

      if (!supabase) {
        const profile = sampleProfiles.find((item) => profileMatchesLoginName(item, cleanLoginName)) || sampleProfiles[0];
        setStoredProfile(profile);
        setStoredMode('demo');
        setMode('demo');
        setCurrentProfile(profile);
        setIsLoading(false);
        setIsInitializing(false);
        return;
      }

      setIsSubmittingLogin(true);
      setIsLoading(true);
      try {
        if (!cleanLoginName.includes('@')) throw new Error('Enter your account email address.');
        const email = cleanLoginName;

        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (authError || !authData.user) {
          throw authError || new Error('Login failed.');
        }

        const profile = await fetchProfile(authData.user.id);
        if (!profile) {
          throw new Error('This user does not have a profile record yet.');
        }

        setStoredProfile(profile);
        setStoredMode('supabase');
        setMode('supabase');
        setCurrentProfile(profile);
        await loadSupabaseData(profile);
      } catch (loginError) {
        const message = loginErrorMessage(loginError);
        setError(message);
        throw new Error(message);
      } finally {
        setIsSubmittingLogin(false);
        setIsLoading(false);
      }
    },
    [fetchProfile, loadSupabaseData],
  );

  const loginDemo = useCallback((role: Role) => {
    const profile = sampleProfiles.find((item) => item.role === role) || sampleProfiles[0];
    setStoredProfile(profile);
    setStoredMode('demo');
    setMode('demo');
    setCurrentProfile(profile);
    setData(sampleData);
    setError(null);
    setIsLoading(false);
    setIsInitializing(false);
  }, []);

  const signUp = useCallback(
    async ({
      fullName,
      email,
      password,
      role = 'employee',
    }: {
      fullName: string;
      email: string;
      password: string;
      role: Role;
    }): Promise<{ profile: Profile | null; requiresConfirmation: boolean }> => {
      setError(null);
      const cleanFullName = fullName.trim();
      const cleanEmail = email.trim().toLowerCase();

      if (!cleanFullName) {
        const msg = 'Please enter full name.';
        setError(msg);
        throw new Error(msg);
      }

      if (!cleanEmail || !cleanEmail.includes('@')) {
        const msg = 'Please enter a valid email address.';
        setError(msg);
        throw new Error(msg);
      }

      if (!password || password.length < 6) {
        const msg = 'Password must be at least 6 characters.';
        setError(msg);
        throw new Error(msg);
      }

      if (!supabase) {
        const newId = createUuid();
        const newProfile: Profile = {
          id: newId,
          full_name: cleanFullName,
          email: cleanEmail,
          role,
          status: 'active',
          created_at: new Date().toISOString(),
        };

        sampleProfiles.push(newProfile);
        setData((prev) => ({
          ...prev,
          profiles: [...prev.profiles.filter((p) => p.email !== cleanEmail), newProfile],
        }));

        setStoredProfile(newProfile);
        setStoredMode('demo');
        setMode('demo');
        setCurrentProfile(newProfile);
        setIsLoading(false);
        setIsInitializing(false);
        return { profile: newProfile, requiresConfirmation: false };
      }

      setIsSubmittingLogin(true);
      setIsLoading(true);
      try {
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              full_name: cleanFullName,
            },
          },
        });

        if (authError) {
          throw authError;
        }

        if (!authData.user) {
          throw new Error('User creation failed in Supabase Auth.');
        }

        const userId = authData.user.id;
        const profileObj: Profile = {
          id: userId,
          full_name: cleanFullName,
          email: cleanEmail,
          role: 'client',
          status: 'active',
          created_at: new Date().toISOString(),
        };

        // The trusted Auth trigger creates the profile and applies any exact
        // pre-provisioned team role. Signup metadata never assigns a role.
        if (authData.session) {
          const fetchedProfile = (await fetchProfile(userId)) || profileObj;
          setStoredProfile(fetchedProfile);
          setStoredMode('supabase');
          setMode('supabase');
          setCurrentProfile(fetchedProfile);
          await loadSupabaseData(fetchedProfile);
          return { profile: fetchedProfile, requiresConfirmation: false };
        }

        return { profile: profileObj, requiresConfirmation: true };
      } catch (err: any) {
        const msg = signupErrorMessage(err);
        setError(msg);
        throw new Error(msg);
      } finally {
        setIsSubmittingLogin(false);
        setIsLoading(false);
      }
    },
    [fetchProfile, loadSupabaseData],
  );


  const signOut = useCallback(async () => {
    try {
      if (supabase && mode === 'supabase') {
        await supabase.auth.signOut();
      }
    } catch (err) {
      console.warn('Sign out warning:', err);
    } finally {
      clearStoredAuth();
      setCurrentProfile(null);
      setData(sampleData);
      setMode(supabase ? 'supabase' : 'demo');
      setIsLoading(false);
      setIsInitializing(false);
    }
  }, [mode]);

  const addActivity = useCallback(
    async (entry: Omit<ActivityLog, 'id' | 'created_at' | 'user_id'>) => {
      if (!currentProfile) throw new Error('No signed-in profile found for activity logging.');
      const activity: ActivityLog = {
        ...entry,
        id: createId('activity'),
        user_id: currentProfile.id,
        created_at: new Date().toISOString(),
      };

      if (supabase && mode === 'supabase') {
        const { error: activityError } = await supabase.from('activity_logs').insert({
          project_id: activity.project_id || null,
          action: activity.action,
          old_value: activity.old_value || null,
          new_value: activity.new_value || null,
          user_id: currentProfile.id,
        });
        if (activityError) throw activityError;
      }

      setData((previous) => ({
        ...previous,
        activityLogs: [activity, ...previous.activityLogs],
      }));
    },
    [currentProfile, mode],
  );

  const createProject = useCallback(
    async (draft: ProjectDraft) => {
      if (!currentProfile) {
        return null;
      }

      const isCanonicalCreation = Boolean(supabase && mode === 'supabase');
      if (isCanonicalCreation && !canManageEverything(currentProfile)) {
        throw new Error('Only Admin or Project Manager users can create a canonical project.');
      }
      if (isCanonicalCreation &&
          (typeof draft.requires_print !== 'boolean' || typeof draft.requires_ebook !== 'boolean')) {
        throw new Error('Confirm both Print and eBook capabilities before creating the project.');
      }
      if (isCanonicalCreation && !draft.requires_print && !draft.requires_ebook) {
        throw new Error('A project must require Print, eBook, or both.');
      }

      const now = new Date().toISOString();
      const timelineErrors = validateTimelineDates(draft);
      if (timelineErrors.length) {
        throw new Error(timelineErrors[0]);
      }

      const autoSkipped = isCanonicalCreation ? [] : getAutoSkippedStagesForServiceType(draft.service_type);
      const stageStates: Record<string, StageData> = { ...(draft.stage_states || {}) };
      autoSkipped.forEach((stg) => {
        stageStates[stg] = {
          stage: stg,
          status: 'SKIPPED',
          started_at: now,
          paused_at: null,
          resumed_at: null,
          completed_at: now,
          due_at: null,
          active_seconds: 0,
          client_wait_seconds: 0,
          pause_reason: null,
          revision_count: 0,
          skip_reason: `Pre-configured by service type (${draft.service_type || 'Preset'})`,
        };
      });

      const timelineDraft = isCanonicalCreation
        ? draft
        : deriveProjectTimeline({ ...draft, stage_states: stageStates }, { syncStatus: true });
      const localProject: Project = normalizeProject({
        ...timelineDraft,
        stage_states: stageStates,
        id: createId('project'),
        project_number: timelineDraft.project_number || `MH-${1001 + data.projects.length}`,
        created_by: currentProfile.id,
        created_at: now,
        updated_at: now,
        remaining_balance: calculateBalance(timelineDraft.total_price, timelineDraft.advance_paid),
      });

      if (supabase && mode === 'supabase') {
        const requiresPrint = draft.requires_print as boolean;
        const requiresEbook = draft.requires_ebook as boolean;
        const payload = definedValues(projectMetadataPayload(localProject));

        const { data: inserted, error: insertError } = await supabase
          .from('projects')
          .insert({
            ...payload,
            created_by: currentProfile.id,
            project_status: 'active',
            workflow_stage_key: 'files_received',
            workflow_stage_status_key: 'pending',
            workflow_waiting_on_key: 'none',
            workflow_version: 0,
            requires_print: requiresPrint,
            requires_ebook: requiresEbook,
            service_capability_status: 'confirmed',
            capabilities_resolved_by: currentProfile.id,
            capabilities_resolved_at: now,
            workflow_settings: canonicalSettings(draft.workflow_settings),
            production_seconds_total: 0,
            client_wait_seconds_total: 0,
            revision_count: 0,
            stage_started_at: null,
            stage_due_at: null,
            stage_completed_at: null,
            final_due_at: null,
            delivered_at: null,
            status: 'New',
            current_stage: 'Files Received',
            stage_status: 'PENDING',
            waiting_on: 'None',
            timeline_status: 'Paused',
            progress_percentage: 0,
            client_action_required: '',
            production_days_used: 0,
            production_time_used: 0,
            client_wait_time: 0,
          })
          .select()
          .single();

        if (insertError) throw insertError;
        const insertedProject = inserted as Project;

        const projectPayment = paymentPayload(localProject);
        await upsertProjectPayment(insertedProject.id, localProject);

        const project = normalizeProject({
          ...localProject,
          ...insertedProject,
          total_price: projectPayment.total_price,
          advance_paid: projectPayment.advance_paid,
          payment_status: projectPayment.payment_status,
          payment_date: projectPayment.payment_date,
          payment_notes: projectPayment.notes,
        });

        setData((previous) => ({ ...previous, projects: [project, ...previous.projects] }));
        await addActivity({
          project_id: project.id,
          action: 'Project created',
          old_value: null,
          new_value: project.project_title,
        });
        await addActivity({
          project_id: project.id,
          action: 'Timeline started',
          old_value: null,
          new_value: project.current_stage || project.status,
        });
        return project;
      }

      setData((previous) => ({ ...previous, projects: [localProject, ...previous.projects] }));
      await addActivity({
        project_id: localProject.id,
        action: 'Project created',
        old_value: null,
        new_value: localProject.project_title,
      });
      await addActivity({
        project_id: localProject.id,
        action: 'Timeline started',
        old_value: null,
        new_value: localProject.current_stage || localProject.status,
      });
      return localProject;
    },
    [addActivity, currentProfile, data.projects.length, mode],
  );

  const updateProject = useCallback(
    async (projectId: string, updates: ProjectMetadataUpdate) => {
      if (!currentProfile) {
        throw new Error('No signed-in profile found.');
      }

      const existing = data.projects.find((project) => project.id === projectId);
      if (!existing) {
        throw new Error('Project not found in the current project list.');
      }

      const nextProject = normalizeProject({
        ...existing,
        ...updates,
        start_date: updates.start_date ?? existing.start_date,
        due_date: updates.due_date ?? existing.due_date,
        internal_deadline: updates.internal_deadline ?? existing.internal_deadline,
        updated_at: new Date().toISOString(),
      });

      if (supabase && mode === 'supabase') {
        const payload = definedValues(projectMetadataPayload(updates));
        const { data: updatedData, error: updateError } = await supabase
          .from('projects').update(payload).eq('id', projectId).select().maybeSingle();
        if (updateError) throw updateError;
        if (!updatedData) throw new Error('No project metadata row was updated. Check project permissions.');

        const hasPaymentUpdate = paymentFieldsChanged(existing, nextProject);

        if (hasPaymentUpdate && canManageEverything(currentProfile)) {
          await upsertProjectPayment(projectId, nextProject);
        }

        const project = normalizeProject({
          ...nextProject,
          ...(updatedData as Project),
        });
        setData((previous) => ({
          ...previous,
          projects: previous.projects.map((item) => (item.id === projectId ? project : item)),
        }));
      } else {
        setData((previous) => ({
          ...previous,
          projects: previous.projects.map((item) => (item.id === projectId ? nextProject : item)),
        }));
      }

      if (updates.assigned_to && updates.assigned_to !== existing.assigned_to) {
        await addActivity({
          project_id: projectId,
          action: 'Assigned to employee',
          old_value: existing.assigned_to,
          new_value: updates.assigned_to,
        });
      }

      if (supabase && mode === 'supabase') {
        await loadSupabaseData(currentProfile);
      }

      return nextProject;
    },
    [addActivity, currentProfile, data.projects, loadSupabaseData, mode],
  );

  const archiveProject = useCallback(
    async (projectId: string, reason: string) => {
      if (!currentProfile || currentProfile.role !== 'admin') {
        throw new Error('Only admins can archive or remove projects.');
      }
      const trimmedReason = (reason || '').trim();
      if (!trimmedReason) {
        throw new Error('A reason is required to archive or remove a project.');
      }

      const project = data.projects.find((item) => item.id === projectId);
      if (!project) {
        throw new Error('Project not found.');
      }

      const canonicalLifecycle = (project.project_status || 'active') as ProjectLifecycleStatus;
      if (canonicalLifecycle === 'archived') {
        throw new Error('This project is already archived.');
      }

      if (supabase && mode === 'supabase') {
        if (!workflowClient) {
          throw new Error('Canonical workflow client is unavailable.');
        }

        let currentVersion = requireWorkflowVersion(project);

        if (canonicalLifecycle === 'active' || canonicalLifecycle === 'on_hold') {
          // Mutation #1: Cancel project using current workflow version
          const cancelResult = await workflowClient.setLifecycle(
            projectId,
            currentVersion,
            'cancelled',
            trimmedReason,
          );

          // Use the workflow_version RETURNED by mutation #1
          currentVersion = cancelResult.workflow_version;

          // Mutation #2: Archive project using that returned workflow_version
          try {
            await workflowClient.setLifecycle(
              projectId,
              currentVersion,
              'archived',
              trimmedReason,
            );
          } catch (archiveError) {
            // Cancellation succeeded, but archival failed.
            // Do NOT claim success. Reload canonical project data so state reflects 'cancelled'.
            await loadSupabaseData(currentProfile);
            throw new Error(
              `Project was successfully cancelled, but archiving failed (${formatWorkflowErrorMessage(archiveError)}). You may retry archiving directly.`
            );
          }
        } else if (canonicalLifecycle === 'completed' || canonicalLifecycle === 'cancelled') {
          // Direct archive mutation
          await workflowClient.setLifecycle(
            projectId,
            currentVersion,
            'archived',
            trimmedReason,
          );
        } else {
          throw new Error(`Cannot archive project from lifecycle status: ${canonicalLifecycle}`);
        }

        await loadSupabaseData(currentProfile);
      } else {
        // Demo mode fallback
        setData((previous) => ({
          ...previous,
          projects: previous.projects.map((p) =>
            p.id === projectId
              ? { ...p, project_status: 'archived', status: 'Cancelled' }
              : p
          ),
        }));
      }
    },
    [currentProfile, data.projects, loadSupabaseData, mode, workflowClient],
  );

  /**
   * @deprecated Physical SQL deletion is removed in Phase 6. Use archiveProject instead.
   */
  const deleteProject = useCallback(
    async (projectId: string, reason?: string) => {
      return archiveProject(projectId, reason || 'Project removed by administrator');
    },
    [archiveProject],
  );

  const deletePayment = useCallback(
    async (projectId: string) => {
      if (!currentProfile || currentProfile.role !== 'admin') {
        throw new Error('Only admins can delete payment records.');
      }

      if (supabase && mode === 'supabase') {
        const { error: deleteError } = await supabase.from('project_payments').delete().eq('project_id', projectId);
        if (deleteError) {
          throw deleteError;
        }

        await loadSupabaseData(currentProfile);
        return;
      }

      setData((previous) => ({
        ...previous,
        projects: previous.projects.map((project) =>
          project.id === projectId
            ? normalizeProject({
                ...project,
                total_price: 0,
                advance_paid: 0,
                payment_status: 'Not Started',
                payment_date: null,
                payment_notes: '',
              })
            : project,
        ),
      }));
    },
    [currentProfile, loadSupabaseData, mode],
  );

  const duplicateProject = useCallback(
    async (project: Project) => {
      const { id, project_number, created_at, updated_at, remaining_balance, ...draft } = project;
      void id;
      void project_number;
      void created_at;
      void updated_at;
      void remaining_balance;

      return createProject({
        ...draft,
        project_title: `${project.project_title} Copy`,
        status: 'New',
        delivery_date: null,
      });
    },
    [createProject],
  );

  const addRevision = useCallback(
    async (projectId: string, note: string, status: RevisionStatus) => {
      if (!currentProfile) {
        return null;
      }

      const revisionNumber =
        data.revisionNotes.filter((revision) => revision.project_id === projectId).length + 1;
      const revision: RevisionNote = {
        id: createId('revision'),
        project_id: projectId,
        revision_number: revisionNumber,
        note,
        status,
        added_by: currentProfile.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (supabase && mode === 'supabase') {
        const { data: inserted, error: insertError } = await supabase
          .from('revision_notes')
          .insert({
            project_id: projectId,
            revision_number: revisionNumber,
            note,
            status,
            added_by: currentProfile.id,
          })
          .select()
          .single();

        if (insertError) {
          throw insertError;
        }

        setData((previous) => ({
          ...previous,
          revisionNotes: [inserted as RevisionNote, ...previous.revisionNotes],
        }));
      } else {
        setData((previous) => ({
          ...previous,
          projects: previous.projects.map((p) =>
            p.id === projectId
              ? normalizeProject({
                  ...p,
                  status: 'In Revision',
                  waiting_on: 'Manuscript Heaven',
                  updated_at: new Date().toISOString(),
                })
              : p,
          ),
          revisionNotes: [revision, ...previous.revisionNotes],
        }));
      }

      await addActivity({
        project_id: projectId,
        action: 'Revision added',
        old_value: null,
        new_value: `Revision ${revisionNumber}`,
      });

      return revision;
    },
    [addActivity, currentProfile, data.revisionNotes, mode],
  );

  const addNote = useCallback(
    async (projectId: string, noteType: NoteType, note: string) => {
      if (!currentProfile) {
        return null;
      }

      const projectNote: ProjectNote = {
        id: createId('note'),
        project_id: projectId,
        note_type: noteType,
        note,
        added_by: currentProfile.id,
        created_at: new Date().toISOString(),
      };

      if (supabase && mode === 'supabase') {
        const { data: inserted, error: insertError } = await supabase
          .from('project_notes')
          .insert({
            project_id: projectId,
            note_type: noteType,
            note,
            added_by: currentProfile.id,
          })
          .select()
          .single();

        if (insertError) {
          throw insertError;
        }

        setData((previous) => ({
          ...previous,
          projectNotes: [inserted as ProjectNote, ...previous.projectNotes],
        }));
      } else {
        setData((previous) => ({
          ...previous,
          projectNotes: [projectNote, ...previous.projectNotes],
        }));
      }

      await addActivity({
        project_id: projectId,
        action: 'Notes added',
        old_value: null,
        new_value: noteType,
      });

      return projectNote;
    },
    [addActivity, currentProfile, mode],
  );

  const createRevisionRequest = useCallback(
    async (draft: RevisionRequestDraft) => {
      if (!currentProfile || !isClientRole(currentProfile.role)) throw new Error('Only client users can submit client revision requests.');
      const project = data.projects.find((item) => item.id === draft.project_id);
      if (!project) throw new Error('Project not found for this client.');
      const instructions = draft.instructions?.trim() || draft.description?.trim() || '';
      if (!instructions) throw new Error('Please add revision instructions before submitting.');
      if (!workflowClient || mode !== 'supabase') throw new Error('Canonical workflow mutations require Supabase mode.');
      const rpcInput = {
        title: draft.title?.trim() || '', instructions,
        description: draft.description?.trim() || '', priority: draft.priority || 'Normal',
      };
      const operationKey = await operationFingerprint({
        projectId: project.id, rpcInput,
        attachments: (draft.attachments || []).map((file,index)=>fileFingerprint(file,index)),
      });
      let operation = revisionSubmissionRetriesRef.current.get(operationKey);
      if (!operation) {
        operation = { attachments: new Map(), complete: false };
        revisionSubmissionRetriesRef.current.set(operationKey, operation);
      }
      if (!operation.requestId) {
        const result = await workflowClient.submitClientRevision(project.id, requireWorkflowVersion(project), rpcInput);
        const returnedId = String(result.affected_entity_ids.revision_request_id || '');
        if (!returnedId) throw new Error('Canonical revision submission returned no revision request ID.');
        operation.requestId = returnedId;
      }
      const requestId = operation.requestId;
      for (const [index,file] of (draft.attachments || []).entries()) {
        const attachmentKey=fileFingerprint(file,index);
        const progress=operation.attachments.get(attachmentKey) || {
          attachmentId:createUuid(),uploaded:false,insertAttempted:false,inserted:false,
        };
        operation.attachments.set(attachmentKey,progress);
        if (!progress.uploaded) {
          progress.storagePath=await uploadRevisionFile({
            clientId:currentProfile.id,projectId:project.id,requestId,file,objectId:progress.attachmentId,
          });
          progress.uploaded=true;
        }
        if (!progress.inserted) {
          await ensureRevisionAttachment(progress,{
            id:progress.attachmentId,revision_request_id:requestId,revision_item_id:null,
            file_name:file.name,file_url:progress.storagePath!,file_type:'client_attachment',uploaded_by:currentProfile.id,
          });
        }
      }
      operation.complete=true;
      await loadSupabaseData(currentProfile);
      revisionSubmissionRetriesRef.current.delete(operationKey);
      return normalizeRevisionRequest({id:requestId,project_id:project.id,client_id:currentProfile.id,
        title:draft.title?.trim() || ('Revision request for '+project.project_title),description:instructions,
        instructions,priority:draft.priority || 'Normal',status:'Submitted'});
    },
    [currentProfile, data.projects, loadSupabaseData, mode, workflowClient],
  );

  const updateRevisionRequest = useCallback(
    async (requestId: string, updates: Partial<Pick<RevisionRequest, 'assigned_to' | 'priority' | 'team_response'>>) => {
      if (!currentProfile) throw new Error('No signed-in profile found.');
      if (supabase && mode === 'supabase') {
        const {error}=await supabase.from('revision_requests').update(definedValues({
          assigned_to:updates.assigned_to,priority:updates.priority,team_response:updates.team_response,
        })).eq('id',requestId);
        if(error) throw error;
        await loadSupabaseData(currentProfile);
        return;
      }
      setData((previous)=>({...previous,revisionRequests:previous.revisionRequests.map((request)=>
        request.id===requestId?{...request,...updates,updated_at:new Date().toISOString()}:request)}));
    },
    [currentProfile, loadSupabaseData, mode],
  );

  const updateRevisionItem = useCallback(
    async (itemId: string, updates: Partial<RevisionItem>) => {
      if (!currentProfile) {
        throw new Error('No signed-in profile found.');
      }

      if (supabase && mode === 'supabase') {
        const { error } = await supabase
          .from('revision_items')
          .update({
            status: updates.status,
            team_response: updates.team_response,
            internal_note: updates.internal_note,
          })
          .eq('id', itemId);

        if (error) {
          throw error;
        }

        await loadSupabaseData(currentProfile);
        return;
      }

      setData((previous) => ({
        ...previous,
        revisionItems: previous.revisionItems.map((item) =>
          item.id === itemId
            ? normalizeRevisionItem({
                ...item,
                ...updates,
                updated_at: new Date().toISOString(),
              })
            : item,
        ),
      }));
    },
    [currentProfile, loadSupabaseData, mode],
  );

  const uploadRevisedProof = useCallback(
    async (requestId: string, file: File, teamResponse?: string) => {
      if (!currentProfile) throw new Error('No signed-in profile found.');
      const request=data.revisionRequests.find((item)=>item.id===requestId);
      const project=request && data.projects.find((item)=>item.id===request.project_id);
      if(!request||!project) throw new Error('Revision request or project not found.');
      if (!workflowClient || mode !== 'supabase') throw new Error('Canonical workflow mutations require Supabase mode.');
      const response=teamResponse?.trim()||null;
      const operationKey=await operationFingerprint({requestId,file:fileFingerprint(file),teamResponse:response});
      let operation=revisedProofRetriesRef.current.get(operationKey);
      if(!operation){
        operation={attachment:{attachmentId:createUuid(),uploaded:false,insertAttempted:false,inserted:false},rpcComplete:false};
        revisedProofRetriesRef.current.set(operationKey,operation);
      }
      if(!operation.attachment.uploaded){
        operation.attachment.storagePath=await uploadRevisionFile({
          clientId:request.client_id,projectId:project.id,requestId,file,objectId:operation.attachment.attachmentId,
        });
        operation.attachment.uploaded=true;
      }
      if(!operation.attachment.inserted){
        await ensureRevisionAttachment(operation.attachment,{
          id:operation.attachment.attachmentId,revision_request_id:requestId,revision_item_id:null,
          file_name:file.name,file_url:operation.attachment.storagePath!,file_type:'revised_proof',uploaded_by:currentProfile.id,
        });
      }
      if(!operation.rpcComplete){
        await workflowClient.submitRevisedProof(project.id,requireWorkflowVersion(project),requestId,response);
        operation.rpcComplete=true;
      }
      await loadSupabaseData(currentProfile);
      revisedProofRetriesRef.current.delete(operationKey);
    },
    [currentProfile, data.projects, data.revisionRequests, loadSupabaseData, mode, workflowClient],
  );

  const respondToRevisionRequest = useCallback(
    async (requestId: string, decision: Extract<ClientRevisionStatus, 'Approved'>) => {
      if(!currentProfile||decision!=='Approved') throw new Error('Only canonical approval is supported here.');
      const request=data.revisionRequests.find((item)=>item.id===requestId);
      const project=request && data.projects.find((item)=>item.id===request.project_id);
      if(!project) throw new Error('Revision project not found.');
      if(!workflowClient||mode!=='supabase') throw new Error('Canonical workflow mutations require Supabase mode.');
      await workflowClient.approveStage(project.id,requireWorkflowVersion(project),'Client approved revised proof');
      await loadSupabaseData(currentProfile);
    },
    [currentProfile,data.projects,data.revisionRequests,loadSupabaseData,mode,workflowClient],
  );

  const approveProjectMilestone = useCallback(
    async (projectId: string, milestone: ApprovalMilestone) => {
      if(!currentProfile) throw new Error('No signed-in profile found.');
      const project=data.projects.find((item)=>item.id===projectId);
      if(!project) throw new Error('Project not found.');
      if(!workflowClient||mode!=='supabase') throw new Error('Canonical workflow mutations require Supabase mode.');
      await workflowClient.approveStage(projectId,requireWorkflowVersion(project),'Client approved '+milestone);
      await loadSupabaseData(currentProfile);
    },
    [currentProfile,data.projects,loadSupabaseData,mode,workflowClient],
  );

  const submitStageForApproval = useCallback(
    async (projectId: string, submissionNote?: string, fileUrl?: string) => {
      if(!currentProfile) throw new Error('No signed-in profile found.');
      const project=data.projects.find((item)=>item.id===projectId);
      if(!project) throw new Error('Project not found.');
      if(!workflowClient||mode!=='supabase') throw new Error('Canonical workflow mutations require Supabase mode.');
      if(fileUrl?.trim()) {
        const stage=project.workflow_stage_key;
        const field:keyof ProjectMetadataUpdate= stage==='ebook_version'?'final_ebook_link':stage==='final_delivery'?'final_print_pdf_link':stage==='design_concept'?'cover_file_link':'proof_pdf_link';
        await updateProject(projectId,{[field]:fileUrl.trim(),...(submissionNote?.trim()?{delivery_notes:submissionNote.trim()}:{})});
      }
      if(project.workflow_stage_key==='final_delivery')
        await workflowClient.completeFinalDelivery(projectId,requireWorkflowVersion(project),submissionNote?.trim()||null);
      else
        await workflowClient.submitStageForApproval(projectId,requireWorkflowVersion(project),submissionNote?.trim()||null);
      await loadSupabaseData(currentProfile);
    },
    [currentProfile,data.projects,loadSupabaseData,mode,updateProject,workflowClient],
  );

  const requestStageSkip = useCallback(
    async (projectId: string, stage: OfficialTimelineStage, reason: string) => {
      if(!currentProfile||!reason.trim()) throw new Error('Please provide a reason for skipping this stage.');
      const project=data.projects.find((item)=>item.id===projectId);
      if(!project) throw new Error('Project not found.');
      if(!workflowClient||mode!=='supabase') throw new Error('Canonical workflow mutations require Supabase mode.');
      const result=await workflowClient.requestStageSkip(projectId,requireWorkflowVersion(project),toWorkflowStage(stage),reason.trim());
      await loadSupabaseData(currentProfile);
      return result;
    },
    [currentProfile,data.projects,loadSupabaseData,mode,workflowClient],
  );

  const respondToStageSkip = useCallback(
    async (requestId: string, approved: boolean, clientNotes?: string) => {
      if(!currentProfile) throw new Error('No signed-in profile found.');
      const skip=(data.stageSkipRequests||[]).find((item)=>item.id===requestId);
      const project=skip && data.projects.find((item)=>item.id===skip.project_id);
      if(!skip||!project) throw new Error('Skip request or project not found.');
      if(!workflowClient||mode!=='supabase') throw new Error('Canonical workflow mutations require Supabase mode.');
      await workflowClient.respondStageSkip(project.id,requireWorkflowVersion(project),requestId,approved?'approved':'rejected',clientNotes?.trim()||null);
      await loadSupabaseData(currentProfile);
    },
    [currentProfile,data.projects,data.stageSkipRequests,loadSupabaseData,mode,workflowClient],
  );

  const adminWorkflowOverride = useCallback(
    async (projectId: string, newStage: TimelineStage, reason: string, explanation: string) => {
      if(!currentProfile||currentProfile.role!=='admin') throw new Error('Administrative Workflow Override is strictly restricted to Admin users.');
      if(!reason.trim()||!explanation.trim()) throw new Error('Please provide both a reason and explanation for the administrative override.');
      const project=data.projects.find((item)=>item.id===projectId);
      if(!project) throw new Error('Project not found.');
      if(newStage==='Completed') throw new Error('Use final delivery completion instead of an administrative Completed override.');
      if(!workflowClient||mode!=='supabase') throw new Error('Canonical workflow mutations require Supabase mode.');
      const stage=toWorkflowStage(newStage);
      const approval=stage==='concept_approval'||stage==='print_approval'||stage==='ebook_approval';
      await workflowClient.adminOverride(projectId,requireWorkflowVersion(project),{
        lifecycle:'active',stage,stageStatus:approval?'awaiting_client':'active',waitingOn:approval?'client':'team',
        reason:reason.trim(),explanation:explanation.trim(),
      });
      await loadSupabaseData(currentProfile);
    },
    [currentProfile,data.projects,loadSupabaseData,mode,workflowClient],
  );

  const advanceWorkflowStage = useCallback(async (projectId: string, note?: string) => {
    if(!currentProfile||!workflowClient||mode!=='supabase') throw new Error('Canonical workflow mutations require Supabase mode.');
    const project=data.projects.find((item)=>item.id===projectId);
    if(!project) throw new Error('Project not found.');
    await workflowClient.advanceStage(projectId,requireWorkflowVersion(project),note?.trim()||null);
    await loadSupabaseData(currentProfile);
  },[currentProfile,data.projects,loadSupabaseData,mode,workflowClient]);

  const completeFinalDelivery = useCallback(async (projectId: string, note?: string) => {
    if(!currentProfile||!workflowClient||mode!=='supabase') throw new Error('Canonical workflow mutations require Supabase mode.');
    const project=data.projects.find((item)=>item.id===projectId);
    if(!project) throw new Error('Project not found.');
    await workflowClient.completeFinalDelivery(projectId,requireWorkflowVersion(project),note?.trim()||null);
    await loadSupabaseData(currentProfile);
  },[currentProfile,data.projects,loadSupabaseData,mode,workflowClient]);

  const setProjectLifecycle = useCallback(async (projectId: string, lifecycle: ProjectLifecycleStatus, reason?: string) => {
    if(!currentProfile||!workflowClient||mode!=='supabase') throw new Error('Canonical workflow mutations require Supabase mode.');
    const project=data.projects.find((item)=>item.id===projectId);
    if(!project) throw new Error('Project not found.');
    if(lifecycle==='completed') throw new Error('Use final delivery completion to complete a project.');
    await workflowClient.setLifecycle(projectId,requireWorkflowVersion(project),lifecycle,reason?.trim()||null);
    await loadSupabaseData(currentProfile);
  },[currentProfile,data.projects,loadSupabaseData,mode,workflowClient]);

  const updateWorkflowConfiguration = useCallback(async (
    projectId:string,requiresPrint:boolean,requiresEbook:boolean,settings:WorkflowSettings,
  )=>{
    if(!currentProfile||!workflowClient||mode!=='supabase') throw new Error('Canonical workflow mutations require Supabase mode.');
    const project=data.projects.find((item)=>item.id===projectId);
    if(!project) throw new Error('Project not found.');
    await workflowClient.updateConfiguration(projectId,requireWorkflowVersion(project),requiresPrint,requiresEbook,canonicalSettings(settings));
    await loadSupabaseData(currentProfile);
  },[currentProfile,data.projects,loadSupabaseData,mode,workflowClient]);

  const updateProjectFromDraft = useCallback(async (projectId:string,draft:ProjectDraft)=>{
    const existing=data.projects.find((item)=>item.id===projectId);
    if(!existing) throw new Error('Project not found.');
    await updateProject(projectId,{
      ...definedValues(projectMetadataPayload(draft)),total_price:draft.total_price,advance_paid:draft.advance_paid,
      payment_status:draft.payment_status,payment_date:draft.payment_date,payment_notes:draft.payment_notes,
    });
    const requiresPrint=draft.requires_print ?? existing.requires_print;
    const requiresEbook=draft.requires_ebook ?? existing.requires_ebook;
    if(typeof requiresPrint==='boolean'&&typeof requiresEbook==='boolean'&&(
      requiresPrint!==existing.requires_print||requiresEbook!==existing.requires_ebook||
      JSON.stringify(canonicalSettings(draft.workflow_settings))!==JSON.stringify(canonicalSettings(existing.workflow_settings))
    )) await updateWorkflowConfiguration(projectId,requiresPrint,requiresEbook,canonicalSettings(draft.workflow_settings));
  },[data.projects,updateProject,updateWorkflowConfiguration]);

  const createTask = useCallback(
    async (draft: TaskDraft) => {
      if (!currentProfile || isClientRole(currentProfile.role)) {
        throw new Error('Only team members can create tasks.');
      }

      const assignedTo = draft.assigned_to || currentProfile.id;
      const fullDraft = { ...draft, assigned_to: assignedTo };

      const task = normalizeTask({
        ...fullDraft,
        id: createId('task'),
        created_by: currentProfile.id,
        completed_at: draft.status === 'Done' ? new Date().toISOString() : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      if (supabase && mode === 'supabase') {
        let { data: inserted, error: insertError } = await supabase
          .from('tasks')
          .insert(taskPayload(fullDraft, currentProfile.id))
          .select()
          .single();

        if (insertError && isMissingSchemaError(insertError)) {
          const legacyInsert = await supabase
            .from('tasks')
            .insert(legacyTaskPayload(fullDraft, currentProfile.id))
            .select()
            .single();
          inserted = legacyInsert.data;
          insertError = legacyInsert.error;
        }
        if (insertError) {
          throw insertError;
        }

        setData((previous) => ({
          ...previous,
          tasks: [normalizeTask(inserted as Partial<Task>), ...previous.tasks],
        }));
        return inserted as Task;
      }

      setData((previous) => ({
        ...previous,
        tasks: [task, ...previous.tasks],
      }));

      return task;
    },
    [currentProfile, mode],
  );

  const updateTask = useCallback(
    async (taskId: string, updates: Partial<Task>) => {
      if (!currentProfile || isClientRole(currentProfile.role)) {
        throw new Error('Only team members can update tasks.');
      }

      const existing = data.tasks.find((task) => task.id === taskId);
      if (!existing) {
        throw new Error('Task not found.');
      }

      const nextTask = normalizeTask({
        ...existing,
        ...updates,
        completed_at:
          updates.status === 'Done' && !existing.completed_at
            ? new Date().toISOString()
            : updates.status && updates.status !== 'Done'
              ? null
              : updates.completed_at ?? existing.completed_at,
        updated_at: new Date().toISOString(),
      });

      if (supabase && mode === 'supabase') {
        const isEmployeeActor = currentProfile.role === 'employee' || currentProfile.role === 'junior_assistant';
        const updatePayload = isEmployeeActor
          ? {
              title: nextTask.title,
              description: nextTask.description,
              status: nextTask.status,
              priority: nextTask.priority,
              start_date: nextTask.start_date,
              due_date: nextTask.due_date,
              parent_task_id: nextTask.parent_task_id,
              estimated_minutes: nextTask.estimated_minutes,
              actual_minutes: nextTask.actual_minutes,
              blocked_reason: nextTask.blocked_reason,
              sort_order: nextTask.sort_order,
              task_type: nextTask.task_type,
              visibility: nextTask.visibility,
              archived_at: nextTask.archived_at,
              completed_at: nextTask.completed_at,
            }
          : taskPayload(nextTask);
        let { data: updated, error: updateError } = await supabase
          .from('tasks')
          .update(updatePayload)
          .eq('id', taskId)
          .select()
          .maybeSingle();

        if (updateError && isMissingSchemaError(updateError)) {
          const legacyUpdate = await supabase
            .from('tasks')
            .update(legacyTaskPayload(nextTask))
            .eq('id', taskId)
            .select()
            .maybeSingle();
          updated = legacyUpdate.data;
          updateError = legacyUpdate.error;
        }
        if (updateError) {
          throw updateError;
        }

        if (!updated) {
          throw new Error('No task row was updated. Check task permissions.');
        }

        setData((previous) => ({
          ...previous,
          tasks: previous.tasks.map((task) => (task.id === taskId ? normalizeTask(updated as Partial<Task>) : task)),
        }));
        return updated as Task;
      }

      setData((previous) => ({
        ...previous,
        tasks: previous.tasks.map((task) => (task.id === taskId ? nextTask : task)),
      }));

      return nextTask;
    },
    [currentProfile, data.tasks, mode],
  );

  const archiveTask = useCallback(async (taskId: string) => {
    return updateTask(taskId, { archived_at: new Date().toISOString() });
  }, [updateTask]);

  const assignTaskCollaborator = useCallback(async (
    taskId: string,
    profileId: string,
    assignmentRole: Exclude<TaskAssignmentRole, 'primary'> = 'collaborator',
  ) => {
    if (!currentProfile || isClientRole(currentProfile.role)) throw new Error('Only team members can assign collaborators.');
    const existing = data.taskAssignees.find((item) => item.task_id === taskId && item.profile_id === profileId);
    if (existing) return existing;
    const local: TaskAssignee = {
      id: createUuid(), task_id: taskId, profile_id: profileId, assignment_role: assignmentRole,
      assigned_by: currentProfile.id, assigned_at: new Date().toISOString(),
    };
    if (supabase && mode === 'supabase') {
      const { data: inserted, error } = await supabase.from('task_assignees').insert({
        task_id: taskId, profile_id: profileId, assignment_role: assignmentRole, assigned_by: currentProfile.id,
      }).select().single();
      if (error) throw error;
      const result = inserted as TaskAssignee;
      setData((previous) => ({ ...previous, taskAssignees: [...previous.taskAssignees, result] }));
      return result;
    }
    setData((previous) => ({ ...previous, taskAssignees: [...previous.taskAssignees, local] }));
    return local;
  }, [currentProfile, data.taskAssignees, mode]);

  const removeTaskCollaborator = useCallback(async (taskId: string, profileId: string) => {
    if (!currentProfile || isClientRole(currentProfile.role)) throw new Error('Only team members can remove collaborators.');
    const existing = data.taskAssignees.find((item) =>
      item.task_id === taskId && item.profile_id === profileId && item.assignment_role !== 'primary');
    if (!existing) return;
    if (supabase && mode === 'supabase') {
      const { data: deleted, error } = await supabase.from('task_assignees').delete().eq('id', existing.id).select('id').maybeSingle();
      if (error) throw error;
      if (!deleted) throw new Error('No collaborator assignment was removed. Check task permissions.');
    }
    setData((previous) => ({
      ...previous,
      taskAssignees: previous.taskAssignees.filter((item) => item.id !== existing.id),
    }));
  }, [currentProfile, data.taskAssignees, mode]);

  const addTaskComment = useCallback(async (taskId: string, comment: string) => {
    if (!currentProfile || isClientRole(currentProfile.role)) throw new Error('Only team members can comment on tasks.');
    const cleanComment = comment.trim();
    if (!cleanComment) throw new Error('Comment cannot be blank.');
    const now = new Date().toISOString();
    const local: TaskComment = { id: createUuid(), task_id: taskId, user_id: currentProfile.id, comment: cleanComment, created_at: now, updated_at: now };
    if (supabase && mode === 'supabase') {
      const { data: inserted, error } = await supabase.from('task_comments')
        .insert({ task_id: taskId, user_id: currentProfile.id, comment: cleanComment }).select().single();
      if (error) throw error;
      const result = inserted as TaskComment;
      setData((previous) => ({ ...previous, taskComments: [...previous.taskComments, result] }));
      return result;
    }
    setData((previous) => ({ ...previous, taskComments: [...previous.taskComments, local] }));
    return local;
  }, [currentProfile, mode]);

  const updateTaskComment = useCallback(async (commentId: string, comment: string) => {
    const cleanComment = comment.trim();
    if (!cleanComment) throw new Error('Comment cannot be blank.');
    if (supabase && mode === 'supabase') {
      const { data: updated, error } = await supabase.from('task_comments').update({ comment: cleanComment })
        .eq('id', commentId).select().maybeSingle();
      if (error) throw error;
      if (!updated) throw new Error('No comment was updated.');
      setData((previous) => ({
        ...previous, taskComments: previous.taskComments.map((item) => item.id === commentId ? updated as TaskComment : item),
      }));
      return updated as TaskComment;
    }
    const updatedAt = new Date().toISOString();
    setData((previous) => ({
      ...previous,
      taskComments: previous.taskComments.map((item) => item.id === commentId ? { ...item, comment: cleanComment, updated_at: updatedAt } : item),
    }));
  }, [mode]);

  const deleteTaskComment = useCallback(async (commentId: string) => {
    if (supabase && mode === 'supabase') {
      const { data: deleted, error } = await supabase.from('task_comments').delete().eq('id', commentId).select('id').maybeSingle();
      if (error) throw error;
      if (!deleted) throw new Error('No comment was deleted. Check comment permissions.');
    }
    setData((previous) => ({ ...previous, taskComments: previous.taskComments.filter((item) => item.id !== commentId) }));
  }, [mode]);

  const addTaskChecklistItem = useCallback(async (taskId: string, title: string) => {
    const cleanTitle = title.trim();
    if (!cleanTitle) throw new Error('Checklist item title is required.');
    const position = data.taskChecklistItems.filter((item) => item.task_id === taskId)
      .reduce((maximum, item) => Math.max(maximum, item.position), -1) + 1;
    const local: TaskChecklistItem = {
      id: createUuid(), task_id: taskId, title: cleanTitle, completed: false,
      completed_by: null, completed_at: null, position, created_at: new Date().toISOString(),
    };
    if (supabase && mode === 'supabase') {
      const { data: inserted, error } = await supabase.from('task_checklist_items')
        .insert({ task_id: taskId, title: cleanTitle, position }).select().single();
      if (error) throw error;
      const result = inserted as TaskChecklistItem;
      setData((previous) => ({ ...previous, taskChecklistItems: [...previous.taskChecklistItems, result] }));
      return result;
    }
    setData((previous) => ({ ...previous, taskChecklistItems: [...previous.taskChecklistItems, local] }));
    return local;
  }, [data.taskChecklistItems, mode]);

  const toggleTaskChecklistItem = useCallback(async (itemId: string, completed: boolean) => {
    const now = new Date().toISOString();
    if (supabase && mode === 'supabase') {
      const { data: updated, error } = await supabase.from('task_checklist_items').update({ completed })
        .eq('id', itemId).select().maybeSingle();
      if (error) throw error;
      if (!updated) throw new Error('No checklist item was updated.');
      setData((previous) => ({
        ...previous, taskChecklistItems: previous.taskChecklistItems.map((item) => item.id === itemId ? updated as TaskChecklistItem : item),
      }));
      return updated as TaskChecklistItem;
    }
    setData((previous) => ({
      ...previous,
      taskChecklistItems: previous.taskChecklistItems.map((item) => item.id === itemId ? {
        ...item, completed, completed_by: completed ? currentProfile?.id || null : null, completed_at: completed ? now : null,
      } : item),
    }));
  }, [currentProfile, mode]);

  const deleteTaskChecklistItem = useCallback(async (itemId: string) => {
    if (supabase && mode === 'supabase') {
      const { data: deleted, error } = await supabase.from('task_checklist_items').delete().eq('id', itemId).select('id').maybeSingle();
      if (error) throw error;
      if (!deleted) throw new Error('No checklist item was deleted. Check task permissions.');
    }
    setData((previous) => ({
      ...previous, taskChecklistItems: previous.taskChecklistItems.filter((item) => item.id !== itemId),
    }));
  }, [mode]);

  const addTaskDependency = useCallback(async (taskId: string, dependsOnTaskId: string) => {
    if (taskId === dependsOnTaskId) throw new Error('A task cannot depend on itself.');
    const existing = data.taskDependencies.find((item) => item.task_id === taskId && item.depends_on_task_id === dependsOnTaskId);
    if (existing) return existing;
    const local: TaskDependency = { id: createUuid(), task_id: taskId, depends_on_task_id: dependsOnTaskId, dependency_type: 'blocks', created_at: new Date().toISOString() };
    if (supabase && mode === 'supabase') {
      const { data: inserted, error } = await supabase.from('task_dependencies')
        .insert({ task_id: taskId, depends_on_task_id: dependsOnTaskId, dependency_type: 'blocks' }).select().single();
      if (error) throw error;
      const result = inserted as TaskDependency;
      setData((previous) => ({ ...previous, taskDependencies: [...previous.taskDependencies, result] }));
      return result;
    }
    setData((previous) => ({ ...previous, taskDependencies: [...previous.taskDependencies, local] }));
    return local;
  }, [data.taskDependencies, mode]);

  const removeTaskDependency = useCallback(async (dependencyId: string) => {
    if (supabase && mode === 'supabase') {
      const { data: deleted, error } = await supabase.from('task_dependencies').delete().eq('id', dependencyId).select('id').maybeSingle();
      if (error) throw error;
      if (!deleted) throw new Error('No dependency was removed. Check task permissions.');
    }
    setData((previous) => ({
      ...previous, taskDependencies: previous.taskDependencies.filter((item) => item.id !== dependencyId),
    }));
  }, [mode]);

  const createSubtask = useCallback(async (parentTaskId: string, draft: TaskDraft) => {
    const parent = data.tasks.find((item) => item.id === parentTaskId);
    if (!parent) throw new Error('Parent task not found.');
    return createTask({ ...draft, project_id: draft.project_id ?? parent.project_id, parent_task_id: parentTaskId });
  }, [createTask, data.tasks]);

  const inviteClient = useCallback(
    async (draft: ClientInviteDraft) => {
      if (!currentProfile || currentProfile.role !== 'admin') {
        throw new Error('Only admins can manage client access.');
      }

      const cleanEmail = draft.email.trim().toLowerCase();
      const cleanName = draft.full_name.trim();

      if (!cleanName || !cleanEmail) {
        throw new Error('Client name and email are required.');
      }

      if (supabase && mode === 'supabase') {
        const { error: teamError } = await supabase.from('team_members').upsert(
          {
            full_name: cleanName,
            email: cleanEmail,
            role: 'client',
            status: draft.status || 'active',
          },
          { onConflict: 'email' },
        );

        if (teamError) {
          throw teamError;
        }

        const { data: profiles, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('email', cleanEmail);

        if (profileError) {
          throw profileError;
        }

        const clientProfile = (profiles || [])[0] as Profile | undefined;

        if (clientProfile) {
          const { data: updatedProfile, error: updateProfileError } = await supabase
            .from('profiles')
            .update({
              full_name: cleanName,
              role: 'client',
              status: draft.status || 'active',
            })
            .eq('id', clientProfile.id)
            .select('id')
            .maybeSingle();

          if (updateProfileError) {
            throw updateProfileError;
          }
          if (!updatedProfile) throw new Error('No client profile row was updated.');

          const { error: accessDeleteError } = await supabase
            .from('client_project_access').delete().eq('client_id', clientProfile.id);
          if (accessDeleteError) throw accessDeleteError;

          if (draft.project_ids.length) {
            const { error: accessError } = await supabase.from('client_project_access').insert(
              draft.project_ids.map((projectId) => ({
                client_id: clientProfile.id,
                project_id: projectId,
              })),
            );

            if (accessError) {
              throw accessError;
            }
          }
        }

        const { error: resetError } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: window.location.origin,
        });
        if (resetError) throw resetError;

        await loadSupabaseData(currentProfile);

        return clientProfile
          ? 'Client access saved. A password setup email was requested if Supabase allows it.'
          : 'Client saved. Create or invite this email in Supabase Auth, then return here to assign projects.';
      }

      const existing = data.profiles.find((profile) => profile.email.toLowerCase() === cleanEmail);
      const clientProfile: Profile =
        existing ||
        {
          id: createId('client'),
          full_name: cleanName,
          email: cleanEmail,
          role: 'client',
          status: draft.status || 'active',
          avatar_url: null,
          phone: '',
          created_at: new Date().toISOString(),
        };

      setData((previous) => ({
        ...previous,
        profiles: existing
          ? previous.profiles.map((profile) =>
              profile.id === existing.id ? { ...profile, full_name: cleanName, role: 'client' } : profile,
            )
          : [...previous.profiles, clientProfile],
        clientProjectAccess: [
          ...previous.clientProjectAccess.filter((access) => access.client_id !== clientProfile.id),
          ...draft.project_ids.map((projectId) => ({
            id: createId('client-access'),
            client_id: clientProfile.id,
            project_id: projectId,
            created_at: new Date().toISOString(),
          })),
        ],
      }));

      return 'Client access saved in demo mode.';
    },
    [currentProfile, data.profiles, loadSupabaseData, mode],
  );

  const provisionClient = useCallback(
    async (draft: ClientInviteDraft) => {
      if (!currentProfile || currentProfile.role !== 'admin') {
        throw new Error('Only admins can add or update clients.');
      }

      const cleanName = draft.full_name.trim();
      const cleanEmail = draft.email.trim().toLowerCase();
      if (!cleanName || !cleanEmail || !cleanEmail.includes('@')) {
        throw new Error('Client name and a valid email are required.');
      }

      if (supabase && mode === 'supabase') {
        const { data: result, error: invokeError } = await supabase.functions.invoke(
          'provision-client',
          {
            body: {
              full_name: cleanName,
              email: cleanEmail,
              project_ids: draft.project_ids || [],
            },
          },
        );

        if (invokeError) throw invokeError;
        if (result?.error) throw new Error(String(result.error));

        await loadSupabaseData(currentProfile);
        return String(result?.message || 'Client saved successfully.');
      }

      return inviteClient({
        full_name: cleanName,
        email: cleanEmail,
        project_ids: draft.project_ids || [],
        status: 'active',
      });
    },
    [currentProfile, inviteClient, loadSupabaseData, mode],
  );

  const provisionTeamMember = useCallback(
    async ({ fullName, email, role, phone }: {
      fullName: string;
      email: string;
      role: Role;
      phone?: string;
    }) => {
      if (!currentProfile || currentProfile.role !== 'admin') {
        throw new Error('Only admins can pre-provision team members.');
      }
      if (!['employee', 'junior_assistant', 'project_manager'].includes(role)) {
        throw new Error('Choose Employee, Junior Assistant, or Project Manager.');
      }

      const cleanName = fullName.trim();
      const cleanEmail = email.trim().toLowerCase();
      const cleanPhone = phone?.trim() || null;
      if (!cleanName || !cleanEmail || !cleanEmail.includes('@')) {
        throw new Error('A valid team member name and email are required.');
      }

      if (supabase && mode === 'supabase') {
        const { data: teamMember, error: teamError } = await supabase
          .from('team_members')
          .upsert({
            full_name: cleanName,
            email: cleanEmail,
            role,
            phone: cleanPhone,
            status: 'active',
          }, { onConflict: 'email' })
          .select()
          .single();
        if (teamError) throw teamError;
        if (!teamMember) throw new Error('Team member pre-provisioning returned no row.');
        await loadSupabaseData(currentProfile);
      } else {
        const existing = data.profiles.find((profile) => profile.email.toLowerCase() === cleanEmail);
        const profile: Profile = {
          ...(existing || { id: createId('team'), created_at: new Date().toISOString() }),
          full_name: cleanName,
          email: cleanEmail,
          role,
          phone: cleanPhone,
          status: 'active',
        };
        setData((previous) => ({
          ...previous,
          profiles: [...previous.profiles.filter((item) => item.email.toLowerCase() !== cleanEmail), profile],
        }));
      }

      return 'Team member pre-provisioned. Ask them to sign up using this email.';
    },
    [currentProfile, data.profiles, loadSupabaseData, mode],
  );

  const updateProfile = useCallback(
    async (
      profileId: string,
      updates: Partial<Pick<Profile, 'full_name' | 'avatar_url' | 'phone'>>,
    ) => {
      if (supabase && mode === 'supabase') {
        if (!currentProfile) throw new Error('No signed-in profile found.');
        if (currentProfile.role !== 'admin' && profileId !== currentProfile.id) {
          throw new Error('You can update only your own profile.');
        }
        const { data: updatedRow, error: updateErr } = await supabase
          .from('profiles')
          .update(updates)
          .eq('id', profileId)
          .select('id')
          .maybeSingle();

        if (updateErr) throw updateErr;
        if (!updatedRow) throw new Error('No profile row was updated. Check profile permissions or refresh stale data.');
      }

      setData((previous) => ({
        ...previous,
        profiles: previous.profiles.map((p) => (p.id === profileId ? { ...p, ...updates } : p)),
      }));

      if (currentProfile?.id === profileId) {
        const updatedCurrent = { ...currentProfile, ...updates };
        setCurrentProfile(updatedCurrent);
        setStoredProfile(updatedCurrent);
      }

      return 'Profile updated successfully!';
    },
    [currentProfile, mode],
  );

  const markNotificationRead = useCallback(
    async (notificationId: string) => {
      setData((previous) => ({
        ...previous,
        notifications: previous.notifications.map((notification) =>
          notification.id === notificationId ? { ...notification, is_read: true } : notification,
        ),
      }));

      if (supabase && mode === 'supabase') {
        await markNotificationAsRead(notificationId);
      }
    },
    [mode],
  );

  const markAllNotificationsRead = useCallback(async () => {
    if (!currentProfile) {
      return;
    }

    setData((previous) => ({
      ...previous,
      notifications: previous.notifications.map((notification) =>
        notification.recipient_id === currentProfile.id ? { ...notification, is_read: true } : notification,
      ),
    }));

    if (supabase && mode === 'supabase') {
      await markAllNotificationsAsRead(currentProfile.id);
    }
  }, [currentProfile, mode]);

  const clearNotificationToast = useCallback(() => {
    setNotificationToast(null);
  }, []);

  const canManageAll = canManageEverything(currentProfile);

  const visibleProjects = useMemo(() => {
    if (!currentProfile) {
      return [];
    }

    if (canManageAll) {
      return data.projects;
    }

    if (isClientRole(currentProfile.role)) {
      return data.projects;
    }

    return data.projects.filter((project) => project.assigned_to === currentProfile.id);
  }, [canManageAll, currentProfile, data.projects]);

  const visibleTasks = useMemo(() => {
    if (!currentProfile || isClientRole(currentProfile.role)) {
      return [];
    }

    const assignedTaskIds = new Set(data.taskAssignees
      .filter((assignment) => assignment.profile_id === currentProfile.id)
      .map((assignment) => assignment.task_id));
    return data.tasks.filter((task) =>
      !task.archived_at && (task.assigned_to === currentProfile.id || assignedTaskIds.has(task.id)));
  }, [currentProfile, data.taskAssignees, data.tasks]);

  const teamTasks = useMemo(() => {
    if (!currentProfile || !canManageAll) return [];
    return data.tasks.filter((task) => !task.archived_at);
  }, [canManageAll, currentProfile, data.tasks]);

  const visibleNotifications = useMemo(() => {
    if (!currentProfile) {
      return [];
    }

    return data.notifications.filter((notification) => notification.recipient_id === currentProfile.id);
  }, [currentProfile, data.notifications]);

  const saveEmployeeCompensation = useCallback(
    async (employeeId: string, updates: Partial<EmployeeCompensation>) => {
      if (!currentProfile || currentProfile.role !== 'admin') throw new Error('Only admins can manage employee compensation.');
      const existing = data.employeeCompensation.find((item) => item.employee_id === employeeId);
      const compensation: EmployeeCompensation = {
        employee_id: employeeId,
        monthly_salary: Number(updates.monthly_salary !== undefined ? updates.monthly_salary : existing?.monthly_salary || 0),
        per_project_rate: Number(updates.per_project_rate !== undefined ? updates.per_project_rate : existing?.per_project_rate || 0),
        salary_type: updates.salary_type || existing?.salary_type || 'Monthly',
        default_currency: updates.default_currency || existing?.default_currency || 'USD',
        joining_date: updates.joining_date !== undefined ? (updates.joining_date || null) : (existing?.joining_date || null),
        responsibilities: updates.responsibilities !== undefined ? updates.responsibilities : existing?.responsibilities || '',
        performance_rating: existing?.performance_rating ?? null,
        updated_at: new Date().toISOString(),
      };
      if (supabase && mode === 'supabase') {
        const payload = {
          employee_id: compensation.employee_id,
          monthly_salary: compensation.monthly_salary,
          per_project_rate: compensation.per_project_rate,
          salary_type: compensation.salary_type,
          default_currency: compensation.default_currency,
          joining_date: compensation.joining_date,
          responsibilities: compensation.responsibilities,
          performance_rating: compensation.performance_rating,
        };
        const { error } = await supabase.from('employee_compensation').upsert(payload, { onConflict: 'employee_id' });
        if (error) throw error;
      }
      setData((previous) => ({
        ...previous,
        employeeCompensation: [compensation, ...previous.employeeCompensation.filter((item) => item.employee_id !== employeeId)],
      }));

      const empName = data.profiles.find((p) => p.id === employeeId)?.full_name || 'Employee';
      await addActivity({
        action: `Salary/compensation updated for ${empName}`,
      });
    },
    [addActivity, currentProfile, data.employeeCompensation, data.profiles, mode],
  );

  const addEmployeeLedgerEntry = useCallback(
    async (entry: Omit<EmployeeLedgerEntry, 'id' | 'created_at'>) => {
      if (!currentProfile || currentProfile.role !== 'admin') throw new Error('Only admins can manage employee payroll.');
      const ledgerEntry: EmployeeLedgerEntry = {
        ...entry,
        id: createUuid(),
        currency: entry.currency || 'USD',
        created_at: new Date().toISOString(),
      };
      if (supabase && mode === 'supabase') {
        const payload = {
          id: ledgerEntry.id,
          employee_id: ledgerEntry.employee_id,
          entry_type: ledgerEntry.entry_type,
          amount: ledgerEntry.amount,
          salary_month: ledgerEntry.salary_month || null,
          payment_method: ledgerEntry.payment_method || null,
          project_id: ledgerEntry.project_id || null,
          notes: ledgerEntry.notes || ledgerEntry.description || '',
          paid_at: ledgerEntry.paid_at,
          currency: ledgerEntry.currency || 'USD',
          reference: ledgerEntry.reference || null,
          status: ledgerEntry.status || 'Pending',
          description: ledgerEntry.description || '',
        };

        const { error } = await supabase.from('employee_ledger').insert(payload);
        if (error) throw error;
      }
      setData((previous) => ({ ...previous, employeeLedger: [ledgerEntry, ...previous.employeeLedger] }));

      const empName = data.profiles.find((p) => p.id === entry.employee_id)?.full_name || 'Employee';
      const actionLabel =
        entry.entry_type === 'Payment'
          ? `Payroll payment of $${entry.amount} recorded for ${empName}`
          : entry.entry_type === 'Advance'
            ? `Advance of $${entry.amount} recorded for ${empName}`
            : entry.entry_type === 'Deduction'
              ? `Deduction of $${entry.amount} added for ${empName}`
              : `${entry.entry_type} of $${entry.amount} added for ${empName}`;

      await addActivity({
        action: actionLabel,
      });
    },
    [addActivity, currentProfile, data.profiles, mode],
  );

  const deleteEmployeeLedgerEntry = useCallback(
    async (entryId: string) => {
      if (!currentProfile || currentProfile.role !== 'admin') throw new Error('Only admins can delete employee payroll entries.');
      const existing = data.employeeLedger.find((entry) => entry.id === entryId);
      if (supabase && mode === 'supabase') {
        const { error: deleteError } = await supabase.from('employee_ledger').delete().eq('id', entryId);
        if (deleteError) throw deleteError;
      }
      setData((previous) => ({
        ...previous,
        employeeLedger: previous.employeeLedger.filter((entry) => entry.id !== entryId),
      }));

      const empName = existing ? data.profiles.find((p) => p.id === existing.employee_id)?.full_name || 'Employee' : 'Employee';
      await addActivity({
        action: `Payroll entry (${existing?.entry_type || 'Ledger'}) deleted for ${empName}`,
      });
    },
    [addActivity, currentProfile, data.employeeLedger, data.profiles, mode],
  );

  const saveInvoiceVersion = useCallback(
    async (draft: Invoice, existingInvoiceId?: string | null, changeNote = '') => {
      if (!currentProfile || !canManageEverything(currentProfile)) {
        throw new Error('Only admins and authorized managers can generate or revise invoices.');
      }

      const now = new Date().toISOString();

      if (supabase && mode === 'supabase') {
        const { data: resultData, error: saveError } = await supabase.rpc('invoice_save_version', {
          p_invoice_id: existingInvoiceId || null,
          p_invoice_number: draft.invoice_number,
          p_client_name: draft.client_name,
          p_client_email: draft.client_email || '',
          p_month: draft.month,
          p_year: draft.year,
          p_month_label: draft.month_label,
          p_due_date: cleanDate(draft.due_date),
          p_items: draft.items,
          p_subtotal: Number(draft.subtotal || 0),
          p_total_paid: Number(draft.total_paid || 0),
          p_total_due: Number(draft.total_due || 0),
          p_notes: draft.notes || '',
          p_status: draft.status,
          p_change_note: changeNote || '',
        });

        if (saveError) throw saveError;

        const result = Array.isArray(resultData) ? resultData[0] : resultData;
        if (!result?.invoice_id || !result?.version_id) {
          throw new Error('Invoice version save returned no invoice identity.');
        }

        const saved: Invoice = {
          ...draft,
          id: String(result.version_id),
          logical_invoice_id: String(result.invoice_id),
          version_number: Number(result.version_number || 1),
          invoice_number: String(result.invoice_number || draft.invoice_number),
          created_at: now,
          created_by: currentProfile.id,
          change_note: changeNote || '',
        };

        await loadSupabaseData(currentProfile);
        return saved;
      }

      const logicalId = existingInvoiceId || createUuid();
      const existingVersions = (data.invoices || []).filter(
        (item) => item.logical_invoice_id === logicalId,
      );
      const versionNumber =
        existingVersions.length > 0
          ? Math.max(...existingVersions.map((item) => Number(item.version_number || 1))) + 1
          : 1;

      const saved: Invoice = {
        ...draft,
        id: createUuid(),
        logical_invoice_id: logicalId,
        version_number: versionNumber,
        created_at: now,
        created_by: currentProfile.id,
        change_note: changeNote || '',
      };

      const projectIds = new Set(saved.items.map((item) => item.project_id).filter(Boolean));
      setData((previous) => ({
        ...previous,
        invoices: [saved, ...(previous.invoices || [])],
        projects: previous.projects.map((project) =>
          projectIds.has(project.id)
            ? {
                ...project,
                invoiced: true,
                invoice_id: logicalId,
                invoiced_at: project.invoiced_at || now,
              }
            : project,
        ),
      }));

      return saved;
    },
    [currentProfile, data.invoices, loadSupabaseData, mode],
  );

  const createFinanceTransaction = useCallback(
    async (draft: FinanceTransactionDraft) => {
      if (!currentProfile || !canManageEverything(currentProfile)) {
        throw new Error('Only admins and authorized managers can create finance transactions.');
      }

      const currencyCode = 'USD' as const;
      const rate = 1.0;
      const originalAmount = Number(draft.original_amount ?? draft.amount ?? 0);
      // Legacy compatibility columns are retained in the database, but finance
      // is now USD-only so no FX conversion is performed.
      const amountPkr = originalAmount;
      const now = new Date().toISOString();

      const transaction: FinanceTransaction = {
        id: draft.id || createId('ftx'),
        type: draft.type,
        category: draft.category,
        description: draft.description,
        amount: originalAmount,
        original_amount: originalAmount,
        currency: currencyCode,
        exchange_rate: rate,
        amount_pkr: amountPkr,
        base_amount_pkr: amountPkr,
        transaction_date: draft.transaction_date || new Date().toISOString().slice(0, 10),
        client_name: draft.client_name || null,
        client_id: draft.client_id || null,
        project_id: draft.project_id || null,
        employee_id: draft.employee_id || null,
        invoice_id: draft.invoice_id || null,
        payment_method: draft.payment_method || 'Bank Transfer',
        reference_no: draft.reference_no || null,
        vendor: draft.vendor || null,
        recurring_status: draft.recurring_status || 'none',
        next_recurring_date: draft.next_recurring_date || null,
        notes: draft.notes || null,
        attachment_url: draft.attachment_url || null,
        expense_type: draft.expense_type || null,
        payment_status: draft.payment_status || null,
        paid_date: draft.paid_date || null,
        financial_account: draft.financial_account || null,
        tax_amount: Number(draft.tax_amount || 0),
        fee_amount: Number(draft.fee_amount || 0),
        recurring_end_date: draft.recurring_end_date || null,
        is_soft_deleted: false,
        created_by: currentProfile.id,
        created_at: now,
        updated_by: currentProfile.id,
        updated_at: now,
      };

      if (supabase && mode === 'supabase') {
        const { data: inserted, error: insertError } = await supabase
          .from('finance_transactions')
          .insert({
            type:transaction.type,category:transaction.category,description:transaction.description,
            amount:transaction.amount,transaction_date:transaction.transaction_date,
            project_id:transaction.project_id,currency:transaction.currency,exchange_rate:transaction.exchange_rate,
            client_name:transaction.client_name,invoice_id:transaction.invoice_id,payment_method:transaction.payment_method,
            reference_no:transaction.reference_no,vendor:transaction.vendor,recurring_status:transaction.recurring_status,
            next_recurring_date:transaction.next_recurring_date,notes:transaction.notes,attachment_url:transaction.attachment_url,
            is_soft_deleted:false,expense_type:transaction.expense_type,payment_status:transaction.payment_status,
            paid_date:transaction.paid_date,financial_account:transaction.financial_account,tax_amount:transaction.tax_amount,
            fee_amount:transaction.fee_amount,recurring_end_date:transaction.recurring_end_date,
            created_by:currentProfile.id,
          })
          .select()
          .single();
        if (insertError) throw insertError;

        const newFtx = (inserted as FinanceTransaction) || transaction;
        setData((previous) => ({
          ...previous,
          financeTransactions: [newFtx, ...(previous.financeTransactions || [])],
        }));
        return newFtx;
      }

      setData((previous) => ({
        ...previous,
        financeTransactions: [transaction, ...(previous.financeTransactions || [])],
      }));

      return transaction;
    },
    [currentProfile, mode],
  );

  const updateFinanceTransaction = useCallback(
    async (id: string, updates: FinanceTransactionUpdate) => {
      if (!currentProfile || !canManageEverything(currentProfile)) {
        throw new Error('Only authorized managers can update finance transactions.');
      }

      if (supabase && mode === 'supabase') {
        const {project_id,...ordinary}=updates;
        const updatePayload=definedValues({
          type:ordinary.type,category:ordinary.category,description:ordinary.description,amount:ordinary.amount,
          transaction_date:ordinary.transaction_date,currency:ordinary.currency,exchange_rate:ordinary.exchange_rate,
          client_name:ordinary.client_name,invoice_id:ordinary.invoice_id,payment_method:ordinary.payment_method,
          reference_no:ordinary.reference_no,vendor:ordinary.vendor,recurring_status:ordinary.recurring_status,
          next_recurring_date:ordinary.next_recurring_date,notes:ordinary.notes,attachment_url:ordinary.attachment_url,
          is_soft_deleted:ordinary.is_soft_deleted,expense_type:ordinary.expense_type,payment_status:ordinary.payment_status,
          paid_date:ordinary.paid_date,financial_account:ordinary.financial_account,tax_amount:ordinary.tax_amount,
          fee_amount:ordinary.fee_amount,recurring_end_date:ordinary.recurring_end_date,
          ...(currentProfile.role==='admin'?{project_id}:{}),
        });
        const { error: updateError } = await supabase
          .from('finance_transactions')
          .update(updatePayload)
          .eq('id', id);

        if (updateError) {
          throw updateError;
        }

        await loadSupabaseData(currentProfile);
        return;
      }

      setData((previous) => ({
        ...previous,
        financeTransactions: (previous.financeTransactions || []).map((t) => {
          if (t.id !== id) return t;
          const merged = { ...t, ...updates };
          const currencyCode = 'USD' as const;
          const rate = 1.0;
          const orig = Number(merged.original_amount ?? merged.amount ?? 0);
          const pkr = orig;
          return {
            ...merged,
            currency: currencyCode,
            exchange_rate: rate,
            amount: orig,
            original_amount: orig,
            amount_pkr: pkr,
            base_amount_pkr: pkr,
            updated_by: currentProfile.id,
            updated_at: new Date().toISOString(),
          };
        }),
      }));
    },
    [currentProfile, loadSupabaseData, mode],
  );

  const softDeleteFinanceTransaction = useCallback(
    async (id: string) => {
      return updateFinanceTransaction(id, { is_soft_deleted: true });
    },
    [updateFinanceTransaction],
  );

  const restoreFinanceTransaction = useCallback(
    async (id: string) => {
      return updateFinanceTransaction(id, { is_soft_deleted: false });
    },
    [updateFinanceTransaction],
  );

  const deleteFinanceTransaction = useCallback(
    async (id: string) => {
      if (!currentProfile || !canManageEverything(currentProfile)) {
        throw new Error('Only authorized managers can delete finance transactions.');
      }
      if (supabase && mode === 'supabase') {
        const { error: delError } = await supabase.from('finance_transactions').delete().eq('id', id);
        if (delError) throw delError;
      }
      setData((previous) => ({
        ...previous,
        financeTransactions: (previous.financeTransactions || []).filter((t) => t.id !== id),
      }));
    },
    [currentProfile, mode],
  );

  const saveFinanceBudget = useCallback(
    async (category: string, monthlyBudgetPkr: number) => {
      if (!currentProfile || !canManageEverything(currentProfile)) {
        throw new Error('Only authorized managers can set category budgets.');
      }

      const now = new Date().toISOString();
      const budgetItem: FinanceBudget = {
        category,
        monthly_budget_pkr: Number(monthlyBudgetPkr || 0),
        updated_by: currentProfile.id,
        updated_at: now,
      };

      if (supabase && mode === 'supabase') {
        const { error: upsertError } = await supabase
          .from('finance_budgets')
          .upsert({ category: budgetItem.category, monthly_budget_pkr: budgetItem.monthly_budget_pkr }, { onConflict: 'category' });

        if (upsertError) {
          throw upsertError;
        }
      }

      setData((previous) => ({
        ...previous,
        financeBudgets: [
          budgetItem,
          ...(previous.financeBudgets || []).filter((b) => b.category !== category),
        ],
      }));
    },
    [currentProfile, mode],
  );

  const sendMessage = useCallback(
    async (
      conversationId: string,
      body: string,
      attachments?: { file_name: string; file_url: string; file_type: string; file_size: number }[],
      parentMessageId?: string | null,
    ) => {
      if (!currentProfile) throw new Error('Not logged in.');
      const now = new Date().toISOString();
      const messageId = createUuid();
      const newAttachments: MessageAttachment[] = (attachments || []).map((a) => ({
        id: createUuid(),
        message_id: messageId,
        file_name: a.file_name,
        file_url: a.file_url,
        file_type: a.file_type,
        file_size: a.file_size,
        created_at: now,
      }));

      const newMessage: ChatMessage = {
        id: messageId,
        conversation_id: conversationId,
        sender_id: currentProfile.id,
        body: body.trim(),
        parent_message_id: parentMessageId || null,
        created_at: now,
        updated_at: now,
        attachments: newAttachments,
        reactions: [],
        mentions: [],
      };

      const mentionMatches = body.match(/@([A-Za-z0-9_]+)/g);
      const mentionedUserIds: string[] = [];

      if (mentionMatches) {
        mentionMatches.forEach((m) => {
          const name = m.substring(1).toLowerCase();
          const found = data.profiles.find(
            (p) => p.full_name.toLowerCase().includes(name) || firstName(p.full_name).toLowerCase() === name,
          );
          if (found && found.id !== currentProfile.id && !mentionedUserIds.includes(found.id)) {
            mentionedUserIds.push(found.id);
          }
        });
      }

      if (supabase && mode === 'supabase') {
        const { error: insertError } = await supabase.from('messages').insert({
            id: messageId,
            conversation_id: conversationId,
            sender_id: currentProfile.id,
            body: body.trim(),
            parent_message_id: parentMessageId || null,
            created_at: now,
            updated_at: now,
          });

        if (insertError) throw insertError;

        if (attachments && attachments.length > 0) {
          const { error: attachmentError } = await supabase.from('message_attachments').insert(
              newAttachments.map((a) => ({
                id: a.id,
                message_id: messageId,
                file_name: a.file_name,
                file_url: a.file_url,
                file_type: a.file_type,
                file_size: a.file_size,
              })),
          );
          if (attachmentError) throw attachmentError;
        }

        if (mentionedUserIds.length > 0) {
          const { error: mentionError } = await supabase.from('message_mentions').insert(
              mentionedUserIds.map((uid) => ({
                message_id: messageId,
                user_id: uid,
              })),
          );
          if (mentionError) throw mentionError;
        }
      }

      setData((prev) => ({
        ...prev,
        messages: [...(prev.messages || []), newMessage],
        messageAttachments: [...(prev.messageAttachments || []), ...newAttachments],
      }));

      void markConversationRead(conversationId);

      return newMessage;
    },
    [currentProfile, data.profiles, mode],
  );

  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!currentProfile) return;
      const existing = (data.messageReactions || []).find(
        (reaction) => reaction.message_id === messageId && reaction.user_id === currentProfile.id && reaction.emoji === emoji,
      );

      if (supabase && mode === 'supabase') {
        if (existing) {
          const { data: deletedReaction, error: deleteError } = await supabase.from('message_reactions').delete()
            .eq('id', existing.id).eq('user_id', currentProfile.id).select('id').maybeSingle();
          if (deleteError) throw deleteError;
          if (!deletedReaction) throw new Error('No reaction row was deleted. Refresh stale message data.');
          setData((previous) => ({
            ...previous,
            messageReactions: (previous.messageReactions || []).filter((reaction) => reaction.id !== existing.id),
          }));
          return;
        }

        const { data: inserted, error: insertError } = await supabase.from('message_reactions')
          .insert({ message_id: messageId, user_id: currentProfile.id, emoji })
          .select().single();
        if (insertError) throw insertError;
        if (!inserted) throw new Error('Reaction insert returned no row.');
        setData((previous) => ({
          ...previous,
          messageReactions: [...(previous.messageReactions || []), inserted as MessageReaction],
        }));
        return;
      }

      const localReaction: MessageReaction = {
        id: createUuid(), message_id: messageId, user_id: currentProfile.id, emoji, created_at: new Date().toISOString(),
      };
      setData((previous) => ({
        ...previous,
        messageReactions: existing
          ? (previous.messageReactions || []).filter((reaction) => reaction.id !== existing.id)
          : [...(previous.messageReactions || []), localReaction],
      }));
    },
    [currentProfile, data.messageReactions, mode],
  );

  const markConversationRead = useCallback(
    async (conversationId: string) => {
      if (!currentProfile) return;
      const now = new Date().toISOString();

      setData((prev) => {
        const members = prev.conversationMembers || [];
        const existing = members.find(
          (m) => m.conversation_id === conversationId && m.user_id === currentProfile.id,
        );

        return existing
          ? { ...prev, conversationMembers: members.map((m) => (m.id === existing.id ? { ...m, last_read_at: now } : m)) }
          : prev;
      });

      if (supabase && mode === 'supabase') {
        const { error } = await supabase.from('conversation_members')
          .update({ last_read_at: now })
          .eq('conversation_id', conversationId)
          .eq('user_id', currentProfile.id);
        if (error) throw error;
      }
    },
    [currentProfile, mode],
  );

  const ensureScopedConversationSelfMembership = useCallback(
    async (conversationId: string) => {
      if (!currentProfile) throw new Error('Not logged in.');
      if (!supabase || mode !== 'supabase') return;
      const client = supabase;

      const selectSelfMembership = () => client
        .from('conversation_members')
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('user_id', currentProfile.id)
        .maybeSingle();

      let { data: membership, error: selectError } = await selectSelfMembership();
      if (selectError) throw selectError;

      if (!membership) {
        const { data: inserted, error: insertError } = await client
          .from('conversation_members')
          .insert({ conversation_id: conversationId, user_id: currentProfile.id })
          .select()
          .single();
        if (insertError) {
          // A concurrent/retried self insert may already have committed. Confirm
          // that exact self row; never create or accept membership for another user.
          const retry = await selectSelfMembership();
          if (retry.error) throw retry.error;
          if (!retry.data) throw insertError;
          membership = retry.data;
        } else {
          if (!inserted) throw new Error('Conversation membership insert returned no row.');
          membership = inserted;
        }
      }

      const confirmed = membership as ConversationMember;
      setData((previous) => {
        const members = previous.conversationMembers || [];
        const existingIndex = members.findIndex(
          (member) => member.conversation_id === conversationId && member.user_id === currentProfile.id,
        );
        return {
          ...previous,
          conversationMembers: existingIndex >= 0
            ? members.map((member, index) => index === existingIndex ? confirmed : member)
            : [...members, confirmed],
        };
      });
    },
    [currentProfile, mode],
  );

  const getOrCreateProjectConversation = useCallback(
    async (projectId: string, isInternal: boolean) => {
      if (!currentProfile) throw new Error('Not logged in.');
      const type = isInternal ? 'project_internal' : 'project_client';
      const existing = (data.conversations || []).find(
        (c) => c.project_id === projectId && c.type === type,
      );
      if (existing) {
        await ensureScopedConversationSelfMembership(existing.id);
        return existing;
      }

      if (supabase && mode === 'supabase') {
        const { data: created, error } = await supabase
          .from('conversations')
          .insert({ type, project_id: projectId, created_by: currentProfile.id })
          .select()
          .single();
        if (error) throw error;
        if (!created) throw new Error('Project conversation insert returned no row.');
        const confirmed = created as Conversation;
        await ensureScopedConversationSelfMembership(confirmed.id);
        setData((prev) => ({ ...prev, conversations: [...(prev.conversations || []), confirmed] }));
        return confirmed;
      }

      const now = new Date().toISOString();
      const newConv: Conversation = { id: createUuid(), type, project_id: projectId, created_by: currentProfile.id, created_at: now, updated_at: now };
      setData((prev) => ({
        ...prev,
        conversations: [...(prev.conversations || []), newConv],
      }));

      return newConv;
    },
    [currentProfile, data.conversations, ensureScopedConversationSelfMembership, mode],
  );

  const getOrCreateTaskConversation = useCallback(
    async (taskId: string) => {
      if (!currentProfile) throw new Error('Not logged in.');
      const existing = (data.conversations || []).find(
        (c) => c.task_id === taskId && c.type === 'task',
      );
      if (existing) {
        await ensureScopedConversationSelfMembership(existing.id);
        return existing;
      }

      if (supabase && mode === 'supabase') {
        const { data: created, error } = await supabase
          .from('conversations')
          .insert({ type: 'task', task_id: taskId, created_by: currentProfile.id })
          .select()
          .single();
        if (error) throw error;
        if (!created) throw new Error('Task conversation insert returned no row.');
        const confirmed = created as Conversation;
        await ensureScopedConversationSelfMembership(confirmed.id);
        setData((prev) => ({ ...prev, conversations: [...(prev.conversations || []), confirmed] }));
        return confirmed;
      }

      const now = new Date().toISOString();
      const newConv: Conversation = { id: createUuid(), type: 'task', task_id: taskId, created_by: currentProfile.id, created_at: now, updated_at: now };
      setData((prev) => ({
        ...prev,
        conversations: [...(prev.conversations || []), newConv],
      }));

      return newConv;
    },
    [currentProfile, data.conversations, ensureScopedConversationSelfMembership, mode],
  );

  const getOrCreateTeamChannel = useCallback(
    async (channelName: string) => {
      if (!currentProfile) throw new Error('Not logged in.');
      if (isClientRole(currentProfile.role)) throw new Error('Team channels are only available to team members.');

      const cleanName = channelName.trim().toLowerCase();
      if (!cleanName) throw new Error('Channel name is required.');

      if (supabase && mode === 'supabase') {
        const { data: conversationId, error } = await supabase.rpc('phase6_get_or_create_team_channel', {
          p_name: cleanName,
        });
        if (error) throw error;
        if (!conversationId) throw new Error('Team channel RPC returned no conversation ID.');

        await loadSupabaseData(currentProfile);
        const now = new Date().toISOString();
        return {
          id: String(conversationId),
          type: 'team_channel',
          name: cleanName,
          created_by: currentProfile.id,
          created_at: now,
          updated_at: now,
        } as Conversation;
      }

      const existing = (data.conversations || []).find(
        (conversation) => conversation.type === 'team_channel' && conversation.name === cleanName,
      );
      if (existing) return existing;

      const now = new Date().toISOString();
      const conversationId = createUuid();
      const conversation: Conversation = {
        id: conversationId,
        type: 'team_channel',
        name: cleanName,
        created_by: currentProfile.id,
        created_at: now,
        updated_at: now,
      };
      const members: ConversationMember[] = (data.profiles || [])
        .filter((profile) => !isClientRole(profile.role) && profile.status !== 'inactive')
        .map((profile) => ({
          id: createUuid(),
          conversation_id: conversationId,
          user_id: profile.id,
          last_read_at: now,
          created_at: now,
        }));

      setData((prev) => ({
        ...prev,
        conversations: [...(prev.conversations || []), conversation],
        conversationMembers: [...(prev.conversationMembers || []), ...members],
      }));
      return conversation;
    },
    [currentProfile, data.conversations, data.profiles, loadSupabaseData, mode],
  );

  const getOrCreateDM = useCallback(
    async (otherUserId: string) => {
      if (!currentProfile) throw new Error('Not logged in.');
      const existing = (data.conversations || []).find((c) => {
        if (c.type !== 'dm') return false;
        const members = (data.conversationMembers || []).filter((m) => m.conversation_id === c.id);
        const userIds = members.map((m) => m.user_id);
        return members.length === 2 && new Set(userIds).size === 2 &&
          userIds.includes(currentProfile.id) && userIds.includes(otherUserId);
      });
      if (existing) return existing;

      if (supabase && mode === 'supabase') {
        const { data: conversationId, error } = await supabase.rpc('phase6_create_direct_conversation', {
          p_other_user_id: otherUserId,
        });
        if (error) throw error;
        if (!conversationId) throw new Error('Direct conversation RPC returned no conversation ID.');
        await loadSupabaseData(currentProfile);
        return {
          id: String(conversationId), type: 'dm', created_by: currentProfile.id,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        } as Conversation;
      }

      const now = new Date().toISOString();
      const newConvId = createUuid();
      const newConv: Conversation = { id: newConvId, type: 'dm', created_by: currentProfile.id, created_at: now, updated_at: now };
      const member1: ConversationMember = { id: createUuid(), conversation_id: newConvId, user_id: currentProfile.id, last_read_at: now, created_at: now };
      const member2: ConversationMember = { id: createUuid(), conversation_id: newConvId, user_id: otherUserId, last_read_at: now, created_at: now };

      setData((prev) => ({
        ...prev,
        conversations: [...(prev.conversations || []), newConv],
        conversationMembers: [...(prev.conversationMembers || []), member1, member2],
      }));

      return newConv;
    },
    [currentProfile, data.conversationMembers, data.conversations, loadSupabaseData, mode],
  );

  return {
    mode,
    currentProfile,
    data,
    isLoading,
    isInitializing,
    isSubmittingLogin,
    error,
    setError,
    canManageAll,
    visibleProjects,
    visibleTasks,
    teamTasks,
    visibleNotifications,
    login,
    signUp,
    loginDemo,
    signOut,
    loadSupabaseData,
    createProject,
    updateProject,
    archiveProject,
    deleteProject,
    deletePayment,
    duplicateProject,
    addRevision,
    addNote,
    createRevisionRequest,
    updateRevisionRequest,
    updateRevisionItem,
    uploadRevisedProof,
    respondToRevisionRequest,
    approveProjectMilestone,
    submitStageForApproval,
    advanceWorkflowStage,
    completeFinalDelivery,
    setProjectLifecycle,
    updateWorkflowConfiguration,
    updateProjectFromDraft,
    requestStageSkip,
    respondToStageSkip,
    adminWorkflowOverride,
    createTask,
    updateTask,
    archiveTask,
    assignTaskCollaborator,
    removeTaskCollaborator,
    addTaskComment,
    updateTaskComment,
    deleteTaskComment,
    addTaskChecklistItem,
    toggleTaskChecklistItem,
    deleteTaskChecklistItem,
    addTaskDependency,
    removeTaskDependency,
    createSubtask,
    inviteClient,
    provisionClient,
    provisionTeamMember,
    updateProfile,
    markNotificationRead,
    markAllNotificationsRead,
    notificationToast,
    clearNotificationToast,
    saveEmployeeCompensation,
    addEmployeeLedgerEntry,
    deleteEmployeeLedgerEntry,
    saveInvoiceVersion,
    createFinanceTransaction,
    updateFinanceTransaction,
    deleteFinanceTransaction,
    softDeleteFinanceTransaction,
    restoreFinanceTransaction,
    saveFinanceBudget,
    sendMessage,
    toggleReaction,
    markConversationRead,
    getOrCreateProjectConversation,
    getOrCreateTaskConversation,
    getOrCreateTeamChannel,
    getOrCreateDM,
  };
}
