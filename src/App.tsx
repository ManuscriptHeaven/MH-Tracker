import { useEffect, useMemo, useState } from 'react';
import { Layout, type ViewKey } from './components/Layout';
import { ProjectDetail } from './components/ProjectDetail';
import { ProjectFormModal } from './components/ProjectFormModal';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { CalendarPage } from './pages/CalendarPage';
import { TeamPage } from './pages/TeamPage';
import { RevisionsPage } from './pages/RevisionsPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { SettingsPage } from './pages/SettingsPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ClientPortalPage } from './pages/ClientPortalPage';
import { ClientAccessPage } from './pages/ClientAccessPage';
import { RevisionRequestsPage } from './pages/RevisionRequestsPage';
import { useTracker } from './lib/useTracker';
import { errorMessage, isClientRole } from './lib/utils';
import type { Project, ProjectDraft } from './lib/types';

export default function App() {
  const tracker = useTracker();
  const [activeView, setActiveView] = useState<ViewKey>('dashboard');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const visibleProjects = tracker.visibleProjects;

  const selectedProjectFresh = useMemo(() => {
    if (!selectedProject) {
      return null;
    }

    return visibleProjects.find((project) => project.id === selectedProject.id) || null;
  }, [selectedProject, visibleProjects]);

  const myTaskProjects = tracker.currentProfile
    ? tracker.data.projects.filter((project) => project.assigned_to === tracker.currentProfile?.id)
    : [];
  const deliveredProjects = visibleProjects.filter((project) => project.status === 'Delivered');
  const isClient = tracker.currentProfile ? isClientRole(tracker.currentProfile.role) : false;

  useEffect(() => {
    const managerOnlyViews: ViewKey[] = ['team', 'clients', 'payments'];
    if (!tracker.canManageAll && managerOnlyViews.includes(activeView)) {
      setActiveView('dashboard');
    }
    if (activeView === 'clients' && tracker.currentProfile?.role !== 'admin') {
      setActiveView('dashboard');
    }
    if (isClient && !['dashboard', 'notifications', 'settings'].includes(activeView)) {
      setActiveView('dashboard');
    }
  }, [activeView, isClient, tracker.canManageAll]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!tracker.notificationToast) {
      return;
    }

    setToast({ message: tracker.notificationToast.message, tone: 'success' });
    tracker.clearNotificationToast();
  }, [tracker.notificationToast, tracker.clearNotificationToast]);

  async function handleSaveProject(draft: ProjectDraft) {
    try {
      if (editingProject) {
        await tracker.updateProject(editingProject.id, draft);
        setEditingProject(null);
        setToast({ message: 'Project updated successfully.', tone: 'success' });
        return;
      }

      await tracker.createProject(draft);
      setToast({ message: 'Project created successfully.', tone: 'success' });
    } catch (error) {
      setToast({
        message: errorMessage(error, 'Project could not be saved.'),
        tone: 'error',
      });
      throw error;
    }
  }

  function openAddProject() {
    setEditingProject(null);
    setShowProjectForm(true);
  }

  function openEditProject(project: Project) {
    setEditingProject(project);
    setShowProjectForm(true);
  }

  function openProjectById(projectId: string) {
    const project = visibleProjects.find((item) => item.id === projectId);

    if (!project) {
      setToast({ message: 'Project is not visible for this user.', tone: 'error' });
      return;
    }

    setSelectedProject(project);
  }

  async function deleteProject(project: Project) {
    const confirmed = window.confirm(`Delete "${project.project_title}"? This cannot be undone.`);
    if (!confirmed) {
      return;
    }

    await tracker.deleteProject(project.id);
    setSelectedProject(null);
  }

  async function updateSelectedProject(updates: Partial<Project>) {
    if (!selectedProjectFresh) {
      return;
    }

    await tracker.updateProject(selectedProjectFresh.id, updates);
  }

  if (!tracker.currentProfile) {
    return (
      <LoginPage
        onLogin={tracker.login}
        onDemoLogin={tracker.loginDemo}
        error={tracker.error}
        isLoading={tracker.isLoading}
      />
    );
  }

  const pageProps = {
    projects: visibleProjects,
    profiles: tracker.data.profiles,
    searchTerm,
    canManageAll: tracker.canManageAll,
    currentProfile: tracker.currentProfile,
    onSelectProject: setSelectedProject,
    onEditProject: openEditProject,
    onDeleteProject: deleteProject,
    onDuplicateProject: tracker.duplicateProject,
    onUpdateProject: tracker.updateProject,
    onAddProject: openAddProject,
  };

  return (
    <Layout
      activeView={activeView}
      setActiveView={setActiveView}
      currentProfile={tracker.currentProfile}
      notifications={tracker.visibleNotifications}
      searchTerm={searchTerm}
      setSearchTerm={setSearchTerm}
      onAddProject={openAddProject}
      onMarkNotificationRead={tracker.markNotificationRead}
      onMarkAllNotificationsRead={tracker.markAllNotificationsRead}
      onViewNotifications={() => setActiveView('notifications')}
      onOpenNotificationProject={openProjectById}
      onSignOut={tracker.signOut}
    >
      {activeView === 'dashboard' && isClient ? (
        <ClientPortalPage
          projects={visibleProjects}
          revisionRequests={tracker.data.revisionRequests}
          revisionItems={tracker.data.revisionItems}
          revisionAttachments={tracker.data.revisionAttachments}
          notifications={tracker.visibleNotifications}
          onCreateRevisionRequest={async (draft) => {
            await tracker.createRevisionRequest(draft);
            setToast({ message: 'Revision request submitted.', tone: 'success' });
          }}
          onRespondToRevision={async (requestId, decision) => {
            await tracker.respondToRevisionRequest(requestId, decision);
            setToast({ message: 'Revision response saved.', tone: 'success' });
          }}
        />
      ) : null}

      {activeView === 'dashboard' && !isClient ? (
        <DashboardPage
          projects={visibleProjects}
          profiles={tracker.data.profiles}
          canViewPayments={tracker.canManageAll}
          canManageProjects={tracker.canManageAll}
          onAddProject={openAddProject}
          onSelectProject={setSelectedProject}
        />
      ) : null}

      {activeView === 'projects' ? <ProjectsPage {...pageProps} /> : null}

      {activeView === 'my_tasks' ? (
        <ProjectsPage {...pageProps} title="My Tasks" projects={myTaskProjects} canManageAll={false} />
      ) : null}

      {activeView === 'calendar' ? (
        <CalendarPage projects={visibleProjects} onSelectProject={setSelectedProject} />
      ) : null}

      {activeView === 'revisions' && !isClient ? (
        <div className="space-y-6">
          <RevisionRequestsPage
            revisionRequests={tracker.data.revisionRequests}
            revisionItems={tracker.data.revisionItems}
            revisionAttachments={tracker.data.revisionAttachments}
            revisionActivity={tracker.data.revisionActivity}
            projects={visibleProjects}
            profiles={tracker.data.profiles}
            currentProfile={tracker.currentProfile}
            canManageAll={tracker.canManageAll}
            onUpdateRequest={tracker.updateRevisionRequest}
            onUpdateItem={tracker.updateRevisionItem}
            onUploadRevisedProof={tracker.uploadRevisedProof}
          />
          {tracker.data.revisionNotes.length ? (
            <RevisionsPage
              revisions={tracker.data.revisionNotes.filter((revision) =>
                visibleProjects.some((project) => project.id === revision.project_id),
              )}
              projects={visibleProjects}
              profiles={tracker.data.profiles}
              onSelectProject={setSelectedProject}
            />
          ) : null}
        </div>
      ) : null}

      {activeView === 'notifications' ? (
        <NotificationsPage
          notifications={tracker.visibleNotifications}
          projects={visibleProjects}
          onMarkRead={tracker.markNotificationRead}
          onMarkAllRead={tracker.markAllNotificationsRead}
          onOpenProject={openProjectById}
        />
      ) : null}

      {activeView === 'team' ? (
        <TeamPage profiles={tracker.data.profiles} projects={visibleProjects} />
      ) : null}

      {activeView === 'clients' && tracker.currentProfile.role === 'admin' ? (
        <ClientAccessPage
          profiles={tracker.data.profiles}
          projects={tracker.data.projects}
          clientProjectAccess={tracker.data.clientProjectAccess}
          onInviteClient={tracker.inviteClient}
        />
      ) : null}

      {activeView === 'delivered' ? (
        <ProjectsPage {...pageProps} title="Delivered Projects" projects={deliveredProjects} />
      ) : null}

      {activeView === 'payments' && tracker.canManageAll ? (
        <PaymentsPage
          projects={visibleProjects}
          currentProfile={tracker.currentProfile}
          isLoading={tracker.isLoading}
          error={tracker.error}
          onSelectProject={setSelectedProject}
          onEditProject={openEditProject}
          onUpdateProject={tracker.updateProject}
          onDeletePayment={tracker.deletePayment}
        />
      ) : null}

      {activeView === 'settings' ? <SettingsPage mode={tracker.mode} /> : null}

      {showProjectForm ? (
        <ProjectFormModal
          currentProfile={tracker.currentProfile}
          profiles={tracker.data.profiles}
          project={editingProject}
          onClose={() => {
            setShowProjectForm(false);
            setEditingProject(null);
          }}
          onSubmit={handleSaveProject}
        />
      ) : null}

      {selectedProjectFresh && !isClient ? (
        <ProjectDetail
          project={selectedProjectFresh}
          profiles={tracker.data.profiles}
          notes={tracker.data.projectNotes}
          revisions={tracker.data.revisionNotes}
          activities={tracker.data.activityLogs}
          currentProfile={tracker.currentProfile}
          canManageAll={tracker.canManageAll}
          onClose={() => setSelectedProject(null)}
          onEdit={() => openEditProject(selectedProjectFresh)}
          onDelete={() => deleteProject(selectedProjectFresh)}
          onUpdateProject={updateSelectedProject}
          onAddNote={async (noteType, note) => {
            await tracker.addNote(selectedProjectFresh.id, noteType, note);
          }}
          onAddRevision={async (note, status) => {
            await tracker.addRevision(selectedProjectFresh.id, note, status);
          }}
        />
      ) : null}

      {toast ? (
        <div
          className={`fixed right-4 top-4 z-[70] max-w-sm rounded-md border px-4 py-3 text-sm font-semibold shadow-soft ${
            toast.tone === 'success'
              ? 'border-green-200 bg-green-50 text-success'
              : 'border-red-200 bg-red-50 text-danger'
          }`}
        >
          {toast.message}
        </div>
      ) : null}
    </Layout>
  );
}
