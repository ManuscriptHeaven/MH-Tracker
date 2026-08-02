export interface AIMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: AIMessageMetadata;
  createdAt: string;
  isStreaming?: boolean;
}

export interface AIMessageMetadata {
  command?: AICommand;
  actionResult?: AIActionResult;
  sources?: RAGSource[];
}

export interface AIConversation {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AIMessage[];
}

export interface AICommand {
  type: AICommandType;
  params: Record<string, unknown>;
  requiresConfirmation: boolean;
  description: string;
}

export type AICommandType = 
  | 'find_project' | 'generate_invoice' | 'create_client' | 'update_status'
  | 'search_files' | 'show_overdue_tasks' | 'draft_email' | 'calculate_quote'
  | 'generate_report' | 'show_pending_invoices' | 'show_due_today' | 'general_query';

export interface AIActionResult {
  success: boolean;
  message: string;
  data?: unknown;
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
  category: 'projects' | 'tasks' | 'invoices' | 'general';
}

export interface AIUserSettings {
  voiceEnabled: boolean;
  voiceLanguage: string;
  ttsEnabled: boolean;
  autoSpeak: boolean;
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
