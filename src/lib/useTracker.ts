import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { sampleData, sampleProfiles } from './sampleData';
import { errorMessage, firstName, isClientRole, isManagerRole } from './utils';
import {
  fetchNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  subscribeToNotifications,
} from './notifications';
import { notifyWithSoundAndVoice } from './sound';
import {
  calculateStageDueDate,
  createStageHistoryEntry,
  deriveProjectTimeline,
  getStageDurationDays,
  getWorkflowSettings,
  isClientApprovalStage,
  nextStageAfterApproval,
  normalizeStage,
  validateTimelineDates,
  type ApprovalMilestone,
} from './timeline';
import type {
  ActivityLog,
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
  ProjectPayment,
  ProjectNote,
  RevisionActivity,
  RevisionAttachment,
  RevisionItem,
  ProjectStatus,
  RevisionNote,
  RevisionRequest,
  RevisionRequestDraft,
  RevisionStatus,
  Role,
  Task,
  TaskDraft,
  TrackerData,
  FinanceBudget,
  FinanceTransaction,
  FinanceTransactionDraft,
  Conversation,
  ConversationMember,
  ChatMessage,
  MessageAttachment,
  MessageReaction,
  MessageMention,
  TimelineStage,
} from './types';
import { DEFAULT_EXCHANGE_RATES } from './financeUtils';

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

function isEnumStatusError(error: unknown) {
  const message = errorMessage(error, '').toLowerCase();
  return (
    message.includes('enum') ||
    message.includes('project_status') ||
    message.includes('22p02') ||
    message.includes('invalid input value for enum')
  );
}

const LEGACY_STATUS_FALLBACK_MAP: Record<string, string> = {
  Active: 'In Progress',
  'Awaiting Client Approval': 'Client Review',
  'Final Delivery': 'Ready for Delivery',
  'In Revision': 'In Revision',
  'In Progress': 'In Progress',
  Completed: 'Completed',
  'On Hold': 'On Hold',
  Cancelled: 'Cancelled',
};

