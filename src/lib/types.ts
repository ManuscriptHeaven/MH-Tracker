export type Role = 'admin' | 'manager' | 'project_manager' | 'employee' | 'junior_assistant' | 'client';

export type ProjectStatus =
  | 'New'
  | 'Waiting for Files'
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
  | 'Cancelled';

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
  | 'Assigned'
  | 'In Progress'
  | 'Ready for Client Review'
  | 'Additional Revision Required'
  | 'Approved'
  | 'Completed';

export type RevisionItemStatus = 'Open' | 'Under Review' | 'In Progress' | 'Completed';

export type NoteType = 'general' | 'internal' | 'client_instruction' | 'qa' | 'delivery' | 'work';

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
  created_by: string | null;
  created_at: string;
  updated_at: string;
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
  old_value: string | null;
  new_value: string | null;
  user_id: string;
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

export interface RevisionRequest {
  id: string;
  project_id: string;
  client_id: string;
  title: string;
  description: string;
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
  title: string;
  description: string;
  priority: ClientRevisionPriority;
  items: RevisionRequestItemDraft[];
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
  revisionRequests: RevisionRequest[];
  revisionItems: RevisionItem[];
  revisionAttachments: RevisionAttachment[];
  revisionActivity: RevisionActivity[];
}
