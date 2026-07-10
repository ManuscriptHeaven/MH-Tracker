import { Mail, Save, ShieldOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Card, EmptyState, Field } from '../components/ui';
import { firstName, isClientRole } from '../lib/utils';
import type { ClientInviteDraft, ClientProjectAccess, Profile, Project } from '../lib/types';

export function ClientAccessPage({
  profiles,
  projects,
  clientProjectAccess,
  onInviteClient,
}: {
  profiles: Profile[];
  projects: Project[];
  clientProjectAccess: ClientProjectAccess[];
  onInviteClient: (draft: ClientInviteDraft) => Promise<string>;
}) {
  const clients = profiles.filter((profile) => isClientRole(profile.role));
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const accessByClient = useMemo(() => {
    return clientProjectAccess.reduce<Record<string, string[]>>((groups, access) => {
      groups[access.client_id] = [...(groups[access.client_id] || []), access.project_id];
      return groups;
    }, {});
  }, [clientProjectAccess]);

  function toggleProject(projectId: string) {
    setProjectIds((previous) =>
      previous.includes(projectId) ? previous.filter((id) => id !== projectId) : [...previous, projectId],
    );
  }

  function editClient(client: Profile) {
    setFullName(client.full_name);
    setEmail(client.email);
    setProjectIds(accessByClient[client.id] || []);
    setMessage(null);
  }

  async function save(status: 'active' | 'inactive' = 'active') {
    setIsSaving(true);
    setMessage(null);
    try {
      const result = await onInviteClient({
        full_name: fullName,
        email,
        project_ids: projectIds,
        status,
      });
      setMessage(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Client access could not be saved.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-col gap-2">
          <h2 className="font-display text-2xl font-semibold">Invite Client</h2>
          <p className="text-sm text-muted">
            Save client access here, then create or invite the same email in Supabase Auth.
          </p>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Field label="Client name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
          <Field label="Client email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>

        <div className="mt-5">
          <p className="mb-3 text-sm font-semibold text-muted">Project access</p>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <label
                key={project.id}
                className="flex items-start gap-3 rounded-md border border-border bg-white p-3 text-sm"
              >
                <input
                  type="checkbox"
                  checked={projectIds.includes(project.id)}
                  onChange={() => toggleProject(project.id)}
                  className="mt-1"
                />
                <span>
                  <span className="block font-semibold">{project.project_title}</span>
                  <span className="text-xs text-muted">{project.project_number}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {message ? <p className="mt-4 rounded-md bg-ivory p-3 text-sm font-semibold text-muted">{message}</p> : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="button" onClick={() => save('active')} disabled={isSaving}>
            <Save className="h-4 w-4" />
            Save Access
          </Button>
          <Button type="button" variant="secondary" onClick={() => save('active')} disabled={isSaving || !email}>
            <Mail className="h-4 w-4" />
            Resend Setup Email
          </Button>
          <Button type="button" variant="danger" onClick={() => save('inactive')} disabled={isSaving || !email}>
            <ShieldOff className="h-4 w-4" />
            Suspend Access
          </Button>
        </div>
      </Card>

      {clients.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {clients.map((client) => {
            const assignedProjects = projects.filter((project) => (accessByClient[client.id] || []).includes(project.id));

            return (
              <Card key={client.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-xl font-semibold">{client.full_name}</h3>
                    <p className="text-sm text-muted">{client.email}</p>
                    <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                      {client.status || 'active'}
                    </p>
                  </div>
                  <Button type="button" variant="secondary" onClick={() => editClient(client)}>
                    Edit
                  </Button>
                </div>
                <div className="mt-4 space-y-2">
                  {assignedProjects.length ? (
                    assignedProjects.map((project) => (
                      <div key={project.id} className="rounded-md bg-ivory px-3 py-2 text-sm">
                        <p className="font-semibold">{project.project_title}</p>
                        <p className="text-xs text-muted">{project.project_number}</p>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted">
                      No projects assigned.
                    </p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="No clients yet"
          message={`Add the first client above. Client usernames can use the first name, for example ${firstName(fullName || 'Client')}.`}
        />
      )}
    </div>
  );
}
