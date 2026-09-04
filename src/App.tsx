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
import { AIAssistantPage } from './pages/AIAssistantPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AIProvider } from './lib/ai/aiContext';
import { CurrencyProvider } from './lib/currency';
import { AIChatButton } from './components/ai/AIChatButton';
import { AIChatPanel } from './components/ai/AIChatPanel';
import { AIDailyPopup } from './components/ai/AIDailyPopup';
import { useTracker } from './lib/useTracker';
import { errorMessage, isClientRole } from './lib/utils';
import type { Project, ProjectDraft, Role } from './lib/types';

import { RevisionRequestModal } from './components/RevisionRequestModal';
import { Toast, type ToastData } from './components/Toast';
import { OfflineBanner } from './components/OfflineBanner';
import { DemoRoleSwitcher } from './components/DemoRoleSwitcher';

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
  const [jumpToConversationId, setJumpToConversationId] = useState<string | null>(null);
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

  function handleSwitchRole(role: Role) {
    tracker.loginDemo(role);
    setActiveView('dashboard');
    setSelectedProject(null);
    setEditingProject(null);
    setShowProjectForm(false);
    setShowRevisionModal(false);
  }

  if (tracker.isInitializing && !tracker.currentProfile) {
    return (
      <main className="grid min-h-screen place-items-center bg-linen p-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-xl bg-gold text-ink font-display text-2xl font-bold shadow-lg animate-pulse">
            MH
          </div>
          <div>
            <h1 className="font-display text-xl font-semibold text-ink">Manuscript Heaven</h1>
            <p className="text-xs uppercase tracking-[0.2em] text-gold mt-1">Publishing Operations</p>
          </div>
          <div className="mt-4 flex items-center gap-2 text-sm font-medium text-muted">
            <div className="h-4 w-4 rounded-full border-2 border-gold border-t-transparent animate-spin" />
            <span>Restoring session...</span>
          </div>
        </div>
      </main>
    );
  }

  if (!tracker.currentProfile) {
    return (
      <>
        <OfflineBanner />
        <LoginPage
          onLogin={tracker.login}
          onSignUp={tracker.signUp}
          onDemoLogin={tracker.loginDemo}
          error={tracker.error}
          isLoading={tracker.isSubmittingLogin}
        />
      </>
    );
  }

  /* ---------- AI Assistant Integration ---------- */

  const pageProps = { projects: visibleProjects, profiles: tracker.data.profiles, searchTerm, canManageAll: tracker.canManageAll, currentProfile: tracker.currentProfile, onSelectProject: setSelectedProject, onEditProject: openEditProject, onDeleteProject: deleteProject, onDuplicateProject: tracker.duplicateProject, onUpdateProject: tracker.updateProject, onAddProject: openAddProject };

  return (
    <CurrencyProvider>
      <AIProvider tracker={tracker} activeView={activeView} selectedProject={selectedProjectFresh}>
        <OfflineBanner />
        <Layout activeView={activeView} setActiveView={setActiveView} currentProfile={tracker.currentProfile} data={tracker.data} notifications={tracker.visibleNotifications} searchTerm={searchTerm} setSearchTerm={setSearchTerm} onAddProject={openAddProject} onMarkNotificationRead={tracker.markNotificationRead} onMarkAllNotificationsRead={tracker.markAllNotificationsRead} onMarkConversationRead={tracker.markConversationRead} onViewNotifications={() => setActiveView('notifications')} onOpenNotificationProject={openProjectById} onSignOut={tracker.signOut} onUpdateProfile={tracker.updateProfile} onOpenConversation={(conversationId) => { setJumpToConversationId(conversationId); setActiveView('communication'); }}>
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
    {activeView === 'ai_assistant' && tracker.canManageAll && (
      <ErrorBoundary>
        <AIAssistantPage projects={visibleProjects} />
      </ErrorBoundary>
    )}
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
        onOpenProject={openProjectById}
        onCreateTask={async (draft) => { await tracker.createTask(draft); }}
        jumpToConversationId={jumpToConversationId}
        onJumpHandled={() => setJumpToConversationId(null)}
      />
    )}
    {activeView === 'calendar' && <CalendarPage projects={visibleProjects} onSelectProject={setSelectedProject} />}
    {activeView === 'team' && (
      <TeamPage
        currentProfile={tracker.currentProfile}
        profiles={tracker.data.profiles}
        projects={visibleProjects}
        tasks={tracker.data.tasks}
        compensation={tracker.data.employeeCompensation}
        ledger={tracker.data.employeeLedger}
        canManagePayroll={tracker.currentProfile.role === 'admin'}
        onAddLedgerEntry={tracker.addEmployeeLedgerEntry}
        onSaveCompensation={tracker.saveEmployeeCompensation}
        onDeleteLedgerEntry={tracker.deleteEmployeeLedgerEntry}
        onUpdateProfile={tracker.updateProfile}
        onAddEmployee={async (data) => {
          await tracker.signUp(data);
        }}
      />
    )}
    {activeView === 'clients' && tracker.currentProfile.role === 'admin' && (
      <ClientAccessPage
        profiles={tracker.data.profiles}
        projects={tracker.data.projects}
        clientProjectAccess={tracker.data.clientProjectAccess}
        onInviteClient={tracker.inviteClient}
        onAddClient={async (data) => {
          await tracker.signUp(data);
        }}
      />
    )}
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
    {activeView === 'settings' && tracker.currentProfile.role === 'admin' && (
      <SettingsPage
        mode={tracker.mode}
        currentProfile={tracker.currentProfile}
        onUpdateProfile={tracker.updateProfile}
      />
    )}
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
        onMarkRead={tracker.markConversationRead}
        onSubmitStageForApproval={async (submissionNote, fileUrl) => {
          try {
            await tracker.submitStageForApproval(selectedProjectFresh.id, submissionNote, fileUrl);
            setToast({ message: 'Submitted stage for client approval & notified client.', tone: 'success' });
          } catch (err) {
            setToast({ message: errorMessage(err, 'Failed to submit stage for approval.'), tone: 'error' });
          }
        }}
        onRequestStageSkip={async (stage, reason) => {
          try {
            await tracker.requestStageSkip(selectedProjectFresh.id, stage, reason);
            setToast({ message: 'Stage skip request sent to client for approval.', tone: 'success' });
          } catch (err) {
            setToast({ message: errorMessage(err, 'Failed to request stage skip.'), tone: 'error' });
          }
        }}
        onAdminWorkflowOverride={async (newStage, reason, explanation) => {
          try {
            await tracker.adminWorkflowOverride(selectedProjectFresh.id, newStage, reason, explanation);
            setToast({ message: 'Administrative workflow override recorded.', tone: 'success' });
          } catch (err) {
            setToast({ message: errorMessage(err, 'Admin override failed.'), tone: 'error' });
          }
        }}
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
        onMarkRead={tracker.markConversationRead}
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
        onRespondToStageSkip={async (requestId, approved) => {
          try {
            await tracker.respondToStageSkip(requestId, approved);
            setToast({ message: `Stage skip ${approved ? 'approved' : 'rejected'}.`, tone: 'success' });
          } catch (err) {
            setToast({ message: errorMessage(err, 'Failed to respond to stage skip.'), tone: 'error' });
          }
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
    {tracker.canManageAll && <AIDailyPopup />}
  </Layout>
  {activeView !== 'ai_assistant' && tracker.canManageAll && (
    <>
      <AIChatButton />
      <AIChatPanel />
    </>
  )}
  <DemoRoleSwitcher
    currentRole={tracker.currentProfile.role}
    currentProfile={tracker.currentProfile}
    onSwitchRole={handleSwitchRole}
  />
  </AIProvider>
  </CurrencyProvider>
  );
}
