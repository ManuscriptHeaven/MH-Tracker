// Pure helpers, normalizers and payload mappers used by the useTracker hook.
// Moved out of useTracker.ts unchanged so the hook file only holds state and actions.
import { supabase } from './supabase';
import {
  type AttendanceDailySlice,
} from './attendanceDailyLedger';
import { errorMessage, firstName, isManagerRole } from './utils';
import {
  normalizeStage,
  type OfficialTimelineStage,
} from './timeline';
import type {
  Profile,
  Project,
  ProjectDraft,
  ProjectMetadataUpdate,
  ProjectPayment,
  RevisionActivity,
  RevisionAttachment,
  RevisionItem,
  Task,
  TaskDraft,
  TrackerData,
  Invoice,
  TimelineStage,
  WorkflowStage,
  WorkflowSettings,
} from './types';

export type AuthMode = 'demo' | 'supabase';

export function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createUuid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (character) =>
    (Number(character) ^ (Math.random() * 16 >> (Number(character) / 4))).toString(16),
  );
}

export function sanitizeMessageFileName(fileName: string) {
  const clean = fileName
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120);

  return clean || 'attachment';
}

export function sanitizeProjectSourceFileName(fileName: string) {
  return sanitizeMessageFileName(fileName).slice(0, 100);
}

export function isDesktopAttendanceClient() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return true;
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (nav.userAgentData?.mobile) return false;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return false;
  return true;
}

export const ATTENDANCE_PENDING_STORAGE_PREFIX = 'mh_attendance_pending_seconds_v1';

export type AttendancePresenceRuntime = {
  sessionId: string | null;
  lastSampleAtMs: number;
  lastMonotonicAtMs: number;
  fractionalMs: number;
  pendingSeconds: number;
  pendingDailySlices: AttendanceDailySlice[];
  isLeader: boolean;
  flushing: boolean;
  screenLocked: boolean;
  pageAway: boolean;
};

export type AttendanceIdleDetector = EventTarget & {
  screenState: 'locked' | 'unlocked' | null;
  start: (options?: { threshold?: number; signal?: AbortSignal }) => Promise<void>;
};

export type AttendanceIdleDetectorConstructor = {
  new (): AttendanceIdleDetector;
  requestPermission: () => Promise<'granted' | 'denied'>;
};

export function getAttendanceIdleDetectorConstructor(): AttendanceIdleDetectorConstructor | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { IdleDetector?: AttendanceIdleDetectorConstructor }).IdleDetector || null;
}

export function attendanceMonotonicNow() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export function attendancePendingStorageKey(userId: string, sessionId: string) {
  return `${ATTENDANCE_PENDING_STORAGE_PREFIX}:${userId}:${sessionId}`;
}

export function readAttendancePendingSeconds(userId: string, sessionId: string) {
  if (typeof window === 'undefined') return 0;
  try {
    const value = Number(localStorage.getItem(attendancePendingStorageKey(userId, sessionId)) || 0);
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  } catch {
    return 0;
  }
}

export function writeAttendancePendingSeconds(userId: string, sessionId: string, seconds: number) {
  if (typeof window === 'undefined') return;
  try {
    const key = attendancePendingStorageKey(userId, sessionId);
    const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    if (safeSeconds > 0) {
      localStorage.setItem(key, String(safeSeconds));
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Attendance must continue even when browser storage is unavailable.
  }
}


export function calculateBalance(totalPrice: number, advancePaid: number) {
  return Math.max(Number(totalPrice || 0) - Number(advancePaid || 0), 0);
}

export function cleanDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : null;
}

export function cleanText(value: string | null | undefined) {
  return value || '';
}

export function isMissingSchemaError(error: unknown) {
  const message = errorMessage(error, '').toLowerCase();
  return (
    message.includes('does not exist') ||
    message.includes('schema cache') ||
    message.includes('could not find') ||
    message.includes('relation') ||
    message.includes('column')
  );
}

