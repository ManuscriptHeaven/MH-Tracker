import type {
  CurrencyCode,
  Profile,
  TrackerData,
  Project,
  Task,
  TaskDraft,
  RevisionRequest,
  NoteType,
  ProjectStatus,
  FinanceTransactionDraft,
  EmployeeLedgerType,
} from '../types';

export type AIToolName =
  // Read Tools (Phase 1)
  | 'get_project_summary'
  | 'get_overdue_projects'
  | 'get_due_today_projects'
  | 'get_due_this_week_projects'
  | 'get_projects_by_client'
  | 'get_projects_by_employee'
  | 'get_projects_by_status'
  | 'get_projects_by_stage'
  | 'get_pending_approvals'
  | 'get_projects_in_revision'
  | 'get_project_details'
  | 'get_project_timeline'
  | 'get_project_revisions'
  | 'get_tasks_summary'
  | 'get_employee_workload'
  | 'get_client_summary'
  | 'get_client_receivables'
  | 'get_finance_summary'
  | 'get_payroll_summary'
  | 'get_project_activity'
  // Write & Action Tools (Phase 2)
  | 'create_project'
  | 'duplicate_project'
  | 'create_task'
  | 'update_task_status'
  | 'assign_task'
  | 'update_task_due_date'
  | 'delete_task'
  | 'update_project_status'
  | 'update_project_due_date'
  | 'assign_project'
  | 'delete_project'
  | 'create_revision_request'
  | 'reassign_revision'
  | 'update_revision_status'
  | 'add_revision_note'
  | 'add_project_note'
  | 'invite_client'
  | 'approve_project_milestone'
  | 'record_project_payment'
  | 'record_income'
  | 'record_expense'
  | 'record_payroll_payment'
  | 'add_payroll_advance'
  | 'add_payroll_deduction'
  | 'send_internal_message'
  | 'send_client_message'
  | 'send_whatsapp_message';

export type AIActionCategory = 'safe_read' | 'safe_write' | 'high_risk' | 'destructive';

export interface AIActionChangeItem {
  field: string;
  label: string;
  oldValue?: string | number | null;
  newValue: string | number | null;
}

export interface AIActionPreview {
  actionId: string;
  toolName: AIToolName;
  category: AIActionCategory;
  title: string;
  description: string;
  targetType: 'project' | 'task' | 'revision' | 'finance' | 'payroll' | 'message';
  targetId?: string;
  targetTitle?: string;
  clientName?: string;
  assignedToName?: string;
  changes: AIActionChangeItem[];
  payload: Record<string, any>;
  confirmButtonText: string;
  cancelButtonText: string;
  spokenPrompt: string;
  requiresStrongConfirmation?: boolean;
}

export interface AIActionAuditLog {
  id: string;
  userId: string;
  userName: string;
  userRole: string;
  action: string;
  targetType: string;
  targetId?: string;
  targetTitle?: string;
  oldValue?: string | null;
  newValue?: string | null;
  timestamp: string;
  confirmed: boolean;
  aiInitiated: boolean;
  status: 'success' | 'failed' | 'cancelled';
  errorMessage?: string;
}

export interface DisambiguationOption {
  id: string;
  title: string;
  subtitle?: string;
  type: 'project' | 'task' | 'revision' | 'employee' | 'client';
  data?: any;
}

export interface AIToolContext {
  currentProfile: Profile;
  data: TrackerData;
  visibleProjects: Project[];
  visibleTasks: Task[];
  displayCurrency: CurrencyCode;
  exchangeRate: number;
  formatMoney: (
    amount: number | null | undefined,
    fromCurrency?: CurrencyCode | string,
    options?: { showCode?: boolean; forceDecimals?: boolean },
  ) => string;
  convertMoney: (
    amount: number | null | undefined,
    fromCurrency?: CurrencyCode | string,
    toCurrency?: CurrencyCode | string,
    rateOverride?: number,
  ) => number;

