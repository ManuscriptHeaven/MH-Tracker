import { Bell, CheckCircle2, FileText, Plus, Repeat2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { StatusBadge } from '../components/Badges';
import { RevisionRequestModal } from '../components/RevisionRequestModal';
import { Button, Card, EmptyState } from '../components/ui';
import { activeClientProjectStatuses } from '../lib/constants';
import { formatDate } from '../lib/date';
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

function revisionText(request: RevisionRequest) {
  return request.instructions || request.description || request.title;
}

function isActiveOrder(project: Project) {
  return activeClientProjectStatuses.includes(project.status);
}

function fileLabel(attachment: RevisionAttachment) {
  if (attachment.file_type === 'revised_proof') {
    return `Revised proof: ${attachment.file_name}`;
  }

  return attachment.file_name;
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
  onRespondToRevision: (requestId: string, decision: Extract<ClientRevisionStatus, 'Approved'>) => Promise<void>;
}) {
  const [revisionProjectId, setRevisionProjectId] = useState<string | null>(null);
  const activeProjects = projects.filter(isActiveOrder);
  const openRequests = revisionRequests.filter((request) => !closedRevisionStatuses.includes(request.status));
  const latestNotifications = notifications.slice(0, 5);

  const requestsByProject = useMemo(() => {
    return revisionRequests.reduce<Record<string, RevisionRequest[]>>((groups, request) => {
      groups[request.project_id] = [...(groups[request.project_id] || []), request];
      return groups;
    }, {});
  }, [revisionRequests]);

  async function approveRevision(requestId: string) {
    const confirmed = window.confirm('Approve this revised proof and mark it ready to complete?');

    if (confirmed) {
      await onRespondToRevision(requestId, 'Approved');
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
          <p className="text-sm font-medium text-muted">Active Orders</p>
          <p className="mt-3 text-3xl font-bold">{activeProjects.length}</p>
        </Card>
        <Card className="min-h-28">
          <p className="text-sm font-medium text-muted">Open Revisions</p>
          <p className="mt-3 text-3xl font-bold">{openRequests.length}</p>
        </Card>
        <Card className="min-h-28">
          <p className="text-sm font-medium text-muted">Unread Notifications</p>
          <p className="mt-3 text-3xl font-bold">{notifications.filter((item) => !item.is_read).length}</p>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.35fr_0.75fr]">
        <div className="space-y-4">
          {activeProjects.length ? (
            activeProjects.map((project) => {
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
                          Open shared proof
                        </a>
                      ) : (
                        <p className="text-sm text-muted">No proof file has been shared yet.</p>
                      )}
                    </div>

                    <div className="rounded-md border border-border bg-ivory p-4">
                      <div className="mb-2 flex items-center gap-2 font-semibold">
                        <Repeat2 className="h-4 w-4 text-gold" />
                        Recent Revisions
                      </div>
                      {projectRequests.length ? (
                        <div className="space-y-2">
                          {projectRequests.slice(0, 3).map((request) => (
                            <div key={request.id} className="text-sm">
                              <p className="line-clamp-2 font-semibold">{revisionText(request)}</p>
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
            })
          ) : (
            <EmptyState
              title="No active orders"
              message="Completed, cancelled, archived, or inactive projects are available in the Projects tab."
            />
          )}
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
        <h2 className="font-display text-2xl font-semibold">Revision History</h2>
        {revisionRequests.length ? (
          revisionRequests.map((request) => {
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

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
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
          })
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
