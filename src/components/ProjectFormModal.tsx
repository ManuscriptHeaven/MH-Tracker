import { Save } from 'lucide-react';
import { paymentStatuses, platforms, priorityOptions, serviceTypes, statusOptions } from '../lib/constants';
import { todayInput } from '../lib/date';
import { errorMessage, firstName, isManagerRole } from '../lib/utils';
import type { Profile, Project, ProjectDraft } from '../lib/types';
import { Button, Field, Modal, SelectField, TextareaField } from './ui';
import { type FormEvent, useEffect, useMemo, useState } from 'react';

function defaultDraft(currentProfile: Profile): ProjectDraft {
  return {
    client_name: '',
    client_email: '',
    project_title: '',
    service_type: 'Print Formatting',
    genre: '',
    trim_size: '',
    page_count: 0,
    word_count: 0,
    image_count: 0,
    platform: 'Amazon KDP',
    assigned_to: null,
    project_manager:
      currentProfile.role === 'project_manager' || currentProfile.role === 'manager' ? currentProfile.id : null,
    priority: 'Normal',
    start_date: todayInput(),
    due_date: todayInput(),
    internal_deadline: todayInput(),
    delivery_date: null,
    status: 'New',
    general_notes: '',
    internal_notes: '',
    client_instructions: '',
    qa_notes: '',
    delivery_notes: '',
    source_file_link: '',
    drive_folder_link: '',
    client_brief_link: '',
    proof_pdf_link: '',
    final_print_pdf_link: '',
    final_ebook_link: '',
    cover_file_link: '',
    other_links: '',
    total_price: 0,
    advance_paid: 0,
    payment_status: 'Not Started',
    payment_date: null,
    payment_notes: '',
  };
}

function draftFromProject(project: Project): ProjectDraft {
  const { id, project_number, created_by, created_at, updated_at, remaining_balance, ...draft } = project;
  void created_at;
  void updated_at;
  void remaining_balance;

  return {
    ...draft,
    id,
    project_number,
    created_by,
  };
}

