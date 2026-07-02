export type Role = 'admin' | 'project_manager' | 'employee' | 'junior_assistant';

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
  user_id: string;
  project_id: string | null;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface TrackerData {
  profiles: Profile[];
  projects: Project[];
  revisionNotes: RevisionNote[];
  projectNotes: ProjectNote[];
  activityLogs: ActivityLog[];
  notifications: NotificationItem[];
}
