import { useEffect, useMemo, useState } from 'react';
import { Layout, type ViewKey } from './components/Layout';
import { ProjectDetail } from './components/ProjectDetail';
import { ClientProjectDetailModal } from './components/ClientProjectDetailModal';
import { ProjectFormModal } from './components/ProjectFormModal';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { CalendarPage } from './pages/CalendarPage';
import { TeamPage } from './pages/TeamPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { SettingsPage } from './pages/SettingsPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ClientPortalPage } from './pages/ClientPortalPage';
import { ClientProjectsPage } from './pages/ClientProjectsPage';
import { ClientAccessPage } from './pages/ClientAccessPage';
import { TasksPage } from './pages/TasksPage';
import { FinancePage } from './pages/FinancePage';
import { CommunicationPage } from './pages/CommunicationPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AIProvider } from './lib/ai/aiContext';
import { CurrencyProvider } from './lib/currency';
import { AIChatButton } from './components/ai/AIChatButton';
import { AIChatPanel } from './components/ai/AIChatPanel';
import { AIDailyPopup } from './components/ai/AIDailyPopup';
import { useTracker } from './lib/useTracker';
import { errorMessage, isClientRole } from './lib/utils';
import type { Project, ProjectDraft } from './lib/types';

import { RevisionRequestModal } from './components/RevisionRequestModal';
import { Toast, type ToastData } from './components/Toast';

