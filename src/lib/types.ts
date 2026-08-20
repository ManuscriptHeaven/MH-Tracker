export type Role = 'admin' | 'manager' | 'project_manager' | 'employee' | 'junior_assistant' | 'client';

export type StandardProjectStatus =
  | 'Active'
  | 'In Progress'
  | 'Awaiting Client Approval'
  | 'In Revision'
  | 'Final Delivery'
  | 'Completed'
  | 'On Hold'
  | 'Cancelled';

export type LegacyProjectStatus =
  | 'New'
  | 'Waiting for Files'
  | 'Files Required'
  | 'Files Received'
  | 'Design Concept in Progress'
  | 'Awaiting Concept Approval'
  | 'Concept Revisions'
  | 'Print Version in Progress'
  | 'Awaiting Print Approval'
  | 'Print Revisions'
  | 'eBook in Progress'
  | 'eBook Review'
  | 'Final Quality Check'
  | 'Ready to Start'
  | 'Formatting'
  | 'Cover Design'
  | 'eBook Conversion'
  | 'First Proof Ready'
  | 'Sent to Client'
  | 'Client Review'
  | 'Revision Requested'
  | 'Final QA'
  | 'Ready for Delivery'
  | 'Delivered'
  | 'Archived';

export type ProjectStatus = StandardProjectStatus | LegacyProjectStatus;

export type OfficialTimelineStage =
  | 'Files Received'
  | 'Design Concept'
  | 'Concept Approval'
  | 'Print Version'
  | 'Print Approval'
  | 'Ebook Version'
  | 'Ebook Approval'
  | 'Final Delivery';

export type TimelineStage =
  | OfficialTimelineStage
  | 'Completed'
  | 'On Hold'
  | 'Cancelled'
  | 'Files Required'
  | 'Design Concept in Progress'
  | 'Awaiting Concept Approval'
  | 'Concept Revisions'
  | 'Print Version in Progress'
  | 'Awaiting Print Approval'
  | 'Print Revisions'
  | 'eBook in Progress'
  | 'eBook Review'
  | 'Final Quality Check';

export type ClockState = 'ACTIVE' | 'PAUSED_CLIENT_REVIEW' | 'REVISION_ACTIVE' | 'COMPLETED' | 'PENDING';

export type TimelineStatus = 'Active' | 'Paused' | 'Revision Required' | 'Completed' | 'On Hold' | 'Cancelled';

export type TimelineWaitingOn = 'Manuscript Heaven' | 'Client' | 'None';

export interface WorkflowSettings {
  files_received_days: number;
  design_concept_days: number;
  design_concept_revision_days: number;
  print_version_days: number;
  print_version_revision_days: number;
  ebook_version_days: number;
  ebook_version_revision_days: number;
  final_delivery_days: number;
  exclude_weekends?: boolean;
}

export interface StageData {
  stage: TimelineStage;
  status: ClockState;
  started_at: string | null;
  paused_at: string | null;
  resumed_at: string | null;
  completed_at: string | null;
  due_at: string | null;
  active_seconds: number;
  client_wait_seconds: number;
  pause_reason: string | null;
  revision_count: number;
}

export interface StageHistoryEntry {
  id: string;
  project_id: string;
  stage: TimelineStage;
  previous_stage?: TimelineStage | null;
  status: ClockState;
  started_at: string | null;
  paused_at?: string | null;
  resumed_at?: string | null;
  completed_at?: string | null;
  due_at?: string | null;
  active_seconds: number;
  client_wait_seconds: number;
  actor_id?: string | null;
  action: string;
  notes?: string | null;
  created_at: string;
}

export type PrintTimelineDays = 3 | 4 | 5;

export type Priority = 'Low' | 'Normal' | 'High' | 'Urgent';

export type PaymentStatus =
  | 'Not Started'
  | 'Advance Paid'
  | 'Partially Paid'
  | 'Fully Paid'
  | 'Pending'
  | 'Refunded';

export type RevisionStatus = 'Pending' | 'In Progress' | 'Completed';

export type ClientRevisionPriority = 'Normal' | 'Important' | 'Urgent';

export type ClientRevisionStatus =
  | 'Submitted'
  | 'Under Review'
  | 'In Progress'
  | 'Ready for Client Review'
  | 'Approved'
  | 'Completed'
  | 'Assigned'
  | 'Additional Revision Required';

