import { UploadCloud } from 'lucide-react';
import { useMemo, useState } from 'react';
import { clientRevisionStatuses, revisionItemStatuses } from '../lib/constants';
import { formatDate } from '../lib/date';
import { firstName, isClientRole } from '../lib/utils';
import type {
  Profile,
  Project,
  RevisionActivity,
  RevisionAttachment,
  RevisionItem,
  RevisionRequest,
} from '../lib/types';
import { Button, Card, EmptyState, Field, SelectField, TextareaField } from '../components/ui';

function profileName(profiles: Profile[], id?: string | null) {
  const profile = profiles.find((item) => item.id === id);
  return profile ? firstName(profile.full_name) : 'Unassigned';
}

function projectName(projects: Project[], id: string) {
  return projects.find((project) => project.id === id)?.project_title || 'Project';
}

function RevisionItemEditor({
  item,
  onUpdate,
}: {
  item: RevisionItem;
  onUpdate: (itemId: string, updates: Partial<RevisionItem>) => Promise<void>;
}) {
  const [status, setStatus] = useState(item.status);
  const [teamResponse, setTeamResponse] = useState(item.team_response || '');
  const [internalNote, setInternalNote] = useState(item.internal_note || '');
  const [isSaving, setIsSaving] = useState(false);

  async function save() {
    setIsSaving(true);
    try {
      await onUpdate(item.id, {
        status,
        team_response: teamResponse,
        internal_note: internalNote,
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="rounded-md border border-border bg-white p-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-semibold">{item.page_reference || 'Revision point'}</p>
          <p className="mt-1 text-sm leading-6 text-charcoal">{item.instruction}</p>
          {item.client_attachment_url ? (
            <p className="mt-2 break-all text-xs text-muted">Client attachment: {item.client_attachment_url}</p>
          ) : null}
        </div>
        <SelectField
          label="Point status"
          value={status}
          onChange={(event) => setStatus(event.target.value as RevisionItem['status'])}
          className="sm:w-52"
        >
          {revisionItemStatuses.map((itemStatus) => (
            <option key={itemStatus}>{itemStatus}</option>
          ))}
        </SelectField>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <TextareaField
          label="Client-visible response"
          value={teamResponse}
          onChange={(event) => setTeamResponse(event.target.value)}
        />
        <TextareaField
          label="Internal note"
          value={internalNote}
          onChange={(event) => setInternalNote(event.target.value)}
        />
      </div>
      <div className="mt-3 flex justify-end">
        <Button type="button" variant="secondary" onClick={save} disabled={isSaving}>
          {isSaving ? 'Saving' : 'Save Point'}
        </Button>
      </div>
    </div>
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
}) {
  const [uploadingRequestId, setUploadingRequestId] = useState<string | null>(null);
  const teamMembers = profiles.filter((profile) => !isClientRole(profile.role));
  const visibleRequests = canManageAll
    ? revisionRequests
    : revisionRequests.filter((request) => request.assigned_to === currentProfile.id);

  const requestsWithProjects = useMemo(
    () =>
      visibleRequests.filter((request) =>
        projects.some((project) => project.id === request.project_id) || canManageAll,
      ),
    [canManageAll, projects, visibleRequests],
  );

  async function handleProofUpload(requestId: string, file?: File) {
    if (!file) {
      return;
    }

    setUploadingRequestId(requestId);
    try {
      await onUploadRevisedProof(requestId, file);
    } finally {
      setUploadingRequestId(null);
    }
  }

  if (!requestsWithProjects.length) {
    return (
      <EmptyState
        title="No client revision requests"
        message="Client revision requests will appear here after submission or assignment."
      />
    );
  }

  return (
    <div className="space-y-5">
      {requestsWithProjects.map((request) => {
        const items = revisionItems.filter((item) => item.revision_request_id === request.id);
        const attachments = revisionAttachments.filter((attachment) => attachment.revision_request_id === request.id);
        const activity = revisionActivity.filter((item) => item.revision_request_id === request.id);
        const completed = items.filter((item) => item.status === 'Completed').length;

        return (
          <Card key={request.id}>
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <p className="text-sm font-semibold text-gold">{projectName(projects, request.project_id)}</p>
                <h2 className="font-display text-2xl font-semibold">{request.title}</h2>
                <p className="mt-1 text-sm text-muted">
                  Client: {profileName(profiles, request.client_id)} | Priority: {request.priority} | Submitted{' '}
                  {formatDate(request.submitted_at.slice(0, 10))}
                </p>
                {request.description ? (
                  <p className="mt-3 rounded-md bg-ivory p-3 text-sm leading-6 text-charcoal">{request.description}</p>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:w-[34rem]">
                <SelectField
                  label="Workflow status"
                  value={request.status}
                  onChange={(event) =>
                    onUpdateRequest(request.id, { status: event.target.value as RevisionRequest['status'] })
                  }
                >
                  {clientRevisionStatuses.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </SelectField>
                <SelectField
                  label="Assign to"
                  value={request.assigned_to || ''}
                  onChange={(event) =>
                    onUpdateRequest(request.id, {
                      assigned_to: event.target.value || null,
                      status: event.target.value ? 'Assigned' : request.status,
                    })
                  }
                  disabled={!canManageAll}
                >
                  <option value="">Unassigned</option>
                  {teamMembers.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {firstName(profile.full_name)}
                    </option>
                  ))}
                </SelectField>
              </div>
            </div>

            <div className="mt-4 h-2 overflow-hidden rounded-full bg-ivory">
              <div className="h-full rounded-full bg-gold" style={{ width: `${items.length ? (completed / items.length) * 100 : 0}%` }} />
            </div>
            <p className="mt-2 text-sm font-semibold text-muted">
              {completed} of {items.length} revision point{items.length === 1 ? '' : 's'} completed
            </p>

            <div className="mt-5 space-y-3">
              {items.map((item) => (
                <RevisionItemEditor key={item.id} item={item} onUpdate={onUpdateItem} />
              ))}
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-md border border-border bg-ivory p-4">
                <p className="mb-3 font-semibold">Files</p>
                <div className="space-y-2">
                  {attachments.length ? (
                    attachments.map((attachment) => (
                      <p key={attachment.id} className="break-all text-sm text-muted">
                        {attachment.file_name} | {attachment.file_type}
                      </p>
                    ))
                  ) : (
                    <p className="text-sm text-muted">No files uploaded yet.</p>
                  )}
                </div>
                <label className="mt-4 grid gap-2 text-sm font-medium">
                  <span>Upload revised proof</span>
                  <input
                    type="file"
                    onChange={(event) => handleProofUpload(request.id, event.target.files?.[0])}
                    className="rounded-md border border-border bg-white px-3 py-2 text-sm"
                  />
                </label>
                {uploadingRequestId === request.id ? (
                  <p className="mt-2 text-sm font-semibold text-muted">
                    <UploadCloud className="mr-1 inline h-4 w-4" />
                    Uploading
                  </p>
                ) : null}
              </div>

              <div className="rounded-md border border-border bg-ivory p-4">
                <p className="mb-3 font-semibold">Activity</p>
                <div className="space-y-3">
                  {activity.length ? (
                    activity.slice(0, 5).map((entry) => (
                      <div key={entry.id} className="text-sm">
                        <p className="font-semibold">{entry.action}</p>
                        <p className="text-muted">
                          {entry.previous_value ? `${entry.previous_value} -> ` : ''}
                          {entry.new_value || 'Updated'} by {profileName(profiles, entry.user_id)}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted">No activity yet.</p>
                  )}
                </div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
