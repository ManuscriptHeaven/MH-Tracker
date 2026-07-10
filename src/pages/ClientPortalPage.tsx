import { Bell, CheckCircle2, FileText, Plus, Repeat2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { StatusBadge } from '../components/Badges';
import { RevisionRequestModal } from '../components/RevisionRequestModal';
import { Button, Card, EmptyState } from '../components/ui';
import { formatDate } from '../lib/date';
import { cn } from '../lib/utils';
import type {
  ClientRevisionStatus,
  NotificationItem,
  Project,
  RevisionAttachment,
  RevisionItem,
  RevisionRequest,
  RevisionRequestDraft,
} from '../lib/types';

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

function completedLabel(items: RevisionItem[]) {
  const completed = items.filter((item) => item.status === 'Completed').length;
  return `${completed} of ${items.length} revision point${items.length === 1 ? '' : 's'} completed`;
}

export function ClientPortalPage({
  projects,
  revisionRequests,
  revisionItems,
  revisionAttachments,
  notifications,
  onCreateRevisionRequest,
  onRespondToRevision,
}: {
  projects: Project[];
  revisionRequests: RevisionRequest[];
  revisionItems: RevisionItem[];
  revisionAttachments: RevisionAttachment[];
  notifications: NotificationItem[];
  onCreateRevisionRequest: (draft: RevisionRequestDraft) => Promise<void>;
  onRespondToRevision: (
    requestId: string,
    decision: Extract<ClientRevisionStatus, 'Approved' | 'Additional Revision Required'>,
  ) => Promise<void>;
}) {
  const [revisionProjectId, setRevisionProjectId] = useState<string | null>(null);
  const activeProjects = projects.filter((project) => project.status !== 'Delivered' && project.status !== 'Cancelled');

  const openRequests = revisionRequests.filter((request) => !closedRevisionStatuses.includes(request.status));
  const latestNotifications = notifications.slice(0, 5);

  const requestsByProject = useMemo(() => {
    return revisionRequests.reduce<Record<string, RevisionRequest[]>>((groups, request) => {
      groups[request.project_id] = [...(groups[request.project_id] || []), request];
      return groups;
    }, {});
  }, [revisionRequests]);

  async function respond(requestId: string, decision: Extract<ClientRevisionStatus, 'Approved' | 'Additional Revision Required'>) {
    const confirmed = window.confirm(
      decision === 'Approved'
        ? 'Approve this revision and mark it ready to complete?'
        : 'Send this revision back for additional changes?',
    );

    if (confirmed) {
      await onRespondToRevision(requestId, decision);
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
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-3">
        <Card className="min-h-28">
          <p className="text-sm font-medium text-muted">Active Projects</p>
          <p className="mt-3 text-3xl font-bold">{activeProjects.length}</p>
        </Card>
        <Card className="min-h-28">
          <p className="text-sm font-medium text-muted">Open Revisions</p>
          <p className="mt-3 text-3xl font-bold">{openRequests.length}</p>
        </Card>
        <Card className="min-h-28">
          <p className="text-sm font-medium text-muted">Notifications</p>
          <p className="mt-3 text-3xl font-bold">{notifications.filter((item) => !item.is_read).length}</p>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.35fr_0.75fr]">
        <div className="space-y-4">
          {projects.map((project) => {
            const projectRequests = requestsByProject[project.id] || [];
            const projectOpenRequests = projectRequests.filter((request) => !closedRevisionStatuses.includes(request.status));
            const proof = latestProof(project);

            return (
              <Card key={project.id}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-gold">
                        {project.project_number}
                      </span>
                      <StatusBadge status={project.status} />
                    </div>
                    <h2 className="mt-3 font-display text-2xl font-semibold">{project.project_title}</h2>
                    <p className="mt-1 text-sm text-muted">Due {formatDate(project.due_date)}</p>
                    <p className="mt-2 text-sm font-medium text-muted">
                      {projectOpenRequests.length} open revision request{projectOpenRequests.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <Button type="button" onClick={() => setRevisionProjectId(project.id)}>
                    <Plus className="h-4 w-4" />
                    Request Revision
                  </Button>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border border-border bg-ivory p-4">
                    <div className="mb-2 flex items-center gap-2 font-semibold">
                      <FileText className="h-4 w-4 text-gold" />
                      Latest Proof
                    </div>
                    {proof ? (
                      <a href={proof} target="_blank" rel="noreferrer" className="break-all text-sm font-semibold text-info">
                        {proof}
                      </a>
                    ) : (
                      <p className="text-sm text-muted">No proof file has been shared yet.</p>
                    )}
                  </div>

                  <div className="rounded-md border border-border bg-ivory p-4">
                    <div className="mb-2 flex items-center gap-2 font-semibold">
                      <Repeat2 className="h-4 w-4 text-gold" />
                      Revision History
                    </div>
                    {projectRequests.length ? (
                      <div className="space-y-2">
                        {projectRequests.slice(0, 3).map((request) => (
                          <div key={request.id} className="text-sm">
                            <p className="font-semibold">{request.title}</p>
                            <p className="text-muted">{request.status}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted">No revision requests yet.</p>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        <aside className="space-y-4">
          <Card>
            <div className="mb-4 flex items-center gap-2">
              <Bell className="h-5 w-5 text-gold" />
              <h2 className="font-display text-xl font-semibold">Notifications</h2>
            </div>
            <div className="space-y-3">
              {latestNotifications.length ? (
                latestNotifications.map((notification) => (
                  <div key={notification.id} className="rounded-md border border-border bg-white p-3">
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
        <h2 className="font-display text-2xl font-semibold">Revision Requests</h2>
        {revisionRequests.length ? (
          revisionRequests.map((request) => {
            const project = projects.find((item) => item.id === request.project_id);
            const items = revisionItems.filter((item) => item.revision_request_id === request.id);
            const attachments = revisionAttachments.filter((attachment) => attachment.revision_request_id === request.id);
            const progress = items.length ? (items.filter((item) => item.status === 'Completed').length / items.length) * 100 : 0;

            return (
              <Card key={request.id}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gold">{project?.project_title || 'Project'}</p>
                    <h3 className="font-display text-xl font-semibold">{request.title}</h3>
                    <p className="mt-1 text-sm text-muted">
                      {request.status} | {request.priority} | Submitted {formatDate(request.submitted_at.slice(0, 10))}
                    </p>
                  </div>
                  {request.status === 'Ready for Client Review' ? (
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="secondary" onClick={() => respond(request.id, 'Additional Revision Required')}>
                        Additional Revision
                      </Button>
                      <Button type="button" onClick={() => respond(request.id, 'Approved')}>
                        <CheckCircle2 className="h-4 w-4" />
                        Approve
                      </Button>
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 h-2 overflow-hidden rounded-full bg-ivory">
                  <div className="h-full rounded-full bg-gold" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-2 text-sm font-semibold text-muted">{completedLabel(items)}</p>

                <div className="mt-4 grid gap-3">
                  {items.map((item, index) => (
                    <div
                      key={item.id}
                      className={cn(
                        'rounded-md border p-4',
                        item.status === 'Completed' ? 'border-green-200 bg-green-50' : 'border-border bg-white',
                      )}
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">
                          {index + 1}. {item.page_reference || 'Revision point'}
                        </p>
                        <span className="rounded-full bg-ivory px-2 py-1 text-xs font-semibold text-muted">
                          {item.status}
                        </span>
                      </div>
                      <p className="text-sm leading-6 text-charcoal">{item.instruction}</p>
                      {item.team_response ? (
                        <p className="mt-3 rounded-md bg-ivory p-3 text-sm leading-6 text-muted">
                          {item.team_response}
                        </p>
                      ) : null}
                      {item.client_attachment_url ? (
                        <p className="mt-2 break-all text-xs text-muted">Attachment: {item.client_attachment_url}</p>
                      ) : null}
                    </div>
                  ))}
                </div>

                {attachments.length ? (
                  <div className="mt-4 rounded-md border border-border bg-ivory p-4">
                    <p className="mb-2 font-semibold">Files</p>
                    <div className="space-y-1">
                      {attachments.map((attachment) => (
                        <p key={attachment.id} className="break-all text-sm text-muted">
                          {attachment.file_name}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}
              </Card>
            );
          })
        ) : (
          <EmptyState
            title="No revision requests"
            message="Use Request Revision on a project when you need changes to a proof or preview."
          />
        )}
      </section>

      {revisionProjectId ? (
        <RevisionRequestModal
          projects={projects}
          initialProjectId={revisionProjectId}
          onClose={() => setRevisionProjectId(null)}
          onSubmit={onCreateRevisionRequest}
        />
      ) : null}
    </div>
  );
}