export type RevisionItemStatus = 'Open' | 'Under Review' | 'In Progress' | 'Completed';

export type NoteType = 'general' | 'internal' | 'client_instruction' | 'qa' | 'delivery' | 'work';

export type TaskStatus = 'To Do' | 'In Progress' | 'Done';

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  avatar_url?: string | null;
  phone?: string | null;
  status?: 'active' | 'inactive';
  created_at: string;
}

export interface EmployeeCompensation {
  employee_id: string;
  monthly_salary: number;
  per_project_rate: number;
  joining_date: string | null;
  responsibilities: string;
  performance_rating: number | null;
  updated_at: string;
}

export type EmployeeLedgerType = 'Salary' | 'Project Payment' | 'Bonus' | 'Advance' | 'Deduction' | 'Payment' | 'Other';

export interface EmployeeLedgerEntry {
  id: string;
  employee_id: string;
  entry_type: EmployeeLedgerType;
  amount: number;
  salary_month: string | null;
  payment_method: string | null;
  project_id: string | null;
  notes: string;
  paid_at: string;
  created_at: string;
}

export interface Project {
  id: string;
  project_number: string;
  client_profile_id?: string | null;
  client_name: string;
  client_email: string;
  project_title: string;
  service_type: string;
  genre: string;
  trim_size: string;
  page_count: number;
  word_count: number;
  image_count: number;
  platform: string;
  assigned_to: string | null;
  project_manager: string | null;
  priority: Priority;
  start_date: string;
  due_date: string;
  internal_deadline: string;
  delivery_date: string | null;
  status: ProjectStatus;
  general_notes: string;
  internal_notes: string;
  client_instructions: string;
  qa_notes: string;
  delivery_notes: string;
  source_file_link: string;
  drive_folder_link: string;
  client_brief_link: string;
  proof_pdf_link: string;
  final_print_pdf_link: string;
  final_ebook_link: string;
  cover_file_link: string;
  other_links: string;
  total_price: number;
  advance_paid: number;
  remaining_balance: number;
  payment_status: PaymentStatus;
  payment_date: string | null;
  payment_notes: string;
  files_received_date?: string | null;
  design_concept_due_date?: string | null;
  design_concept_due_date_manual?: boolean;
  design_concept_submitted_date?: string | null;
  design_concept_approval_date?: string | null;
  concept_revision_due_date?: string | null;
  print_version_due_date?: string | null;
  print_version_due_date_manual?: boolean;
  print_version_submitted_date?: string | null;
  print_version_approval_date?: string | null;
  print_revision_due_date?: string | null;
  ebook_due_date?: string | null;
  ebook_due_date_manual?: boolean;
  ebook_submitted_date?: string | null;
  ebook_approval_date?: string | null;
  final_delivery_date?: string | null;
  current_stage?: TimelineStage;
  stage_status?: ClockState;
  stage_started_at?: string | null;
  stage_due_at?: string | null;
  stage_completed_at?: string | null;
  final_due_at?: string | null;
  production_time_used?: number;
  client_wait_time?: number;
  revision_count?: number;
  stage_states?: Record<string, StageData>;
  stage_history?: StageHistoryEntry[];
  workflow_settings?: WorkflowSettings;
  progress_percentage?: number;
  waiting_on?: TimelineWaitingOn;
  timeline_status?: TimelineStatus;
  production_days_used?: number;
  delay_reason?: string;
  client_action_required?: string;
  print_timeline_days?: PrintTimelineDays;
  invoiced?: boolean;
  invoice_id?: string | null;
  invoiced_at?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceItem {
  project_id: string;
  project_number: string;
  project_title: string;
  service_type: string;
  total_price: number;
  advance_paid: number;
  due_amount: number;
  completion_date?: string | null;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  client_name: string;
  client_email: string;
  month: number;
  year: number;
  month_label: string;
  created_at: string;
  due_date: string;
  items: InvoiceItem[];
  subtotal: number;
  total_paid: number;
  total_due: number;
  notes?: string;
  status: 'Draft' | 'Sent' | 'Paid';
}

export interface ProjectPayment {
  id: string;
  project_id: string;
  total_price: number;
  advance_paid: number;
  remaining_balance: number;
  payment_status: PaymentStatus;
  due_date?: string | null;
  payment_month?: string | null;
  payment_year?: number | null;
  payment_date?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export type ProjectDraft = Omit<
  Project,
  'id' | 'project_number' | 'remaining_balance' | 'created_at' | 'updated_at' | 'created_by'
> & {
  id?: string;
  project_number?: string;
  created_by?: string | null;
};

export interface RevisionNote {
  id: string;
  project_id: string;
  revision_number: number;
  note: string;
  status: RevisionStatus;
  added_by: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectNote {
  id: string;
  project_id: string;
  note_type: NoteType;
  note: string;
  added_by: string;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  project_id: string;
  action: string;
  activity_type?: string | null;
  description?: string | null;
  old_value: string | null;
  new_value: string | null;
  user_id: string;
  attachment_url?: string | null;
  internal_note?: string | null;
  created_at: string;
}

export interface NotificationItem {
  id: string;
  recipient_id: string;
  project_id: string | null;
  revision_request_id?: string | null;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface ClientProjectAccess {
  id: string;
  client_id: string;
  project_id: string;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  project_id: string | null;
  assigned_to: string | null;
  created_by: string;
  status: TaskStatus;
  priority: Priority;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type TaskDraft = Omit<Task, 'id' | 'created_by' | 'completed_at' | 'created_at' | 'updated_at'>;

export interface RevisionRequest {
  id: string;
  project_id: string;
  client_id: string;
  title: string;
  description: string;
  instructions: string;
  team_response: string | null;
  priority: ClientRevisionPriority;
  status: ClientRevisionStatus;
  assigned_to: string | null;
  submitted_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RevisionItem {
  id: string;
  revision_request_id: string;
  sort_order: number;
  page_reference: string;
  instruction: string;
  status: RevisionItemStatus;
  client_attachment_url: string | null;
  team_response: string | null;
  internal_note?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RevisionAttachment {
  id: string;
  revision_request_id: string;
  revision_item_id: string | null;
  file_name: string;
  file_url: string;
  file_type: string;
  uploaded_by: string;
  created_at: string;
}

export interface RevisionActivity {
  id: string;
  revision_request_id: string;
  user_id: string | null;
  action: string;
  previous_value: string | null;
  new_value: string | null;
  created_at: string;
}

export interface RevisionRequestItemDraft {
  page_reference: string;
  instruction: string;
  client_attachment_url?: string | null;
  attachment_file?: File | null;
}

export interface RevisionRequestDraft {
  project_id: string;
  instructions: string;
  title?: string;
  description?: string;
  priority?: ClientRevisionPriority;
  items?: RevisionRequestItemDraft[];
  attachments?: File[];
}

export interface ClientInviteDraft {
  full_name: string;
  email: string;
  project_ids: string[];
  status?: 'active' | 'inactive';
}

export interface TrackerData {
  profiles: Profile[];
  projects: Project[];
  revisionNotes: RevisionNote[];
  projectNotes: ProjectNote[];
  activityLogs: ActivityLog[];
  notifications: NotificationItem[];
  clientProjectAccess: ClientProjectAccess[];
  tasks: Task[];
  revisionRequests: RevisionRequest[];
  revisionItems: RevisionItem[];
  revisionAttachments: RevisionAttachment[];
  revisionActivity: RevisionActivity[];
  employeeCompensation: EmployeeCompensation[];
  employeeLedger: EmployeeLedgerEntry[];
  workflowSettings?: WorkflowSettings;
  stageHistory?: StageHistoryEntry[];
  financeTransactions?: FinanceTransaction[];
  financeBudgets?: FinanceBudget[];
  projectProfitability?: ProjectProfitabilityItem[];
  clientReceivables?: ClientReceivableItem[];
  teamPayroll?: TeamPayrollItem[];
  conversations?: Conversation[];
  conversationMembers?: ConversationMember[];
  messages?: ChatMessage[];
  messageAttachments?: MessageAttachment[];
  messageReactions?: MessageReaction[];
  messageMentions?: MessageMention[];
}

export type CurrencyCode = 'PKR' | 'USD' | 'EUR' | 'GBP';

export type IncomeCategory =
  | 'Book Formatting'
  | 'eBook Formatting'
  | 'Cover Design'
  | 'Publishing Support'
  | 'Other Services'
  | 'Other Income';

export type ExpenseCategory =
  | 'Office'
  | 'Software'
  | 'Adobe'
  | 'AI/API'
  | 'Hosting'
  | 'Domain'
  | 'Marketing'
  | 'Advertising'
  | 'Freelancers'
  | 'Team'
  | 'Equipment'
  | 'Internet'
  | 'Utilities'
  | 'Bank Fees'
  | 'Payment Processing Fees'
  | 'Taxes'
  | 'Miscellaneous';

export type FinanceTransactionType = 'income' | 'expense';

export type RecurringStatus = 'none' | 'monthly' | 'quarterly' | 'yearly';

export interface FinanceTransaction {
  id: string;
  type: FinanceTransactionType;
  category: string;
  description: string;
  amount: number;
  original_amount?: number;
  currency: CurrencyCode;
  exchange_rate: number;
  amount_pkr: number;
  base_amount_pkr?: number;
  transaction_date: string;
  client_name?: string | null;
  client_id?: string | null;
  project_id?: string | null;
  employee_id?: string | null;
  invoice_id?: string | null;
  payment_method: string;
  reference_no?: string | null;
  vendor?: string | null;
  recurring_status?: RecurringStatus;
  next_recurring_date?: string | null;
  notes?: string | null;
  attachment_url?: string | null;
  expense_type?: string | null;
  payment_status?: 'Paid' | 'Pending' | 'Partially Paid' | null;
  paid_date?: string | null;
  financial_account?: string | null;
  tax_amount?: number;
  fee_amount?: number;
  recurring_end_date?: string | null;
  is_soft_deleted?: boolean;
  created_by: string | null;
  created_at: string;
  updated_by?: string | null;
  updated_at?: string;
}

export type FinanceTransactionDraft = Omit<
  FinanceTransaction,
  'id' | 'created_at' | 'created_by' | 'amount_pkr' | 'base_amount_pkr' | 'updated_at' | 'updated_by'
> & {
  id?: string;
  amount_pkr?: number;
  base_amount_pkr?: number;
};

export interface FinanceBudget {
  category: string;
  monthly_budget_pkr: number;
  updated_by?: string | null;
  updated_at?: string;
}

export interface ProjectProfitabilityItem {
  project_id: string;
  project_number: string;
  project_title: string;
  client_name: string;
  revenue_pkr: number;
  team_cost_pkr: number;
  direct_expenses_pkr: number;
  payment_fees_pkr: number;
  total_cost_pkr: number;
  net_profit_pkr: number;
  profit_margin_percent: number;
}

export interface ClientReceivableItem {
  client_name: string;
  client_email: string;
  total_invoiced_pkr: number;
  total_paid_pkr: number;
  outstanding_pkr: number;
  overdue_pkr: number;
  project_count: number;
  invoices_count: number;
}

export interface TeamPayrollItem {
  employee_id: string;
  employee_name: string;
  monthly_salary_pkr: number;
  per_project_rate_pkr: number;
  advance_pkr: number;
  bonus_pkr: number;
  deduction_pkr: number;
  paid_pkr: number;
  net_payable_pkr: number;
  remaining_due_pkr: number;
  payment_date: string | null;
  status: 'Paid' | 'Partial' | 'Pending';
}

export type FinancialReportType =
  | 'pnl'
  | 'income'
  | 'expense'
  | 'cash_flow'
  | 'receivables'
  | 'payroll'
  | 'profitability'
  | 'tax';

export type ConversationType = 'team_channel' | 'dm' | 'project_internal' | 'project_client' | 'task';

export interface Conversation {
  id: string;
  type: ConversationType;
  name?: string | null;
  project_id?: string | null;
  task_id?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationMember {
  id: string;
  conversation_id: string;
  user_id: string;
  last_read_at: string;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  parent_message_id?: string | null;
  created_at: string;
  updated_at: string;
  attachments?: MessageAttachment[];
  reactions?: MessageReaction[];
  mentions?: MessageMention[];
}

export interface MessageAttachment {
  id: string;
  message_id: string;
  file_name: string;
  file_url: string;
  file_type: string;
  file_size: number;
  created_at: string;
}

export interface MessageReaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface MessageMention {
  id: string;
  message_id: string;
  user_id: string;
  created_at: string;
}

export type CommunicationFilterSection =
  | 'inbox'
  | 'team_channels'
  | 'direct_messages'
  | 'project_internal'
  | 'project_client';

