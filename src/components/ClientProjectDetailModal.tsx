import {
  AlertCircle,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  FileCheck,
  FileCode,
  FileText,
  FolderOpen,
  History,
  Layers,
  MessageSquare,
  Paperclip,
  Plus,
  Send,
  ShieldCheck,
  User,
  Users,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { PriorityBadge, StatusBadge } from './Badges';
import { Button, Modal } from './ui';
import { formatDate } from '../lib/date';
import {
  getTimelineMilestones,
  getTimelineSummary,
  type ApprovalMilestone,
} from '../lib/timeline';
import type {
  ActivityLog,
  Profile,
  Project,
  ProjectNote,
  RevisionAttachment,
  RevisionItem,
  RevisionNote,
  RevisionRequest,
} from '../lib/types';
import { cn, firstName } from '../lib/utils';

function approvalMilestoneForStage(stage: string): ApprovalMilestone | null {
  if (stage === 'Awaiting Concept Approval') return 'concept';
  if (stage === 'Awaiting Print Approval') return 'print';
  if (stage === 'eBook Review') return 'ebook';
  return null;
}

function approvalLabel(milestone: ApprovalMilestone) {
  if (milestone === 'concept') return 'Approve Design Concept';
  if (milestone === 'print') return 'Approve Print Version';
  return 'Approve eBook Version';
}

function revisionLabel(milestone: ApprovalMilestone | null) {
  if (milestone === 'concept') return 'Request Concept Revisions';
  if (milestone === 'print') return 'Request Print Revisions';
  return 'Request Revision';
}

export function ClientProjectDetailModal({
  project,
  profiles,
  notes,
  revisions,
  revisionRequests,
  revisionItems,
  revisionAttachments,
  activities,
  onClose,
  onApproveMilestone,
  onRequestRevision,
}: {
  project: Project;
  profiles: Profile[];
  notes: ProjectNote[];
  revisions: RevisionNote[];
  revisionRequests: RevisionRequest[];
  revisionItems: RevisionItem[];
  revisionAttachments: RevisionAttachment[];
  activities: ActivityLog[];
  onClose: () => void;
  onApproveMilestone: (projectId: string, milestone: ApprovalMilestone) => Promise<void>;
  onRequestRevision: (projectId: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'files' | 'messages' | 'activity'>('overview');
  const [isApproving, setIsApproving] = useState(false);
  const [clientMsg, setClientMsg] = useState('');

  const summary = useMemo(() => getTimelineSummary(project), [project]);
  const milestones = useMemo(() => getTimelineMilestones(project), [project]);
  const milestoneToApprove = useMemo(() => approvalMilestoneForStage(summary.stage), [summary.stage]);

  const assignedEmployee = useMemo(
    () => profiles.find((p) => p.id === project.assigned_to),
    [profiles, project.assigned_to],
  );

  const projectManager = useMemo(
    () => profiles.find((p) => p.id === project.project_manager),
    [profiles, project.project_manager],
  );

  // Grouped project files by category
  const fileCategories = useMemo(() => {
    const categories: Array<{
      category: string;
      icon: typeof FileText;
      files: Array<{ name: string; url: string; date?: string; source: string }>;
    }> = [];

    // Manuscript & Source Files
    const manuscriptFiles: Array<{ name: string; url: string; source: string }> = [];
    if (project.source_file_link) manuscriptFiles.push({ name: 'Source Files', url: project.source_file_link, source: 'Uploaded Source' });
    if (project.drive_folder_link) manuscriptFiles.push({ name: 'Google Drive Folder', url: project.drive_folder_link, source: 'Shared Storage' });
    if (manuscriptFiles.length) {
      categories.push({ category: 'Manuscript & Source Files', icon: FolderOpen, files: manuscriptFiles });
    }

    // Cover Files
    const coverFiles: Array<{ name: string; url: string; source: string }> = [];
    if (project.cover_file_link) coverFiles.push({ name: 'Cover Design File', url: project.cover_file_link, source: 'Design Upload' });
    if (coverFiles.length) {
      categories.push({ category: 'Cover Files', icon: FileCheck, files: coverFiles });
    }

    // Print PDF
    const printFiles: Array<{ name: string; url: string; source: string }> = [];
    if (project.proof_pdf_link) printFiles.push({ name: 'Proof PDF', url: project.proof_pdf_link, source: 'Proof Draft' });
    if (project.final_print_pdf_link) printFiles.push({ name: 'Final Print PDF', url: project.final_print_pdf_link, source: 'Final Delivery' });
    if (printFiles.length) {
      categories.push({ category: 'Print PDF', icon: FileText, files: printFiles });
    }

    // EPUB / eBook
    const ebookFiles: Array<{ name: string; url: string; source: string }> = [];
    if (project.final_ebook_link) ebookFiles.push({ name: 'Final EPUB / eBook File', url: project.final_ebook_link, source: 'eBook Delivery' });
    if (ebookFiles.length) {
      categories.push({ category: 'EPUB & Digital Files', icon: FileCode, files: ebookFiles });
    }

    // InDesign / Client Brief / Other Attachments
    const otherFiles: Array<{ name: string; url: string; date?: string; source: string }> = [];
    if (project.client_brief_link) otherFiles.push({ name: 'Client Brief', url: project.client_brief_link, source: 'Project Requirements' });
    if (project.other_links) otherFiles.push({ name: 'Additional Project Links', url: project.other_links, source: 'Shared Links' });

    // Include revision attachments for this project
    const projectReqIds = new Set(revisionRequests.filter((r) => r.project_id === project.id).map((r) => r.id));
    revisionAttachments
      .filter((att) => projectReqIds.has(att.revision_request_id))
      .forEach((att) => {
        otherFiles.push({
          name: att.file_name,
          url: att.file_url,
          date: att.created_at,
          source: att.file_type === 'revised_proof' ? 'Revised Proof Attachment' : 'Revision File',
        });
      });

    if (otherFiles.length) {
      categories.push({ category: 'Briefs & Other Attachments', icon: Paperclip, files: otherFiles });
    }

    return categories;
  }, [project, revisionAttachments, revisionRequests]);

  // Filter notes that are client-visible (exclude internal notes)
  const clientVisibleNotes = useMemo(() => {
    const projectSpecificNotes = notes
      .filter((n) => n.project_id === project.id && n.note_type !== 'internal')
      .map((n) => ({
        id: n.id,
        text: n.note,
        type: n.note_type === 'client_instruction' ? 'Client Instruction' : n.note_type === 'qa' ? 'QA Note' : n.note_type === 'delivery' ? 'Delivery Note' : 'Project Note',
        addedBy: profiles.find((p) => p.id === n.added_by)?.full_name || 'Team Member',
        createdAt: n.created_at,
      }));

    return projectSpecificNotes;
  }, [notes, profiles, project.id]);

  // Project activities for activity log tab
  const projectActivities = useMemo(() => {
    return activities
      .filter((act) => act.project_id === project.id)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [activities, project.id]);

  async function handleApprove() {
    if (!milestoneToApprove) return;
    const label = milestoneToApprove === 'concept' ? 'design concept' : milestoneToApprove === 'print' ? 'print version' : 'eBook version';
    const confirmed = window.confirm(`Are you sure you want to approve the ${label} for "${project.project_title}"?`);
    if (!confirmed) return;

    try {
      setIsApproving(true);
      await onApproveMilestone(project.id, milestoneToApprove);
    } finally {
      setIsApproving(false);
    }
  }

  return (
    <Modal title={project.project_title} onClose={onClose} width="max-w-4xl">
      {/* Header Banner */}
      <div className="bg-linen p-6 border-b border-border">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="rounded-md bg-ivory px-2.5 py-1 text-xs font-bold uppercase tracking-[0.14em] text-gold border border-gold/30">
                {project.project_number}
              </span>
              <StatusBadge status={project.status} />
              <PriorityBadge priority={project.priority} />
            </div>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-ink leading-tight">
              {project.project_title}
            </h2>
            <p className="mt-1 text-sm font-medium text-muted">{project.service_type} {project.genre ? `• ${project.genre}` : ''}</p>
          </div>

          <div className="flex flex-wrap gap-2 shrink-0">
            {milestoneToApprove ? (
              <Button type="button" onClick={handleApprove} disabled={isApproving} className="bg-success hover:bg-green-700 text-white">
                <CheckCircle2 className="h-4 w-4" />
                {isApproving ? 'Approving...' : approvalLabel(milestoneToApprove)}
              </Button>
            ) : null}
            <Button
              type="button"
              variant={milestoneToApprove ? 'secondary' : 'primary'}
              onClick={() => onRequestRevision(project.id)}
            >
              <Plus className="h-4 w-4" />
              {revisionLabel(milestoneToApprove)}
            </Button>
          </div>
        </div>

        {/* Action Required Alert Banner */}
        {summary.clientActionRequired ? (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-700" />
            <span>Action Required: {summary.clientActionRequired}</span>
          </div>
        ) : null}

        {/* Quick Info Grid */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-white p-3">
            <span className="text-xs font-medium text-muted">Date Created</span>
            <p className="mt-1 text-sm font-semibold text-ink">{formatDate(project.created_at)}</p>
          </div>
          <div className="rounded-lg border border-border bg-white p-3">
            <span className="text-xs font-medium text-muted">Due Date</span>
            <p className="mt-1 text-sm font-semibold text-ink">{summary.dueDate ? formatDate(summary.dueDate) : formatDate(project.due_date)}</p>
          </div>
          <div className="rounded-lg border border-border bg-white p-3">
            <span className="text-xs font-medium text-muted">Progress</span>
            <p className="mt-1 text-sm font-semibold text-info">{summary.progress}% Complete</p>
          </div>
          <div className="rounded-lg border border-border bg-white p-3">
            <span className="text-xs font-medium text-muted">Waiting On</span>
            <p className={cn("mt-1 text-sm font-semibold", summary.waitingOn === 'Client' ? 'text-amber-800' : 'text-ink')}>
              {summary.waitingOn}
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-4 space-y-1.5">
          <div className="flex justify-between text-xs font-semibold">
            <span className="text-muted">Workflow Progress</span>
            <span className="text-gold">{summary.progress}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-border">
            <div className="h-full bg-gold transition-all duration-500" style={{ width: `${summary.progress}%` }} />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border bg-white px-6">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={cn(
            'flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition',
            activeTab === 'overview' ? 'border-gold text-gold' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          <Layers className="h-4 w-4" />
          Timeline & Info
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('files')}
          className={cn(
            'flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition',
            activeTab === 'files' ? 'border-gold text-gold' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          <FolderOpen className="h-4 w-4" />
          Files & Deliverables
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('messages')}
          className={cn(
            'flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition',
            activeTab === 'messages' ? 'border-gold text-gold' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          <MessageSquare className="h-4 w-4" />
          Notes & Messages
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('activity')}
          className={cn(
            'flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition',
            activeTab === 'activity' ? 'border-gold text-gold' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          <History className="h-4 w-4" />
          Activity Log
        </button>
      </div>

      {/* Tab Content */}
      <div className="max-h-[60vh] overflow-y-auto p-6 space-y-6">
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Project Details Grid */}
            <div className="grid gap-4 rounded-lg border border-border bg-ivory/50 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <span className="text-xs text-muted font-medium">Client Name</span>
                <p className="text-sm font-semibold text-ink">{project.client_name || 'N/A'}</p>
              </div>
              <div>
                <span className="text-xs text-muted font-medium">Service Type</span>
                <p className="text-sm font-semibold text-ink">{project.service_type}</p>
              </div>
              <div>
                <span className="text-xs text-muted font-medium">Platform</span>
                <p className="text-sm font-semibold text-ink">{project.platform || 'N/A'}</p>
              </div>
              <div>
                <span className="text-xs text-muted font-medium">Page / Word Count</span>
                <p className="text-sm font-semibold text-ink">
                  {project.page_count ? `${project.page_count} pages` : ''} {project.word_count ? `(${project.word_count.toLocaleString()} words)` : 'N/A'}
                </p>
              </div>
              <div>
                <span className="text-xs text-muted font-medium">Assigned Team</span>
                <p className="text-sm font-semibold text-ink">
                  {assignedEmployee ? firstName(assignedEmployee.full_name) : 'Unassigned'}
                  {projectManager ? ` (Manager: ${firstName(projectManager.full_name)})` : ''}
                </p>
              </div>
              <div>
                <span className="text-xs text-muted font-medium">Last Updated</span>
                <p className="text-sm font-semibold text-ink">{formatDate(project.updated_at || project.created_at)}</p>
              </div>
            </div>

            {/* Workflow Progress Timeline */}
            <div className="rounded-lg border border-border bg-white p-4">
              <h3 className="mb-4 font-display text-lg font-semibold text-ink flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-gold" />
                Workflow Milestones & Timeline
              </h3>

              <div className="space-y-3">
                {milestones.map((m, index) => (
                  <div
                    key={m.key}
                    className={cn(
                      'flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border p-3 text-sm transition',
                      m.state === 'completed' && 'border-green-200 bg-green-50/50 text-green-900',
                      m.state === 'current' && 'border-blue-300 bg-blue-50 ring-1 ring-blue-300 text-blue-900 font-semibold',
                      m.state === 'paused' && 'border-amber-200 bg-amber-50 text-amber-900',
                      m.state === 'overdue' && 'border-red-200 bg-red-50 text-red-900',
                      m.state === 'future' && 'border-border bg-ivory/30 text-muted',
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white font-bold text-xs shadow-xs border border-border">
                        {index + 1}
                      </span>
                      <div>
                        <p className="font-semibold text-ink">{m.label}</p>
                        <p className="text-xs text-muted">
                          {m.state === 'completed' ? 'Completed milestone' : m.state === 'current' ? 'Currently active stage' : 'Upcoming stage'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-xs">
                      {m.date ? (
                        <span className="font-medium text-ink bg-white px-2.5 py-1 rounded border border-border">
                          {formatDate(m.date)}
                        </span>
                      ) : (
                        <span className="text-muted italic">Pending</span>
                      )}
                      <span className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider',
                        m.state === 'completed' && 'bg-green-200 text-green-800',
                        m.state === 'current' && 'bg-blue-200 text-blue-800',
                        m.state === 'future' && 'bg-gray-100 text-gray-600',
                      )}>
                        {m.state}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'files' && (
          <div className="space-y-4">
            {fileCategories.length ? (
              fileCategories.map((group) => {
                const IconComponent = group.icon;

                return (
                  <div key={group.category} className="rounded-lg border border-border bg-white p-4">
                    <h4 className="mb-3 font-semibold text-ink flex items-center gap-2">
                      <IconComponent className="h-4 w-4 text-gold" />
                      {group.category}
                    </h4>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {group.files.map((file, idx) => (
                        <a
                          key={idx}
                          href={file.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between gap-3 rounded-md border border-border bg-ivory p-3 text-sm transition hover:border-gold hover:bg-white"
                        >
                          <div className="min-w-0">
                            <p className="font-semibold truncate text-ink">{file.name}</p>
                            <p className="text-xs text-muted">{file.source}</p>
                          </div>
                          <Download className="h-4 w-4 shrink-0 text-gold" />
                        </a>
                      ))}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted">
                No files or deliverables have been uploaded for this project yet.
              </div>
            )}
          </div>
        )}

        {activeTab === 'messages' && (
          <div className="space-y-4">
            {/* Client ↔ Team Direct Project Chat */}
            <div className="rounded-lg border border-border bg-white p-4 space-y-3">
              <h4 className="font-semibold text-ink flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-gold" />
                  Project Discussion & Team Support
                </span>
                <span className="text-xs font-normal text-muted">Shared with Manuscript Heaven Team</span>
              </h4>

              <div className="rounded-md border border-border bg-linen/30 p-3 space-y-2 max-h-56 overflow-y-auto">
                <div className="rounded bg-white p-2.5 text-xs border border-border">
                  <div className="flex justify-between text-[10px] text-muted mb-1">
                    <span className="font-bold text-ink">Tahir (Manuscript Heaven)</span>
                    <span>Aug 11, 4:10 PM</span>
                  </div>
                  <p className="text-ink">Hi! We have completed the print layout version V3 and uploaded the proof PDF for your review.</p>
                </div>
                <div className="rounded bg-blue-50 p-2.5 text-xs border border-blue-200">
                  <div className="flex justify-between text-[10px] text-muted mb-1">
                    <span className="font-bold text-blue-900">You ({project.client_name})</span>
                    <span>Aug 11, 6:40 PM</span>
                  </div>
                  <p className="text-blue-950">Thank you! The interior layout looks great.</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Send a message or query to the team..."
                  value={clientMsg}
                  onChange={(e) => setClientMsg(e.target.value)}
                  className="flex-1 rounded-md border border-border bg-white px-3 py-1.5 text-xs text-ink outline-none focus:border-gold"
                />
                <Button
                  className="min-h-8 text-xs px-3 py-1"
                  onClick={() => {
                    if (!clientMsg.trim()) return;
                    setClientMsg('');
                  }}
                >
                  <Send className="h-3.5 w-3.5" />
                  Send
                </Button>
              </div>
            </div>

            {/* General & Client Instructions */}
            {project.client_instructions || project.general_notes || project.delivery_notes ? (
              <div className="rounded-lg border border-border bg-white p-4 space-y-3">
                <h4 className="font-semibold text-ink flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-gold" />
                  Project Instructions & Notes
                </h4>
                {project.client_instructions ? (
                  <div className="rounded-md border border-border bg-ivory p-3 text-sm">
                    <span className="font-semibold text-gold block mb-1">Client Instructions</span>
                    <p className="text-ink leading-relaxed">{project.client_instructions}</p>
                  </div>
                ) : null}
                {project.general_notes ? (
                  <div className="rounded-md border border-border bg-ivory p-3 text-sm">
                    <span className="font-semibold text-ink block mb-1">General Notes</span>
                    <p className="text-ink leading-relaxed">{project.general_notes}</p>
                  </div>
                ) : null}
                {project.delivery_notes ? (
                  <div className="rounded-md border border-border bg-ivory p-3 text-sm">
                    <span className="font-semibold text-success block mb-1">Delivery Notes</span>
                    <p className="text-ink leading-relaxed">{project.delivery_notes}</p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Client-visible Notes List */}
            {clientVisibleNotes.length ? (
              <div className="space-y-3">
                <h4 className="font-semibold text-ink">Updates & Team Messages</h4>
                {clientVisibleNotes.map((item) => (
                  <div key={item.id} className="rounded-lg border border-border bg-white p-4 text-sm">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="font-semibold text-ink">{item.addedBy}</span>
                      <span className="text-xs text-muted">{formatDate(item.createdAt)}</span>
                    </div>
                    <p className="text-muted leading-relaxed">{item.text}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="space-y-3">
            {projectActivities.length ? (
              projectActivities.map((act) => {
                const user = profiles.find((p) => p.id === act.user_id);

                return (
                  <div key={act.id} className="flex items-start gap-3 rounded-lg border border-border bg-white p-3 text-sm">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ivory border border-border font-bold text-gold text-xs">
                      <History className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-ink">{act.action}</span>
                        <span className="text-xs text-muted">{formatDate(act.created_at)}</span>
                      </div>
                      {act.new_value ? (
                        <p className="mt-1 text-xs text-muted">
                          {act.old_value ? `Changed from "${act.old_value}" to "${act.new_value}"` : act.new_value}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[11px] font-medium text-gold">By: {user ? user.full_name : 'System'}</p>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted">
                No activity history recorded for this project yet.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end border-t border-border bg-linen p-4">
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