async function safeSelect<T>(
  query: PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ data: T[]; error: null }> {
  const { data, error } = await query;

  if (error) {
    if (isMissingSchemaError(error)) {
      return { data: [], error: null };
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

function normalizeProject(project: Project): Project {
  const totalPrice = Number(project.total_price || 0);
  const advancePaid = Number(project.advance_paid || 0);

  return deriveProjectTimeline({
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
  });
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

function normalizeRevisionRequest(request: Partial<RevisionRequest>): RevisionRequest {
  const now = new Date().toISOString();

  return {
    id: request.id || createId('revision-request'),
    project_id: request.project_id || '',
    client_id: request.client_id || '',
    title: request.title || 'Revision Request',
    description: request.description || '',
    instructions: request.instructions || request.description || request.title || '',
    team_response: request.team_response || null,
    priority: request.priority || 'Normal',
    status: request.status || 'Submitted',
    assigned_to: request.assigned_to || null,
    submitted_at: request.submitted_at || request.created_at || now,
    completed_at: request.completed_at || null,
    created_at: request.created_at || now,
    updated_at: request.updated_at || now,
  };
}

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
    due_date: cleanDate(task.due_date),
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
    due_date: cleanDate(task.due_date),
    completed_at: task.status === 'Done' ? existingCompletedAt || new Date().toISOString() : null,
    ...(createdBy ? { created_by: createdBy } : {}),
  };
}

function supabaseProjectPayload(project: ProjectDraft | Partial<Project>) {
  const {
    id,
    project_number,
    total_price,
    advance_paid,
    remaining_balance,
    payment_status,
    payment_date,
    payment_notes,
    created_by,
    created_at,
    updated_at,
    invoiced,
    invoice_id,
    invoiced_at,
    client_profile_id,
    ...payload
  } = project as Partial<Project>;

  void id;
  void project_number;
  void total_price;
  void advance_paid;
  void remaining_balance;
  void payment_status;
  void payment_date;
  void payment_notes;
  void created_by;
  void created_at;
  void updated_at;
  void invoiced;
  void invoice_id;
  void invoiced_at;
  void client_profile_id;

  return {
    ...payload,
    assigned_to: payload.assigned_to || null,
    project_manager: payload.project_manager || null,
    start_date: cleanDate(payload.start_date),
    due_date: cleanDate(payload.due_date),
    internal_deadline: cleanDate(payload.internal_deadline),
    delivery_date: cleanDate(payload.delivery_date),
    files_received_date: cleanDate(payload.files_received_date),
    design_concept_due_date: cleanDate(payload.design_concept_due_date),
    design_concept_submitted_date: cleanDate(payload.design_concept_submitted_date),
    design_concept_approval_date: cleanDate(payload.design_concept_approval_date),
    concept_revision_due_date: cleanDate(payload.concept_revision_due_date),
    print_version_due_date: cleanDate(payload.print_version_due_date),
    print_version_submitted_date: cleanDate(payload.print_version_submitted_date),
    print_version_approval_date: cleanDate(payload.print_version_approval_date),
    print_revision_due_date: cleanDate(payload.print_revision_due_date),
    ebook_due_date: cleanDate(payload.ebook_due_date),
    ebook_submitted_date: cleanDate(payload.ebook_submitted_date),
    ebook_approval_date: cleanDate(payload.ebook_approval_date),
    final_delivery_date: cleanDate(payload.final_delivery_date),
    print_timeline_days: payload.print_timeline_days || 5,
    progress_percentage: Number(payload.progress_percentage || 0),
    production_days_used: Number(payload.production_days_used || 0),
    client_action_required: cleanText(payload.client_action_required),
    delay_reason: cleanText(payload.delay_reason),
  };
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

function basePaymentPayload(project: ProjectDraft | Partial<Project>) {
  return {
    total_price: Number(project.total_price || 0),
    advance_paid: Number(project.advance_paid || 0),
    payment_status: project.payment_status || 'Not Started',
  };
}

function isMissingPaymentMetadataColumn(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message || '');
  return (
    message.includes('payment_date') ||
    message.includes('payment_month') ||
    message.includes('payment_year') ||
    message.includes('due_date') ||
    message.includes('notes')
  );
}

async function upsertProjectPayment(
  projectId: string,
  project: ProjectDraft | Partial<Project>,
  updatedBy: string,
) {
  if (!supabase) {
    return;
  }

  const { error } = await supabase.from('project_payments').upsert(
    {
      project_id: projectId,
      ...paymentPayload(project),
      updated_by: updatedBy,
    },
    { onConflict: 'project_id' },
  );

  if (!error) {
    return;
  }

  if (!isMissingPaymentMetadataColumn(error)) {
    throw error;
  }

  const { error: fallbackError } = await supabase.from('project_payments').upsert(
    {
      project_id: projectId,
      ...basePaymentPayload(project),
      updated_by: updatedBy,
    },
    { onConflict: 'project_id' },
  );

  if (fallbackError) {
    throw fallbackError;
  }
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
}: {
  clientId: string;
  projectId: string;
  requestId: string;
  file: File;
  itemId?: string | null;
}) {
  if (!supabase) {
    return '';
  }

  const safeName = cleanStorageName(file.name);
  const itemPath = itemId ? `${itemId}/` : '';
  const path = `${clientId}/${projectId}/${requestId}/${itemPath}${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from('revision-files').upload(path, file, {
    upsert: false,
  });

  if (error) {
    throw error;
  }

  return path;
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
  const initialData = useMemo(() => getStoredTrackerData() || sampleData, []);

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(initialProfile);
  const [data, setData] = useState<TrackerData>(initialData);
  // isInitializing is true only on cold startup when no cached profile exists
  const [isInitializing, setIsInitializing] = useState<boolean>(() => Boolean(supabase && !initialProfile));
  const [isSubmittingLogin, setIsSubmittingLogin] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notificationToast, setNotificationToast] = useState<NotificationItem | null>(null);

  const isRestoringRef = useRef<boolean>(false);

  const loadSupabaseData = useCallback(async (profile: Profile) => {
    if (!supabase) {
      return;
    }

    setIsLoading(true);
    setError(null);

    const profileIsClient = isClientRole(profile.role);
    const canManage = canManageEverything(profile);
    const emptyResult = Promise.resolve({ data: [], error: null });

    if (canManage) {
      const { error: timelineNotificationError } = await supabase.rpc('create_timeline_deadline_notifications');
      if (timelineNotificationError && !isMissingSchemaError(timelineNotificationError)) {
        console.warn('Timeline notification check failed:', timelineNotificationError);
      }
    }

    const profilesPromise = profileIsClient
      ? safeSelect<Profile>(supabase.from('profiles').select('*').eq('id', profile.id))
      : safeSelect<Profile>(supabase.from('profiles').select('*').order('full_name'));

    const projectsPromise = profileIsClient
      ? safeSelect<Partial<Project>>(
          supabase.from('client_project_summaries').select('*'),
        )
      : safeSelect<Project>(supabase.from('projects').select('*').order('created_at', { ascending: false }));

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
      : canManage
        ? safeSelect<Task>(
            supabase
              .from('tasks')
              .select('*')
              .order('status', { ascending: true })
              .order('due_date', { ascending: true, nullsFirst: false })
              .order('created_at', { ascending: false }),
          )
        : safeSelect<Task>(
            supabase
              .from('tasks')
              .select('*')
              .eq('assigned_to', profile.id)
              .order('status', { ascending: true })
              .order('due_date', { ascending: true, nullsFirst: false })
              .order('created_at', { ascending: false }),
          );

    const clientAccessPromise = canManage || profileIsClient
      ? safeSelect<ClientProjectAccess>(supabase.from('client_project_access').select('*').order('created_at'))
      : emptyResult;

    const revisionRequestsPromise = profileIsClient
      ? safeSelect<Partial<RevisionRequest>>(
          supabase.from('client_revision_requests').select('*').order('created_at', { ascending: false }),
        )
      : safeSelect<RevisionRequest>(supabase.from('revision_requests').select('*').order('created_at', { ascending: false }));

    const revisionItemsPromise = profileIsClient
      ? safeSelect<Partial<RevisionItem>>(
          supabase.from('client_revision_items').select('*').order('sort_order', { ascending: true }),
        )
      : safeSelect<RevisionItem>(supabase.from('revision_items').select('*').order('sort_order', { ascending: true }));

    const revisionAttachmentsPromise = profileIsClient
      ? safeSelect<Partial<RevisionAttachment>>(
          supabase.from('client_revision_attachments').select('*').order('created_at', { ascending: false }),
        )
      : safeSelect<RevisionAttachment>(
          supabase.from('revision_attachments').select('*').order('created_at', { ascending: false }),
        );

    const revisionActivityPromise = profileIsClient
      ? safeSelect<Partial<RevisionActivity>>(
          supabase.from('client_revision_activity').select('*').order('created_at', { ascending: false }),
        )
      : safeSelect<RevisionActivity>(supabase.from('revision_activity').select('*').order('created_at', { ascending: false }));

    const employeeCompensationPromise = profile.role === 'admin' || profile.role === 'manager'
      ? safeSelect<EmployeeCompensation>(supabase.from('employee_compensation').select('*'))
      : emptyResult;
    const employeeLedgerPromise = profile.role === 'admin' || profile.role === 'manager'
      ? safeSelect<EmployeeLedgerEntry>(supabase.from('employee_ledger').select('*').order('paid_at', { ascending: false }))
      : emptyResult;
    const financeTransactionsPromise = canManage
      ? safeSelect<FinanceTransaction>(supabase.from('finance_transactions').select('*').order('transaction_date', { ascending: false }))
      : emptyResult;
    const financeBudgetsPromise = canManage
      ? safeSelect<FinanceBudget>(supabase.from('finance_budgets').select('*'))
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
      clientAccessRes,
      revisionRequestsRes,
      revisionItemsRes,
      revisionAttachmentsRes,
      revisionActivityRes,
      employeeCompensationRes,
      employeeLedgerRes,
      financeTransactionsRes,
      financeBudgetsRes,
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
      clientAccessPromise,
      revisionRequestsPromise,
      revisionItemsPromise,
      revisionAttachmentsPromise,
      revisionActivityPromise,
      employeeCompensationPromise,
      employeeLedgerPromise,
      financeTransactionsPromise,
      financeBudgetsPromise,
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
      profiles: profilesRes.data as Profile[],
      projects: mergePayments(projects, payments),
      revisionNotes: revisionsRes.data as RevisionNote[],
      projectNotes: notesRes.data as ProjectNote[],
      activityLogs: activityRes.data as ActivityLog[],
      tasks: (tasksRes.data as Partial<Task>[]).map(normalizeTask),
      notifications,
      clientProjectAccess: clientAccessRes.data as ClientProjectAccess[],
      revisionRequests: (revisionRequestsRes.data as Partial<RevisionRequest>[]).map(normalizeRevisionRequest),
      revisionItems: (revisionItemsRes.data as Partial<RevisionItem>[]).map(normalizeRevisionItem),
      revisionAttachments: (revisionAttachmentsRes.data as Partial<RevisionAttachment>[]).map(normalizeRevisionAttachment),
      revisionActivity: (revisionActivityRes.data as Partial<RevisionActivity>[]).map(normalizeRevisionActivity),
      employeeCompensation: employeeCompensationRes.data as EmployeeCompensation[],
      employeeLedger: employeeLedgerRes.data as EmployeeLedgerEntry[],
      financeTransactions: financeTransactionsRes.data as FinanceTransaction[],
      financeBudgets: financeBudgetsRes.data as FinanceBudget[],
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

    // Realtime chat message and reaction synchronization
    const subscription = supabaseClient
      .channel(`realtime-chat-sync:${currentProfile.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const newMsg = payload.new as ChatMessage;
          if (!newMsg || !newMsg.id) return;

          setData((prev) => {
            const exists = (prev.messages || []).some((m) => m.id === newMsg.id);
            if (exists) return prev;

            // Trigger sound and voice alert if message was sent by another user
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
          const updatedMember = payload.new as ConversationMember;
          if (!updatedMember || !updatedMember.id) return;

          setData((prev) => {
            const members = prev.conversationMembers || [];
            const idx = members.findIndex(
              (m) =>
                m.id === updatedMember.id ||
                (m.conversation_id === updatedMember.conversation_id && m.user_id === updatedMember.user_id),
            );

            if (idx >= 0) {
              const next = [...members];
              next[idx] = updatedMember;
              return { ...prev, conversationMembers: next };
            }

            return { ...prev, conversationMembers: [...members, updatedMember] };
          });
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
  }, [currentProfile, mode]);

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
        let email = cleanLoginName;

        if (!cleanLoginName.includes('@')) {
          const { data: loginEmail, error: lookupError } = await supabase.rpc('find_login_email', {
            login_name: cleanLoginName,
          });

          if (lookupError) {
            throw lookupError;
          }

          if (!loginEmail) {
            throw new Error('No active user found with that name. Ask admin to check the Supabase profile.');
          }

          email = String(loginEmail);
        }

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
              role,
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
          role,
          status: 'active',
          created_at: new Date().toISOString(),
        };

        // If a session exists, try updating profile and team_members client-side (otherwise Postgres trigger handles it server-side)
        if (authData.session) {
          try {
            await supabase.from('profiles').upsert(profileObj, { onConflict: 'id' });
            await supabase.from('team_members').upsert(
              {
                full_name: cleanFullName,
                email: cleanEmail,
                role,
                status: 'active',
              },
              { onConflict: 'email' },
            );
          } catch (upsertErr) {
            console.warn('Post-signup table upsert warning:', upsertErr);
          }

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
    async (entry: Omit<ActivityLog, 'id' | 'created_at'>) => {
      const activity: ActivityLog = {
        ...entry,
        id: createId('activity'),
        created_at: new Date().toISOString(),
      };

      setData((previous) => ({
        ...previous,
        activityLogs: [activity, ...previous.activityLogs],
      }));

      if (supabase && mode === 'supabase') {
        await supabase.from('activity_logs').insert({
          project_id: activity.project_id || null,
          action: activity.action,
          old_value: activity.old_value || null,
          new_value: activity.new_value || null,
          user_id: activity.user_id,
        });
      }
    },
    [mode],
  );

  const createProject = useCallback(
    async (draft: ProjectDraft) => {
      if (!currentProfile) {
        return null;
      }

      const now = new Date().toISOString();
      const timelineErrors = validateTimelineDates(draft);
      if (timelineErrors.length) {
        throw new Error(timelineErrors[0]);
      }

      const timelineDraft = deriveProjectTimeline(draft, { syncStatus: true });
      const localProject: Project = normalizeProject({
        ...timelineDraft,
        id: createId('project'),
        project_number: timelineDraft.project_number || `MH-${1001 + data.projects.length}`,
        created_by: currentProfile.id,
        created_at: now,
        updated_at: now,
        remaining_balance: calculateBalance(timelineDraft.total_price, timelineDraft.advance_paid),
      });

      if (supabase && mode === 'supabase') {
        const payload = supabaseProjectPayload(localProject);
        let insertedProject: Project | null = null;

        const { data: inserted, error: insertError } = await supabase
          .from('projects')
          .insert({
            ...payload,
            created_by: currentProfile.id,
          })
          .select()
          .single();

        if (insertError) {
          if (isEnumStatusError(insertError)) {
            console.warn('Enum status error during project insert, retrying with compatible fallback status:', insertError);
            const fallbackStatus = LEGACY_STATUS_FALLBACK_MAP[localProject.status] || 'In Progress';
            const { data: retryData, error: retryError } = await supabase
              .from('projects')
              .insert({
                ...payload,
                status: fallbackStatus,
                created_by: currentProfile.id,
              })
              .select()
              .single();

            if (retryError) throw retryError;
            insertedProject = retryData as Project;
          } else {
            throw insertError;
          }
        } else {
          insertedProject = inserted as Project;
        }

        const projectPayment = paymentPayload(localProject);
        await upsertProjectPayment(insertedProject.id, localProject, currentProfile.id);

        const project = normalizeProject({
          ...insertedProject,
          ...localProject,
          total_price: projectPayment.total_price,
          advance_paid: projectPayment.advance_paid,
          payment_status: projectPayment.payment_status,
          payment_date: projectPayment.payment_date,
          payment_notes: projectPayment.notes,
        });

        // Auto-link to client_project_access if a client profile with matching email exists
        if (localProject.client_email) {
          const matchingClient = data.profiles.find(
            (p) => isClientRole(p.role) && p.email && p.email.trim().toLowerCase() === localProject.client_email.trim().toLowerCase(),
          );
          if (matchingClient) {
            await supabase
              .from('client_project_access')
              .upsert(
                { client_id: matchingClient.id, project_id: project.id },
                { onConflict: 'client_id,project_id' },
              );
          }
        }

        setData((previous) => ({ ...previous, projects: [project, ...previous.projects] }));
        await addActivity({
          project_id: project.id,
          action: 'Project created',
          old_value: null,
          new_value: project.project_title,
          user_id: currentProfile.id,
        });
        await addActivity({
          project_id: project.id,
          action: 'Timeline started',
          old_value: null,
          new_value: project.current_stage || project.status,
          user_id: currentProfile.id,
        });
        return project;
      }

      setData((previous) => ({ ...previous, projects: [localProject, ...previous.projects] }));
      await addActivity({
        project_id: localProject.id,
        action: 'Project created',
        old_value: null,
        new_value: localProject.project_title,
        user_id: currentProfile.id,
      });
      await addActivity({
        project_id: localProject.id,
        action: 'Timeline started',
        old_value: null,
        new_value: localProject.current_stage || localProject.status,
        user_id: currentProfile.id,
      });
      return localProject;
    },
    [addActivity, currentProfile, data.projects.length, mode],
  );

  const updateProject = useCallback(
    async (projectId: string, updates: Partial<Project>) => {
      if (!currentProfile) {
        throw new Error('No signed-in profile found.');
      }

      const existing = data.projects.find((project) => project.id === projectId);
      if (!existing) {
        throw new Error('Project not found in the current project list.');
      }

      const timelineErrors = validateTimelineDates({ ...existing, ...updates });
      if (timelineErrors.length) {
        throw new Error(timelineErrors[0]);
      }

      const nextProject = normalizeProject({
        ...deriveProjectTimeline({ ...existing, ...updates }, { syncStatus: true }),
        updated_at: new Date().toISOString(),
      });

      if (supabase && mode === 'supabase') {
        let updated: Project | null = null;
        try {
          const payload = supabaseProjectPayload(nextProject);
          let { data: updatedData, error: updateError } = await supabase
            .from('projects')
            .update({
              ...payload,
              updated_at: nextProject.updated_at,
            })
            .eq('id', projectId)
            .select()
            .maybeSingle();

          if (updateError && isEnumStatusError(updateError)) {
            console.warn('Enum status error during project update, retrying with compatible fallback status:', updateError);
            const fallbackStatus = LEGACY_STATUS_FALLBACK_MAP[nextProject.status] || 'In Progress';
            const { data: retryData, error: retryError } = await supabase
              .from('projects')
              .update({
                ...payload,
                status: fallbackStatus,
                updated_at: nextProject.updated_at,
              })
              .eq('id', projectId)
              .select()
              .maybeSingle();

            if (retryError) {
              if (isMissingSchemaError(retryError)) {
                console.warn('Supabase project update schema warning:', retryError);
              } else {
                throw retryError;
              }
            } else {
              updatedData = retryData;
              updateError = null;
            }
          }

          if (updateError) {
            if (isMissingSchemaError(updateError)) {
              console.warn('Supabase project update schema warning:', updateError);
            } else {
              throw updateError;
            }
          }
          if (updatedData) {
            updated = updatedData as Project;
          }
        } catch (err) {
          if (isMissingSchemaError(err)) {
            console.warn('Supabase project update warning:', err);
          } else {
            throw err;
          }
        }

        const hasPaymentUpdate = paymentFieldsChanged(existing, nextProject);

        if (hasPaymentUpdate && canManageEverything(currentProfile)) {
          await upsertProjectPayment(projectId, nextProject, currentProfile.id);
        }

        const project = normalizeProject({
          ...(updated as Project || nextProject),
          ...nextProject,
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

      if (updates.status && updates.status !== existing.status) {
        await addActivity({
          project_id: projectId,
          action: 'Status changed',
          old_value: existing.status,
          new_value: updates.status,
          user_id: currentProfile.id,
        });
      }

      if (nextProject.current_stage && nextProject.current_stage !== existing.current_stage) {
        await addActivity({
          project_id: projectId,
          action: 'Timeline stage changed',
          old_value: existing.current_stage || existing.status,
          new_value: nextProject.current_stage,
          user_id: currentProfile.id,
        });
      }

      if (updates.assigned_to && updates.assigned_to !== existing.assigned_to) {
        await addActivity({
          project_id: projectId,
          action: 'Assigned to employee',
          old_value: existing.assigned_to,
          new_value: updates.assigned_to,
          user_id: currentProfile.id,
        });
      }

      if (supabase && mode === 'supabase') {
        await loadSupabaseData(currentProfile);
      }

      return nextProject;
    },
    [addActivity, currentProfile, data.projects, loadSupabaseData, mode],
  );

  const deleteProject = useCallback(
    async (projectId: string) => {
      if (!currentProfile || currentProfile.role !== 'admin') {
        throw new Error('Only admins can delete projects.');
      }

      if (supabase && mode === 'supabase') {
        const { error: deleteError } = await supabase.from('projects').delete().eq('id', projectId);
        if (deleteError) {
          throw deleteError;
        }
      }

      setData((previous) => ({
        ...previous,
        projects: previous.projects.filter((project) => project.id !== projectId),
        revisionNotes: previous.revisionNotes.filter((revision) => revision.project_id !== projectId),
        projectNotes: previous.projectNotes.filter((note) => note.project_id !== projectId),
        activityLogs: previous.activityLogs.filter((activity) => activity.project_id !== projectId),
      }));
    },
    [currentProfile, mode],
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

        await supabase
          .from('projects')
          .update({
            status: 'In Revision',
            waiting_on: 'Manuscript Heaven',
            updated_at: new Date().toISOString(),
          })
          .eq('id', projectId);

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
        user_id: currentProfile.id,
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
        user_id: currentProfile.id,
      });

      return projectNote;
    },
    [addActivity, currentProfile, mode],
  );

  const createRevisionRequest = useCallback(
    async (draft: RevisionRequestDraft) => {
      if (!currentProfile) {
        throw new Error('No signed-in profile found.');
      }

      if (!isClientRole(currentProfile.role)) {
        throw new Error('Only client users can submit client revision requests.');
      }

      const project = data.projects.find((item) => item.id === draft.project_id);
      if (!project) {
        throw new Error('Project not found for this client.');
      }

      const instructions = draft.instructions?.trim() || draft.description?.trim() || '';

      if (!instructions) {
        throw new Error('Please add revision instructions before submitting.');
      }

      const settings = getWorkflowSettings(project);
      const today = new Date().toISOString().slice(0, 10);
      const now = new Date().toISOString();
      const currentStage = project.current_stage || 'Concept Approval';
      const revisionDays = getStageDurationDays(currentStage, settings, true) || 2;
      const stageDueDate = calculateStageDueDate(today, revisionDays, settings);
      const revCount = (project.revision_count || 0) + 1;

      const projectUpdates: Partial<Project> = {
        status: 'In Revision' as ProjectStatus,
        current_stage: currentStage,
        stage_status: 'REVISION_ACTIVE',
        waiting_on: 'Manuscript Heaven',
        timeline_status: 'Revision Required',
        stage_started_at: now,
        stage_due_at: stageDueDate,
        revision_count: revCount,
        client_action_required: '',
        updated_at: now,
      };

      // Build notifications for every relevant team member
      const notificationTitle = `Revision Requested: ${project.project_title}`;
      const notificationMessage = `Client requested ${currentStage} revision #${revCount}. ${revisionDays} production day${revisionDays === 1 ? '' : 's'} allocated.`;

      const notificationRecipients = [
        project.assigned_to,
        project.project_manager,
        ...data.profiles.filter(p => p.role === 'admin').map(p => p.id)
      ].filter((id): id is string => Boolean(id) && id !== currentProfile.id);

      const buildNotification = (recipientId: string): NotificationItem => ({
        id: createId('notification'),
        recipient_id: recipientId,
        project_id: project.id,
        type: 'revision_requested',
        title: notificationTitle,
        message: notificationMessage,
        is_read: false,
        created_at: now,
      });

      const historyEntry = createStageHistoryEntry(
        project,
        `Client requested revision #${revCount} for ${currentStage}`,
        currentProfile.id,
        instructions,
      );

      // -------------------------------------------------------
      // SUPABASE PATH: Call the atomic security-definer RPC.
      // This bypasses client-role RLS restrictions on the projects
      // table and performs all steps in a single transaction:
      //   1. Insert revision_request
      //   2. Update project workflow state (stage_status, waiting_on, etc.)
      //   3. Create stage history entry
      //   4. Create notifications for all team members
      // -------------------------------------------------------
      if (supabase && mode === 'supabase') {
        const supabaseClient = supabase;
        // ---- Optimistic local state update ----
        // Update the UI immediately so the client sees 'In Revision' right away
        // without waiting for loadSupabaseData to complete.
        setData((previous) => ({
          ...previous,
          projects: previous.projects.map((item) =>
            item.id === draft.project_id
              ? normalizeProject({ ...item, ...projectUpdates })
              : item,
          ),
        }));

        try {
          const { data: rpcData, error: rpcError } = await supabaseClient.rpc('submit_client_revision', {
            p_project_id:   draft.project_id,
            p_client_id:    currentProfile.id,
            p_title:        draft.title?.trim() || '',
            p_description:  instructions,
            p_instructions: instructions,
            p_priority:     draft.priority || 'Normal',
          });

          if (rpcError) {
            // Roll back optimistic update on failure
            setData((previous) => ({
              ...previous,
              projects: previous.projects.map((item) =>
                item.id === draft.project_id
                  ? normalizeProject({ ...item, stage_status: project.stage_status, waiting_on: project.waiting_on, status: project.status })
                  : item,
              ),
            }));
            throw rpcError;
          }

          const requestId = rpcData as string;

          // Upload attachments after the revision is created
          await Promise.all(
            (draft.attachments || []).map(async (file) => {
              const fileUrl = await uploadRevisionFile({
                clientId: currentProfile.id,
                projectId: draft.project_id,
                requestId,
                file,
              });
              await supabaseClient.from('revision_attachments').insert({
                revision_request_id: requestId,
                revision_item_id: null,
                file_name: file.name,
                file_url: fileUrl,
                file_type: 'client_attachment',
                uploaded_by: currentProfile.id,
              });
            }),
          );

          // Reload all data to sync the new state from the database
          await loadSupabaseData(currentProfile);

          const builtRequest = normalizeRevisionRequest({
            id: requestId,
            project_id: draft.project_id,
            client_id: currentProfile.id,
            title: draft.title?.trim() || `Revision request for ${project.project_title}`,
            description: instructions,
            instructions,
            team_response: null,
            priority: draft.priority || 'Normal',
            status: 'Submitted',
            submitted_at: now,
            created_at: now,
            updated_at: now,
          });

          return builtRequest;
        } catch (revisionError) {
          console.error('Revision submission failed:', revisionError);
          throw new Error(errorMessage(revisionError, 'Revision request could not be submitted. Please try again.'));
        }
      }

      const request = normalizeRevisionRequest({
        id: createId('client-revision'),
        project_id: draft.project_id,
        client_id: currentProfile.id,
        title: draft.title?.trim() || `Revision request for ${project.project_title}`,
        description: instructions,
        instructions,
        team_response: null,
        priority: draft.priority || 'Normal',
        status: 'Submitted',
        submitted_at: now,
        created_at: now,
        updated_at: now,
      });
      const attachments = (draft.attachments || []).map((file) =>
        normalizeRevisionAttachment({
          id: createId('revision-attachment'),
          revision_request_id: request.id,
          revision_item_id: null,
          file_name: file.name,
          file_url: file.name,
          file_type: 'client_attachment',
          uploaded_by: currentProfile.id,
          created_at: now,
        }),
      );

      setData((previous) => ({
        ...previous,
        projects: previous.projects.map((item) =>
          item.id === draft.project_id
            ? normalizeProject({
                ...item,
                ...projectUpdates,
              })
            : item,
        ),
        revisionRequests: [request, ...previous.revisionRequests],
        revisionAttachments: [...attachments, ...previous.revisionAttachments],
        // Add a notification for each unique team member (deduplicated)
        notifications: [
          ...[...new Set(notificationRecipients)].map((recipientId) => buildNotification(recipientId)),
          ...previous.notifications,
        ],
        stageHistory: [historyEntry, ...(previous.stageHistory || [])],
        revisionActivity: [
          normalizeRevisionActivity({
            id: createId('revision-activity'),
            revision_request_id: request.id,
            user_id: currentProfile.id,
            action: 'Revision submitted',
            previous_value: null,
            new_value: request.instructions,
            created_at: now,
          }),
          ...previous.revisionActivity,
        ],
      }));

      return request;
    },
    [currentProfile, data.profiles, data.projects, loadSupabaseData, mode],
  );

  const updateRevisionRequest = useCallback(
    async (requestId: string, updates: Partial<RevisionRequest>) => {
      if (!currentProfile) {
        throw new Error('No signed-in profile found.');
      }

      if (supabase && mode === 'supabase') {
        const payload = {
          assigned_to: updates.assigned_to,
          status: updates.status,
          priority: updates.priority,
          team_response: updates.team_response,
          completed_at:
            updates.status === 'Approved' || updates.status === 'Completed' ? new Date().toISOString() : updates.completed_at,
        };

        const { error } = await supabase.from('revision_requests').update(payload).eq('id', requestId);
        if (error) {
          throw error;
        }

        await loadSupabaseData(currentProfile);
        return;
      }

      setData((previous) => ({
        ...previous,
        revisionRequests: previous.revisionRequests.map((request) =>
          request.id === requestId
            ? normalizeRevisionRequest({
                ...request,
                ...updates,
                completed_at:
                  updates.status === 'Approved' || updates.status === 'Completed'
                    ? new Date().toISOString()
                    : request.completed_at,
                updated_at: new Date().toISOString(),
              })
            : request,
        ),
      }));
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
    async (requestId: string, file: File) => {
      if (!currentProfile) {
        throw new Error('No signed-in profile found.');
      }

      const request = data.revisionRequests.find((item) => item.id === requestId);
      if (!request) {
        throw new Error('Revision request not found.');
      }

      const project = data.projects.find((p) => p.id === request.project_id);
      const now = new Date().toISOString();

      const stage = project?.current_stage || 'Print Approval';
      const approvalStatus: ProjectStatus = 'Awaiting Client Approval';

      const projectUpdates: Partial<Project> = {
        status: approvalStatus,
        stage_status: 'PAUSED_CLIENT_REVIEW',
        waiting_on: 'Client',
        timeline_status: 'Paused',
        client_action_required:
          stage === 'Concept Approval'
            ? 'Review and approve the updated design concept'
            : stage === 'Print Approval'
              ? 'Review and approve the updated print version'
              : 'Review and approve the updated eBook version',
        updated_at: now,
      };

      const notification: NotificationItem = {
        id: createId('notification'),
        recipient_id: request.client_id,
        project_id: request.project_id,
        type: 'revision_submitted',
        title: `Revision Completed: ${project?.project_title || 'Project'}`,
        message: 'Your requested revision has been completed and is ready for review.',
        is_read: false,
        created_at: now,
      };

      const historyEntry = project
        ? createStageHistoryEntry(
            project,
            `Revision completed for ${project.current_stage || 'Approval stage'} and submitted for client review`,
            currentProfile.id,
          )
        : null;

      if (supabase && mode === 'supabase') {
        const fileUrl = await uploadRevisionFile({
          clientId: request.client_id,
          projectId: request.project_id,
          requestId: request.id,
          file,
        });

        const { error } = await supabase.from('revision_attachments').insert({
          revision_request_id: request.id,
          revision_item_id: null,
          file_name: file.name,
          file_url: fileUrl,
          file_type: 'revised_proof',
          uploaded_by: currentProfile.id,
        });

        if (error) {
          throw error;
        }

        await supabase
          .from('revision_requests')
          .update({ status: 'Ready for Client Review', updated_at: now })
          .eq('id', request.id);

        await supabase.from('projects').update(projectUpdates).eq('id', request.project_id);
        await supabase.from('notifications').insert({
          id: notification.id,
          recipient_id: notification.recipient_id,
          project_id: notification.project_id,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          is_read: false,
        });

        await loadSupabaseData(currentProfile);
        return;
      }

      const newAttachment = normalizeRevisionAttachment({
        id: createId('revision-attachment'),
        revision_request_id: request.id,
        file_name: file.name,
        file_url: file.name,
        file_type: 'revised_proof',
        uploaded_by: currentProfile.id,
        created_at: now,
      });

      setData((previous) => ({
        ...previous,
        projects: previous.projects.map((item) =>
          item.id === request.project_id ? normalizeProject({ ...item, ...projectUpdates }) : item,
        ),
        revisionRequests: previous.revisionRequests.map((item) =>
          item.id === request.id ? { ...item, status: 'Ready for Client Review', updated_at: now } : item,
        ),
        revisionAttachments: [newAttachment, ...previous.revisionAttachments],
        notifications: [notification, ...previous.notifications],
        stageHistory: historyEntry ? [historyEntry, ...(previous.stageHistory || [])] : previous.stageHistory,
      }));
    },
    [currentProfile, data.projects, data.revisionRequests, loadSupabaseData, mode],
  );

  const respondToRevisionRequest = useCallback(
    async (requestId: string, decision: Extract<ClientRevisionStatus, 'Approved'>) => {
      if (!currentProfile) {
        throw new Error('No signed-in profile found.');
      }

      if (supabase && mode === 'supabase') {
        const { error } = await supabase.rpc('client_respond_revision', {
          request_id: requestId,
          decision,
        });

        if (error) {
          throw error;
        }

        await loadSupabaseData(currentProfile);
        return;
      }

      await updateRevisionRequest(requestId, { status: decision });
    },
    [currentProfile, loadSupabaseData, mode, updateRevisionRequest],
  );

  const approveProjectMilestone = useCallback(
    async (projectId: string, milestone: ApprovalMilestone) => {
      if (!currentProfile) {
        throw new Error('No signed-in profile found.');
      }

      const project = data.projects.find((item) => item.id === projectId);
      if (!project) {
        throw new Error('Project not found.');
      }

      const today = new Date().toISOString().slice(0, 10);
      const now = new Date().toISOString();
      const settings = getWorkflowSettings(project);

      let nextStage: TimelineStage = 'Print Version';
      let approvalField: keyof Project = 'design_concept_approval_date';
      let daysAllocated = settings.print_version_days ?? 5;
      let label = 'Design Concept';

      if (milestone === 'concept') {
        nextStage = 'Print Version';
        approvalField = 'design_concept_approval_date';
        daysAllocated = settings.print_version_days ?? 5;
        label = 'Design Concept';
      } else if (milestone === 'print') {
        nextStage = 'Ebook Version';
        approvalField = 'print_version_approval_date';
        daysAllocated = settings.ebook_version_days ?? 5;
        label = 'Print Version';
      } else if (milestone === 'ebook') {
        nextStage = 'Final Delivery';
        approvalField = 'ebook_approval_date';
        daysAllocated = settings.final_delivery_days ?? 2;
        label = 'eBook Version';
      }

      const stageDueDate = calculateStageDueDate(today, daysAllocated, settings);
      const historyEntry = createStageHistoryEntry(
        project,
        `Client approved ${label}. Activated ${nextStage}.`,
        currentProfile.id,
        `Allocated ${daysAllocated} production days.`,
      );

      const projectUpdates: Partial<Project> = {
        [approvalField]: today,
        current_stage: nextStage,
        stage_status: 'ACTIVE',
        waiting_on: 'Manuscript Heaven',
        timeline_status: 'Active',
        stage_started_at: now,
        stage_due_at: stageDueDate,
        stage_completed_at: null,
        client_action_required: '',
        updated_at: now,
      };

      if (nextStage === 'Final Delivery') {
        projectUpdates.status = 'Final Delivery';
      } else {
        projectUpdates.status = 'In Progress';
      }

      const recipientId = project.assigned_to || project.project_manager || currentProfile.id;
      const notification: NotificationItem = {
        id: createId('notification'),
        recipient_id: recipientId,
        project_id: projectId,
        type: 'milestone_approval',
        title: `Milestone Approved: ${project.project_title}`,
        message: `${label} approved. ${nextStage} is now active (${daysAllocated} production days allocated).`,
        is_read: false,
        created_at: now,
      };

      if (supabase && mode === 'supabase') {
        const { error: rpcErr } = await supabase.rpc('client_approve_project_milestone', {
          project_id: projectId,
          milestone,
        });

        if (rpcErr) {
          console.warn('client_approve_project_milestone RPC fallback:', rpcErr);
          const { error: updateErr } = await supabase.from('projects').update(projectUpdates).eq('id', projectId);
          if (updateErr) console.warn('Supabase project milestone approval error:', updateErr);

          await supabase.from('notifications').insert({
            id: notification.id,
            recipient_id: notification.recipient_id,
            project_id: notification.project_id,
            type: notification.type,
            title: notification.title,
            message: notification.message,
            is_read: false,
          });
        }

        await loadSupabaseData(currentProfile);
        return;
      }

      setData((previous) => ({
        ...previous,
        projects: previous.projects.map((p) => (p.id === projectId ? normalizeProject({ ...p, ...projectUpdates }) : p)),
        notifications: [notification, ...previous.notifications],
        stageHistory: [historyEntry, ...(previous.stageHistory || [])],
      }));
    },
    [currentProfile, data.projects, loadSupabaseData, mode],
  );

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
        const { data: inserted, error: insertError } = await supabase
          .from('tasks')
          .insert(taskPayload(fullDraft, currentProfile.id))
          .select()
          .single();

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
        const { data: updated, error: updateError } = await supabase
          .from('tasks')
          .update(taskPayload(nextTask))
          .eq('id', taskId)
          .select()
          .maybeSingle();

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
          const { error: updateProfileError } = await supabase
            .from('profiles')
            .update({
              full_name: cleanName,
              role: 'client',
              status: draft.status || 'active',
            })
            .eq('id', clientProfile.id);

          if (updateProfileError) {
            throw updateProfileError;
          }

          await supabase.from('client_project_access').delete().eq('client_id', clientProfile.id);

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

        await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: window.location.origin,
        });

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

  const updateProfile = useCallback(
    async (
      profileId: string,
      updates: Partial<Pick<Profile, 'full_name' | 'avatar_url' | 'phone'>>,
    ) => {
      if (supabase && mode === 'supabase') {
        const { error: updateErr } = await supabase
          .from('profiles')
          .update(updates)
          .eq('id', profileId);

        if (updateErr) {
          throw updateErr;
        }
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
      const clientProjectIds = new Set(
        data.clientProjectAccess
          .filter((access) => access.client_id === currentProfile.id)
          .map((access) => access.project_id),
      );

      const clientNameLower = (currentProfile.full_name || '').toLowerCase().trim();
      const clientEmailLower = (currentProfile.email || '').toLowerCase().trim();

      return data.projects.filter((project) => {
        if (clientProjectIds.has(project.id)) {
          return true;
        }

        const projClientName = (project.client_name || '').toLowerCase().trim();
        const projClientEmail = (project.client_email || '').toLowerCase().trim();

        if (clientNameLower && projClientName && (projClientName === clientNameLower || clientNameLower.includes(projClientName) || projClientName.includes(clientNameLower))) {
          return true;
        }

        if (clientEmailLower && projClientEmail && projClientEmail === clientEmailLower) {
          return true;
        }

        if (project.created_by === currentProfile.id) {
          return true;
        }

        return false;
      });
    }

    return data.projects.filter((project) => project.assigned_to === currentProfile.id);
  }, [canManageAll, currentProfile, data.clientProjectAccess, data.projects]);

  const visibleTasks = useMemo(() => {
    if (!currentProfile || isClientRole(currentProfile.role)) {
      return [];
    }

    return data.tasks.filter((task) => task.assigned_to === currentProfile.id);
  }, [currentProfile, data.tasks]);

  const teamTasks = useMemo(() => {
    if (!currentProfile || !canManageAll) return [];
    return data.tasks;
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
        const basePayload: Record<string, unknown> = {
          employee_id: compensation.employee_id,
          monthly_salary: compensation.monthly_salary,
          per_project_rate: compensation.per_project_rate,
          joining_date: compensation.joining_date,
          responsibilities: compensation.responsibilities,
          performance_rating: compensation.performance_rating,
          updated_at: compensation.updated_at,
        };

        // Try upserting full payload first, fallback to base payload if custom columns aren't in Supabase yet
        const fullPayload = {
          ...basePayload,
          salary_type: compensation.salary_type,
          default_currency: compensation.default_currency,
        };

        const { error: fullError } = await supabase.from('employee_compensation').upsert(fullPayload, { onConflict: 'employee_id' });
        if (fullError) {
          console.warn('Upsert with extended compensation columns failed, falling back to base schema:', fullError);
          const { error: baseError } = await supabase.from('employee_compensation').upsert(basePayload, { onConflict: 'employee_id' });
          if (baseError) {
            throw new Error(baseError.message || baseError.details || 'Failed to save employee compensation in Supabase.');
          }
        }
      }
      setData((previous) => ({
        ...previous,
        employeeCompensation: [compensation, ...previous.employeeCompensation.filter((item) => item.employee_id !== employeeId)],
      }));

      const empName = data.profiles.find((p) => p.id === employeeId)?.full_name || 'Employee';
      await addActivity({
        action: `Salary/compensation updated for ${empName}`,
        user_id: currentProfile.id,
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
        const basePayload: Record<string, unknown> = {
          id: ledgerEntry.id,
          employee_id: ledgerEntry.employee_id,
          entry_type: ledgerEntry.entry_type,
          amount: ledgerEntry.amount,
          salary_month: ledgerEntry.salary_month || null,
          payment_method: ledgerEntry.payment_method || null,
          project_id: ledgerEntry.project_id || null,
          notes: ledgerEntry.notes || ledgerEntry.description || '',
          paid_at: ledgerEntry.paid_at,
          created_at: ledgerEntry.created_at,
        };

        const fullPayload = {
          ...basePayload,
          currency: ledgerEntry.currency || 'USD',
          reference: ledgerEntry.reference || null,
          status: ledgerEntry.status || 'Pending',
          description: ledgerEntry.description || '',
        };

        const { error: fullError } = await supabase.from('employee_ledger').insert(fullPayload);
        if (fullError) {
          console.warn('Insert with extended ledger columns failed, falling back to base schema:', fullError);
          const { error: baseError } = await supabase.from('employee_ledger').insert(basePayload);
          if (baseError) {
            throw new Error(baseError.message || baseError.details || 'Failed to record employee payroll entry in Supabase.');
          }
        }
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
        user_id: currentProfile.id,
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
        user_id: currentProfile.id,
      });
    },
    [addActivity, currentProfile, data.employeeLedger, data.profiles, mode],
  );

  const createFinanceTransaction = useCallback(
    async (draft: FinanceTransactionDraft) => {
      if (!currentProfile || !canManageEverything(currentProfile)) {
        throw new Error('Only admins and authorized managers can create finance transactions.');
      }

      const currencyCode = draft.currency || 'PKR';
      const rate = currencyCode === 'PKR' ? 1.0 : (draft.exchange_rate && draft.exchange_rate > 0 ? draft.exchange_rate : (DEFAULT_EXCHANGE_RATES[currencyCode] || 1.0));
      const originalAmount = Number(draft.original_amount ?? draft.amount ?? 0);
      const amountPkr = Math.round(originalAmount * rate);
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
        const { id: _unusedId, ...fullPayload } = transaction;

        const { data: inserted, error: insertError } = await supabase
          .from('finance_transactions')
          .insert(fullPayload)
          .select()
          .single();

        if (insertError) {
          const isColumnError =
            insertError.code === 'PGRST204' ||
            insertError.code === '42703' ||
            insertError.message?.toLowerCase().includes('column') ||
            insertError.message?.toLowerCase().includes('schema');

          if (isColumnError) {
            const basePayload = {
              type: transaction.type,
              category: transaction.category,
              description: transaction.description,
              amount: transaction.amount,
              transaction_date: transaction.transaction_date,
              project_id: transaction.project_id || null,
              created_by: currentProfile.id,
            };

            const { data: baseInserted, error: baseError } = await supabase
              .from('finance_transactions')
              .insert(basePayload)
              .select()
              .single();

            if (baseError) {
              throw baseError;
            }

            const newFtx = { ...transaction, ...(baseInserted as object) };
            setData((previous) => ({
              ...previous,
              financeTransactions: [newFtx, ...(previous.financeTransactions || [])],
            }));
            return newFtx;
          }

          throw insertError;
        }

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
    async (id: string, updates: Partial<FinanceTransaction>) => {
      if (!currentProfile || !canManageEverything(currentProfile)) {
        throw new Error('Only authorized managers can update finance transactions.');
      }

      const now = new Date().toISOString();

      if (supabase && mode === 'supabase') {
        const { error: updateError } = await supabase
          .from('finance_transactions')
          .update({
            ...updates,
            updated_by: currentProfile.id,
            updated_at: now,
          })
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
          const currencyCode = merged.currency || 'PKR';
          const rate = currencyCode === 'PKR' ? 1.0 : (merged.exchange_rate && merged.exchange_rate > 0 ? merged.exchange_rate : (DEFAULT_EXCHANGE_RATES[currencyCode] || 1.0));
          const orig = Number(merged.original_amount ?? merged.amount ?? 0);
          const pkr = Math.round(orig * rate);
          return {
            ...merged,
            currency: currencyCode,
            exchange_rate: rate,
            amount: orig,
            original_amount: orig,
            amount_pkr: pkr,
            base_amount_pkr: pkr,
            updated_by: currentProfile.id,
            updated_at: now,
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
        if (delError) {
          await supabase.from('finance_transactions').update({ is_soft_deleted: true, updated_by: currentProfile.id }).eq('id', id);
        }
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
          .upsert(budgetItem, { onConflict: 'category' });

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
        try {
          const { error: insertError } = await supabase.from('messages').insert({
            id: messageId,
            conversation_id: conversationId,
            sender_id: currentProfile.id,
            body: body.trim(),
            parent_message_id: parentMessageId || null,
            created_at: now,
            updated_at: now,
          });

          if (insertError) {
            console.warn('Supabase message insert error:', insertError);
          }

          if (attachments && attachments.length > 0) {
            await supabase.from('message_attachments').insert(
              newAttachments.map((a) => ({
                id: a.id,
                message_id: messageId,
                file_name: a.file_name,
                file_url: a.file_url,
                file_type: a.file_type,
                file_size: a.file_size,
              })),
            );
          }

          if (mentionedUserIds.length > 0) {
            await supabase.from('message_mentions').insert(
              mentionedUserIds.map((uid) => ({
                message_id: messageId,
                user_id: uid,
              })),
            );

            await supabase.from('notifications').insert(
              mentionedUserIds.map((uid) => ({
                recipient_id: uid,
                type: 'mention',
                title: `${firstName(currentProfile.full_name)} mentioned you`,
                message: body.length > 80 ? body.slice(0, 80) + '...' : body,
                is_read: false,
              })),
            );
          }
        } catch (err) {
          console.warn('Supabase messaging sync warning:', err);
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
      const now = new Date().toISOString();

      setData((prev) => {
        const existingReactions = prev.messageReactions || [];
        const existing = existingReactions.find(
          (r) => r.message_id === messageId && r.user_id === currentProfile.id && r.emoji === emoji,
        );

        let updated: MessageReaction[];
        if (existing) {
          updated = existingReactions.filter((r) => r.id !== existing.id);
        } else {
          updated = [
            ...existingReactions,
            { id: createUuid(), message_id: messageId, user_id: currentProfile.id, emoji, created_at: now },
          ];
        }

        return { ...prev, messageReactions: updated };
      });
    },
    [currentProfile],
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

        let updated: ConversationMember[];
        if (existing) {
          updated = members.map((m) => (m.id === existing.id ? { ...m, last_read_at: now } : m));
        } else {
          updated = [
            ...members,
            { id: createUuid(), conversation_id: conversationId, user_id: currentProfile.id, last_read_at: now, created_at: now },
          ];
        }

        return { ...prev, conversationMembers: updated };
      });

      if (supabase && mode === 'supabase') {
        try {
          const { error } = await supabase.from('conversation_members').upsert(
            {
              conversation_id: conversationId,
              user_id: currentProfile.id,
              last_read_at: now,
            },
            { onConflict: 'conversation_id,user_id' },
          );

          if (error && !isMissingSchemaError(error)) {
            console.warn('conversation_members upsert warning:', error);
          }
        } catch (err) {
          console.warn('Could not persist markConversationRead in supabase:', err);
        }
      }
    },
    [currentProfile, mode],
  );

  const getOrCreateProjectConversation = useCallback(
    async (projectId: string, isInternal: boolean) => {
      const type = isInternal ? 'project_internal' : 'project_client';
      const existing = (data.conversations || []).find(
        (c) => c.project_id === projectId && c.type === type,
      );
      if (existing) return existing;

      const now = new Date().toISOString();
      const newConvId = createUuid();
      const newConv: Conversation = {
        id: newConvId,
        type,
        project_id: projectId,
        created_by: currentProfile?.id || null,
        created_at: now,
        updated_at: now,
      };

      if (supabase && mode === 'supabase') {
        try {
          const { data: created, error } = await supabase
            .from('conversations')
            .insert({
              id: newConvId,
              type,
              project_id: projectId,
              created_by: currentProfile?.id || null,
            })
            .select()
            .single();

          if (!error && created) {
            newConv.id = created.id;
          }
        } catch (err) {
          console.warn('Project conversation insert warning:', err);
        }
      }

      setData((prev) => ({
        ...prev,
        conversations: [...(prev.conversations || []), newConv],
      }));

      return newConv;
    },
    [currentProfile, data.conversations, mode],
  );

  const getOrCreateTaskConversation = useCallback(
    async (taskId: string) => {
      const existing = (data.conversations || []).find(
        (c) => c.task_id === taskId && c.type === 'task',
      );
      if (existing) return existing;

      const now = new Date().toISOString();
      const newConvId = createUuid();
      const newConv: Conversation = {
        id: newConvId,
        type: 'task',
        task_id: taskId,
        created_by: currentProfile?.id || null,
        created_at: now,
        updated_at: now,
      };

      if (supabase && mode === 'supabase') {
        try {
          const { data: created, error } = await supabase
            .from('conversations')
            .insert({
              id: newConvId,
              type: 'task',
              task_id: taskId,
              created_by: currentProfile?.id || null,
            })
            .select()
            .single();

          if (!error && created) {
            newConv.id = created.id;
          }
        } catch (err) {
          console.warn('Task conversation insert warning:', err);
        }
      }

      setData((prev) => ({
        ...prev,
        conversations: [...(prev.conversations || []), newConv],
      }));

      return newConv;
    },
    [currentProfile, data.conversations, mode],
  );

  const getOrCreateDM = useCallback(
    async (otherUserId: string) => {
      if (!currentProfile) throw new Error('Not logged in.');
      const existing = (data.conversations || []).find((c) => {
        if (c.type !== 'dm') return false;
        const members = (data.conversationMembers || []).filter((m) => m.conversation_id === c.id);
        const userIds = members.map((m) => m.user_id);
        return userIds.includes(currentProfile.id) && userIds.includes(otherUserId);
      });
      if (existing) return existing;

      const now = new Date().toISOString();
      const newConvId = createUuid();
      const newConv: Conversation = {
        id: newConvId,
        type: 'dm',
        created_by: currentProfile.id,
        created_at: now,
        updated_at: now,
      };

      const member1: ConversationMember = { id: createUuid(), conversation_id: newConvId, user_id: currentProfile.id, last_read_at: now, created_at: now };
      const member2: ConversationMember = { id: createUuid(), conversation_id: newConvId, user_id: otherUserId, last_read_at: now, created_at: now };

      if (supabase && mode === 'supabase') {
        try {
          const { data: created, error } = await supabase
            .from('conversations')
            .insert({ id: newConvId, type: 'dm', created_by: currentProfile.id })
            .select()
            .single();

          if (!error && created) {
            newConv.id = created.id;
            await supabase.from('conversation_members').insert([
              { id: member1.id, conversation_id: created.id, user_id: currentProfile.id },
              { id: member2.id, conversation_id: created.id, user_id: otherUserId },
            ]);
          }
        } catch (err) {
          console.warn('DM insert warning:', err);
        }
      }

      setData((prev) => ({
        ...prev,
        conversations: [...(prev.conversations || []), newConv],
        conversationMembers: [...(prev.conversationMembers || []), member1, member2],
      }));

      return newConv;
    },
    [currentProfile, data.conversationMembers, data.conversations, mode],
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
    createTask,
    updateTask,
    inviteClient,
    updateProfile,
    markNotificationRead,
    markAllNotificationsRead,
    notificationToast,
    clearNotificationToast,
    saveEmployeeCompensation,
    addEmployeeLedgerEntry,
    deleteEmployeeLedgerEntry,
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
    getOrCreateDM,
  };
}