export function ProjectFormModal({
  currentProfile,
  profiles,
  project,
  onClose,
  onSubmit,
}: {
  currentProfile: Profile;
  profiles: Profile[];
  project?: Project | null;
  onClose: () => void;
  onSubmit: (draft: ProjectDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ProjectDraft>(() =>
    project ? draftFromProject(project) : defaultDraft(currentProfile),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(project ? draftFromProject(project) : defaultDraft(currentProfile));
    setFormError(null);
  }, [currentProfile, project]);

  const assignableProfiles = useMemo(
    () => profiles.filter((profile) => profile.role === 'employee' || profile.role === 'junior_assistant'),
    [profiles],
  );

  const managers = useMemo(
    () => profiles.filter((profile) => isManagerRole(profile.role)),
    [profiles],
  );

  const balance = Math.max(Number(draft.total_price || 0) - Number(draft.advance_paid || 0), 0);

  function update<K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setFormError(null);

    try {
      await onSubmit(draft);
      onClose();
    } catch (error) {
      setFormError(errorMessage(error, 'Project could not be saved.'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal title={project ? 'Edit Project' : 'Add New Project'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="grid gap-4 rounded-lg border border-border bg-white p-4">
          <h3 className="font-display text-lg font-semibold">Basic Information</h3>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Field
              label="Client Name"
              required
              value={draft.client_name}
              onChange={(event) => update('client_name', event.target.value)}
            />
            <Field
              label="Client Email"
              type="email"
              value={draft.client_email}
              onChange={(event) => update('client_email', event.target.value)}
            />
            <Field
              label="Project Title"
              required
              value={draft.project_title}
              onChange={(event) => update('project_title', event.target.value)}
            />
            <SelectField
              label="Service Type"
              value={draft.service_type}
              onChange={(event) => update('service_type', event.target.value)}
            >
              {serviceTypes.map((service) => (
                <option key={service}>{service}</option>
              ))}
            </SelectField>
            <Field label="Book Genre" value={draft.genre} onChange={(event) => update('genre', event.target.value)} />
            <Field
              label="Trim Size"
              value={draft.trim_size}
              onChange={(event) => update('trim_size', event.target.value)}
            />
            <Field
              label="Page Count"
              type="number"
              min="0"
              value={draft.page_count}
              onChange={(event) => update('page_count', Number(event.target.value))}
            />
            <Field
              label="Word Count"
              type="number"
              min="0"
              value={draft.word_count}
              onChange={(event) => update('word_count', Number(event.target.value))}
            />
            <Field
              label="Number of Images"
              type="number"
              min="0"
              value={draft.image_count}
              onChange={(event) => update('image_count', Number(event.target.value))}
            />
            <SelectField
              label="Platform"
              value={draft.platform}
              onChange={(event) => update('platform', event.target.value)}
            >
              {platforms.map((platform) => (
                <option key={platform}>{platform}</option>
              ))}
            </SelectField>
          </div>
        </section>

        <section className="grid gap-4 rounded-lg border border-border bg-white p-4">
          <h3 className="font-display text-lg font-semibold">Project Management</h3>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <SelectField
              label="Assigned To"
              value={draft.assigned_to || ''}
              onChange={(event) => update('assigned_to', event.target.value || null)}
            >
              <option value="">Unassigned</option>
              {assignableProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {firstName(profile.full_name)}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Project Manager"
              value={draft.project_manager || ''}
              onChange={(event) => update('project_manager', event.target.value || null)}
            >
              <option value="">Unassigned</option>
              {managers.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {firstName(profile.full_name)}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Priority"
              value={draft.priority}
              onChange={(event) => update('priority', event.target.value as ProjectDraft['priority'])}
            >
              {priorityOptions.map((priority) => (
                <option key={priority}>{priority}</option>
              ))}
            </SelectField>
            <Field
              label="Start Date"
              type="date"
              value={draft.start_date}
              onChange={(event) => update('start_date', event.target.value)}
            />
            <Field
              label="Due Date"
              type="date"
              value={draft.due_date}
              onChange={(event) => update('due_date', event.target.value)}
            />
            <Field
              label="Internal Deadline"
              type="date"
              value={draft.internal_deadline}
              onChange={(event) => update('internal_deadline', event.target.value)}
            />
            <Field
              label="Delivery Date"
              type="date"
              value={draft.delivery_date || ''}
              onChange={(event) => update('delivery_date', event.target.value || null)}
            />
            <SelectField
              label="Project Status"
              value={draft.status}
              onChange={(event) => update('status', event.target.value as ProjectDraft['status'])}
            >
              {statusOptions.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </SelectField>
          </div>
        </section>

        <section className="grid gap-4 rounded-lg border border-border bg-white p-4">
          <h3 className="font-display text-lg font-semibold">Notes</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <TextareaField
              label="General Notes"
              value={draft.general_notes}
              onChange={(event) => update('general_notes', event.target.value)}
            />
            <TextareaField
              label="Internal Notes"
              value={draft.internal_notes}
              onChange={(event) => update('internal_notes', event.target.value)}
            />
            <TextareaField
              label="Client Instructions"
              value={draft.client_instructions}
              onChange={(event) => update('client_instructions', event.target.value)}
            />
            <TextareaField
              label="QA Notes"
              value={draft.qa_notes}
              onChange={(event) => update('qa_notes', event.target.value)}
            />
          </div>
        </section>

        <section className="grid gap-4 rounded-lg border border-border bg-white p-4">
          <h3 className="font-display text-lg font-semibold">Files and Delivery Links</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Source File Link"
              value={draft.source_file_link}
              onChange={(event) => update('source_file_link', event.target.value)}
            />
            <Field
              label="Google Drive Folder Link"
              value={draft.drive_folder_link}
              onChange={(event) => update('drive_folder_link', event.target.value)}
            />
            <Field
              label="Client Brief Link"
              value={draft.client_brief_link}
              onChange={(event) => update('client_brief_link', event.target.value)}
            />
            <Field
              label="Proof PDF Link"
              value={draft.proof_pdf_link}
              onChange={(event) => update('proof_pdf_link', event.target.value)}
            />
            <Field
              label="Final Print PDF Link"
              value={draft.final_print_pdf_link}
              onChange={(event) => update('final_print_pdf_link', event.target.value)}
            />
            <Field
              label="Final eBook Link"
              value={draft.final_ebook_link}
              onChange={(event) => update('final_ebook_link', event.target.value)}
            />
            <Field
              label="Cover File Link"
              value={draft.cover_file_link}
              onChange={(event) => update('cover_file_link', event.target.value)}
            />
            <Field
              label="Other Delivery Links"
              value={draft.other_links}
              onChange={(event) => update('other_links', event.target.value)}
            />
          </div>
          <TextareaField
            label="Delivery Notes"
            value={draft.delivery_notes}
            onChange={(event) => update('delivery_notes', event.target.value)}
          />
        </section>

        <section className="grid gap-4 rounded-lg border border-border bg-white p-4">
          <h3 className="font-display text-lg font-semibold">Payment Tracking</h3>
          <div className="grid gap-4 md:grid-cols-3">
            <Field
              label="Total Price"
              type="number"
              min="0"
              value={draft.total_price}
              onChange={(event) => update('total_price', Number(event.target.value))}
            />
            <Field
              label="Advance Paid"
              type="number"
              min="0"
              value={draft.advance_paid}
              onChange={(event) => update('advance_paid', Number(event.target.value))}
            />
            <label className="grid gap-1.5 text-sm font-medium text-ink">
              <span>Remaining Balance</span>
              <div className="grid min-h-11 place-items-center rounded-md border border-border bg-ivory px-3 text-sm font-semibold">
                ${balance.toLocaleString()}
              </div>
            </label>
            <SelectField
              label="Payment Status"
              value={draft.payment_status}
              onChange={(event) => update('payment_status', event.target.value as ProjectDraft['payment_status'])}
            >
              {paymentStatuses.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </SelectField>
            <Field
              label="Payment Date"
              type="date"
              value={draft.payment_date || ''}
              onChange={(event) => update('payment_date', event.target.value || null)}
            />
          </div>
          <TextareaField
            label="Payment Notes"
            value={draft.payment_notes}
            onChange={(event) => update('payment_notes', event.target.value)}
          />
        </section>

        <div className="sticky bottom-0 flex flex-col gap-3 border-t border-border bg-linen py-4 sm:flex-row sm:justify-end">
          {formError ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger sm:mr-auto">{formError}</p>
          ) : null}
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSaving}>
            <Save className="h-4 w-4" />
            {isSaving ? 'Saving' : 'Save Project'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