export async function safeSelect<T>(
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

export function paymentMonthParts(dueDate: string | null | undefined) {
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

export type InvoiceVersionRow = Omit<Invoice, 'logical_invoice_id'> & {
  invoice_id: string;
};

export function normalizeInvoiceVersion(row: InvoiceVersionRow): Invoice {
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

export function normalizeProject(project: Project): Project {
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

export function normalizeClientProject(project: Partial<Project>): Project {
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

export function normalizeRevisionItem(item: Partial<RevisionItem>): RevisionItem {
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

export function normalizeRevisionAttachment(attachment: Partial<RevisionAttachment>): RevisionAttachment {
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

export function normalizeRevisionActivity(activity: Partial<RevisionActivity>): RevisionActivity {
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

export function normalizeTask(task: Partial<Task>): Task {
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

export function taskPayload(task: TaskDraft | Partial<Task>, createdBy?: string) {
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

export function projectMetadataPayload(project: ProjectMetadataUpdate | ProjectDraft) {
  return {
    client_name: project.client_name,
    client_email: project.client_email,
    company_name: project.company_name || null,
    contact_name: project.contact_name || null,
    billing_address: project.billing_address || null,
    author: project.author || null,
    invoice_description: project.invoice_description || null,
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

export function legacyTaskPayload(task: TaskDraft | Partial<Task>, createdBy?: string) {
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

export async function requiredSelect<T>(
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

export async function optionalV2Select<T>(
  query: PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ data: T[]; error: null }> {
  const { data, error } = await query;
  if (error) {
    if (isMissingSchemaError(error)) return { data: [], error: null };
    throw error;
  }
  return { data: data || [], error: null };
}

export function definedValues<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

export function canonicalSettings(settings?: WorkflowSettings): WorkflowSettings {
  return {
    exclude_weekends: settings?.exclude_weekends ?? true,
    files_received_days: 0,
    design_concept_days: settings?.design_concept_days ?? 3,
    print_version_days: settings?.print_version_days ?? 5,
    ebook_version_days: settings?.ebook_version_days ?? 5,
    final_delivery_days: settings?.final_delivery_days ?? 2,
    revision_days: settings?.revision_days ?? settings?.design_concept_revision_days ?? 2,
  };
}

export const CANONICAL_STAGE_BY_LABEL: Record<OfficialTimelineStage, WorkflowStage> = {
  'Files Received': 'files_received',
  'Design Concept': 'design_concept',
  'Concept Approval': 'concept_approval',
  'Print Version': 'print_version',
  'Print Approval': 'print_approval',
  'Ebook Version': 'ebook_version',
  'Ebook Approval': 'ebook_approval',
  'Final Delivery': 'final_delivery',
};

export function toWorkflowStage(stage: TimelineStage): WorkflowStage {
  const normalized = normalizeStage(stage);
  if (normalized === 'Completed' || normalized === 'On Hold' || normalized === 'Cancelled') {
    throw new Error(`${stage} is not a canonical workflow stage.`);
  }
  return CANONICAL_STAGE_BY_LABEL[normalized];
}

export function requireWorkflowVersion(project: Pick<Project, 'workflow_version'>) {
  if (!Number.isSafeInteger(project.workflow_version) || Number(project.workflow_version) < 0) {
    throw new Error('Phase 6 database configuration is incomplete: project workflow_version is unavailable.');
  }
  return Number(project.workflow_version);
}

export function paymentPayload(project: ProjectDraft | Partial<Project>) {
  return {
    total_price: Number(project.total_price || 0),
    advance_paid: Number(project.advance_paid || 0),
    payment_status: project.payment_status || 'Not Started',
    ...paymentMonthParts(project.due_date),
    payment_date: cleanDate(project.payment_date),
    notes: cleanText(project.payment_notes),
  };
}

export async function upsertProjectPayment(
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

export function mergePayments(projects: Project[], payments: ProjectPayment[]) {
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

export function canManageEverything(profile: Profile | null) {
  return isManagerRole(profile?.role);
}

export function cleanStorageName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'attachment';
}

export async function uploadRevisionFile({
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

export async function operationFingerprint(value: unknown) {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('This browser does not support the secure hashing required for safe action retries.');
  }
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function fileFingerprint(file: File, index = 0) {
  return `${index}:${file.name}:${file.size}:${file.type}:${file.lastModified}`;
}

export type AttachmentRetryProgress = {
  attachmentId: string;
  storagePath?: string;
  uploaded: boolean;
  insertAttempted: boolean;
  inserted: boolean;
};
export type RevisionSubmissionRetry = {
  requestId?: string;
  attachments: Map<string, AttachmentRetryProgress>;
  complete: boolean;
};
export type RevisedProofRetry = {
  attachment: AttachmentRetryProgress;
  rpcComplete: boolean;
};

export async function ensureRevisionAttachment(
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

export function paymentFieldsChanged(previous: Project, next: Project) {
  return (
    Number(previous.total_price || 0) !== Number(next.total_price || 0) ||
    Number(previous.advance_paid || 0) !== Number(next.advance_paid || 0) ||
    previous.payment_status !== next.payment_status ||
    cleanDate(previous.payment_date) !== cleanDate(next.payment_date) ||
    cleanText(previous.payment_notes) !== cleanText(next.payment_notes) ||
    cleanDate(previous.due_date) !== cleanDate(next.due_date)
  );
}

export function normalizeLoginValue(value: string) {
  return value.trim().toLowerCase();
}

export function profileMatchesLoginName(profile: Profile, loginName: string) {
  const normalizedLogin = normalizeLoginValue(loginName);

  return [profile.email, profile.full_name, firstName(profile.full_name)].some(
    (value) => normalizeLoginValue(value) === normalizedLogin,
  );
}

export function loginErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as any).message) : 'Login failed.';

  if (message.toLowerCase().includes('invalid login credentials')) {
    return 'Name or password is incorrect.';
  }

  if (message.includes('find_login_email')) {
    return 'Name login is not set up in Supabase yet. Please run the latest database update.';
  }

  return message;
}

export function signupErrorMessage(error: unknown) {
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

export const AUTH_PROFILE_STORAGE_KEY = 'mh_auth_profile';
export const AUTH_MODE_STORAGE_KEY = 'mh_auth_mode';
export const TRACKER_DATA_STORAGE_KEY = 'mh_tracker_cache';

export function createEmptyTrackerData(profile: Profile | null = null): TrackerData {
  return {
    profiles: profile ? [profile] : [],
    projects: [],
    revisionNotes: [],
    projectNotes: [],
    activityLogs: [],
    projectInitialFiles: [],
    projectClientReminders: [],
    projectDelayMetrics: [],
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
    attendanceSessions: [],
    attendanceBreaks: [],
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

export function getStoredProfile(): Profile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AUTH_PROFILE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

export function setStoredProfile(profile: Profile | null) {
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

export function getStoredMode(): AuthMode {
  if (typeof window === 'undefined') return supabase ? 'supabase' : 'demo';
  try {
    const raw = localStorage.getItem(AUTH_MODE_STORAGE_KEY) as AuthMode | null;
    if (raw === 'supabase' || raw === 'demo') return raw;
  } catch {
    // fallback
  }
  return supabase ? 'supabase' : 'demo';
}

export function setStoredMode(mode: AuthMode | null) {
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

export function getStoredTrackerData(): TrackerData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TRACKER_DATA_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TrackerData) : null;
  } catch {
    return null;
  }
}

export function setStoredTrackerData(trackerData: TrackerData) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(TRACKER_DATA_STORAGE_KEY, JSON.stringify(trackerData));
  } catch {
    // ignore quota errors
  }
}

export function clearStoredAuth() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(AUTH_PROFILE_STORAGE_KEY);
    localStorage.removeItem(AUTH_MODE_STORAGE_KEY);
    localStorage.removeItem(TRACKER_DATA_STORAGE_KEY);
  } catch {
    // ignore
  }
}
