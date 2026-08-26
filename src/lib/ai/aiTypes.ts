import type { CurrencyCode, Profile, TrackerData, Project, Task, RevisionRequest } from '../types';

export type AIToolName =
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
  | 'get_project_activity';

export interface AIToolContext {
  currentProfile: Profile;
  data: TrackerData;
  visibleProjects: Project[];
  visibleTasks: Task[];
  displayCurrency: CurrencyCode;
  exchangeRate: number;
  formatMoney: (amount: number | null | undefined, fromCurrency?: CurrencyCode | string, options?: { showCode?: boolean; forceDecimals?: boolean }) => string;
  convertMoney: (amount: number | null | undefined, fromCurrency?: CurrencyCode | string, toCurrency?: CurrencyCode | string, rateOverride?: number) => number;
}

export interface AIToolResult<T = any> {
  success: boolean;
  toolName: AIToolName;
  spokenText: string;
  displayText: string;
  data?: T;
  error?: string;
  count?: number;
  entities?: {
    projects?: Project[];
    clients?: string[];
    employees?: string[];
  };
}

export interface ConversationMemory {
  lastTopic?: 'projects' | 'tasks' | 'revisions' | 'clients' | 'team' | 'finance' | 'payroll' | 'general';
  lastToolUsed?: AIToolName;
  lastProjects?: Project[];
  lastClientName?: string;
  lastEmployeeName?: string;
  lastStatus?: string;
  lastStage?: string;
  lastQueryTime?: string;
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