  // Tracker Mutations for Phase 2 Write Tools
  trackerMutations?: {
    createProject?: (draft: any) => Promise<any>;
    duplicateProject?: (projectId: string) => Promise<any>;
    createTask?: (draft: TaskDraft) => Promise<Task>;
    updateTask?: (taskId: string, updates: Partial<Task>) => Promise<Task>;
    deleteTask?: (taskId: string) => Promise<void>;
    updateProject?: (projectId: string, updates: Partial<Project>) => Promise<Project>;
    deleteProject?: (projectId: string) => Promise<void>;
    addNote?: (projectId: string, noteType: NoteType, note: string) => Promise<any>;
    createRevisionRequest?: (draft: any) => Promise<any>;
    updateRevisionRequest?: (id: string, updates: Partial<RevisionRequest>) => Promise<void>;
    respondToRevisionRequest?: (id: string, response: string, status?: string, assignedTo?: string) => Promise<void>;
    approveProjectMilestone?: (projectId: string, milestone: string, approvedBy?: string, notes?: string, clientSignedName?: string) => Promise<void>;
    inviteClient?: (draft: any) => Promise<void>;
    createFinanceTransaction?: (draft: FinanceTransactionDraft) => Promise<any>;
    updateFinanceTransaction?: (id: string, updates: any) => Promise<any>;
    deleteFinanceTransaction?: (id: string) => Promise<void>;
    addEmployeeLedgerEntry?: (entry: any) => Promise<void>;
    deleteEmployeeLedgerEntry?: (id: string) => Promise<void>;
    sendMessage?: (conversationId: string, body: string) => Promise<any>;
    getOrCreateDM?: (otherUserId: string) => Promise<any>;
    getOrCreateProjectConversation?: (projectId: string) => Promise<any>;
    getOrCreateTaskConversation?: (taskId: string) => Promise<any>;
  };
}

export interface AIToolResult<T = any> {
  success: boolean;
  toolName: AIToolName;
  spokenText: string;
  displayText: string;
  data?: T;
  error?: string;
  count?: number;
  pendingAction?: AIActionPreview;
  disambiguation?: DisambiguationOption[];
  auditLog?: AIActionAuditLog;
  entities?: {
    projects?: Project[];
    clients?: string[];
    employees?: string[];
    tasks?: Task[];
    revisions?: RevisionRequest[];
  };
}

export interface ConversationMemory {
  lastTopic?: 'projects' | 'tasks' | 'revisions' | 'clients' | 'team' | 'finance' | 'payroll' | 'messages' | 'general';
  lastToolUsed?: AIToolName;
  lastProjects?: Project[];
  lastTasks?: Task[];
  lastRevisions?: RevisionRequest[];
  lastClientName?: string;
  lastEmployeeName?: string;
  lastStatus?: string;
  lastStage?: string;
  lastQueryTime?: string;
  pendingAction?: AIActionPreview | null;
  pendingDisambiguation?: DisambiguationOption[] | null;
  pendingDisambiguationContext?: {
    originalQuery: string;
    intentType: string;
    targetPayload: Record<string, any>;
  } | null;
}

export interface ToolExecutionLog {
  id: string;
  userId: string;
  userRole: string;
  question: string;
  toolUsed: AIToolName;
  timestamp: string;
  success: boolean;
  error?: string;
}

export interface AIMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  spokenText?: string;
  metadata?: AIMessageMetadata;
  createdAt: string;
  isStreaming?: boolean;
}

export interface AIMessageMetadata {
  toolUsed?: AIToolName;
  toolResult?: AIToolResult;
  pendingAction?: AIActionPreview;
  disambiguation?: DisambiguationOption[];
  actionStatus?: 'pending' | 'confirmed' | 'cancelled' | 'executed' | 'failed';
  auditLog?: AIActionAuditLog;
  sources?: RAGSource[];
  suggestedFollowUps?: string[];
}

export interface AIConversation {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AIMessage[];
}

export interface RAGSource {
  title: string;
  category: string;
  content: string;
  similarity: number;
}

export interface DailySummary {
  greeting: string;
  pendingProjects: { count: number; items: DailySummaryItem[] };
  dueToday: { count: number; items: DailySummaryItem[] };
  overdueTasks: { count: number; items: DailySummaryItem[] };
  unreadMessages: number;
  pendingInvoices: { count: number; totalAmount: number };
  revenueSummary: { thisMonth: number; lastMonth: number; change: number };
  recommendedActions: string[];
  proactiveInsights: ProactiveInsight[];
}

export interface DailySummaryItem {
  id: string;
  title: string;
  subtitle?: string;
  urgency?: 'low' | 'medium' | 'high' | 'critical';
}

export interface ProactiveInsight {
  type: 'missing_invoice' | 'late_project' | 'missing_files' | 'unpaid_client' | 'upcoming_deadline' | 'duplicate_project';
  title: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  relatedId?: string;
}

export interface QuickAction {
  id: string;
  label: string;
  command: string;
  icon?: string;
  category: 'projects' | 'tasks' | 'finance' | 'team' | 'general';
}

export interface AIUserSettings {
  voiceEnabled: boolean;
  voiceLanguage: string;
  ttsEnabled: boolean;
  autoSpeak: boolean;
  isMuted?: boolean;
}

export interface KnowledgeBaseDocument {
  id: string;
  title: string;
  fileName: string;
  fileUrl: string | null;
  fileType: string | null;
  category: string;
  uploadedBy: string;
  createdAt: string;
}
