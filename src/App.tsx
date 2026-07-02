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
import { useTracker } from './lib/useTracker';
import type { Project, ProjectDraft } from './lib/types';

export default function App() {
  const tracker = useTracker();
  const [activeView, setActiveView] = useState<ViewKey>('dashboard');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [showProjectForm, setShowProjectForm] = useState(false);
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

  useEffect(() => {
    const managerOnlyViews: ViewKey[] = ['team', 'payments'];
    if (!tracker.canManageAll && managerOnlyViews.includes(activeView)) {
      setActiveView('dashboard');
    }
  }, [activeView, tracker.canManageAll]);

  async function handleSaveProject(draft: ProjectDraft) {
    if (editingProject) {
      await tracker.updateProject(editingProject.id, draft);
      setEditingProject(null);
      return;
    }

    await tracker.createProject(draft);
  }

  function openAddProject() {
    setEditingProject(null);
    setShowProjectForm(true);
  }

  function openEditProject(project: Project) {
    setEditingProject(project);
    setShowProjectForm(true);
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
      onSignOut={tracker.signOut}
    >
      {activeView === 'dashboard' ? (
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

      {activeView === 'revisions' ? (
        <RevisionsPage
          revisions={tracker.data.revisionNotes.filter((revision) =>
            visibleProjects.some((project) => project.id === revision.project_id),
          )}
          projects={visibleProjects}
          profiles={tracker.data.profiles}
          onSelectProject={setSelectedProject}
        />
      ) : null}

      {activeView === 'team' ? (
        <TeamPage profiles={tracker.data.profiles} projects={visibleProjects} />
      ) : null}

      {activeView === 'delivered' ? (
        <ProjectsPage {...pageProps} title="Delivered Projects" projects={deliveredProjects} />
      ) : null}

      {activeView === 'payments' && tracker.canManageAll ? (
        <PaymentsPage projects={visibleProjects} onSelectProject={setSelectedProject} />
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

      {selectedProjectFresh ? (
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
    </Layout>
  );
}
