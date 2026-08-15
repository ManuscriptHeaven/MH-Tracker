import {
  AlertCircle,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  CreditCard,
  Download,
  Edit,
  ExternalLink,
  FileCheck,
  FileCode,
  FileText,
  Filter,
  FolderOpen,
  History,
  Layers,
  ListChecks,
  Lock,
  MessageSquare,
  Paperclip,
  Plus,
  Printer,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  TrendingUp,
  User,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { RevisionRequestsPage } from '../pages/RevisionRequestsPage';
import { revisionStatuses, timelineStages } from '../lib/constants';
import { deadlineClass, deadlineLabel, formatDate, todayInput } from '../lib/date';
import { getTimelineSummary, timelineUpdateForStage } from '../lib/timeline';
import { currency, firstName, initials } from '../lib/utils';
import type {
  ActivityLog,
  ChatMessage,
  Conversation,
  NoteType,
  Profile,
  Project,
  ProjectNote,
  RevisionActivity,
  RevisionAttachment,
  RevisionItem,
  RevisionNote,
  RevisionRequest,
  RevisionStatus,
  TimelineStage,
  Task,
} from '../lib/types';
import { PaymentBadge, PriorityBadge, RoleBadge, StatusBadge } from './Badges';
import { ProjectTimelinePanel, TimelineBadge } from './ProjectTimeline';
import { ProjectDiscussionChat } from './ProjectDiscussionChat';
import { Button, Card, Field, Modal, SelectField, TextareaField } from './ui';

export type ProjectDetailTab =
  | 'overview'
  | 'timeline'
  | 'files'
  | 'revisions'
  | 'tasks'
  | 'communication'
  | 'payment'
  | 'activity';

const noteTypes: Array<{ value: NoteType; label: string }> = [
  { value: 'general', label: 'General' },
  { value: 'internal', label: 'Internal' },
  { value: 'client_instruction', label: 'Client Instruction' },
  { value: 'qa', label: 'QA' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'work', label: 'Work Note' },
];

function profileName(profiles: Profile[], id?: string | null) {
  const profile = profiles.find((item) => item.id === id);
  return profile ? firstName(profile.full_name) : 'Unassigned';
}

function fullProfileName(profiles: Profile[], id?: string | null) {
  const profile = profiles.find((item) => item.id === id);
  return profile ? profile.full_name : 'Unassigned';
}

export function ProjectDetail({
  project,
  profiles,
  notes,
  revisions,
  revisionRequests,
  revisionItems,
  revisionAttachments,
  revisionActivity,
  activities,
  tasks,
  currentProfile,
  canManageAll,
  onClose,
  onEdit,
  onDelete,
  onUpdateProject,
  onAddNote,
  onAddRevision,
  onUpdateRevisionRequest,
  onUpdateRevisionItem,
  onUploadRevisedProof,
  conversations = [],
  messages = [],
  onSendMessage,
  onGetOrCreateProjectConversation,
}: {
  project: Project;
  profiles: Profile[];
  notes: ProjectNote[];
  revisions: RevisionNote[];
  revisionRequests: RevisionRequest[];
  revisionItems: RevisionItem[];
  revisionAttachments: RevisionAttachment[];
  revisionActivity: RevisionActivity[];
  activities: ActivityLog[];
  tasks: Task[];
  currentProfile: Profile;
  canManageAll: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onUpdateProject: (updates: Partial<Project>) => Promise<void>;
  onAddNote: (noteType: NoteType, note: string) => Promise<void>;
  onAddRevision: (note: string, status: RevisionStatus) => Promise<void>;
  onUpdateRevisionRequest: (requestId: string, updates: Partial<RevisionRequest>) => Promise<void>;
  onUpdateRevisionItem: (itemId: string, updates: Partial<RevisionItem>) => Promise<void>;
  onUploadRevisedProof: (requestId: string, file: File) => Promise<void>;
  conversations?: Conversation[];
  messages?: ChatMessage[];
  onSendMessage?: (
    conversationId: string,
    body: string,
    attachments?: { file_name: string; file_url: string; file_type: string; file_size: number }[],
    parentMessageId?: string | null,
  ) => Promise<ChatMessage>;
  onGetOrCreateProjectConversation?: (projectId: string, isInternal: boolean) => Promise<Conversation>;
}) {
  const [activeTab, setActiveTab] = useState<ProjectDetailTab>('overview');
  const [stage, setStage] = useState<TimelineStage>(project.current_stage || 'Files Required');
  const [noteType, setNoteType] = useState<NoteType>('work');
  const [note, setNote] = useState('');
  const [revisionNote, setRevisionNote] = useState('');
  const [revisionStatus, setRevisionStatus] = useState<RevisionStatus>('Pending');
  const [commSubTab, setCommSubTab] = useState<'internal' | 'client'>('internal');
  const [quickMsg, setQuickMsg] = useState('');
  const [activityFilter, setActivityFilter] = useState<'all' | 'client' | 'team' | 'files' | 'status' | 'revisions' | 'system'>('all');
  const [taskFilter, setTaskFilter] = useState<'all' | 'open' | 'in_progress' | 'done'>('all');

  // File links editing modal state
  const [isEditingFiles, setIsEditingFiles] = useState(false);
  const [editFileValues, setEditFileValues] = useState({
    source_file_link: project.source_file_link || '',
    drive_folder_link: project.drive_folder_link || '',
    client_brief_link: project.client_brief_link || '',
    proof_pdf_link: project.proof_pdf_link || '',
    final_print_pdf_link: project.final_print_pdf_link || '',
    final_ebook_link: project.final_ebook_link || '',
    cover_file_link: project.cover_file_link || '',
    other_links: project.other_links || '',
  });

  // Payment editing state
  const [isEditingPayment, setIsEditingPayment] = useState(false);
  const [paymentValues, setPaymentValues] = useState({
    total_price: String(project.total_price || 0),
    advance_paid: String(project.advance_paid || 0),
    payment_status: project.payment_status || 'Not Started',
    payment_date: project.payment_date || '',
    payment_notes: project.payment_notes || '',
  });

  const summary = useMemo(() => getTimelineSummary(project), [project]);

  const projectNotes = useMemo(
    () => notes.filter((item) => item.project_id === project.id),
    [notes, project.id],
  );

  const projectRevisions = useMemo(
    () => revisions.filter((item) => item.project_id === project.id),
    [revisions, project.id],
  );

  const projectRevisionRequests = useMemo(
    () => revisionRequests.filter((item) => item.project_id === project.id),
    [revisionRequests, project.id],
  );

  const projectActivities = useMemo(
    () => activities.filter((item) => item.project_id === project.id),
    [activities, project.id],
  );

  const projectTasks = useMemo(
    () => tasks.filter((task) => task.project_id === project.id),
    [project.id, tasks],
  );

  useEffect(() => {
    setStage(project.current_stage || 'Files Required');
  }, [project.current_stage, project.id]);

  async function saveStage() {
    await onUpdateProject(timelineUpdateForStage(project, stage));
  }

  async function markDelivered() {
    setStage('Completed');
    await onUpdateProject(timelineUpdateForStage({ ...project, final_delivery_date: todayInput() }, 'Completed'));
  }

  async function submitNote() {
    if (!note.trim()) return;
    await onAddNote(noteType, note.trim());
    setNote('');
  }

  async function submitRevision() {
    if (!revisionNote.trim()) return;
    await onAddRevision(revisionNote.trim(), revisionStatus);
    setRevisionNote('');
    setRevisionStatus('Pending');
  }

  async function handleSaveFiles(e: React.FormEvent) {
    e.preventDefault();
    await onUpdateProject(editFileValues);
    setIsEditingFiles(false);
  }

  async function handleSavePayment(e: React.FormEvent) {
    e.preventDefault();
    const totalPrice = Number(paymentValues.total_price) || 0;
    const advancePaid = Number(paymentValues.advance_paid) || 0;
    await onUpdateProject({
      total_price: totalPrice,
      advance_paid: advancePaid,
      remaining_balance: Math.max(totalPrice - advancePaid, 0),
      payment_status: paymentValues.payment_status as Project['payment_status'],
      payment_date: paymentValues.payment_date || null,
      payment_notes: paymentValues.payment_notes,
    });
    setIsEditingPayment(false);
  }

  // Filtered activity log
  const filteredActivities = useMemo(() => {
    return projectActivities.filter((act) => {
      if (activityFilter === 'all') return true;
      const text = `${act.action} ${act.new_value || ''} ${act.old_value || ''}`.toLowerCase();
      if (activityFilter === 'revisions') return text.includes('revision');
      if (activityFilter === 'status') return text.includes('status') || text.includes('stage');
      if (activityFilter === 'files') return text.includes('file') || text.includes('upload') || text.includes('proof');
      if (activityFilter === 'client') return text.includes('client') || text.includes('approved') || text.includes('requested');
      if (activityFilter === 'team') return !text.includes('client') && !text.includes('system');
      if (activityFilter === 'system') return text.includes('system') || text.includes('timeline') || text.includes('clock');
      return true;
    });
  }, [projectActivities, activityFilter]);

  // Filtered tasks
  const filteredTasks = useMemo(() => {
    return projectTasks.filter((task) => {
      if (taskFilter === 'all') return true;
      if (taskFilter === 'open') return task.status === 'To Do';
      if (taskFilter === 'in_progress') return task.status === 'In Progress';
      if (taskFilter === 'done') return task.status === 'Done';
      return true;
    });
  }, [projectTasks, taskFilter]);

  // Grouped project files
  const fileCategories = useMemo(() => {
    const categories: Array<{
      category: string;
      icon: typeof FileText;
      files: Array<{ name: string; url: string; key: keyof typeof editFileValues }>;
    }> = [];

    // Client Source Files
    const clientFiles: Array<{ name: string; url: string; key: keyof typeof editFileValues }> = [];
    if (project.source_file_link) clientFiles.push({ name: 'Source Manuscript Files', url: project.source_file_link, key: 'source_file_link' });
    if (project.drive_folder_link) clientFiles.push({ name: 'Google Drive Storage Folder', url: project.drive_folder_link, key: 'drive_folder_link' });
    if (project.client_brief_link) clientFiles.push({ name: 'Client Brief & Requirements', url: project.client_brief_link, key: 'client_brief_link' });
    if (clientFiles.length) {
      categories.push({ category: 'Client & Source Files', icon: FolderOpen, files: clientFiles });
    }

    // Production Proofs & Covers
    const prodFiles: Array<{ name: string; url: string; key: keyof typeof editFileValues }> = [];
    if (project.proof_pdf_link) prodFiles.push({ name: 'Interior Proof PDF', url: project.proof_pdf_link, key: 'proof_pdf_link' });
    if (project.cover_file_link) prodFiles.push({ name: 'Cover Design File', url: project.cover_file_link, key: 'cover_file_link' });
    if (project.other_links) prodFiles.push({ name: 'Additional Production Links', url: project.other_links, key: 'other_links' });
    if (prodFiles.length) {
      categories.push({ category: 'Production & Proofs', icon: FileCheck, files: prodFiles });
    }

    // Final Deliverables
    const deliverableFiles: Array<{ name: string; url: string; key: keyof typeof editFileValues }> = [];
    if (project.final_print_pdf_link) deliverableFiles.push({ name: 'Final Print-Ready PDF', url: project.final_print_pdf_link, key: 'final_print_pdf_link' });
    if (project.final_ebook_link) deliverableFiles.push({ name: 'Final eBook (EPUB/MOBI)', url: project.final_ebook_link, key: 'final_ebook_link' });
    if (deliverableFiles.length) {
      categories.push({ category: 'Final Deliverables', icon: FileCode, files: deliverableFiles });
    }

    return categories;
  }, [project]);

  return (
    <Modal title="Project Details" onClose={onClose} width="max-w-6xl">
      <div className="space-y-4">
        {/* ========================================================================= */}
        {/* FIXED PROJECT HEADER (Always visible across all tabs) */}
        {/* ========================================================================= */}
        <div className="rounded-xl border border-border bg-white p-5 shadow-xs">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              {/* Badges row */}
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="rounded-md bg-ivory px-2.5 py-1 text-xs font-bold uppercase tracking-[0.14em] text-gold border border-gold/30">
                  {project.project_number}
                </span>
                <StatusBadge status={project.status} />
                <PriorityBadge priority={project.priority} />
                <TimelineBadge project={project} />
                {project.revision_count ? (
                  <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-bold text-orange-800 flex items-center gap-1">
                    <RotateCcw className="h-3 w-3" />
                    Rev #{project.revision_count}
                  </span>
                ) : null}
              </div>

              {/* Title & Service */}
              <h2 className="font-display text-2xl lg:text-3xl font-bold text-ink leading-tight">
                {project.project_title}
              </h2>
              <p className="mt-1 text-sm font-medium text-muted">
                {project.client_name} {project.client_email ? `• ${project.client_email}` : ''} • {project.service_type}
              </p>
            </div>

            {/* Quick action buttons */}
            <div className="flex flex-wrap gap-2 shrink-0">
              <Button variant="secondary" onClick={() => window.print()} className="text-xs">
                <Printer className="h-4 w-4" />
                Print
              </Button>
              {canManageAll ? (
                <Button variant="secondary" onClick={onEdit} className="text-xs">
                  <Edit className="h-4 w-4" />
                  Edit Project
                </Button>
              ) : null}
              <Button onClick={markDelivered} className="text-xs">
                <CheckCircle2 className="h-4 w-4" />
                Mark Delivered
              </Button>
              {currentProfile.role === 'admin' ? (
                <Button variant="danger" onClick={onDelete} className="text-xs">
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              ) : null}
            </div>
          </div>

          {/* Quick Metrics Strip */}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 rounded-lg border border-border bg-ivory/60 p-3 text-xs">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted block">Current Stage</span>
              <span className="font-semibold text-ink truncate block mt-0.5">{summary.stage}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted block">Waiting On</span>
              <span className={`font-semibold truncate block mt-0.5 ${summary.waitingOn === 'Client' ? 'text-amber-800 font-bold' : 'text-ink'}`}>
                {summary.waitingOn}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted block">Due Date</span>
              <span className="font-semibold text-ink truncate block mt-0.5 flex items-center gap-1">
                <CalendarDays className="h-3 w-3 text-gold" />
                {summary.dueDate ? formatDate(summary.dueDate) : formatDate(project.due_date)}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted block">Assigned Staff</span>
              <span className="font-semibold text-ink truncate block mt-0.5">
                {profileName(profiles, project.assigned_to)}
              </span>
            </div>
          </div>

          {/* Active Revision Alert if in revision */}
          {summary.stageStatus === 'REVISION_ACTIVE' ? (
            <div className="mt-3 flex items-center gap-2 rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-900">
              <AlertTriangle className="h-4 w-4 shrink-0 text-orange-600" />
              <span>
                <strong>Revision Active ({summary.stage}):</strong> Client requested changes. 2 production days allocated.
              </span>
            </div>
          ) : null}
        </div>

        {/* ========================================================================= */}
        {/* INTERNAL TABS NAVIGATION */}
        {/* ========================================================================= */}
        <div className="flex border-b border-border bg-white px-2 overflow-x-auto rounded-t-lg scrollbar-none">
          {([
            { id: 'overview', label: 'Overview', icon: Layers },
            { id: 'timeline', label: 'Timeline', icon: TrendingUp },
            {
              id: 'files',
              label: 'Files & Deliverables',
              icon: FolderOpen,
              count: fileCategories.reduce((acc, c) => acc + c.files.length, 0),
            },
            {
              id: 'revisions',
              label: 'Revisions',
              icon: RotateCcw,
              count: projectRevisionRequests.length + projectRevisions.length,
            },
            {
              id: 'tasks',
              label: 'Tasks',
              icon: ListChecks,
              count: projectTasks.length,
            },
            {
              id: 'communication',
              label: 'Communication',
              icon: MessageSquare,
            },
            {
              id: 'payment',
              label: 'Payment',
              icon: CreditCard,
              hide: !canManageAll && currentProfile.role !== 'admin' && currentProfile.role !== 'manager',
            },
            {
              id: 'activity',
              label: 'Activity',
              icon: History,
              count: projectActivities.length,
            },
          ] as const).map((tab) => {
            if ('hide' in tab && tab.hide) return null;
            const IconComponent = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as ProjectDetailTab)}
                className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-xs md:text-sm font-semibold transition ${
                  isActive
                    ? 'border-gold text-gold font-bold bg-ivory/50 rounded-t'
                    : 'border-transparent text-muted hover:text-ink hover:bg-linen/40'
                }`}
              >
                <IconComponent className="h-4 w-4" />
                {tab.label}
                {'count' in tab && typeof tab.count === 'number' && tab.count > 0 ? (
                  <span
                    className={`flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                      isActive ? 'bg-gold text-ink' : 'bg-border text-charcoal'
                    }`}
                  >
                    {tab.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* ========================================================================= */}
        {/* TAB CONTENTS (Only the active tab renders below) */}
        {/* ========================================================================= */}
        <div className="min-h-[420px]">
          {/* 1. OVERVIEW TAB */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-3">
                {/* Project Specs */}
                <Card className="xl:col-span-2">
                  <h3 className="font-display text-lg font-semibold text-ink flex items-center gap-2 mb-3">
                    <FileText className="h-4 w-4 text-gold" />
                    Project Specifications
                  </h3>
                  <div className="grid gap-2.5 text-xs sm:grid-cols-2 lg:grid-cols-3">
                    <Info label="Service Type" value={project.service_type} />
                    <Info label="Platform" value={project.platform || 'Standard'} />
                    <Info label="Genre" value={project.genre || 'Not set'} />
                    <Info label="Trim Size" value={project.trim_size || 'Not set'} />
                    <Info label="Page Count" value={String(project.page_count || 0)} />
                    <Info label="Word Count" value={project.word_count ? project.word_count.toLocaleString() : '0'} />
                    <Info label="Image Count" value={String(project.image_count || 0)} />
                    <Info label="Target Due Date" value={formatDate(project.due_date)} />
                    <Info label="Internal Deadline" value={formatDate(project.internal_deadline)} />
                    <Info label="Created Date" value={formatDate(project.created_at)} />
                    <Info label="Last Updated" value={formatDate(project.updated_at)} />
                    <Info label="Delivery Date" value={formatDate(project.delivery_date || project.final_delivery_date)} />
                  </div>
                </Card>

                {/* Assigned Team & Stage Controls */}
                <div className="space-y-4">
                  <Card>
                    <h3 className="font-display text-lg font-semibold text-ink flex items-center gap-2 mb-3">
                      <Users className="h-4 w-4 text-gold" />
                      Assigned Team
                    </h3>
                    <div className="space-y-2.5 text-xs">
                      {/* Employee */}
                      <div className="flex items-center gap-3 rounded-lg border border-border bg-ivory/50 p-2.5">
                        <div className="grid h-9 w-9 place-items-center rounded-full bg-gold/20 font-bold text-ink text-xs">
                          {initials(profileName(profiles, project.assigned_to))}
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="text-[10px] uppercase font-bold text-muted block">Assigned Employee</span>
                          <p className="font-semibold text-ink truncate">{fullProfileName(profiles, project.assigned_to)}</p>
                        </div>
                      </div>

                      {/* Project Manager */}
                      <div className="flex items-center gap-3 rounded-lg border border-border bg-ivory/50 p-2.5">
                        <div className="grid h-9 w-9 place-items-center rounded-full bg-blue-100 font-bold text-blue-900 text-xs">
                          {initials(profileName(profiles, project.project_manager))}
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="text-[10px] uppercase font-bold text-muted block">Project Manager</span>
                          <p className="font-semibold text-ink truncate">{fullProfileName(profiles, project.project_manager)}</p>
                        </div>
                      </div>
                    </div>
                  </Card>

                  {/* Stage Transition Quick Select */}
                  <Card>
                    <h3 className="font-display text-sm font-semibold text-ink mb-2">Change Stage</h3>
                    <div className="flex items-center gap-2">
                      <SelectField
                        value={stage}
                        onChange={(e) => setStage(e.target.value as TimelineStage)}
                        className="flex-1 text-xs"
                      >
                        {timelineStages.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </SelectField>
                      <Button onClick={saveStage} className="min-h-9 text-xs px-3">
                        Save
                      </Button>
                    </div>
                  </Card>
                </div>
              </div>

              {/* Compact Payment Summary if accessible */}
              {canManageAll ? (
                <Card>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border pb-3">
                    <h3 className="font-display text-lg font-semibold text-ink flex items-center gap-2">
                      <CreditCard className="h-4 w-4 text-gold" />
                      Financial Summary
                    </h3>
                    <button
                      type="button"
                      onClick={() => setActiveTab('payment')}
                      className="text-xs font-semibold text-gold hover:underline"
                    >
                      View Full Payment Tab →
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
                    <div className="rounded-lg bg-ivory p-2.5">
                      <span className="text-muted block">Total Price</span>
                      <p className="text-sm font-bold text-ink mt-0.5">{currency(project.total_price)}</p>
                    </div>
                    <div className="rounded-lg bg-ivory p-2.5">
                      <span className="text-muted block">Advance Paid</span>
                      <p className="text-sm font-bold text-success mt-0.5">{currency(project.advance_paid)}</p>
                    </div>
                    <div className="rounded-lg bg-ivory p-2.5">
                      <span className="text-muted block">Remaining</span>
                      <p className="text-sm font-bold text-amber-900 mt-0.5">{currency(project.remaining_balance)}</p>
                    </div>
                    <div className="rounded-lg bg-ivory p-2.5">
                      <span className="text-muted block">Payment Status</span>
                      <div className="mt-1">
                        <PaymentBadge status={project.payment_status} />
                      </div>
                    </div>
                  </div>
                </Card>
              ) : null}

              {/* Notes & Instructions Summary */}
              <Card>
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <h3 className="font-display text-lg font-semibold text-ink flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-gold" />
                    Instructions & Project Notes
                  </h3>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <NoteBlock title="Client Instructions" value={project.client_instructions} />
                  <NoteBlock title="General Notes" value={project.general_notes} />
                  <NoteBlock title="Internal Team Notes" value={project.internal_notes} />
                  <NoteBlock title="QA Notes" value={project.qa_notes} />
                </div>

                {/* Quick Add Note Form */}
                <div className="mt-4 rounded-lg border border-border bg-ivory p-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted block mb-2">Add New Note</span>
                  <div className="grid gap-2 sm:grid-cols-[180px_1fr_auto] sm:items-end">
                    <SelectField
                      label="Note Type"
                      value={noteType}
                      onChange={(e) => setNoteType(e.target.value as NoteType)}
                      className="text-xs"
                    >
                      {noteTypes.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </SelectField>
                    <Field
                      label="Note Content"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Write note..."
                      className="text-xs"
                    />
                    <Button type="button" onClick={submitNote} className="min-h-9 text-xs px-3">
                      <Plus className="h-4 w-4" />
                      Add Note
                    </Button>
                  </div>
                </div>

                {/* Notes History */}
                {projectNotes.length ? (
                  <div className="mt-3 space-y-2 max-h-44 overflow-y-auto">
                    {projectNotes.map((item) => (
                      <div key={item.id} className="rounded-md border border-border bg-white p-2.5 text-xs">
                        <div className="flex items-center justify-between text-muted mb-1">
                          <span className="font-bold text-ink capitalize">{item.note_type.replace('_', ' ')}</span>
                          <span>{profileName(profiles, item.added_by)} • {formatDate(item.created_at)}</span>
                        </div>
                        <p className="text-charcoal leading-relaxed">{item.note}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </Card>
            </div>
          )}

          {/* 2. TIMELINE TAB */}
          {activeTab === 'timeline' && (
            <div className="space-y-4">
              <ProjectTimelinePanel project={project} />

              <Card>
                <h3 className="font-display text-lg font-semibold text-ink mb-3">Timeline Controls</h3>
                <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                  <SelectField
                    label="Manually Override Timeline Stage"
                    value={stage}
                    onChange={(e) => setStage(e.target.value as TimelineStage)}
                    className="sm:w-80 text-sm"
                  >
                    {timelineStages.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </SelectField>
                  <Button onClick={saveStage}>Save Stage</Button>
                  <Button variant="secondary" onClick={markDelivered}>
                    <CheckCircle2 className="h-4 w-4" />
                    Complete Project
                  </Button>
                </div>
              </Card>
            </div>
          )}

          {/* 3. FILES & DELIVERABLES TAB */}
          {activeTab === 'files' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-display text-xl font-semibold text-ink">Project Files & Deliverables</h3>
                  <p className="text-xs text-muted mt-0.5">All shared client files, interior proofs, cover drafts, and final deliverables.</p>
                </div>
                {canManageAll ? (
                  <Button variant="secondary" onClick={() => setIsEditingFiles(true)} className="text-xs">
                    <Edit className="h-3.5 w-3.5" />
                    Edit File Links
                  </Button>
                ) : null}
              </div>

              {fileCategories.length ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {fileCategories.map((group) => {
                    const IconComp = group.icon;

                    return (
                      <Card key={group.category} className="flex flex-col justify-between">
                        <div>
                          <h4 className="font-display font-semibold text-ink flex items-center gap-2 border-b border-border pb-2.5 mb-3 text-sm">
                            <IconComp className="h-4 w-4 text-gold" />
                            {group.category}
                          </h4>
                          <div className="space-y-2">
                            {group.files.map((file) => (
                              <div
                                key={file.name}
                                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-ivory/60 p-2.5 text-xs hover:border-gold hover:bg-white transition"
                              >
                                <div className="min-w-0">
                                  <p className="font-semibold text-ink truncate">{file.name}</p>
                                  <p className="text-[10px] text-muted truncate mt-0.5">{file.url}</p>
                                </div>
                                <a
                                  href={file.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="shrink-0 rounded-md bg-gold/15 p-1.5 text-ink hover:bg-gold hover:text-white transition"
                                  title="Open file link"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              </div>
                            ))}
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <Card>
                  <div className="p-8 text-center text-muted">
                    <FolderOpen className="mx-auto h-8 w-8 text-border mb-2" />
                    <p className="font-semibold">No files attached yet</p>
                    <p className="text-xs mt-1">Add Google Drive, proof PDFs, or deliverable links to this project.</p>
                    {canManageAll ? (
                      <Button variant="secondary" onClick={() => setIsEditingFiles(true)} className="mt-3 text-xs">
                        <Plus className="h-3.5 w-3.5" />
                        Add File Links
                      </Button>
                    ) : null}
                  </div>
                </Card>
              )}

              {/* Edit File Links Modal */}
              {isEditingFiles && (
                <div className="rounded-xl border border-border bg-linen/50 p-4 space-y-3">
                  <h4 className="font-display font-semibold text-sm">Update Project File URLs</h4>
                  <form onSubmit={handleSaveFiles} className="grid gap-3 sm:grid-cols-2 text-xs">
                    <Field
                      label="Source File URL"
                      value={editFileValues.source_file_link}
                      onChange={(e) => setEditFileValues({ ...editFileValues, source_file_link: e.target.value })}
                    />
                    <Field
                      label="Drive Folder Link"
                      value={editFileValues.drive_folder_link}
                      onChange={(e) => setEditFileValues({ ...editFileValues, drive_folder_link: e.target.value })}
                    />
                    <Field
                      label="Client Brief Link"
                      value={editFileValues.client_brief_link}
                      onChange={(e) => setEditFileValues({ ...editFileValues, client_brief_link: e.target.value })}
                    />
                    <Field
                      label="Interior Proof PDF URL"
                      value={editFileValues.proof_pdf_link}
                      onChange={(e) => setEditFileValues({ ...editFileValues, proof_pdf_link: e.target.value })}
                    />
                    <Field
                      label="Final Print-Ready PDF URL"
                      value={editFileValues.final_print_pdf_link}
                      onChange={(e) => setEditFileValues({ ...editFileValues, final_print_pdf_link: e.target.value })}
                    />
                    <Field
                      label="Final eBook (EPUB) URL"
                      value={editFileValues.final_ebook_link}
                      onChange={(e) => setEditFileValues({ ...editFileValues, final_ebook_link: e.target.value })}
                    />
                    <Field
                      label="Cover Design URL"
                      value={editFileValues.cover_file_link}
                      onChange={(e) => setEditFileValues({ ...editFileValues, cover_file_link: e.target.value })}
                    />
                    <Field
                      label="Other Project Links"
                      value={editFileValues.other_links}
                      onChange={(e) => setEditFileValues({ ...editFileValues, other_links: e.target.value })}
                    />
                    <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
                      <Button type="button" variant="secondary" onClick={() => setIsEditingFiles(false)} className="text-xs">
                        Cancel
                      </Button>
                      <Button type="submit" className="text-xs">
                        Save Links
                      </Button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* 4. REVISIONS TAB */}
          {activeTab === 'revisions' && (
            <div className="space-y-5">
              {/* Client Revision Requests for this project */}
              <div>
                <div className="mb-3">
                  <h3 className="font-display text-xl font-semibold text-ink">Client Revision Requests</h3>
                  <p className="text-xs text-muted">
                    Complete records of client-submitted revisions for this project with item checklists, files, and team replies.
                  </p>
                </div>

                <RevisionRequestsPage
                  revisionRequests={projectRevisionRequests}
                  revisionItems={revisionItems}
                  revisionAttachments={revisionAttachments}
                  revisionActivity={revisionActivity}
                  projects={[project]}
                  profiles={profiles}
                  currentProfile={currentProfile}
                  canManageAll={canManageAll}
                  onUpdateRequest={onUpdateRevisionRequest}
                  onUpdateItem={onUpdateRevisionItem}
                  onUploadRevisedProof={onUploadRevisedProof}
                />
              </div>

              {/* Internal Revision Notes */}
              <Card>
                <h3 className="font-display text-lg font-semibold text-ink mb-3">Internal Revision Notes (Team Only)</h3>
                <div className="grid gap-3">
                  <TextareaField
                    label="New Internal Revision Note"
                    value={revisionNote}
                    onChange={(event) => setRevisionNote(event.target.value)}
                    placeholder="Enter internal production notes about this revision round..."
                  />
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <SelectField
                      label="Revision Status"
                      value={revisionStatus}
                      onChange={(event) => setRevisionStatus(event.target.value as RevisionStatus)}
                      className="sm:w-56 text-xs"
                    >
                      {revisionStatuses.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </SelectField>
                    <Button type="button" onClick={submitRevision} className="text-xs">
                      <Plus className="h-4 w-4" />
                      Add Internal Revision Note
                    </Button>
                  </div>
                </div>

                {projectRevisions.length ? (
                  <div className="mt-4 space-y-2.5">
                    {projectRevisions.map((rev) => (
                      <div key={rev.id} className="rounded-lg border border-border bg-white p-3 text-xs">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-bold text-ink">Revision Round #{rev.revision_number}</span>
                          <span className="rounded-full bg-ivory px-2 py-0.5 text-[11px] font-semibold text-muted border border-border">
                            {rev.status}
                          </span>
                        </div>
                        <p className="text-charcoal leading-relaxed">{rev.note}</p>
                        <p className="mt-2 text-[10px] text-muted">
                          Added by {profileName(profiles, rev.added_by)} • {formatDate(rev.created_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </Card>
            </div>
          )}

          {/* 5. TASKS TAB */}
          {activeTab === 'tasks' && (
            <div className="space-y-4">
              <Card>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-3">
                  <div>
                    <h3 className="font-display text-xl font-semibold text-ink">Project Tasks</h3>
                    <p className="text-xs text-muted mt-0.5">
                      {projectTasks.filter((t) => t.status === 'Done').length} of {projectTasks.length} tasks completed
                    </p>
                  </div>
                  {/* Task Filter */}
                  <div className="flex items-center gap-1 rounded-lg bg-linen p-1 text-xs">
                    {(['all', 'open', 'in_progress', 'done'] as const).map((filter) => (
                      <button
                        key={filter}
                        type="button"
                        onClick={() => setTaskFilter(filter)}
                        className={`rounded px-2.5 py-1 capitalize transition ${
                          taskFilter === filter ? 'bg-gold text-ink font-bold shadow-xs' : 'text-muted hover:text-ink'
                        }`}
                      >
                        {filter.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                </div>

                {projectTasks.length ? (
                  <div className="mt-3 space-y-2">
                    {/* Progress Bar */}
                    <div className="h-2 w-full overflow-hidden rounded-full bg-ivory mb-4">
                      <div
                        className="h-full bg-gold transition-all duration-300"
                        style={{
                          width: `${(projectTasks.filter((t) => t.status === 'Done').length / projectTasks.length) * 100}%`,
                        }}
                      />
                    </div>

                    {filteredTasks.length ? (
                      filteredTasks.map((task) => (
                        <div
                          key={task.id}
                          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-white p-3 text-xs shadow-xs hover:border-gold transition"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-ink">{task.title}</p>
                            {task.description ? <p className="text-muted mt-0.5 line-clamp-1">{task.description}</p> : null}
                            <p className="text-[10px] text-muted mt-1">
                              Assigned to <span className="font-medium text-charcoal">{profileName(profiles, task.assigned_to)}</span> • Due {formatDate(task.due_date)}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                              task.status === 'Done'
                                ? 'bg-emerald-100 text-emerald-800'
                                : task.status === 'In Progress'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {task.status}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-center py-6 text-xs text-muted">No tasks matching the selected filter.</p>
                    )}
                  </div>
                ) : (
                  <div className="p-8 text-center text-muted">
                    <ListChecks className="mx-auto h-8 w-8 text-border mb-2" />
                    <p className="font-semibold">No tasks assigned to this project yet</p>
                    <p className="text-xs mt-1">Assign tasks to team members from the Tasks page.</p>
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* 6. COMMUNICATION TAB */}
          {activeTab === 'communication' && (
            <div className="space-y-4">
              <Card>
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <h3 className="font-display text-xl font-semibold flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-gold" />
                    Project Discussion
                  </h3>
                  <div className="flex rounded-lg bg-linen p-1 text-xs font-semibold">
                    <button
                      onClick={() => setCommSubTab('internal')}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition ${
                        commSubTab === 'internal' ? 'bg-gold text-ink font-bold shadow-xs' : 'text-muted hover:text-ink'
                      }`}
                    >
                      <Lock className="h-3.5 w-3.5" />
                      Internal Discussion 🔒
                    </button>
                    <button
                      onClick={() => setCommSubTab('client')}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition ${
                        commSubTab === 'client' ? 'bg-gold text-ink font-bold shadow-xs' : 'text-muted hover:text-ink'
                      }`}
                    >
                      <User className="h-3.5 w-3.5" />
                      Client Discussion 👤
                    </button>
                  </div>
                </div>

                <div className="mt-3 rounded-lg border border-border bg-linen/30 p-3">
                  {onSendMessage && onGetOrCreateProjectConversation ? (
                    <ProjectDiscussionChat
                      projectId={project.id}
                      projectName={project.project_title}
                      clientName={project.client_name}
                      isInternal={commSubTab === 'internal'}
                      currentProfile={currentProfile}
                      profiles={profiles}
                      conversations={conversations}
                      messages={messages}
                      onSendMessage={onSendMessage}
                      onGetOrCreateProjectConversation={onGetOrCreateProjectConversation}
                    />
                  ) : (
                    <p className="text-xs text-muted">Messaging service is currently connecting...</p>
                  )}
                </div>
              </Card>
            </div>
          )}

          {/* 7. PAYMENT TAB */}
          {activeTab === 'payment' && (
            <div className="space-y-4">
              <Card>
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div>
                    <h3 className="font-display text-xl font-semibold text-ink">Project Payment & Financials</h3>
                    <p className="text-xs text-muted">Complete billing status, advance payments, and notes for this project.</p>
                  </div>
                  {canManageAll ? (
                    <Button variant="secondary" onClick={() => setIsEditingPayment(!isEditingPayment)} className="text-xs">
                      <Edit className="h-3.5 w-3.5" />
                      {isEditingPayment ? 'Cancel' : 'Edit Payment'}
                    </Button>
                  ) : null}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                  <div className="rounded-lg border border-border bg-ivory p-3">
                    <span className="text-muted block font-medium">Total Contract Price</span>
                    <p className="text-xl font-bold text-ink mt-1">{currency(project.total_price)}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-green-50/50 p-3">
                    <span className="text-green-800 block font-medium">Advance Paid</span>
                    <p className="text-xl font-bold text-success mt-1">{currency(project.advance_paid)}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-amber-50/50 p-3">
                    <span className="text-amber-800 block font-medium">Remaining Balance</span>
                    <p className="text-xl font-bold text-amber-900 mt-1">{currency(project.remaining_balance)}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-ivory p-3">
                    <span className="text-muted block font-medium">Payment Status</span>
                    <div className="mt-1.5">
                      <PaymentBadge status={project.payment_status} />
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 text-xs">
                  <div className="rounded-lg border border-border bg-white p-3">
                    <span className="text-muted font-medium block">Payment Date</span>
                    <p className="text-sm font-semibold text-ink mt-0.5">{formatDate(project.payment_date)}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-white p-3">
                    <span className="text-muted font-medium block">Payment Notes</span>
                    <p className="text-sm font-semibold text-ink mt-0.5">{project.payment_notes || 'No payment notes recorded.'}</p>
                  </div>
                </div>

                {/* Edit Payment Form */}
                {isEditingPayment && (
                  <form onSubmit={handleSavePayment} className="mt-4 rounded-xl border border-border bg-linen/50 p-4 space-y-3">
                    <h4 className="font-semibold text-xs text-ink">Update Payment Record</h4>
                    <div className="grid gap-3 sm:grid-cols-2 text-xs">
                      <Field
                        label="Total Contract Price ($)"
                        type="number"
                        value={paymentValues.total_price}
                        onChange={(e) => setPaymentValues({ ...paymentValues, total_price: e.target.value })}
                      />
                      <Field
                        label="Advance Paid ($)"
                        type="number"
                        value={paymentValues.advance_paid}
                        onChange={(e) => setPaymentValues({ ...paymentValues, advance_paid: e.target.value })}
                      />
                      <SelectField
                        label="Payment Status"
                        value={paymentValues.payment_status}
                        onChange={(e) => setPaymentValues({ ...paymentValues, payment_status: e.target.value as Project['payment_status'] })}
                      >
                        <option value="Not Started">Not Started</option>
                        <option value="Advance Paid">Advance Paid</option>
                        <option value="Partially Paid">Partially Paid</option>
                        <option value="Fully Paid">Fully Paid</option>
                        <option value="Pending">Pending</option>
                        <option value="Refunded">Refunded</option>
                      </SelectField>
                      <Field
                        label="Payment Date"
                        type="date"
                        value={paymentValues.payment_date}
                        onChange={(e) => setPaymentValues({ ...paymentValues, payment_date: e.target.value })}
                      />
                      <div className="sm:col-span-2">
                        <Field
                          label="Payment Notes"
                          value={paymentValues.payment_notes}
                          onChange={(e) => setPaymentValues({ ...paymentValues, payment_notes: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button type="button" variant="secondary" onClick={() => setIsEditingPayment(false)} className="text-xs">
                        Cancel
                      </Button>
                      <Button type="submit" className="text-xs">
                        Save Payment
                      </Button>
                    </div>
                  </form>
                )}
              </Card>
            </div>
          )}

          {/* 8. ACTIVITY TAB */}
          {activeTab === 'activity' && (
            <div className="space-y-4">
              <Card>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-3">
                  <div>
                    <h3 className="font-display text-xl font-semibold text-ink">Project Activity History</h3>
                    <p className="text-xs text-muted">Complete audit log of all events, client interactions, stage transitions, and file uploads.</p>
                  </div>
                  {/* Activity Filters */}
                  <div className="flex flex-wrap items-center gap-1 rounded-lg bg-linen p-1 text-xs">
                    {(['all', 'client', 'team', 'files', 'status', 'revisions'] as const).map((filter) => (
                      <button
                        key={filter}
                        type="button"
                        onClick={() => setActivityFilter(filter)}
                        className={`rounded px-2.5 py-1 capitalize transition ${
                          activityFilter === filter ? 'bg-gold text-ink font-bold shadow-xs' : 'text-muted hover:text-ink'
                        }`}
                      >
                        {filter}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-4 space-y-2.5">
                  {filteredActivities.length ? (
                    filteredActivities.map((act) => (
                      <div
                        key={act.id}
                        className="flex items-start gap-3 rounded-lg border border-border bg-white p-3 text-xs shadow-xs"
                      >
                        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gold/20 text-gold">
                          <History className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold text-ink">{act.action}</p>
                            <span className="text-[10px] text-muted shrink-0">{formatDate(act.created_at)}</span>
                          </div>
                          {act.new_value ? (
                            <p className="text-muted mt-0.5">
                              {act.old_value ? `${act.old_value} → ` : ''}
                              <span className="text-charcoal font-medium">{act.new_value}</span>
                            </p>
                          ) : null}
                          <p className="text-[10px] text-gold font-medium mt-1">
                            By: {profileName(profiles, act.user_id)}
                          </p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-8 text-center text-muted">
                      <History className="mx-auto h-8 w-8 text-border mb-2" />
                      <p className="font-semibold">No activity matching the filter</p>
                      <p className="text-xs mt-1">Project activity will appear as changes occur.</p>
                    </div>
                  )}
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-ivory px-3 py-2">
      <span className="text-muted">{label}</span>
      <span className="text-right font-semibold text-ink truncate max-w-[55%]">{value}</span>
    </div>
  );
}

function NoteBlock({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-white p-3 text-xs">
      <p className="font-bold text-ink">{title}</p>
      <p className="mt-1.5 min-h-10 leading-relaxed text-charcoal">{value || 'No notes added.'}</p>
    </div>
  );
}
