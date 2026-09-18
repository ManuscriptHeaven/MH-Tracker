import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FolderKanban,
  Mail,
  Pencil,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Card, EmptyState, Field } from '../components/ui';
import { isClientRole } from '../lib/utils';
import type { ClientInviteDraft, ClientProjectAccess, Profile, Project } from '../lib/types';

export function ClientAccessPage({
  profiles,
  projects,
  clientProjectAccess,
  onSaveClient,
}: {
  profiles: Profile[];
  projects: Project[];
  clientProjectAccess: ClientProjectAccess[];
  onSaveClient: (draft: ClientInviteDraft) => Promise<string>;
}) {
  const clients = useMemo(
    () =>
      profiles
        .filter((profile) => isClientRole(profile.role))
        .sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [profiles],
  );

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [showProjects, setShowProjects] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const accessByClient = useMemo(
    () =>
      clientProjectAccess.reduce<Record<string, string[]>>((groups, access) => {
        groups[access.client_id] = [...(groups[access.client_id] || []), access.project_id];
        return groups;
      }, {}),
    [clientProjectAccess],
  );

  const activeProjects = useMemo(
    () =>
      projects
        .filter(
          (project) =>
            !['Completed', 'Delivered', 'Cancelled'].includes(project.status) &&
            project.project_status !== 'archived',
        )
        .sort((a, b) => a.project_title.localeCompare(b.project_title)),
    [projects],
  );

  function resetForm() {
    setFullName('');
    setEmail('');
    setProjectIds([]);
    setShowProjects(false);
    setEditingClientId(null);
  }

  function toggleProject(projectId: string) {
    setProjectIds((previous) =>
      previous.includes(projectId)
        ? previous.filter((id) => id !== projectId)
        : [...previous, projectId],
    );
  }

  function editClient(client: Profile) {
    setEditingClientId(client.id);
    setFullName(client.full_name);
    setEmail(client.email);
    setProjectIds(accessByClient[client.id] || []);
    setShowProjects(true);
    setMessage(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveClient() {
    const cleanName = fullName.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanName || !cleanEmail || !cleanEmail.includes('@')) {
      setMessage({ type: 'error', text: 'Client name and a valid email are required.' });
      return;
    }

    setIsSaving(true);
    setMessage(null);

    try {
      const result = await onSaveClient({
        full_name: cleanName,
        email: cleanEmail,
        project_ids: projectIds,
        status: 'active',
      });
      setMessage({
        type: 'success',
        text:
          result ||
          (editingClientId
            ? 'Client details updated successfully.'
            : 'Client added and invite email sent.'),
      });
      resetForm();
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Client could not be saved.',
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <section className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#8b6f38]">
            Client Management
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">
            Clients
          </h1>
          <p className="mt-1 text-sm text-muted">
            Add a client in seconds. Project access can be assigned now or later.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 self-start rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-bold text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Secure portal invite
        </div>
      </section>

      <Card className="overflow-hidden rounded-2xl p-0">
        <div className="border-b border-border bg-[#fcfbf8] px-4 py-4 sm:px-5">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold/15 text-[#7a5518]">
              <UserPlus className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-ink">
                {editingClientId ? 'Edit Client' : 'Quick Add Client'}
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                Only name and email are required. New clients receive a portal invite automatically.
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label="Client Name *"
              placeholder="e.g. Noah Brooks"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
            <Field
              label="Client Email *"
              type="email"
              placeholder="e.g. noah@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <button
            type="button"
            onClick={() => setShowProjects((value) => !value)}
            className="mt-4 flex w-full items-center justify-between rounded-xl border border-border bg-[#faf9f6] px-3.5 py-3 text-left transition hover:border-gold/50"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-[#7a5518] shadow-xs">
                <FolderKanban className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-xs font-bold text-ink">
                  Assign Projects Now
                  <span className="ml-1 font-normal text-muted">(optional)</span>
                </span>
                <span className="mt-0.5 block text-[10px] text-muted">
                  {projectIds.length
                    ? `${projectIds.length} project${projectIds.length === 1 ? '' : 's'} selected`
                    : 'You can skip this and assign access later.'}
                </span>
              </span>
            </span>
            {showProjects ? (
              <ChevronUp className="h-4 w-4 shrink-0 text-muted" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
            )}
          </button>

          {showProjects ? (
            <div className="mt-3 rounded-xl border border-border bg-white p-3">
              {activeProjects.length ? (
                <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
                  {activeProjects.map((project) => {
                    const selected = projectIds.includes(project.id);
                    return (
                      <label
                        key={project.id}
                        className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition ${
                          selected
                            ? 'border-gold bg-gold/10'
                            : 'border-border bg-[#fcfbf8] hover:border-gold/50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleProject(project.id)}
                          className="mt-0.5 accent-gold"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-bold text-ink">
                            {project.project_title}
                          </span>
                          <span className="mt-0.5 block truncate text-[10px] text-muted">
                            {project.project_number} · {project.client_name}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="py-3 text-center text-xs text-muted">
                  No active projects are available for assignment.
                </p>
              )}
            </div>
          ) : null}

          {message ? (
            <div
              className={`mt-4 rounded-xl border p-3 text-xs font-semibold ${
                message.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-rose-200 bg-rose-50 text-rose-700'
              }`}
            >
              {message.text}
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border/70 pt-4">
            <Button type="button" onClick={saveClient} disabled={isSaving}>
              <Mail className="h-4 w-4" />
              {isSaving
                ? 'Saving...'
                : editingClientId
                  ? 'Save Client'
                  : 'Add Client & Send Invite'}
            </Button>

            {editingClientId ? (
              <Button type="button" variant="secondary" onClick={resetForm} disabled={isSaving}>
                <X className="h-4 w-4" />
                Cancel Edit
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold text-ink">Client Directory</h2>
            <p className="mt-0.5 text-xs text-muted">
              {clients.length} client{clients.length === 1 ? '' : 's'} currently in MH Tracker.
            </p>
          </div>
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-linen text-[#7a5518]">
            <Users className="h-4 w-4" />
          </div>
        </div>

        {clients.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {clients.map((client) => {
              const assignedProjects = projects.filter((project) =>
                (accessByClient[client.id] || []).includes(project.id),
              );

              return (
                <Card key={client.id} className="rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-display text-lg font-bold text-ink">
                        {client.full_name}
                      </h3>
                      <p className="mt-0.5 truncate text-xs text-muted">{client.email}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                        client.status === 'inactive'
                          ? 'bg-rose-50 text-rose-700'
                          : 'bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {client.status || 'active'}
                    </span>
                  </div>

                  <div className="mt-4 rounded-xl bg-[#faf9f6] p-3">
                    <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted">
                      Project Access
                    </p>
                    {assignedProjects.length ? (
                      <div className="mt-2 space-y-1.5">
                        {assignedProjects.slice(0, 3).map((project) => (
                          <div
                            key={project.id}
                            className="flex items-center justify-between gap-2 text-[11px]"
                          >
                            <span className="truncate font-semibold text-ink">
                              {project.project_title}
                            </span>
                            <span className="shrink-0 text-[9px] text-muted">
                              {project.project_number}
                            </span>
                          </div>
                        ))}
                        {assignedProjects.length > 3 ? (
                          <p className="text-[10px] font-semibold text-[#7a5518]">
                            +{assignedProjects.length - 3} more
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-2 text-[11px] text-muted">No project access assigned yet.</p>
                    )}
                  </div>

                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => editClient(client)}
                    className="mt-3 w-full justify-center"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit Client & Access
                  </Button>
                </Card>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="No clients yet"
            message="Use Quick Add Client above. Name and email are all you need."
          />
        )}
      </section>
    </div>
  );
}
