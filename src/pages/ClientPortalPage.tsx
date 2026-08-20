import {
  AlertCircle,
  ArrowUpRight,
  Bell,
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock3,
  FileText,
  FolderOpen,
  ListChecks,
  MessageSquare,
  Plus,
  Repeat2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { StatusBadge } from '../components/Badges';
import { TimelineBadge } from '../components/ProjectTimeline';
import { RevisionRequestModal } from '../components/RevisionRequestModal';
import { Button, Card, EmptyState } from '../components/ui';
import { activeClientProjectStatuses, closedStatuses } from '../lib/constants';
import { formatDate } from '../lib/date';
import { getTimelineMilestones, getTimelineSummary, type ApprovalMilestone } from '../lib/timeline';
import type {
  ClientRevisionStatus,
  NotificationItem,
  Project,
  RevisionAttachment,
  RevisionItem,
  RevisionRequest,
  RevisionRequestDraft,
} from '../lib/types';
import { cn } from '../lib/utils';

const closedRevisionStatuses: ClientRevisionStatus[] = ['Approved', 'Completed'];

function latestProof(project: Project) {
  return (
    project.proof_pdf_link ||
    project.final_print_pdf_link ||
    project.final_ebook_link ||
    project.cover_file_link ||
    ''
  );
}

function revisionText(request: RevisionRequest) {
  return request.instructions || request.description || request.title;
}

function isActiveOrder(project: Project) {
  return project.status === 'Active' || !closedStatuses.includes(project.status) || activeClientProjectStatuses.includes(project.status);
}

function fileLabel(attachment: RevisionAttachment) {
  if (attachment.file_type === 'revised_proof') {
    return `Revised proof: ${attachment.file_name}`;
  }

  return attachment.file_name;
}

function approvalMilestoneForStage(stage: string): ApprovalMilestone | null {
  // Match both normalized stage names and legacy status strings
  if (stage === 'Concept Approval' || stage === 'Awaiting Concept Approval' || stage === 'Concept Revisions') {
    return 'concept';
  }

  if (stage === 'Print Approval' || stage === 'Awaiting Print Approval' || stage === 'Print Revisions') {
    return 'print';
  }

  if (stage === 'Ebook Approval' || stage === 'eBook Review') {
    return 'ebook';
  }

  return null;
}

function approvalLabel(milestone: ApprovalMilestone) {
  if (milestone === 'concept') {
    return 'Approve Design Concept';
  }

  if (milestone === 'print') {
    return 'Approve Print Version';
  }

  return 'Approve Ebook Version';
}

function revisionLabel(milestone: ApprovalMilestone | null) {
  if (milestone === 'concept') {
    return 'Request Design Revision';
  }

  if (milestone === 'print') {
    return 'Request Print Revision';
  }

  if (milestone === 'ebook') {
    return 'Request Ebook Revision';
  }

  return 'Request Revision';
}

function daysRemainingText(summary: ReturnType<typeof getTimelineSummary>) {
  if (summary.daysRemaining === null) {
    return summary.waitingOn === 'Client' ? 'Waiting for your review' : 'Not active';
  }

  if (summary.daysRemaining < 0) {
    const overdueDays = Math.abs(summary.daysRemaining);
    return `${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue`;
  }

  if (summary.daysRemaining === 0) {
    return 'Due today';
  }

  if (summary.daysRemaining === 1) {
    return 'Due tomorrow';
  }

  return `${summary.daysRemaining} days left`;
}

function ClientStat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  icon: typeof FolderOpen;
}) {
  return (
    <div className="rounded-md border border-border bg-ivory px-4 py-3">
      <div className="flex items-center gap-2 text-muted">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-semibold uppercase tracking-[0.12em]">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-ink">{value}</p>
    </div>
  );
}

function InfoTile({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className={cn('rounded-md border border-border bg-ivory px-3 py-2', accent && 'border-gold/50 bg-[#fff8e8]')}>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 font-semibold text-ink">{value}</p>
    </div>
  );
}

function MiniTimelineIcon({ state }: { state: string }) {
  if (state === 'completed') {
    return <CheckCircle2 className="h-4 w-4" />;
  }

  if (state === 'paused') {
    return <Clock3 className="h-4 w-4" />;
  }

  if (state === 'overdue') {
    return <AlertCircle className="h-4 w-4" />;
  }

  return <Circle className="h-4 w-4" />;
}

