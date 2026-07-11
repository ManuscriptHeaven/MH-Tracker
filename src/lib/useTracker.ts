import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { sampleData, sampleProfiles } from './sampleData';
import { errorMessage, firstName, isClientRole, isManagerRole } from './utils';
import {
  fetchNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  subscribeToNotifications,
} from './notifications';
import type {
  ActivityLog,
  ClientInviteDraft,
  ClientProjectAccess,
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
  TrackerData,
} from './types';

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

  return {
    ...project,
    total_price: totalPrice,
    advance_paid: advancePaid,
    remaining_balance: calculateBalance(totalPrice, advancePaid),
    payment_status: project.payment_status || 'Not Started',
    payment_date: cleanDate(project.payment_date),
    payment_notes: cleanText(project.payment_notes),
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
    genre: '',
    trim_size: '',
    page_count: 0,
    word_count: 0,
    image_count: 0,
    platform: '',
    assigned_to: null,
    project_manager: null,
    priority: 'Normal',
    start_date: '',
    due_date: cleanDate(project.due_date) || '',
    internal_deadline: '',
    delivery_date: null,
    status: project.status || 'New',
    general_notes: '',
    internal_notes: '',
    client_instructions: '',
    qa_notes: '',
    delivery_notes: '',
    source_file_link: '',
    drive_folder_link: '',
    client_brief_link: '',
    proof_pdf_link: project.proof_pdf_link || '',
    final_print_pdf_link: project.final_print_pdf_link || '',
    final_ebook_link: project.final_ebook_link || '',
    cover_file_link: project.cover_file_link || '',
    other_links: '',
    total_price: 0,
    advance_paid: 0,
    remaining_balance: 0,
    payment_status: 'Not Started',
    payment_date: null,
    payment_notes: '',
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

  return {
    ...payload,
    assigned_to: payload.assigned_to || null,
    project_manager: payload.project_manager || null,
    start_date: cleanDate(payload.start_date),
    due_date: cleanDate(payload.due_date),
    internal_deadline: cleanDate(payload.internal_deadline),
    delivery_date: cleanDate(payload.delivery_date),
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
  const message = error instanceof Error ? error.message : 'Login failed.';

  if (message.toLowerCase().includes('invalid login credentials')) {
    return 'Name or password is incorrect.';
  }

  if (message.includes('find_login_email')) {
    return 'Name login is not set up in Supabase yet. Please run the latest database update.';
  }

  return message;
}

export function useTracker() {
  const [mode, setMode] = useState<AuthMode>(supabase ? 'supabase' : 'demo');
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [data, setData] = useState<TrackerData>(sampleData);
  const [isLoading, setIsLoading] = useState(Boolean(supabase));
  const [error, setError] = useState<string | null>(null);
  const [notificationToast, setNotificationToast] = useState<NotificationItem | null>(null);

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
      ? safeSelect<Profile>(supabase.from('profiles').select('*').eq('id', profile.id))
      : safeSelect<Profile>(supabase.from('profiles').select('*').order('full_name'));

    const projectsPromise = profileIsClient
      ? safeSelect<Partial<Project>>(supabase.from('client_project_summaries').select('*').order('due_date'))
      : safeSelect<Project>(supabase.from('projects').select('*').order('due_date'));

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

    const [
      profilesRes,
      projectsRes,
      paymentsRes,
      revisionsRes,
      notesRes,
      activityRes,
      clientAccessRes,
      revisionRequestsRes,
      revisionItemsRes,
      revisionAttachmentsRes,
      revisionActivityRes,
      notifications,
    ] = await Promise.all([
      profilesPromise,
      projectsPromise,
      paymentsPromise,
      revisionNotesPromise,
      projectNotesPromise,
      activityPromise,
      clientAccessPromise,
      revisionRequestsPromise,
      revisionItemsPromise,
      revisionAttachmentsPromise,
      revisionActivityPromise,
      fetchNotifications(profile.id),
    ]);

    const projects = profileIsClient
      ? (projectsRes.data as Partial<Project>[]).map(normalizeClientProject)
      : (projectsRes.data as Project[]).map(normalizeProject);
    const payments = paymentsRes.data as ProjectPayment[];

    setData({
      profiles: profilesRes.data as Profile[],
      projects: mergePayments(projects, payments),
      revisionNotes: revisionsRes.data as RevisionNote[],
      projectNotes: notesRes.data as ProjectNote[],
      activityLogs: activityRes.data as ActivityLog[],
      notifications,
      clientProjectAccess: clientAccessRes.data as ClientProjectAccess[],
      revisionRequests: (revisionRequestsRes.data as Partial<RevisionRequest>[]).map(normalizeRevisionRequest),
      revisionItems: (revisionItemsRes.data as Partial<RevisionItem>[]).map(normalizeRevisionItem),
      revisionAttachments: (revisionAttachmentsRes.data as Partial<RevisionAttachment>[]).map(normalizeRevisionAttachment),
      revisionActivity: (revisionActivityRes.data as Partial<RevisionActivity>[]).map(normalizeRevisionActivity),
    });

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
        setIsLoading(false);
        return;
      }

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!active) {
          return;
        }

        if (!session?.user) {
          setCurrentProfile(null);
          setIsLoading(false);
          return;
        }

        const profile = await fetchProfile(session.user.id);
        if (!profile || !active) {
          return;
        }

        setCurrentProfile(profile);
        await loadSupabaseData(profile);
      } catch (sessionError) {
        if (active) {
          setError(sessionError instanceof Error ? sessionError.message : 'Could not restore session.');
          setCurrentProfile(null);
          setIsLoading(false);
        }
      }
    }

    restoreSession();

    const authListener = supabase?.auth.onAuthStateChange(async (_event, session) => {
      if (!session?.user) {
        setCurrentProfile(null);
        setIsLoading(false);
        return;
      }

      try {
        const profile = await fetchProfile(session.user.id);
        if (profile) {
          setCurrentProfile(profile);
          await loadSupabaseData(profile);
        }
      } catch (authError) {
        setError(authError instanceof Error ? authError.message : 'Could not load profile.');
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
        const profile = sampleProfiles.find((item) => profileMatchesLoginName(item, cleanLoginName));
        setCurrentProfile(profile || sampleProfiles[0]);
        setMode('demo');
        return;
      }

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

        setMode('supabase');
        setCurrentProfile(profile);
        await loadSupabaseData(profile);
      } catch (loginError) {
        const message = loginErrorMessage(loginError);
        setError(message);
        setIsLoading(false);
        throw new Error(message);
      }
    },
    [fetchProfile, loadSupabaseData],
  );

  const loginDemo = useCallback((role: Role) => {
    const profile = sampleProfiles.find((item) => item.role === role) || sampleProfiles[0];
    setMode('demo');
    setCurrentProfile(profile);
    setData(sampleData);
    setError(null);
    setIsLoading(false);
  }, []);

  const signOut = useCallback(async () => {
    if (supabase && mode === 'supabase') {
      await supabase.auth.signOut();
    }

    setCurrentProfile(null);
    setData(sampleData);
    setMode(supabase ? 'supabase' : 'demo');
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
          project_id: activity.project_id,
          action: activity.action,
          old_value: activity.old_value,
          new_value: activity.new_value,
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
      const localProject: Project = normalizeProject({
        ...draft,
        id: createId('project'),
        project_number: draft.project_number || `MH-${1001 + data.projects.length}`,
        created_by: currentProfile.id,
        created_at: now,
        updated_at: now,
        remaining_balance: calculateBalance(draft.total_price, draft.advance_paid),
      });

      if (supabase && mode === 'supabase') {
        const { data: inserted, error: insertError } = await supabase
          .from('projects')
          .insert({
            ...supabaseProjectPayload(localProject),
            created_by: currentProfile.id,
          })
          .select()
          .single();

        if (insertError) {
          throw insertError;
        }

        const projectPayment = paymentPayload(localProject);
        await upsertProjectPayment((inserted as Project).id, localProject, currentProfile.id);

        const project = normalizeProject({
          ...(inserted as Project),
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

      const nextProject = normalizeProject({
        ...existing,
        ...updates,
        updated_at: new Date().toISOString(),
      });

      if (supabase && mode === 'supabase') {
        const { data: updated, error: updateError } = await supabase
          .from('projects')
          .update({
            ...supabaseProjectPayload(nextProject),
            updated_at: nextProject.updated_at,
          })
          .eq('id', projectId)
          .select()
          .maybeSingle();

        if (updateError) {
          throw updateError;
        }

        if (!updated) {
          throw new Error('No project row was updated. Check the project ID or Supabase RLS policy.');
        }

        const hasPaymentUpdate = paymentFieldsChanged(existing, nextProject);

        if (hasPaymentUpdate && canManageEverything(currentProfile)) {
          await upsertProjectPayment(projectId, nextProject, currentProfile.id);
        }

        const project = normalizeProject({
          ...(updated as Project),
          total_price: nextProject.total_price,
          advance_paid: nextProject.advance_paid,
          remaining_balance: nextProject.remaining_balance,
          payment_status: nextProject.payment_status,
          payment_date: nextProject.payment_date,
          payment_notes: nextProject.payment_notes,
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

        setData((previous) => ({
          ...previous,
          revisionNotes: [inserted as RevisionNote, ...previous.revisionNotes],
        }));
      } else {
        setData((previous) => ({
          ...previous,
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

      if (supabase && mode === 'supabase') {
        try {
          const supabaseClient = supabase;
          const requestId = createUuid();
          const requestTitle = draft.title?.trim() || `Revision request for ${project.project_title}`;
          const now = new Date().toISOString();
          const request = normalizeRevisionRequest({
            id: requestId,
            project_id: draft.project_id,
            client_id: currentProfile.id,
            title: requestTitle,
            description: instructions,
            instructions,
            team_response: null,
            priority: draft.priority || 'Normal',
            status: 'Submitted',
            submitted_at: now,
            created_at: now,
            updated_at: now,
          });

          const { error: requestError } = await supabaseClient.from('revision_requests').insert({
            id: request.id,
            project_id: request.project_id,
            client_id: request.client_id,
            title: request.title,
            description: request.description,
            instructions: request.instructions,
            team_response: request.team_response,
            priority: request.priority,
            status: 'Submitted',
          });

          if (requestError) {
            throw requestError;
          }

          await Promise.all(
            (draft.attachments || []).map(async (file) => {
              const fileUrl = await uploadRevisionFile({
                clientId: currentProfile.id,
                projectId: request.project_id,
                requestId: request.id,
                file,
              });

              const { error: attachmentError } = await supabaseClient.from('revision_attachments').insert({
                revision_request_id: request.id,
                revision_item_id: null,
                file_name: file.name,
                file_url: fileUrl,
                file_type: 'client_attachment',
                uploaded_by: currentProfile.id,
              });

              if (attachmentError) {
                throw attachmentError;
              }
            }),
          );

          await loadSupabaseData(currentProfile);
          return request;
        } catch (revisionError) {
          console.error('Supabase revision request error:', revisionError);
          throw new Error('Revision request could not be submitted. Please try again.');
        }
      }

      const now = new Date().toISOString();
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
        revisionRequests: [request, ...previous.revisionRequests],
        revisionAttachments: [...attachments, ...previous.revisionAttachments],
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
    [currentProfile, data.projects, loadSupabaseData, mode],
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

        await loadSupabaseData(currentProfile);
        return;
      }

      setData((previous) => ({
        ...previous,
        revisionAttachments: [
          normalizeRevisionAttachment({
            id: createId('revision-attachment'),
            revision_request_id: request.id,
            file_name: file.name,
            file_url: file.name,
            file_type: 'revised_proof',
            uploaded_by: currentProfile.id,
            created_at: new Date().toISOString(),
          }),
          ...previous.revisionAttachments,
        ],
      }));
    },
    [currentProfile, data.revisionRequests, loadSupabaseData, mode],
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

      if (!clientProjectIds.size) {
        return data.projects;
      }

      return data.projects.filter((project) => clientProjectIds.has(project.id));
    }

    return data.projects.filter((project) => project.assigned_to === currentProfile.id);
  }, [canManageAll, currentProfile, data.clientProjectAccess, data.projects]);

  const visibleNotifications = useMemo(() => {
    if (!currentProfile) {
      return [];
    }

    return data.notifications.filter((notification) => notification.recipient_id === currentProfile.id);
  }, [currentProfile, data.notifications]);

  return {
    mode,
    currentProfile,
    data,
    isLoading,
    error,
    setError,
    canManageAll,
    visibleProjects,
    visibleNotifications,
    login,
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
    inviteClient,
    markNotificationRead,
    markAllNotificationsRead,
    notificationToast,
    clearNotificationToast,
  };
}
