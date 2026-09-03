import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Edit3,
  ExternalLink,
  Eye,
  FileCheck,
  FileText,
  Filter,
  History,
  Info,
  Lock,
  MessageSquare,
  Paperclip,
  Plus,
  Save,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  User,
  UserCheck,
  X,
} from 'lucide-react';
import React, { useMemo, useState, useEffect } from 'react';
import { Button, Card, EmptyState, Field, Modal, SelectField, TextareaField } from '../components/ui';
import { UserAvatar } from '../components/UserAvatar';
import { roleLabels } from '../lib/constants';
import { formatDate } from '../lib/date';
import { firstName, isClientRole, cn } from '../lib/utils';
import type {
  Profile,
  Project,
  RevisionActivity,
  RevisionAttachment,
  RevisionItem,
  RevisionRequest,
} from '../lib/types';

export type InternalReviewStatus =
  | 'Not Started'
  | 'In Progress'
  | 'Ready for Internal Review'
  | 'Approved for Client';

export type ChecklistItemStatus = 'Pending' | 'In Progress' | 'Resolved' | 'Needs Clarification';

export interface ChecklistItemData {
  id: string;
  itemNumber: number;
  instruction: string;
  page_reference?: string;
  status: ChecklistItemStatus;
  internal_note: string;
  client_attachment_url?: string | null;
  isDbItem: boolean;
}

function profileName(profiles: Profile[], id?: string | null) {
  const profile = profiles.find((item) => item.id === id);
  return profile ? firstName(profile.full_name) : 'Unassigned';
}

function projectName(projects: Project[], id: string) {
  return projects.find((project) => project.id === id)?.project_title || 'Project';
}

function toInternalStatus(status?: string | null): InternalReviewStatus {
  if (!status) return 'Not Started';
  const s = status.trim().toLowerCase();
  if (s === 'not started' || s === 'submitted' || s === 'assigned' || s === 'pending') {
    return 'Not Started';
  }
  if (s === 'in progress') {
    return 'In Progress';
  }
  if (s === 'ready for internal review' || s === 'under review' || s === 'review') {
    return 'Ready for Internal Review';
  }
  if (
    s === 'approved for client' ||
    s === 'ready for client review' ||
    s === 'approved' ||
    s === 'completed'
  ) {
    return 'Approved for Client';
  }
  return 'In Progress';
}

function toDbItemStatus(status: ChecklistItemStatus): RevisionItem['status'] {
  switch (status) {
    case 'Resolved':
      return 'Completed';
    case 'In Progress':
      return 'In Progress';
    case 'Needs Clarification':
      return 'Under Review';
    default:
      return 'Open';
  }
}

function fromDbItemStatus(status?: string | null): ChecklistItemStatus {
  switch (status) {
    case 'Completed':
      return 'Resolved';
    case 'In Progress':
      return 'In Progress';
    case 'Under Review':
      return 'Needs Clarification';
    default:
      return 'Pending';
  }
}

/**
 * Intelligent parser that extracts preamble note and itemized numbered/bulleted checklist points.
 */
export function parseRevisionTextIntoItems(
  text: string,
  requestId: string,
): { preamble?: string; items: ChecklistItemData[] } {
  if (!text || !text.trim()) {
    return { items: [] };
  }

  const cleanText = text.trim();

  // Look for numbered patterns like "1. ", "1) "
  const numberPattern = /(?:^|\n|\s+)(?:(\d+)\s*[\.\)]\s+)/g;
  const matches: { index: number; length: number; num: number }[] = [];

  let match;
  while ((match = numberPattern.exec(cleanText)) !== null) {
    const num = parseInt(match[1], 10);
    if (num > 0 && num < 1000) {
      matches.push({
        index: match.index,
        length: match[0].length,
        num,
      });
    }
  }

  if (matches.length > 0) {
    let preamble: string | undefined = undefined;
    const firstMatch = matches[0];
    if (firstMatch.index > 0) {
      const intro = cleanText.substring(0, firstMatch.index).trim();
      if (intro) preamble = intro;
    }

    const items: ChecklistItemData[] = [];
    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      const startText = current.index + current.length;
      const endText = i + 1 < matches.length ? matches[i + 1].index : cleanText.length;
      const itemText = cleanText.substring(startText, endText).trim();

      if (itemText) {
        items.push({
          id: `${requestId}-parsed-${current.num}`,
          itemNumber: current.num,
          instruction: itemText,
          status: 'Pending',
          internal_note: '',
          isDbItem: false,
        });
      }
    }

    if (items.length > 0) {
      return { preamble, items };
    }
  }

  // Bullet points fallback (- or * or •)
  const bulletLines = cleanText.split('\n').filter((line) => line.trim().length > 0);
  const isBulletList = bulletLines.length > 1 && bulletLines.every((line) => /^[-*•]\s+/.test(line.trim()));
  if (isBulletList) {
    return {
      items: bulletLines.map((line, idx) => ({
        id: `${requestId}-bullet-${idx + 1}`,
        itemNumber: idx + 1,
        instruction: line.replace(/^[-*•]\s+/, '').trim(),
        status: 'Pending',
        internal_note: '',
        isDbItem: false,
      })),
    };
  }

  // Paragraphs fallback
  const paragraphs = cleanText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length > 1) {
    return {
      items: paragraphs.map((p, idx) => ({
        id: `${requestId}-para-${idx + 1}`,
        itemNumber: idx + 1,
        instruction: p,
        status: 'Pending',
        internal_note: '',
        isDbItem: false,
      })),
    };
  }

  // Single text fallback
  return {
    items: [
      {
        id: `${requestId}-single-1`,
        itemNumber: 1,
        instruction: cleanText,
        status: 'Pending',
        internal_note: '',
        isDbItem: false,
      },
    ],
  };
}