function ClientMiniTimeline({ project }: { project: Project }) {
  const summary = getTimelineSummary(project);
  const milestones = getTimelineMilestones(project);

  return (
    <div className="rounded-md border border-border bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold">Production Timeline</p>
          <h3 className="mt-1 font-display text-lg font-semibold text-ink">{summary.stage}</h3>
          <p className="mt-1 text-sm text-muted">{summary.nextMilestone}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <TimelineBadge project={project} />
          <span className="inline-flex min-h-7 items-center rounded-full border border-border bg-ivory px-2.5 text-xs font-semibold text-muted">
            {summary.progress}% complete
          </span>
        </div>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-ivory">
        <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${summary.progress}%` }} />
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {milestones.map((milestone) => (
          <div
            key={milestone.key}
            className={cn(
              'grid min-w-32 gap-1 rounded-md border px-3 py-2 text-xs',
              milestone.state === 'completed' && 'border-green-200 bg-green-50 text-success',
              milestone.state === 'current' && 'border-blue-200 bg-blue-50 text-blue-800',
              milestone.state === 'paused' && 'border-amber-200 bg-amber-50 text-amber-800',
              milestone.state === 'overdue' && 'border-red-200 bg-red-50 text-danger',
              milestone.state === 'future' && 'border-border bg-ivory text-muted',
            )}
          >
            <span className="flex items-center gap-1.5 font-semibold">
              <MiniTimelineIcon state={milestone.state} />
              {milestone.label}
            </span>
            <span>{milestone.date ? formatDate(milestone.date) : 'Pending'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectQuickActions({
  project,
  onRequestRevision,
  onApproveMilestone,
  compact = false,
}: {
  project: Project;
  onRequestRevision: (projectId: string) => void;
  onApproveMilestone: (project: Project, milestone: ApprovalMilestone) => Promise<void>;
  compact?: boolean;
}) {
  const summary = getTimelineSummary(project);
  const milestone = approvalMilestoneForStage(summary.stage);

  // Only show approval actions when client is waiting (PAUSED_CLIENT_REVIEW), not during revision
  const isApprovalPending = milestone !== null && summary.waitingOn === 'Client';

  return (
    <div className={cn('flex flex-wrap gap-2', compact && 'grid')}>
      {isApprovalPending ? (
        <Button type="button" className={compact ? 'w-full justify-center' : undefined} onClick={() => onApproveMilestone(project, milestone!)}>
          <CheckCircle2 className="h-4 w-4" />
          {approvalLabel(milestone!)}
        </Button>
      ) : null}
      {/* Always show Request Revision during an approval stage */}
      {milestone !== null ? (
        <Button
          type="button"
          variant={isApprovalPending ? 'secondary' : 'primary'}
          className={compact ? 'w-full justify-center' : undefined}
          onClick={() => onRequestRevision(project.id)}
        >
          <Plus className="h-4 w-4" />
          {revisionLabel(milestone)}
        </Button>
      ) : null}
    </div>
  );
}

function ClientProjectCard({
  project,
  projectRequests,
  onRequestRevision,
  onApproveMilestone,
  onSelectProject,
}: {
  project: Project;
  projectRequests: RevisionRequest[];
  onRequestRevision: (projectId: string) => void;
  onApproveMilestone: (project: Project, milestone: ApprovalMilestone) => Promise<void>;
  onSelectProject?: (project: Project) => void;
}) {
  const summary = getTimelineSummary(project);
  void projectRequests;

  return (
    <Card className="overflow-hidden p-5 transition hover:border-gold/60 hover:shadow-md flex flex-col justify-between space-y-4">
      <div>
        {/* Top Badges & Actions */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-ivory px-2.5 py-1 text-xs font-bold uppercase tracking-[0.14em] text-gold border border-gold/30">
              {project.project_number}
            </span>
            <StatusBadge status={project.status} />
          </div>
          <ProjectQuickActions project={project} onRequestRevision={onRequestRevision} onApproveMilestone={onApproveMilestone} />
        </div>

        {/* Project Title & Service */}
        <div className="mt-3">
          <h2
            className={cn(
              'font-display text-2xl font-semibold leading-tight text-ink',
              onSelectProject && 'cursor-pointer hover:text-gold transition',
            )}
            onClick={() => onSelectProject?.(project)}
          >
            {project.project_title}
          </h2>
          <p className="mt-1 text-sm font-medium text-muted">{project.service_type}</p>
        </div>

        {/* Action Required Banner */}
        {summary.clientActionRequired ? (
          <div className="mt-3 rounded-md border border-gold/60 bg-[#fff8e8] px-3 py-2 text-xs font-semibold text-ink flex items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-gold" />
            <span>Your action: {summary.clientActionRequired}</span>
          </div>
        ) : null}

        {/* Basic Info Row */}
        <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-border bg-ivory/60 p-3">
          <div>
            <span className="text-[11px] uppercase tracking-wider font-semibold text-muted block">Next Delivery / Due</span>
            <p className="mt-0.5 text-sm font-semibold text-ink flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5 text-gold shrink-0" />
              {summary.dueDate ? formatDate(summary.dueDate) : formatDate(project.due_date)}
            </p>
          </div>
          <div>
            <span className="text-[11px] uppercase tracking-wider font-semibold text-muted block">Waiting On</span>
            <p className={cn("mt-0.5 text-sm font-semibold", summary.waitingOn === 'Client' ? 'text-amber-800' : 'text-ink')}>
              {summary.waitingOn}
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-3 space-y-1">
          <div className="flex justify-between text-xs font-semibold">
            <span className="text-muted">Progress</span>
            <span className="text-gold font-bold">{summary.progress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
            <div className="h-full bg-gold transition-all duration-300" style={{ width: `${summary.progress}%` }} />
          </div>
        </div>
      </div>

      {/* Footer / View Details */}
      {onSelectProject ? (
        <div className="pt-2 border-t border-border flex items-center justify-between">
          <span className="text-xs text-muted font-medium">Click for files, notes & timeline</span>
          <button
            type="button"
            onClick={() => onSelectProject(project)}
            className="text-xs font-bold uppercase tracking-wider text-gold hover:underline flex items-center gap-1"
          >
            View Details →
          </button>
        </div>
      ) : null}
    </Card>
  );
}

function AttentionPanel({
  projects,
  onRequestRevision,
  onApproveMilestone,
}: {
  projects: Project[];
  onRequestRevision: (projectId: string) => void;
  onApproveMilestone: (project: Project, milestone: ApprovalMilestone) => Promise<void>;
}) {
  if (!projects.length) {
    return (
      <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted">
        No client action is pending right now.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {projects.slice(0, 4).map((project) => {
        const summary = getTimelineSummary(project);

        return (
          <div key={project.id} className="rounded-md border border-border bg-ivory p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold">{project.project_number}</p>
                <p className="mt-1 font-semibold leading-snug text-ink">{project.project_title}</p>
                <p className="mt-1 text-sm text-muted">{summary.clientActionRequired || summary.nextMilestone}</p>
              </div>
              <TimelineBadge project={project} />
            </div>
            <div className="mt-3">
              <ProjectQuickActions
                project={project}
                onRequestRevision={onRequestRevision}
                onApproveMilestone={onApproveMilestone}
                compact
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ClientPortalPage({
  projects,
  revisionRequests,
  revisionItems,
  revisionAttachments,
  notifications,
  onCreateRevisionRequest,
  onRespondToRevision,
  onApproveMilestone,
  onSelectProject,
}: {
  projects: Project[];
  revisionRequests: RevisionRequest[];
  revisionItems: RevisionItem[];
  revisionAttachments: RevisionAttachment[];
  notifications: NotificationItem[];
  onCreateRevisionRequest: (draft: RevisionRequestDraft) => Promise<void>;
  onRespondToRevision: (requestId: string, decision: Extract<ClientRevisionStatus, 'Approved'>) => Promise<void>;
  onApproveMilestone: (projectId: string, milestone: ApprovalMilestone) => Promise<void>;
  onSelectProject?: (project: Project) => void;
}) {
  const [revisionProjectId, setRevisionProjectId] = useState<string | null>(null);
  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [projects],
  );
  const activeProjects = sortedProjects.filter(isActiveOrder);
  const openRequests = revisionRequests.filter((request) => !closedRevisionStatuses.includes(request.status));
  const completedProjects = projects.filter((project) => project.status === 'Delivered' || project.status === 'Completed');
  const unreadCount = notifications.filter((item) => !item.is_read).length;
  const latestNotifications = notifications.slice(0, 5);
  const nextDueProject = [...activeProjects]
    .filter((project) => project.due_date)
    .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())[0];

  const requestsByProject = useMemo(() => {
    return revisionRequests.reduce<Record<string, RevisionRequest[]>>((groups, request) => {
      groups[request.project_id] = [...(groups[request.project_id] || []), request];
      return groups;
    }, {});
  }, [revisionRequests]);

  const attentionProjects = useMemo(
    () =>
      activeProjects.filter((project) => {
        const summary = getTimelineSummary(project);
        return summary.waitingOn === 'Client' || Boolean(summary.clientActionRequired);
      }),
    [activeProjects],
  );

  const revisionHistory = useMemo(
    () => [...revisionRequests].sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()),
    [revisionRequests],
  );

  async function approveRevision(requestId: string) {
    const confirmed = window.confirm('Approve this revised proof and mark it ready to complete?');

    if (confirmed) {
      await onRespondToRevision(requestId, 'Approved');
    }
  }

  async function approveMilestone(project: Project, milestone: ApprovalMilestone) {
    const label =
      milestone === 'concept' ? 'design concept' : milestone === 'print' ? 'complete print version' : 'eBook version';
    const confirmed = window.confirm(`Approve the ${label} for "${project.project_title}"?`);

    if (confirmed) {
      await onApproveMilestone(project.id, milestone);
    }
  }

  if (!projects.length) {
    return (
      <EmptyState
        title="No client projects"
        message="Your project portal will show active projects after Manuscript Heaven grants access."
      />
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-ivory px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-gold">
                <FolderOpen className="h-3.5 w-3.5" />
                Client Portal
              </div>
              <h2 className="font-display text-3xl font-semibold text-ink">Project Dashboard</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                Review active work, approve proof stages, open shared files, and send revision notes from one place.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[420px]">
              <ClientStat label="Active" value={activeProjects.length} icon={FolderOpen} />
              <ClientStat label="Revisions" value={openRequests.length} icon={Repeat2} />
              <ClientStat label="Unread" value={unreadCount} icon={Bell} />
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-2">
            <Clock3 className="h-5 w-5 text-gold" />
            <h2 className="font-display text-xl font-semibold">Next Due</h2>
          </div>
          {nextDueProject ? (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={nextDueProject.status} />
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-gold">
                  {nextDueProject.project_number}
                </span>
              </div>
              <p
                className={cn(
                  'font-display text-2xl font-semibold leading-tight',
                  onSelectProject && 'cursor-pointer hover:text-gold transition',
                )}
                onClick={() => onSelectProject?.(nextDueProject)}
              >
                {nextDueProject.project_title}
              </p>
              <p className="flex items-center gap-2 text-sm font-semibold text-muted">
                <CalendarDays className="h-4 w-4" />
                Due {formatDate(nextDueProject.due_date)}
              </p>
            </div>
          ) : (
            <p className="mt-4 rounded-md border border-dashed border-border p-4 text-sm text-muted">
              No active project deadline yet.
            </p>
          )}
        </Card>
      </section>

      <section className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-display text-2xl font-semibold">Active Projects</h2>
              <p className="mt-1 text-sm text-muted">
                {completedProjects.length} delivered project{completedProjects.length === 1 ? '' : 's'} are available in Projects.
              </p>
            </div>
            <p className="inline-flex items-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-sm font-semibold text-muted">
              <ListChecks className="h-4 w-4 text-gold" />
              {attentionProjects.length} need attention
            </p>
          </div>

          {activeProjects.length ? (
            <div className="grid gap-4 2xl:grid-cols-2">
              {activeProjects.map((project) => (
                <ClientProjectCard
                  key={project.id}
                  project={project}
                  projectRequests={requestsByProject[project.id] || []}
                  onRequestRevision={setRevisionProjectId}
                  onApproveMilestone={approveMilestone}
                  onSelectProject={onSelectProject}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No active orders"
              message="Completed, cancelled, archived, or inactive projects are available in the Projects tab."
            />
          )}
        </div>

        <aside className="space-y-4 2xl:sticky 2xl:top-4 2xl:self-start">
          <Card>
            <div className="mb-4 flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-gold" />
              <h2 className="font-display text-xl font-semibold">Needs Your Attention</h2>
            </div>
            <AttentionPanel projects={attentionProjects} onRequestRevision={setRevisionProjectId} onApproveMilestone={approveMilestone} />
          </Card>

          <Card>
            <div className="mb-4 flex items-center gap-2">
              <Bell className="h-5 w-5 text-gold" />
              <h2 className="font-display text-xl font-semibold">Notifications</h2>
            </div>
            <div className="space-y-3">
              {latestNotifications.length ? (
                latestNotifications.map((notification) => (
                  <div key={notification.id} className="rounded-md border border-border bg-ivory p-3">
                    <p className="font-semibold">{notification.title}</p>
                    <p className="mt-1 text-sm leading-5 text-muted">{notification.message}</p>
                  </div>
                ))
              ) : (
                <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted">
                  No notifications yet.
                </p>
              )}
            </div>
          </Card>
        </aside>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-gold" />
          <h2 className="font-display text-2xl font-semibold">Revision History</h2>
        </div>
        {revisionHistory.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {revisionHistory.map((request) => {
              const project = projects.find((item) => item.id === request.project_id);
              const items = revisionItems.filter((item) => item.revision_request_id === request.id);
              const attachments = revisionAttachments.filter((attachment) => attachment.revision_request_id === request.id);
              const clientAttachments = attachments.filter((attachment) => attachment.file_type !== 'revised_proof');
              const revisedProofs = attachments.filter((attachment) => attachment.file_type === 'revised_proof');
              const teamResponses = [
                request.team_response,
                ...items.map((item) => item.team_response),
              ].filter((response): response is string => Boolean(response));

              return (
                <Card key={request.id}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gold">{project?.project_title || 'Project'}</p>
                      <h3 className="font-display text-xl font-semibold">Revision Request</h3>
                      <p className="mt-1 text-sm text-muted">
                        {request.status} | Submitted {formatDate(request.submitted_at.slice(0, 10))}
                      </p>
                    </div>
                    {request.status === 'Ready for Client Review' ? (
                      <Button type="button" onClick={() => approveRevision(request.id)}>
                        <CheckCircle2 className="h-4 w-4" />
                        Approve
                      </Button>
                    ) : null}
                  </div>

                  <div className="mt-4 rounded-md border border-border bg-ivory p-4">
                    <p className="mb-2 font-semibold">Revision instructions</p>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-charcoal">{revisionText(request)}</p>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="rounded-md border border-border bg-white p-4">
                      <p className="mb-2 font-semibold">Uploaded attachments</p>
                      {clientAttachments.length ? (
                        <div className="space-y-1">
                          {clientAttachments.map((attachment) => (
                            <p key={attachment.id} className="break-all text-sm text-muted">
                              {fileLabel(attachment)}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted">No client attachments uploaded.</p>
                      )}
                    </div>

                    <div className="rounded-md border border-border bg-white p-4">
                      <p className="mb-2 font-semibold">Revised proof files</p>
                      {revisedProofs.length ? (
                        <div className="space-y-1">
                          {revisedProofs.map((attachment) => (
                            <p key={attachment.id} className="break-all text-sm text-muted">
                              {fileLabel(attachment)}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted">No revised proof has been uploaded yet.</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 rounded-md border border-border bg-white p-4">
                    <p className="mb-2 font-semibold">Team response</p>
                    {teamResponses.length ? (
                      <div className="space-y-2">
                        {teamResponses.map((response, index) => (
                          <p key={`${request.id}-${index}`} className="rounded-md bg-ivory p-3 text-sm leading-6 text-muted">
                            {response}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted">The team has not added a response yet.</p>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="No revision requests"
            message="Use Request Revision on an active order when you need changes to a proof or preview."
          />
        )}
      </section>

      {revisionProjectId ? (
        <RevisionRequestModal
          projects={activeProjects}
          initialProjectId={revisionProjectId}
          onClose={() => setRevisionProjectId(null)}
          onSubmit={onCreateRevisionRequest}
        />
      ) : null}
    </div>
  );
}