export default function App() {
  const tracker = useTracker();
  const [activeView, setActiveView] = useState<ViewKey>('dashboard');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [revisionModalProjectId, setRevisionModalProjectId] = useState<string | undefined>(undefined);
  const [toast, setToast] = useState<ToastData | null>(null);
  const visibleProjects = tracker.visibleProjects;
  const isClient = tracker.currentProfile ? isClientRole(tracker.currentProfile.role) : false;

  const selectedProjectFresh = useMemo(() => selectedProject
    ? visibleProjects.find((project) => project.id === selectedProject.id) || null
    : null, [selectedProject, visibleProjects]);
  const deliveredProjects = visibleProjects.filter((project) => project.status === 'Delivered' || project.status === 'Completed');

  useEffect(() => {
    if (!tracker.notificationToast) return;
    setToast({
      title: tracker.notificationToast.title || 'Notification',
      message: tracker.notificationToast.message,
      tone: 'info',
      projectId: tracker.notificationToast.project_id,
    });
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
      setToast({ message: errorMessage(error, 'Project could not be saved.'), tone: 'error' });
      throw error;
    }
  }

  function openAddProject() { setEditingProject(null); setShowProjectForm(true); }
  function openEditProject(project: Project) { setEditingProject(project); setShowProjectForm(true); }
  function openProjectById(projectId: string) {
    const project = visibleProjects.find((item) => item.id === projectId);
    if (!project) { setToast({ message: 'Project is not visible for this user.', tone: 'error' }); return; }
    setSelectedProject(project);
  }
  async function deleteProject(project: Project) {
    if (!window.confirm(`Delete "${project.project_title}"? This cannot be undone.`)) return;
    await tracker.deleteProject(project.id); setSelectedProject(null);
  }
  async function updateSelectedProject(updates: Partial<Project>) {
    if (selectedProjectFresh) await tracker.updateProject(selectedProjectFresh.id, updates);
  }

  if (!tracker.currentProfile) return <LoginPage onLogin={tracker.login} onDemoLogin={tracker.loginDemo} error={tracker.error} isLoading={tracker.isLoading} />;

  /* ---------- AI Assistant Integration ---------- */

  const pageProps = { projects: visibleProjects, profiles: tracker.data.profiles, searchTerm, canManageAll: tracker.canManageAll, currentProfile: tracker.currentProfile, onSelectProject: setSelectedProject, onEditProject: openEditProject, onDeleteProject: deleteProject, onDuplicateProject: tracker.duplicateProject, onUpdateProject: tracker.updateProject, onAddProject: openAddProject };

  return (
    <CurrencyProvider>
      <AIProvider tracker={tracker}>
        <Layout activeView={activeView} setActiveView={setActiveView} currentProfile={tracker.currentProfile} data={tracker.data} notifications={tracker.visibleNotifications} searchTerm={searchTerm} setSearchTerm={setSearchTerm} onAddProject={openAddProject} onMarkNotificationRead={tracker.markNotificationRead} onMarkAllNotificationsRead={tracker.markAllNotificationsRead} onMarkConversationRead={tracker.markConversationRead} onViewNotifications={() => setActiveView('notifications')} onOpenNotificationProject={openProjectById} onSignOut={tracker.signOut}>
    {activeView === 'dashboard' && isClient && (
      <ClientPortalPage
        projects={visibleProjects}
        revisionRequests={tracker.data.revisionRequests}
        revisionItems={tracker.data.revisionItems}
        revisionAttachments={tracker.data.revisionAttachments}
        notifications={tracker.visibleNotifications}
        onCreateRevisionRequest={async (draft) => { await tracker.createRevisionRequest(draft); }}
        onRespondToRevision={async (requestId, decision) => { await tracker.respondToRevisionRequest(requestId, decision); }}
        onApproveMilestone={async (projectId, milestone) => {
          try {
            await tracker.approveProjectMilestone(projectId, milestone);
            const label = milestone === 'concept' ? 'Design concept' : milestone === 'print' ? 'Print version' : 'eBook version';
            setToast({ message: `${label} approved successfully!`, tone: 'success' });
          } catch (error) {
            setToast({ message: errorMessage(error, 'Failed to approve milestone.'), tone: 'error' });
            throw error;
          }
        }}
        onSelectProject={setSelectedProject}
      />
    )}
    {activeView === 'dashboard' && !isClient && <DashboardPage projects={visibleProjects} profiles={tracker.data.profiles} canViewPayments={tracker.canManageAll} canManageProjects={tracker.canManageAll} currentProfileId={tracker.currentProfile.id} onAddProject={openAddProject} onSelectProject={setSelectedProject} />}
    {activeView === 'projects' && isClient && <ClientProjectsPage projects={visibleProjects} searchTerm={searchTerm} onSelectProject={setSelectedProject} />}
    {activeView === 'projects' && !isClient && <ProjectsPage {...pageProps} />}
    {activeView === 'my_tasks' && <TasksPage mode="personal" tasks={tracker.visibleTasks} projects={tracker.data.projects} profiles={tracker.data.profiles} currentProfile={tracker.currentProfile} searchTerm={searchTerm} onCreateTask={async (draft) => { await tracker.createTask(draft); }} onUpdateTask={async (taskId, updates) => { await tracker.updateTask(taskId, updates); }} onSelectProject={setSelectedProject} />}
    {activeView === 'team_tasks' && tracker.canManageAll && <TasksPage mode="team" tasks={tracker.teamTasks} projects={tracker.data.projects} profiles={tracker.data.profiles} currentProfile={tracker.currentProfile} searchTerm={searchTerm} onCreateTask={async (draft) => { await tracker.createTask(draft); }} onUpdateTask={async (taskId, updates) => { await tracker.updateTask(taskId, updates); }} onSelectProject={setSelectedProject} />}
    {activeView === 'communication' && (
      <CommunicationPage
        currentProfile={tracker.currentProfile}
        data={tracker.data}
        projects={visibleProjects}
        profiles={tracker.data.profiles}
        tasks={tracker.data.tasks}
        onSendMessage={tracker.sendMessage}
        onToggleReaction={tracker.toggleReaction}
        onMarkRead={tracker.markConversationRead}
        onGetOrCreateDM={tracker.getOrCreateDM}
        onGetOrCreateProjectConversation={tracker.getOrCreateProjectConversation}
      />
    )}
    {activeView === 'calendar' && <CalendarPage projects={visibleProjects} onSelectProject={setSelectedProject} />}
    {activeView === 'notifications' && <NotificationsPage notifications={tracker.visibleNotifications} projects={visibleProjects} onMarkRead={tracker.markNotificationRead} onMarkAllRead={tracker.markAllNotificationsRead} onOpenProject={openProjectById} />}
    {activeView === 'team' && <TeamPage profiles={tracker.data.profiles} projects={visibleProjects} tasks={tracker.data.tasks} compensation={tracker.data.employeeCompensation} ledger={tracker.data.employeeLedger} canManagePayroll={tracker.currentProfile.role === 'admin'} onAddLedgerEntry={tracker.addEmployeeLedgerEntry} />}
    {activeView === 'clients' && tracker.currentProfile.role === 'admin' && <ClientAccessPage profiles={tracker.data.profiles} projects={tracker.data.projects} clientProjectAccess={tracker.data.clientProjectAccess} onInviteClient={tracker.inviteClient} />}
    {activeView === 'delivered' && <ProjectsPage {...pageProps} title="Delivered Projects" projects={deliveredProjects} />}
    {activeView === 'payments' && tracker.canManageAll && (
      <ErrorBoundary>
        <PaymentsPage projects={visibleProjects} currentProfile={tracker.currentProfile} isLoading={tracker.isLoading} error={tracker.error} onSelectProject={setSelectedProject} onEditProject={openEditProject} onUpdateProject={tracker.updateProject} onDeletePayment={tracker.deletePayment} />
      </ErrorBoundary>
    )}
    {activeView === 'finance' && tracker.currentProfile.role === 'admin' && (
      <FinancePage
        currentProfile={tracker.currentProfile}
        projects={tracker.data.projects}
        profiles={tracker.data.profiles}
        employeeCompensation={tracker.data.employeeCompensation}
        employeeLedger={tracker.data.employeeLedger}
        financeTransactions={tracker.data.financeTransactions}
        financeBudgets={tracker.data.financeBudgets}
        onCreateTransaction={tracker.createFinanceTransaction}
        onUpdateTransaction={tracker.updateFinanceTransaction}
        onDeleteTransaction={tracker.deleteFinanceTransaction}
        onSoftDeleteTransaction={tracker.softDeleteFinanceTransaction}
        onUpdateProject={tracker.updateProject}
        onAddLedgerEntry={tracker.addEmployeeLedgerEntry}
        onDeleteLedgerEntry={tracker.deleteEmployeeLedgerEntry}
        onSaveBudget={tracker.saveFinanceBudget}
      />
    )}
    {activeView === 'settings' && tracker.currentProfile.role === 'admin' && <SettingsPage mode={tracker.mode} />}
    {showProjectForm && <ProjectFormModal currentProfile={tracker.currentProfile} profiles={tracker.data.profiles} projects={tracker.data.projects} project={editingProject} onClose={() => { setShowProjectForm(false); setEditingProject(null); }} onSubmit={handleSaveProject} />}
    {selectedProjectFresh && !isClient && (
      <ProjectDetail
        project={selectedProjectFresh}
        profiles={tracker.data.profiles}
        notes={tracker.data.projectNotes}
        revisions={tracker.data.revisionNotes}
        revisionRequests={tracker.data.revisionRequests}
        revisionItems={tracker.data.revisionItems}
        revisionAttachments={tracker.data.revisionAttachments}
        revisionActivity={tracker.data.revisionActivity}
        activities={tracker.data.activityLogs}
        tasks={tracker.data.tasks}
        currentProfile={tracker.currentProfile}
        canManageAll={tracker.canManageAll}
        onClose={() => setSelectedProject(null)}
        onEdit={() => openEditProject(selectedProjectFresh)}
        onDelete={() => deleteProject(selectedProjectFresh)}
        onUpdateProject={updateSelectedProject}
        onAddNote={async (noteType, note) => { await tracker.addNote(selectedProjectFresh.id, noteType, note); }}
        onAddRevision={async (note, status) => { await tracker.addRevision(selectedProjectFresh.id, note, status); }}
        onUpdateRevisionRequest={tracker.updateRevisionRequest}
        onUpdateRevisionItem={tracker.updateRevisionItem}
        onUploadRevisedProof={tracker.uploadRevisedProof}
        conversations={tracker.data.conversations}
        messages={tracker.data.messages}
        onSendMessage={tracker.sendMessage}
        onGetOrCreateProjectConversation={tracker.getOrCreateProjectConversation}
      />
    )}
    {selectedProjectFresh && isClient && (
      <ClientProjectDetailModal
        project={selectedProjectFresh}
        profiles={tracker.data.profiles}
        notes={tracker.data.projectNotes}
        revisions={tracker.data.revisionNotes}
        revisionRequests={tracker.data.revisionRequests}
        revisionItems={tracker.data.revisionItems}
        revisionAttachments={tracker.data.revisionAttachments}
        activities={tracker.data.activityLogs}
        currentProfile={tracker.currentProfile}
        conversations={tracker.data.conversations}
        messages={tracker.data.messages}
        onSendMessage={tracker.sendMessage}
        onGetOrCreateProjectConversation={tracker.getOrCreateProjectConversation}
        onClose={() => setSelectedProject(null)}
        onApproveMilestone={async (projectId, milestone) => {
          try {
            await tracker.approveProjectMilestone(projectId, milestone);
            const label = milestone === 'concept' ? 'Design concept' : milestone === 'print' ? 'Print version' : 'eBook version';
            setToast({ message: `${label} approved successfully!`, tone: 'success' });
          } catch (error) {
            setToast({ message: errorMessage(error, 'Failed to approve milestone.'), tone: 'error' });
            throw error;
          }
        }}
        onRequestRevision={(projectId) => {
          setSelectedProject(null);
          setRevisionModalProjectId(projectId);
          setShowRevisionModal(true);
        }}
      />
    )}
    {showRevisionModal && (
      <RevisionRequestModal
        projects={visibleProjects}
        initialProjectId={revisionModalProjectId}
        onClose={() => {
          setShowRevisionModal(false);
          setRevisionModalProjectId(undefined);
        }}
        onSubmit={async (draft) => {
          await tracker.createRevisionRequest(draft);
          setShowRevisionModal(false);
          setRevisionModalProjectId(undefined);
          setToast({ message: 'Revision request submitted! Project status updated to In Revision.', tone: 'success' });
        }}
      />
    )}
    <Toast toast={toast} onClose={() => setToast(null)} onOpenProject={openProjectById} />
    <AIDailyPopup />
  </Layout>
  <AIChatButton />
  <AIChatPanel />
  </AIProvider>
  </CurrencyProvider>
  );
}