const itemStatusConfig: Record<
  ChecklistItemStatus,
  { label: string; badgeClass: string; dotClass: string }
> = {
  Pending: {
    label: 'Pending',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100',
    dotClass: 'bg-amber-500',
  },
  'In Progress': {
    label: 'In Progress',
    badgeClass: 'bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100',
    dotClass: 'bg-blue-500',
  },
  Resolved: {
    label: 'Resolved',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100',
    dotClass: 'bg-emerald-500',
  },
  'Needs Clarification': {
    label: 'Needs Clarification',
    badgeClass: 'bg-purple-50 text-purple-800 border-purple-200 hover:bg-purple-100',
    dotClass: 'bg-purple-500',
  },
};

const internalStatusSteps: {
  status: InternalReviewStatus;
  label: string;
  desc: string;
  icon: React.ElementType;
  activeClass: string;
}[] = [
  {
    status: 'Not Started',
    label: 'Not Started',
    desc: 'Revision queued, pending work',
    icon: Clock3,
    activeClass: 'bg-slate-100 text-slate-800 border-slate-300 ring-1 ring-slate-400',
  },
  {
    status: 'In Progress',
    label: 'In Progress',
    desc: 'Staff actively editing files',
    icon: Edit3,
    activeClass: 'bg-blue-50 text-blue-800 border-blue-300 ring-1 ring-blue-400',
  },
  {
    status: 'Ready for Internal Review',
    label: 'Ready for Review',
    desc: 'Awaiting manager / QA check',
    icon: Eye,
    activeClass: 'bg-purple-50 text-purple-800 border-purple-300 ring-1 ring-purple-400',
  },
  {
    status: 'Approved for Client',
    label: 'Approved for Client',
    desc: 'Verified & ready for delivery',
    icon: ShieldCheck,
    activeClass: 'bg-emerald-50 text-emerald-800 border-emerald-300 ring-1 ring-emerald-400',
  },
];

interface RevisionCardProps {
  request: RevisionRequest;
  dbItems: RevisionItem[];
  attachments: RevisionAttachment[];
  activities: RevisionActivity[];
  projects: Project[];
  profiles: Profile[];
  currentProfile: Profile;
  canManageAll: boolean;
  roundNumber: number;
  onUpdateRequest: (requestId: string, updates: Partial<RevisionRequest>) => Promise<void>;
  onUpdateItem: (itemId: string, updates: Partial<RevisionItem>) => Promise<void>;
  onUploadRevisedProof: (requestId: string, file: File) => Promise<void>;
  onSubmitStageForApproval?: (submissionNote?: string, fileUrl?: string) => Promise<void>;
}

