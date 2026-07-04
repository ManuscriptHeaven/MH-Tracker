import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { sampleData, sampleProfiles } from './sampleData';
import { firstName, isManagerRole } from './utils';
import type {
  ActivityLog,
  NoteType,
  Profile,
  Project,
  ProjectDraft,
  ProjectPayment,
  ProjectNote,
  ProjectStatus,
  RevisionNote,
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

function calculateBalance(totalPrice: number, advancePaid: number) {
  return Math.max(Number(totalPrice || 0) - Number(advancePaid || 0), 0);
}

function cleanDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : null;
}

function cleanText(value: string | null | undefined) {
  return value || '';
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

  const { error } = await supabase.from('project_payments').upsert({
    project_id: projectId,
    ...paymentPayload(project),
    updated_by: updatedBy,
  });

  if (!error) {
    return;
  }

  if (!isMissingPaymentMetadataColumn(error)) {
    throw error;
  }

  const { error: fallbackError } = await supabase.from('project_payments').upsert({
    project_id: projectId,
    ...basePaymentPayload(project),
    updated_by: updatedBy,
  });

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

  const loadSupabaseData = useCallback(async (profile: Profile) => {
    if (!supabase) {
      return;
    }

    setIsLoading(true);
    setError(null);

    const paymentsPromise = canManageEverything(profile)
      ? supabase.from('project_payments').select('*')
      : Promise.resolve({ data: [], error: null });

    const [profilesRes, projectsRes, paymentsRes, revisionsRes, notesRes, activityRes, notificationsRes] =
      await Promise.all([
        supabase.from('profiles').select('*').order('full_name'),
        supabase.from('projects').select('*').order('due_date'),
        paymentsPromise,
        supabase.from('revision_notes').select('*').order('created_at', { ascending: false }),
        supabase.from('project_notes').select('*').order('created_at', { ascending: false }),
        supabase.from('activity_logs').select('*').order('created_at', { ascending: false }),
        supabase
          .from('notifications')
          .select('*')
          .eq('user_id', profile.id)
          .order('created_at', { ascending: false }),
      ]);

    const firstError =
      profilesRes.error ||
      projectsRes.error ||
      paymentsRes.error ||
      revisionsRes.error ||
      notesRes.error ||
      activityRes.error ||
      notificationsRes.error;

    if (firstError) {
      throw firstError;
    }

    const projects = ((projectsRes.data || []) as Project[]).map(normalizeProject);
    const payments = (paymentsRes.data || []) as ProjectPayment[];

    setData({
      profiles: (profilesRes.data || []) as Profile[],
      projects: mergePayments(projects, payments),
      revisionNotes: (revisionsRes.data || []) as RevisionNote[],
      projectNotes: (notesRes.data || []) as ProjectNote[],
      activityLogs: (activityRes.data || []) as ActivityLog[],
      notifications: (notificationsRes.data || []) as TrackerData['notifications'],
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

  const markNotificationRead = useCallback(
    async (notificationId: string) => {
      setData((previous) => ({
        ...previous,
        notifications: previous.notifications.map((notification) =>
          notification.id === notificationId ? { ...notification, is_read: true } : notification,
        ),
      }));

      if (supabase && mode === 'supabase') {
        await supabase.from('notifications').update({ is_read: true }).eq('id', notificationId);
      }
    },
    [mode],
  );

  const canManageAll = canManageEverything(currentProfile);

  const visibleProjects = useMemo(() => {
    if (!currentProfile) {
      return [];
    }

    if (canManageAll) {
      return data.projects;
    }

    return data.projects.filter((project) => project.assigned_to === currentProfile.id);
  }, [canManageAll, currentProfile, data.projects]);

  const visibleNotifications = useMemo(() => {
    if (!currentProfile) {
      return [];
    }

    return data.notifications.filter((notification) => notification.user_id === currentProfile.id);
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
    markNotificationRead,
  };
}
