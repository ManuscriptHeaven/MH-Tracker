export type Role = 'admin' | 'manager' | 'project_manager' | 'employee' | 'junior_assistant' | 'client';

export type ProjectStatus =
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
  | 'Completed'
  | 'Ready to Start'
  | 'In Progress'
  | 'Formatting'
  | 'Cover Design'
  | 'eBook Conversion'
  | 'First Proof Ready'
  | 'Sent to Client'
  | 'Client Review'
  | 'Revision Requested'
  | 'In Revision'
  | 'Final QA'
  | 'Ready for Delivery'
  | 'Delivered'
  | 'On Hold'
  | 'Archived'
  | 'Cancelled';

export type TimelineStage =
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
  | 'Completed'
  | 'On Hold'
  | 'Cancelled';

export type TimelineStatus = 'Active' | 'Paused' | 'Completed' | 'On Hold' | 'Cancelled';

export type TimelineWaitingOn = 'Manuscript Heaven' | 'Client' | 'None';

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

export interface Project {
  id: string;
  project_number: string;
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
}