function SingleRevisionRequestCard({
  request,
  dbItems,
  attachments,
  activities,
  projects,
  profiles,
  currentProfile,
  canManageAll,
  roundNumber,
  onUpdateRequest,
  onUpdateItem,
  onUploadRevisedProof,
  onSubmitStageForApproval,
}: RevisionCardProps) {
  const project = projects.find((p) => p.id === request.project_id);
  const teamMembers = useMemo(
    () => profiles.filter((profile) => !isClientRole(profile.role)),
    [profiles],
  );

  // Parse raw text if no DB items exist
  const parsedData = useMemo(() => {
    const rawText = request.instructions || request.description || request.title || '';
    return parseRevisionTextIntoItems(rawText, request.id);
  }, [request.description, request.id, request.instructions, request.title]);

  // Storage key for persisting parsed items status/notes locally
  const storageKey = `mh_rev_items_${request.id}`;

  // Initialize checklist items (either DB items or parsed items with cached state)
  const [items, setItems] = useState<ChecklistItemData[]>(() => {
    if (dbItems.length > 0) {
      return dbItems.map((item, idx) => ({
        id: item.id,
        itemNumber: idx + 1,
        instruction: item.instruction,
        page_reference: item.page_reference,
        status: fromDbItemStatus(item.status),
        internal_note: item.internal_note || '',
        client_attachment_url: item.client_attachment_url,
        isDbItem: true,
      }));
    }

    // Use parsed items and overlay any cached state
    let cachedOverrides: Record<string, { status?: ChecklistItemStatus; internal_note?: string }> = {};
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) cachedOverrides = JSON.parse(stored);
    } catch {
      // Ignore parse error
    }

    return parsedData.items.map((item) => ({
      ...item,
      status: cachedOverrides[item.id]?.status || item.status,
      internal_note: cachedOverrides[item.id]?.internal_note ?? item.internal_note,
    }));
  });

  // Keep items in sync if DB items change
  useEffect(() => {
    if (dbItems.length > 0) {
      setItems(
        dbItems.map((item, idx) => ({
          id: item.id,
          itemNumber: idx + 1,
          instruction: item.instruction,
          page_reference: item.page_reference,
          status: fromDbItemStatus(item.status),
          internal_note: item.internal_note || '',
          client_attachment_url: item.client_attachment_url,
          isDbItem: true,
        })),
      );
    }
  }, [dbItems]);

  // Operational state
  const [internalStatus, setInternalStatus] = useState<InternalReviewStatus>(() =>
    toInternalStatus(request.status),
  );
  const [assignedStaffId, setAssignedStaffId] = useState<string>(request.assigned_to || '');
  const [teamResponse, setTeamResponse] = useState<string>(request.team_response || '');
  const [filterState, setFilterState] = useState<'all' | 'pending' | 'resolved'>('all');
  const [searchAssignee, setSearchAssignee] = useState('');
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);

  // Note editing state per item
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  // UI feedback & modals
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [draftSavedToast, setDraftSavedToast] = useState(false);
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [isSubmittingDelivery, setIsSubmittingDelivery] = useState(false);
  const [deliveryFileUrl, setDeliveryFileUrl] = useState(
    project?.final_print_pdf_link || project?.proof_pdf_link || project?.final_ebook_link || '',
  );
  const [deliveryProofFile, setDeliveryProofFile] = useState<File | null>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);

  // Sync assigned staff when request prop changes
  useEffect(() => {
    setAssignedStaffId(request.assigned_to || '');
  }, [request.assigned_to]);

  useEffect(() => {
    setInternalStatus(toInternalStatus(request.status));
  }, [request.status]);

  useEffect(() => {
    setTeamResponse(request.team_response || '');
  }, [request.team_response]);

  // Checklist counts
  const totalCount = items.length;
  const resolvedCount = items.filter((i) => i.status === 'Resolved').length;
  const pendingCount = totalCount - resolvedCount;
  const progressPercent = totalCount ? Math.round((resolvedCount / totalCount) * 100) : 0;
  const isAllResolved = totalCount > 0 && resolvedCount === totalCount;
  const isApprovedForClient = internalStatus === 'Approved for Client';
  const isReadyForDelivery = isAllResolved && isApprovedForClient;

  // Filtered items
  const displayedItems = useMemo(() => {
    if (filterState === 'pending') {
      return items.filter((i) => i.status !== 'Resolved');
    }
    if (filterState === 'resolved') {
      return items.filter((i) => i.status === 'Resolved');
    }
    return items;
  }, [filterState, items]);

  const assignedProfile = profiles.find((p) => p.id === assignedStaffId);

  // Persist parsed item changes to localStorage
  function persistParsedItems(updatedItems: ChecklistItemData[]) {
    const overrides: Record<string, { status: ChecklistItemStatus; internal_note: string }> = {};
    updatedItems.forEach((i) => {
      if (!i.isDbItem) {
        overrides[i.id] = { status: i.status, internal_note: i.internal_note };
      }
    });
    try {
      localStorage.setItem(storageKey, JSON.stringify(overrides));
    } catch {
      // Ignore
    }
  }

  // Checkbox toggle: Done <=> Pending
  async function handleToggleDone(item: ChecklistItemData) {
    const newStatus: ChecklistItemStatus = item.status === 'Resolved' ? 'Pending' : 'Resolved';
    const updated = items.map((i) => (i.id === item.id ? { ...i, status: newStatus } : i));
    setItems(updated);
    persistParsedItems(updated);

    if (item.isDbItem) {
      await onUpdateItem(item.id, { status: toDbItemStatus(newStatus) });
    }
  }

  // Change individual item status pill
  async function handleStatusChange(item: ChecklistItemData, newStatus: ChecklistItemStatus) {
    const updated = items.map((i) => (i.id === item.id ? { ...i, status: newStatus } : i));
    setItems(updated);
    persistParsedItems(updated);

    if (item.isDbItem) {
      await onUpdateItem(item.id, { status: toDbItemStatus(newStatus) });
    }
  }

  // Save note on item
  async function handleSaveItemNote(itemId: string) {
    const updated = items.map((i) => (i.id === itemId ? { ...i, internal_note: noteDraft } : i));
    setItems(updated);
    persistParsedItems(updated);

    const item = items.find((i) => i.id === itemId);
    if (item?.isDbItem) {
      await onUpdateItem(itemId, { internal_note: noteDraft });
    }

    setEditingNoteId(null);
    setNoteDraft('');
  }

  // Assign staff
  async function handleAssignStaff(profileId: string | null) {
    setAssignedStaffId(profileId || '');
    setShowAssigneeDropdown(false);
    setSearchAssignee('');

    const newStatus =
      profileId && (internalStatus === 'Not Started' || request.status === 'Submitted')
        ? 'In Progress'
        : request.status;

    if (profileId && (internalStatus === 'Not Started')) {
      setInternalStatus('In Progress');
    }

    await onUpdateRequest(request.id, {
      assigned_to: profileId,
      status: newStatus as RevisionRequest['status'],
    });
  }

  // Update internal operational status
  async function handleInternalStatusChange(newStatus: InternalReviewStatus) {
    setInternalStatus(newStatus);
    let mappedDbStatus: RevisionRequest['status'] = request.status;
    if (newStatus === 'Not Started') mappedDbStatus = 'Submitted';
    else if (newStatus === 'In Progress') mappedDbStatus = 'In Progress';
    else if (newStatus === 'Ready for Internal Review') mappedDbStatus = 'Under Review';
    else if (newStatus === 'Approved for Client') mappedDbStatus = 'Ready for Client Review';

    await onUpdateRequest(request.id, {
      status: mappedDbStatus,
    });
  }

  // Action 1: Save Internal Draft
  async function handleSaveInternalDraft() {
    setIsSavingDraft(true);
    try {
      persistParsedItems(items);
      await onUpdateRequest(request.id, {
        team_response: teamResponse,
        assigned_to: assignedStaffId || null,
      });

      // Save each DB item
      await Promise.all(
        items
          .filter((i) => i.isDbItem)
          .map((i) =>
            onUpdateItem(i.id, {
              status: toDbItemStatus(i.status),
              internal_note: i.internal_note,
            }),
          ),
      );

      setDraftSavedToast(true);
      setTimeout(() => setDraftSavedToast(false), 3000);
    } finally {
      setIsSavingDraft(false);
    }
  }

  // Action 2: Send to Client & Close Round
  async function handleConfirmSendToClient() {
    setIsSubmittingDelivery(true);
    try {
      // 1. Upload proof file if selected
      if (deliveryProofFile) {
        await onUploadRevisedProof(request.id, deliveryProofFile);
      }

      // 2. Call parent approval / delivery submission
      if (onSubmitStageForApproval) {
        await onSubmitStageForApproval(teamResponse, deliveryFileUrl);
      }

      // 3. Mark request as ready for client review / completed
      await onUpdateRequest(request.id, {
        status: 'Ready for Client Review',
        team_response: teamResponse,
        completed_at: new Date().toISOString(),
      });

      setShowDeliveryModal(false);
    } finally {
      setIsSubmittingDelivery(false);
    }
  }

  const filteredTeamMembers = useMemo(() => {
    if (!searchAssignee.trim()) return teamMembers;
    const q = searchAssignee.toLowerCase();
    return teamMembers.filter(
      (m) =>
        m.full_name.toLowerCase().includes(q) ||
        (m.email && m.email.toLowerCase().includes(q)) ||
        m.role.toLowerCase().includes(q),
    );
  }, [searchAssignee, teamMembers]);

  return (
    <Card className="p-5 sm:p-6 border-gold/30 bg-white/90 shadow-sm relative overflow-hidden">
      {/* Toast Notification */}
      {draftSavedToast && (
        <div className="absolute top-4 right-4 z-20 flex items-center gap-2 bg-charcoal text-white text-xs px-3.5 py-2 rounded-lg shadow-md animate-fade-in">
          <CheckCircle2 className="h-4 w-4 text-gold" />
          <span>Internal revision draft saved</span>
        </div>
      )}

      {/* TOP HEADER & CLEAR STATUS HIERARCHY */}
      <div className="flex flex-col gap-3 pb-4 border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-gold">
              {projectName(projects, request.project_id)}
            </span>
            <h3 className="font-display text-xl font-bold text-ink leading-tight mt-0.5">
              {request.title || 'Revision Request'}
            </h3>
          </div>
        </div>

        {/* Status Hierarchy Badges */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-1 text-xs">
          {/* Group 1: Client Facing */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase font-bold text-muted tracking-wider">Client Facing:</span>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 shadow-2xs">
              Rev #{roundNumber}
            </span>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-ivory text-ink border border-border shadow-2xs">
              Submitted: {formatDate(request.submitted_at.slice(0, 10))}
            </span>
            <span
              className={cn(
                'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border shadow-2xs',
                request.priority === 'Urgent'
                  ? 'bg-red-50 text-danger border-red-200'
                  : request.priority === 'Important'
                    ? 'bg-orange-50 text-amber-700 border-orange-200'
                    : 'bg-blue-50 text-blue-700 border-blue-200',
              )}
            >
              Priority: {request.priority || 'Normal'}
            </span>
          </div>

          <div className="hidden sm:block h-3.5 w-px bg-border" />

          {/* Group 2: Internal Tracking */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase font-bold text-muted tracking-wider">Internal Tracking:</span>
            <span
              className={cn(
                'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border shadow-2xs',
                internalStatus === 'Approved for Client'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                  : internalStatus === 'Ready for Internal Review'
                    ? 'bg-purple-50 text-purple-800 border-purple-200'
                    : internalStatus === 'In Progress'
                      ? 'bg-blue-50 text-blue-800 border-blue-200'
                      : 'bg-slate-100 text-slate-700 border-slate-300',
              )}
            >
              {internalStatus}
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-linen/70 text-ink border border-border shadow-2xs">
              <UserAvatar
                profile={assignedProfile}
                name={assignedProfile?.full_name || 'Unassigned'}
                size="xs"
              />
              <span className="truncate max-w-[120px]">
                {assignedProfile ? firstName(assignedProfile.full_name) : 'Unassigned'}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* TWO-COLUMN RESPONSIVE LAYOUT (NO OVERLAPS) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-5 items-start">
        {/* LEFT COLUMN: Preamble, Interactive Checklist, Response Staging Area, Two-Tier Actions */}
        <div className="lg:col-span-8 space-y-5 min-w-0">
          {/* Optional Client Preamble Note (clean context banner) */}
          {parsedData.preamble && (
            <div className="rounded-lg bg-ivory/80 border border-border/80 p-3 flex items-start gap-2.5 text-xs text-charcoal shadow-2xs">
              <Info className="h-4 w-4 text-gold shrink-0 mt-0.5" />
              <div>
                <strong className="text-ink font-semibold">Client Overview Note:</strong>{' '}
                <span className="text-muted leading-relaxed">{parsedData.preamble}</span>
              </div>
            </div>
          )}

          {/* INTERACTIVE REVISION CHECKLIST */}
          <div className="rounded-xl border border-border bg-white shadow-2xs p-4 sm:p-5">
            {/* Checklist Header & Progress Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border pb-3.5 mb-3.5">
              <div>
                <h4 className="font-display font-bold text-base text-ink flex items-center gap-2">
                  <FileCheck className="h-4 w-4 text-gold" />
                  Revision Checklist
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-ivory border border-border text-muted">
                    {resolvedCount} of {totalCount} Resolved
                  </span>
                </h4>
                <p className="text-[11px] text-muted mt-0.5">
                  Interactive operational tasks extracted from client revision feedback.
                </p>
              </div>

              {/* Filter Pills */}
              <div className="flex items-center gap-1.5 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setFilterState('all')}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-semibold transition',
                    filterState === 'all'
                      ? 'bg-charcoal text-white shadow-2xs'
                      : 'bg-linen/60 text-muted hover:text-ink',
                  )}
                >
                  All ({totalCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterState('pending')}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-semibold transition',
                    filterState === 'pending'
                      ? 'bg-amber-600 text-white shadow-2xs'
                      : 'bg-amber-50 text-amber-800 hover:bg-amber-100',
                  )}
                >
                  Open ({pendingCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterState('resolved')}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-semibold transition',
                    filterState === 'resolved'
                      ? 'bg-emerald-600 text-white shadow-2xs'
                      : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
                  )}
                >
                  Resolved ({resolvedCount})
                </button>
              </div>
            </div>

            {/* Visual Progress Bar */}
            <div className="mb-4">
              <div className="h-2 w-full overflow-hidden rounded-full bg-ivory border border-border/50">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {/* Checklist Items List */}
            {displayedItems.length === 0 ? (
              <div className="py-8 text-center text-muted text-xs">
                <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500 mb-2 opacity-80" />
                <p className="font-semibold text-ink">No points in this filter</p>
                <p className="mt-0.5">All revision checklist points matching this status are complete.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {displayedItems.map((item) => {
                  const isResolved = item.status === 'Resolved';
                  const isNoteOpen = editingNoteId === item.id;
                  const config = itemStatusConfig[item.status];

                  return (
                    <div
                      key={item.id}
                      className={cn(
                        'rounded-lg border p-3 text-xs transition-all',
                        isResolved
                          ? 'border-emerald-200/80 bg-emerald-50/20'
                          : item.status === 'In Progress'
                            ? 'border-blue-200/80 bg-blue-50/15'
                            : item.status === 'Needs Clarification'
                              ? 'border-purple-200/80 bg-purple-50/15'
                              : 'border-border bg-white hover:border-gold/40',
                      )}
                    >
                      <div className="flex items-start gap-3">
                        {/* Interactive Checkbox */}
                        <button
                          type="button"
                          onClick={() => handleToggleDone(item)}
                          className={cn(
                            'mt-0.5 h-4.5 w-4.5 shrink-0 rounded flex items-center justify-center border transition',
                            isResolved
                              ? 'bg-emerald-600 border-emerald-600 text-white shadow-2xs'
                              : 'border-charcoal/30 bg-white hover:border-gold hover:bg-gold/10 text-transparent',
                          )}
                          title={isResolved ? 'Mark open' : 'Mark completed'}
                        >
                          <Check className="h-3 w-3 stroke-[3]" />
                        </button>

                        {/* Task Content */}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <span className="font-bold text-ink mr-1.5 text-xs">
                                #{item.itemNumber}.
                              </span>
                              <span
                                className={cn(
                                  'text-xs leading-relaxed',
                                  isResolved ? 'line-through text-muted' : 'text-charcoal font-medium',
                                )}
                              >
                                {item.instruction}
                              </span>
                              {item.client_attachment_url && (
                                <p className="mt-1 text-[11px] text-muted flex items-center gap-1">
                                  <Paperclip className="h-3 w-3 text-gold" />
                                  <span>Client attachment:</span>
                                  <a
                                    href={item.client_attachment_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-gold font-medium hover:underline truncate max-w-[240px]"
                                  >
                                    {item.client_attachment_url}
                                  </a>
                                </p>
                              )}
                            </div>

                            {/* Status Pill Dropdown */}
                            <div className="shrink-0 flex items-center gap-1.5 self-start">
                              <select
                                value={item.status}
                                onChange={(e) =>
                                  handleStatusChange(item, e.target.value as ChecklistItemStatus)
                                }
                                className={cn(
                                  'text-[11px] font-semibold py-0.5 px-2 rounded-full border cursor-pointer focus:outline-none transition',
                                  config.badgeClass,
                                )}
                              >
                                <option value="Pending">Pending</option>
                                <option value="In Progress">In Progress</option>
                                <option value="Resolved">Resolved</option>
                                <option value="Needs Clarification">Needs Clarification</option>
                              </select>
                            </div>
                          </div>

                          {/* Quick Internal Note Toggle / Display */}
                          <div className="mt-2 pt-2 border-t border-border/50 flex flex-col gap-1.5">
                            {item.internal_note && !isNoteOpen ? (
                              <div className="flex items-center justify-between gap-2 bg-ivory/80 rounded px-2.5 py-1.5 text-[11px] text-ink border border-border/60">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <MessageSquare className="h-3 w-3 text-gold shrink-0" />
                                  <span className="font-bold text-muted shrink-0">Staff Note:</span>
                                  <span className="truncate text-charcoal font-medium">
                                    {item.internal_note}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingNoteId(item.id);
                                    setNoteDraft(item.internal_note);
                                  }}
                                  className="text-muted hover:text-ink font-semibold shrink-0 text-[10px]"
                                >
                                  Edit Note
                                </button>
                              </div>
                            ) : null}

                            {isNoteOpen ? (
                              <div className="space-y-1.5 bg-ivory/60 p-2 rounded-lg border border-border">
                                <textarea
                                  value={noteDraft}
                                  onChange={(e) => setNoteDraft(e.target.value)}
                                  placeholder="Designer notes (e.g., 'Fixed font mismatch on page 1 in InDesign')..."
                                  className="w-full text-xs rounded border border-border p-2 focus:border-gold focus:outline-none bg-white"
                                  rows={2}
                                />
                                <div className="flex justify-end gap-1.5">
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() => {
                                      setEditingNoteId(null);
                                      setNoteDraft('');
                                    }}
                                    className="text-[11px] py-1 px-2 h-auto"
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    type="button"
                                    onClick={() => handleSaveItemNote(item.id)}
                                    className="text-[11px] py-1 px-2 h-auto bg-charcoal text-white"
                                  >
                                    Save Note
                                  </Button>
                                </div>
                              </div>
                            ) : !item.internal_note ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingNoteId(item.id);
                                  setNoteDraft('');
                                }}
                                className="text-[11px] text-muted hover:text-gold font-medium inline-flex items-center gap-1 self-start"
                              >
                                <Plus className="h-3 w-3" />
                                <span>Add internal note</span>
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* GATED CLIENT DELIVERY STAGING AREA */}
          <div className="rounded-xl border border-border bg-white shadow-2xs p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3 border-b border-border pb-3 mb-3.5">
              <div>
                <h4 className="font-display font-bold text-base text-ink flex items-center gap-2">
                  <Send className="h-4 w-4 text-gold" />
                  Client Delivery Staging Area
                </h4>
                <p className="text-[11px] text-muted mt-0.5">
                  Internal staging area for crafting the explanatory delivery note before client release.
                </p>
              </div>

              {isReadyForDelivery ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Ready to Deliver
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-300">
                  <Lock className="h-3.5 w-3.5" />
                  Staged & Gated
                </span>
              )}
            </div>

            {/* Visual Gate / Notice Banner */}
            {!isReadyForDelivery ? (
              <div className="mb-3 rounded-lg bg-amber-50/70 border border-amber-200/80 p-3 text-xs text-amber-900 flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <strong>Delivery Gated:</strong>{' '}
                  {pendingCount > 0
                    ? `${pendingCount} checklist points are still unresolved. Resolve all items and set internal review status to "Approved for Client" to submit.`
                    : `Internal status is currently "${internalStatus}". Set status to "Approved for Client" in the right sidebar to unlock client delivery.`}
                </div>
              </div>
            ) : (
              <div className="mb-3 rounded-lg bg-emerald-50/70 border border-emerald-300 p-3 text-xs text-emerald-900 flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <strong>Ready for Client Release:</strong> All {totalCount} points are marked resolved
                  and the internal status is approved. Review your message below and click{' '}
                  <strong>"Submit Revision to Client"</strong> to send.
                </div>
              </div>
            )}

            <TextareaField
              label="Client-Visible Response (Draft Preview)"
              value={teamResponse}
              onChange={(e) => setTeamResponse(e.target.value)}
              placeholder="e.g. We have applied all requested revisions to the print proof, updated the chapter headings, and refined page layouts. Please review the updated proof..."
              rows={4}
            />

            {/* TWO-TIER ACTION BUTTONS */}
            <div className="mt-4 pt-3 border-t border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="text-[11px] text-muted">
                {isReadyForDelivery ? (
                  <span className="text-emerald-700 font-medium flex items-center gap-1">
                    <Check className="h-3.5 w-3.5" />
                    Internal review approved. Ready for client.
                  </span>
                ) : (
                  <span>Saving as internal draft preserves progress without notifying client.</span>
                )}
              </div>

              <div className="flex items-center gap-2.5">
                {/* Action 1: Save Internal Draft */}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleSaveInternalDraft}
                  disabled={isSavingDraft}
                  className="text-xs py-2 px-3.5"
                >
                  <Save className="h-3.5 w-3.5 text-muted" />
                  {isSavingDraft ? 'Saving Draft...' : 'Save Internal Draft'}
                </Button>

                {/* Action 2: Submit Revision to Client (Primary Action) */}
                <Button
                  type="button"
                  onClick={() => setShowDeliveryModal(true)}
                  disabled={!isReadyForDelivery || isSubmittingDelivery}
                  className={cn(
                    'text-xs py-2 px-4 font-semibold shadow-xs transition',
                    isReadyForDelivery
                      ? 'bg-gold text-white hover:bg-gold/90'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed',
                  )}
                  title={
                    !isReadyForDelivery
                      ? 'Resolve all checklist items and set Internal Status to "Approved for Client" to submit.'
                      : 'Submit completed revision to client'
                  }
                >
                  <Send className="h-3.5 w-3.5" />
                  Submit Revision to Client
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Internal Operational Control, Files, Activity */}
        <div className="lg:col-span-4 space-y-4 min-w-0">
          {/* Internal Operational Control Card */}
          <div className="rounded-xl border border-gold/30 bg-ivory/50 p-4 sm:p-5 shadow-2xs space-y-5">
            <div>
              <h4 className="font-display font-bold text-sm text-ink flex items-center gap-1.5">
                <Clock3 className="h-4 w-4 text-gold" />
                Internal Workflow & Assignment
              </h4>
              <p className="text-[11px] text-muted mt-0.5">
                Operational pipeline before client release.
              </p>
            </div>

            {/* Staff Assignment */}
            <div className="space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted block">
                Staff Assignment
              </span>

              {/* Current Assignee Display */}
              <div className="flex items-center gap-3 p-2.5 bg-white rounded-lg border border-border shadow-2xs">
                <UserAvatar
                  profile={assignedProfile}
                  name={assignedProfile?.full_name || 'Unassigned'}
                  role="employee"
                  size="md"
                  showRoleRing
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-xs text-ink truncate">
                    {assignedProfile ? assignedProfile.full_name : 'Unassigned'}
                  </p>
                  <span className="text-[10px] text-muted block truncate">
                    {assignedProfile
                      ? roleLabels[assignedProfile.role] || assignedProfile.role
                      : 'Select staff below'}
                  </span>
                </div>
              </div>

              {/* Searchable Dropdown */}
              {canManageAll && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowAssigneeDropdown(!showAssigneeDropdown)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-1.5 bg-white border border-border rounded-md text-xs hover:border-gold transition text-left"
                  >
                    <span className="truncate text-charcoal">
                      {assignedProfile ? `Reassign: ${assignedProfile.full_name}` : 'Assign Staff...'}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-muted shrink-0" />
                  </button>

                  {showAssigneeDropdown && (
                    <div className="absolute top-full left-0 right-0 mt-1 z-30 bg-white rounded-lg border border-border shadow-lg p-2 space-y-1.5 animate-fade-in">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted" />
                        <input
                          type="text"
                          value={searchAssignee}
                          onChange={(e) => setSearchAssignee(e.target.value)}
                          placeholder="Search employee..."
                          className="w-full text-xs pl-8 pr-2.5 py-1.5 rounded border border-border focus:border-gold focus:outline-none"
                          autoFocus
                        />
                      </div>

                      <div className="max-h-48 overflow-y-auto space-y-1">
                        <button
                          type="button"
                          onClick={() => handleAssignStaff(null)}
                          className="w-full text-left px-2.5 py-1.5 rounded text-xs text-muted hover:bg-ivory transition"
                        >
                          ✕ Unassign
                        </button>
                        {filteredTeamMembers.map((member) => (
                          <button
                            key={member.id}
                            type="button"
                            onClick={() => handleAssignStaff(member.id)}
                            className={cn(
                              'w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition text-left',
                              assignedStaffId === member.id
                                ? 'bg-gold/15 text-ink font-semibold'
                                : 'hover:bg-ivory text-charcoal',
                            )}
                          >
                            <UserAvatar profile={member} name={member.full_name} size="xs" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium">{member.full_name}</p>
                              <span className="text-[10px] text-muted block truncate">
                                {roleLabels[member.role] || member.role}
                              </span>
                            </div>
                            {assignedStaffId === member.id && (
                              <Check className="h-3.5 w-3.5 text-gold shrink-0" />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Internal Review Status Selector */}
            <div className="space-y-2 pt-2 border-t border-border/70">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted block">
                Internal Review Status
              </span>

              <div className="space-y-1.5">
                {internalStatusSteps.map((step) => {
                  const Icon = step.icon;
                  const isCurrent = internalStatus === step.status;

                  return (
                    <button
                      key={step.status}
                      type="button"
                      onClick={() => handleInternalStatusChange(step.status)}
                      className={cn(
                        'w-full flex items-start gap-2.5 p-2 rounded-lg border text-left text-xs transition',
                        isCurrent
                          ? step.activeClass
                          : 'border-border bg-white/70 hover:border-gold hover:bg-white text-muted',
                      )}
                    >
                      <Icon
                        className={cn(
                          'h-4 w-4 shrink-0 mt-0.5',
                          isCurrent ? 'text-inherit' : 'text-muted',
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold leading-tight text-ink">{step.label}</p>
                        <span className="text-[10px] text-muted block mt-0.5">{step.desc}</span>
                      </div>
                      {isCurrent && <Check className="h-3.5 w-3.5 shrink-0 self-center text-inherit" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Files & Deliverables Card */}
          <div className="rounded-xl border border-border bg-white p-4 sm:p-5 shadow-2xs space-y-4">
            <h4 className="font-display font-bold text-sm text-ink flex items-center gap-1.5">
              <Paperclip className="h-4 w-4 text-gold" />
              Revision Files & Deliverables
            </h4>

            {/* Client attachments */}
            <div>
              <span className="text-[10px] font-bold uppercase text-muted block mb-1.5">
                Client Attachments ({attachments.length})
              </span>
              {attachments.length ? (
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {attachments.map((att) => (
                    <div
                      key={att.id}
                      className="flex items-center justify-between gap-2 p-2 rounded border border-border bg-ivory/50 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-ink truncate">{att.file_name}</p>
                        <span className="text-[10px] text-muted">{att.file_type}</span>
                      </div>
                      <a
                        href={att.file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-gold hover:underline text-xs flex items-center gap-1 shrink-0"
                      >
                        <ExternalLink className="h-3 w-3" />
                        View
                      </a>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted">No files attached by client.</p>
              )}
            </div>

            {/* Upload Revised Proof */}
            <div className="pt-2 border-t border-border space-y-2">
              <span className="text-[10px] font-bold uppercase text-muted block">
                Upload Revised Proof
              </span>
              <input
                type="file"
                id={`upload-proof-${request.id}`}
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setIsUploadingFile(true);
                    try {
                      await onUploadRevisedProof(request.id, file);
                    } finally {
                      setIsUploadingFile(false);
                    }
                  }
                }}
              />
              <label
                htmlFor={`upload-proof-${request.id}`}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-border rounded-lg text-xs font-semibold text-charcoal hover:border-gold hover:bg-ivory cursor-pointer transition"
              >
                <UploadCloud className="h-4 w-4 text-gold" />
                <span>{isUploadingFile ? 'Uploading File...' : 'Upload Revised Proof'}</span>
              </label>
            </div>
          </div>

          {/* Activity Log Card */}
          {activities.length > 0 && (
            <div className="rounded-xl border border-border bg-white p-4 sm:p-5 shadow-2xs space-y-3">
              <h4 className="font-display font-bold text-sm text-ink flex items-center gap-1.5">
                <History className="h-4 w-4 text-gold" />
                Revision Activity
              </h4>
              <div className="space-y-2 max-h-44 overflow-y-auto">
                {activities.slice(0, 6).map((act) => (
                  <div key={act.id} className="text-xs border-b border-border/50 pb-2 last:border-b-0">
                    <p className="font-semibold text-ink">{act.action}</p>
                    <p className="text-[11px] text-muted mt-0.5">
                      {act.previous_value ? `${act.previous_value} → ` : ''}
                      <span className="text-charcoal font-medium">{act.new_value || 'Updated'}</span> by{' '}
                      {profileName(profiles, act.user_id)}
                    </p>
                    <span className="text-[10px] text-muted">{formatDate(act.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CONFIRMATION MODAL: SUBMIT REVISION TO CLIENT */}
      {showDeliveryModal && (
        <Modal
          title={`Submit Revision to Client (Round #${roundNumber})`}
          onClose={() => setShowDeliveryModal(false)}
          width="max-w-2xl"
        >
          <div className="space-y-4 text-xs">
            {/* Context Notice */}
            <div className="rounded-lg border border-gold/30 bg-ivory/80 p-3 flex items-start gap-2.5 text-ink">
              <Clock3 className="h-4 w-4 text-gold shrink-0 mt-0.5" />
              <div>
                <strong>Client Delivery & Review Request</strong>
                <p className="text-muted mt-0.5">
                  Submitting this revision will notify the client, transition project status to{' '}
                  <strong>Awaiting Client Approval</strong>, pause the production clock, and close this revision round.
                </p>
              </div>
            </div>

            {/* Summary of Resolved Points */}
            <div className="rounded-lg border border-border bg-white p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-ink">Checklist Resolution Summary</span>
                <span className="text-emerald-700 font-semibold text-[11px] flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {resolvedCount} of {totalCount} points resolved
                </span>
              </div>
              <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                {items.map((i) => (
                  <div
                    key={i.id}
                    className="flex items-start gap-2 text-[11px] py-1 border-b border-border/40 last:border-b-0"
                  >
                    <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-ink">#{i.itemNumber}:</span>{' '}
                      <span className="text-charcoal truncate">{i.instruction}</span>
                      {i.internal_note && (
                        <p className="text-[10px] text-muted italic">Note: {i.internal_note}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Final Client-Facing Message Preview */}
            <TextareaField
              label="Final Client-Facing Message"
              value={teamResponse}
              onChange={(e) => setTeamResponse(e.target.value)}
              placeholder="Explanatory notes for client review..."
              rows={4}
            />

            {/* Attached Deliverable URL & Proof File */}
            <div className="space-y-3 pt-2 border-t border-border">
              <Field
                label="Deliverable / Proof Link (URL or Google Drive)"
                value={deliveryFileUrl}
                onChange={(e) => setDeliveryFileUrl(e.target.value)}
                placeholder="https://drive.google.com/file/d/example-proof.pdf"
              />

              <div>
                <label className="text-xs font-semibold text-ink block mb-1">
                  Attach New Revised Proof File (Optional)
                </label>
                <input
                  type="file"
                  onChange={(e) => setDeliveryProofFile(e.target.files?.[0] || null)}
                  className="w-full text-xs rounded-md border border-border p-2 bg-white"
                />
                {deliveryProofFile && (
                  <p className="text-[11px] text-emerald-700 mt-1 flex items-center gap-1">
                    <Check className="h-3 w-3" /> Selected: {deliveryProofFile.name}
                  </p>
                )}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-2.5 pt-3 border-t border-border">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowDeliveryModal(false)}
                disabled={isSubmittingDelivery}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleConfirmSendToClient}
                disabled={isSubmittingDelivery}
                className="bg-gold text-white font-semibold hover:bg-gold/90"
              >
                <Send className="h-3.5 w-3.5" />
                {isSubmittingDelivery ? 'Sending to Client...' : 'Send to Client & Close Round'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}

export function RevisionRequestsPage({
  revisionRequests,
  revisionItems,
  revisionAttachments,
  revisionActivity,
  projects,
  profiles,
  currentProfile,
  canManageAll,
  onUpdateRequest,
  onUpdateItem,
  onUploadRevisedProof,
  onSubmitStageForApproval,
}: {
  revisionRequests: RevisionRequest[];
  revisionItems: RevisionItem[];
  revisionAttachments: RevisionAttachment[];
  revisionActivity: RevisionActivity[];
  projects: Project[];
  profiles: Profile[];
  currentProfile: Profile;
  canManageAll: boolean;
  onUpdateRequest: (requestId: string, updates: Partial<RevisionRequest>) => Promise<void>;
  onUpdateItem: (itemId: string, updates: Partial<RevisionItem>) => Promise<void>;
  onUploadRevisedProof: (requestId: string, file: File) => Promise<void>;
  onSubmitStageForApproval?: (submissionNote?: string, fileUrl?: string) => Promise<void>;
}) {
  const visibleRequests = canManageAll
    ? revisionRequests
    : revisionRequests.filter((request) => request.assigned_to === currentProfile.id);

  const requestsWithProjects = useMemo(
    () =>
      visibleRequests.filter(
        (request) => projects.some((project) => project.id === request.project_id) || canManageAll,
      ),
    [canManageAll, projects, visibleRequests],
  );

  if (!requestsWithProjects.length) {
    return (
      <EmptyState
        title="No client revision requests"
        message="Client revision requests will appear here after submission or assignment."
      />
    );
  }

  return (
    <div className="space-y-6">
      {requestsWithProjects.map((request, idx) => {
        const items = revisionItems.filter((item) => item.revision_request_id === request.id);
        const attachments = revisionAttachments.filter(
          (attachment) => attachment.revision_request_id === request.id,
        );
        const activity = revisionActivity.filter(
          (item) => item.revision_request_id === request.id,
        );

        // Calculate round number (if project has revision_count, use that or chronological index)
        const project = projects.find((p) => p.id === request.project_id);
        const roundNum = project?.revision_count || requestsWithProjects.length - idx;

        return (
          <SingleRevisionRequestCard
            key={request.id}
            request={request}
            dbItems={items}
            attachments={attachments}
            activities={activity}
            projects={projects}
            profiles={profiles}
            currentProfile={currentProfile}
            canManageAll={canManageAll}
            roundNumber={roundNum}
            onUpdateRequest={onUpdateRequest}
            onUpdateItem={onUpdateItem}
            onUploadRevisedProof={onUploadRevisedProof}
            onSubmitStageForApproval={onSubmitStageForApproval}
          />
        );
      })}
    </div>
  );
}
