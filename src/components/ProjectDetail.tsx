import { CheckCircle2, Edit, FileText, Plus, Printer, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { RevisionRequestsPage } from '../pages/RevisionRequestsPage';
import { isProjectStatus, projectStatusChoices, revisionStatuses } from '../lib/constants';
import { deadlineClass, deadlineLabel, formatDate, todayInput } from '../lib/date';
import { currency, firstName, initials } from '../lib/utils';
import type {
  ActivityLog,
  NoteType,
  Profile,
  Project,
  ProjectNote,
  RevisionActivity,
  RevisionAttachment,
  RevisionItem,
  ProjectStatus,
  RevisionNote,
  RevisionRequest,
  RevisionStatus,
} from '../lib/types';
import { PaymentBadge, PriorityBadge, RoleBadge, StatusBadge } from './Badges';
import { Button, Card, Field, Modal, SelectField, TextareaField } from './ui';

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

function LinkRow({ label, value }: { label: string; value: string }) {
  if (!value) {
    return null;
  }

  return (
    <a
      href={value}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between gap-3 rounded-md border border-border bg-white px-3 py-2 text-sm transition hover:border-gold"
    >
      <span className="font-medium">{label}</span>
      <span className="truncate text-muted">{value}</span>
    </a>
  );
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
}) {
  const [status, setStatus] = useState<string>(project.status);
  const [noteType, setNoteType] = useState<NoteType>('work');
  const [note, setNote] = useState('');
  const [revisionNote, setRevisionNote] = useState('');
  const [revisionStatus, setRevisionStatus] = useState<RevisionStatus>('Pending');

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

  async function saveStatus() {
    if (!isProjectStatus(status)) {
      window.alert('Please choose a project status from the suggestions.');
      setStatus(project.status);
      return;
    }

    await onUpdateProject({
      status,
      delivery_date: status === 'Delivered' ? todayInput() : project.delivery_date,
    });
  }

  async function markDelivered() {
    setStatus('Delivered');
    await onUpdateProject({
      status: 'Delivered',
      delivery_date: todayInput(),
    });
  }

  async function submitNote() {
    if (!note.trim()) {
      return;
    }

    await onAddNote(noteType, note.trim());
    setNote('');
  }

  async function submitRevision() {
    if (!revisionNote.trim()) {
      return;
    }

    await onAddRevision(revisionNote.trim(), revisionStatus);
    setRevisionNote('');
    setRevisionStatus('Pending');
  }

  return (
    <Modal title="Project Details" onClose={onClose} width="max-w-6xl">
      <div className="space-y-5">
        <Card>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">
                  {project.project_number}
                </span>
                <StatusBadge status={project.status} />
                <PriorityBadge priority={project.priority} />
              </div>
              <h2 className="mt-3 font-display text-3xl font-semibold text-ink">{project.project_title}</h2>
              <p className="mt-1 text-sm text-muted">
                {project.client_name} | {project.client_email || 'No client email'}
              </p>
              <p className={`mt-3 text-sm font-semibold ${deadlineClass(project)}`}>
                {deadlineLabel(project)} | Due {formatDate(project.due_date)}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => window.print()}>
                <Printer className="h-4 w-4" />
                Print
              </Button>
              {canManageAll ? (
                <Button variant="secondary" onClick={onEdit}>
                  <Edit className="h-4 w-4" />
                  Edit
                </Button>
              ) : null}
              <Button onClick={markDelivered}>
                <CheckCircle2 className="h-4 w-4" />
                Mark Delivered
              </Button>
              {currentProfile.role === 'admin' ? (
                <Button variant="danger" onClick={onDelete}>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              ) : null}
            </div>
          </div>
        </Card>

        <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-5">
            <Card>
              <h3 className="font-display text-xl font-semibold">Project Information</h3>
              <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                <Info label="Service" value={project.service_type} />
                <Info label="Platform" value={project.platform} />
                <Info label="Genre" value={project.genre || 'Not set'} />
                <Info label="Trim Size" value={project.trim_size || 'Not set'} />
                <Info label="Page Count" value={String(project.page_count || 0)} />
                <Info label="Word Count" value={String(project.word_count || 0)} />
                <Info label="Images" value={String(project.image_count || 0)} />
                <Info label="Internal Deadline" value={formatDate(project.internal_deadline)} />
                <Info label="Assigned To" value={profileName(profiles, project.assigned_to)} />
                <Info label="Project Manager" value={profileName(profiles, project.project_manager)} />
              </div>
            </Card>

            <Card>
              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <Field
                  label="Change Status"
                  list="project-detail-status-options"
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  className="md:w-72"
                />
                <datalist id="project-detail-status-options">
                  {projectStatusChoices(project.status).map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
                <Button onClick={saveStatus}>Save Status</Button>
              </div>
            </Card>

            <Card>
              <h3 className="font-display text-xl font-semibold">Files and Links</h3>
              <div className="mt-4 grid gap-2">
                <LinkRow label="Source File" value={project.source_file_link} />
                <LinkRow label="Drive Folder" value={project.drive_folder_link} />
                <LinkRow label="Client Brief" value={project.client_brief_link} />
                <LinkRow label="Proof PDF" value={project.proof_pdf_link} />
                <LinkRow label="Final Print PDF" value={project.final_print_pdf_link} />
                <LinkRow label="Final eBook" value={project.final_ebook_link} />
                <LinkRow label="Cover File" value={project.cover_file_link} />
                <LinkRow label="Other Links" value={project.other_links} />
                {!project.source_file_link &&
                !project.drive_folder_link &&
                !project.proof_pdf_link &&
                !project.final_print_pdf_link &&
                !project.final_ebook_link ? (
                  <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted">
                    No file links added yet.
                  </p>
                ) : null}
              </div>
            </Card>

            <Card>
              <h3 className="font-display text-xl font-semibold">Notes</h3>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <NoteBlock title="General Notes" value={project.general_notes} />
                <NoteBlock title="Internal Notes" value={project.internal_notes} />
                <NoteBlock title="Client Instructions" value={project.client_instructions} />
                <NoteBlock title="QA Notes" value={project.qa_notes} />
                <NoteBlock title="Delivery Notes" value={project.delivery_notes} />
              </div>

              <div className="mt-5 grid gap-3 rounded-lg border border-border bg-ivory p-4">
                <h4 className="font-semibold">Add Note</h4>
                <div className="grid gap-3 md:grid-cols-[220px_1fr_auto] md:items-end">
                  <SelectField
                    label="Note Type"
                    value={noteType}
                    onChange={(event) => setNoteType(event.target.value as NoteType)}
                  >
                    {noteTypes.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </SelectField>
                  <Field label="Note" value={note} onChange={(event) => setNote(event.target.value)} />
                  <Button type="button" onClick={submitNote}>
                    <Plus className="h-4 w-4" />
                    Add
                  </Button>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {projectNotes.map((item) => (
                  <div key={item.id} className="rounded-md border border-border bg-white p-3 text-sm">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="font-semibold capitalize">{item.note_type.replace('_', ' ')}</span>
                      <span className="text-muted">by {profileName(profiles, item.added_by)}</span>
                      <span className="text-muted">{new Date(item.created_at).toLocaleString()}</span>
                    </div>
                    <p className="leading-6 text-charcoal">{item.note}</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="space-y-5">
            {canManageAll ? (
              <Card>
                <h3 className="font-display text-xl font-semibold">Payment</h3>
                <div className="mt-4 grid gap-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Status</span>
                    <PaymentBadge status={project.payment_status} />
                  </div>
                  <Info label="Total Price" value={currency(project.total_price)} />
                  <Info label="Advance Paid" value={currency(project.advance_paid)} />
                  <Info label="Remaining Balance" value={currency(project.remaining_balance)} />
                  <Info label="Payment Date" value={formatDate(project.payment_date)} />
                  <div className="rounded-md bg-ivory px-3 py-2">
                    <p className="text-muted">Payment Notes</p>
                    <p className="mt-1 font-semibold">{project.payment_notes || 'No notes'}</p>
                  </div>
                </div>
              </Card>
            ) : null}

            <Card>
              <h3 className="font-display text-xl font-semibold">Assigned Team</h3>
              <div className="mt-4 space-y-3">
                {Array.from(new Set([project.assigned_to, project.project_manager].filter(Boolean))).map((id) => {
                  const profile = profiles.find((item) => item.id === id);
                  if (!profile) {
                    return null;
                  }

                  return (
                    <div key={profile.id} className="flex items-center gap-3 rounded-md border border-border p-3">
                      <div className="grid h-10 w-10 place-items-center rounded-full bg-gold/20 text-sm font-bold">
                        {initials(firstName(profile.full_name))}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{firstName(profile.full_name)}</p>
                        <p className="truncate text-xs text-muted">{profile.email}</p>
                      </div>
                      <RoleBadge role={profile.role} />
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card>
              <h3 className="font-display text-xl font-semibold">Internal Revision Notes</h3>
              <div className="mt-4 grid gap-3">
                <TextareaField
                  label="New Internal Revision Note"
                  value={revisionNote}
                  onChange={(event) => setRevisionNote(event.target.value)}
                />
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <SelectField
                    label="Revision Status"
                    value={revisionStatus}
                    onChange={(event) => setRevisionStatus(event.target.value as RevisionStatus)}
                    className="sm:w-56"
                  >
                    {revisionStatuses.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </SelectField>
                  <Button type="button" onClick={submitRevision}>
                    <Plus className="h-4 w-4" />
                    Add Revision
                  </Button>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {projectRevisions.length ? (
                  projectRevisions.map((revision) => (
                    <div key={revision.id} className="rounded-md border border-border bg-white p-3 text-sm">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="font-semibold">Revision {revision.revision_number}</span>
                        <span className="rounded-full bg-ivory px-2 py-1 text-xs font-semibold text-muted">
                          {revision.status}
                        </span>
                      </div>
                      <p className="leading-6 text-charcoal">{revision.note}</p>
                      <p className="mt-2 text-xs text-muted">
                        {profileName(profiles, revision.added_by)} |{' '}
                        {new Date(revision.created_at).toLocaleString()}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted">
                    No revision notes yet.
                  </p>
                )}
              </div>
            </Card>

            <Card>
              <h3 className="font-display text-xl font-semibold">Activity Timeline</h3>
              <div className="mt-4 space-y-3">
                {projectActivities.length ? (
                  projectActivities.map((activity) => (
                    <div key={activity.id} className="flex gap-3 text-sm">
                      <div className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gold/20">
                        <FileText className="h-3.5 w-3.5 text-gold" />
                      </div>
                      <div>
                        <p className="font-semibold">{activity.action}</p>
                        <p className="text-muted">
                          {activity.old_value ? `${activity.old_value} -> ` : ''}
                          {activity.new_value || 'Updated'} by {profileName(profiles, activity.user_id)}
                        </p>
                        <p className="text-xs text-muted">{new Date(activity.created_at).toLocaleString()}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted">
                    No activity yet.
                  </p>
                )}
              </div>
            </Card>
          </div>
        </div>

        <section className="space-y-4">
          <div>
            <h3 className="font-display text-2xl font-semibold">Client Revision Requests</h3>
            <p className="mt-1 text-sm text-muted">
              Revision requests submitted by the client for this project stay here with the project.
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
        </section>
      </div>
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md bg-ivory px-3 py-2">
      <span className="text-muted">{label}</span>
      <span className="text-right font-semibold">{value}</span>
    </div>
  );
}

function NoteBlock({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-white p-3">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-2 min-h-12 text-sm leading-6 text-muted">{value || 'No notes added.'}</p>
    </div>
  );
}
