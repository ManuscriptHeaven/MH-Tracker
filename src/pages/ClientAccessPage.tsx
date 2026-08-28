import { Check, Mail, Save, Share2, ShieldOff, Sparkles, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Card, EmptyState, Field } from '../components/ui';
import { ShareableInviteModal } from '../components/ShareableInviteModal';
import { firstName, isClientRole } from '../lib/utils';
import type { ClientInviteDraft, ClientProjectAccess, Profile, Project, Role } from '../lib/types';

export function ClientAccessPage({
  profiles,
  projects,
  clientProjectAccess,
  onInviteClient,
  onAddClient,
}: {
  profiles: Profile[];
  projects: Project[];
  clientProjectAccess: ClientProjectAccess[];
  onInviteClient: (draft: ClientInviteDraft) => Promise<string>;
  onAddClient?: (data: {
    fullName: string;
    email: string;
    password: string;
    role: Role;
  }) => Promise<void>;
}) {
  const clients = profiles.filter((profile) => isClientRole(profile.role));
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [createdInviteModalData, setCreatedInviteModalData] = useState<{
    name: string;
    email: string;
    role: Role;
    password?: string;
    projectTitles: string[];
  } | null>(null);

  const accessByClient = useMemo(() => {
    return clientProjectAccess.reduce<Record<string, string[]>>((groups, access) => {
      groups[access.client_id] = [...(groups[access.client_id] || []), access.project_id];
      return groups;
    }, {});
  }, [clientProjectAccess]);

  function generatePassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
    let pass = 'MH@';
    for (let i = 0; i < 6; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setPassword(pass);
  }

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
    if (!fullName.trim() || !email.trim()) {
      setMessage('Please provide client name and email.');
      return;
    }

    setIsSaving(true);
    setMessage(null);
    const assignedPassword = password || 'MH@' + Math.random().toString(36).slice(-6);

    try {
      // 1. Save client project access & metadata
      const result = await onInviteClient({
        full_name: fullName,
        email,
        project_ids: projectIds,
        status,
      });

      // 2. If onAddClient is available, ensure client is created in Supabase Auth
      if (onAddClient && status === 'active') {
        try {
          await onAddClient({
            fullName,
            email,
            password: assignedPassword,
            role: 'client',
          });
        } catch (authErr: any) {
          console.warn('Client auth sync note:', authErr?.message);
        }
      }

      const assignedTitles = projects
        .filter((p) => projectIds.includes(p.id))
        .map((p) => p.project_title);

      setCreatedInviteModalData({
        name: fullName,
        email,
        role: 'client',
        password: assignedPassword,
        projectTitles: assignedTitles,
      });

      setMessage(result || 'Client access saved successfully.');
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
          <h2 className="font-display text-2xl font-semibold flex items-center gap-2">
            <UserPlus className="h-6 w-6 text-gold" />
            Add & Invite Client
          </h2>
          <p className="text-sm text-muted">
            Add client access to projects, set a temporary password, and generate a shareable WhatsApp or Email invite.
          </p>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <Field
            label="Client Name"
            placeholder="e.g., Noah Brooks"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
          <Field
            label="Client Email"
            type="email"
            placeholder="e.g., noah@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-charcoal">
                Initial Password
              </label>
              <button
                type="button"
                onClick={generatePassword}
                className="text-xs font-bold text-gold hover:underline flex items-center gap-1"
              >
                <Sparkles className="h-3 w-3" />
                Auto-Generate
              </button>
            </div>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="e.g. MH@Client123"
              className="w-full rounded-md border border-border bg-white p-2.5 text-sm font-mono text-charcoal shadow-soft focus:border-gold focus:outline-hidden"
            />
          </div>
        </div>

        <div className="mt-5">
          <p className="mb-3 text-sm font-semibold text-muted">Select Projects Client Can Access</p>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <label
                key={project.id}
                className={`flex items-start gap-3 rounded-md border p-3 text-sm transition cursor-pointer ${
                  projectIds.includes(project.id)
                    ? 'border-gold bg-gold/10'
                    : 'border-border bg-white hover:border-gray-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={projectIds.includes(project.id)}
                  onChange={() => toggleProject(project.id)}
                  className="mt-1 accent-gold"
                />
                <span>
                  <span className="block font-semibold text-ink">{project.project_title}</span>
                  <span className="text-xs text-muted">{project.project_number} • {project.client_name}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {message ? (
          <p className="mt-4 rounded-md bg-ivory p-3 text-sm font-semibold text-muted border border-border">
            {message}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="button" onClick={() => save('active')} disabled={isSaving}>
            <Save className="h-4 w-4" />
            {isSaving ? 'Saving...' : 'Save & Generate Invite Link'}
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => save('inactive')}
            disabled={isSaving || !email}
          >
            <ShieldOff className="h-4 w-4" />
            Suspend Access
          </Button>
        </div>
      </Card>

      {clients.length ? (
        <div>
          <h3 className="font-display text-xl font-semibold mb-3">Existing Clients ({clients.length})</h3>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {clients.map((client) => {
              const assignedProjects = projects.filter((project) =>
                (accessByClient[client.id] || []).includes(project.id)
              );

              return (
                <Card key={client.id} className="flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-display text-xl font-semibold text-ink">{client.full_name}</h3>
                        <p className="text-sm text-muted">{client.email}</p>
                        <span className={`inline-block mt-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                          client.status === 'inactive' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-800'
                        }`}>
                          {client.status || 'active'}
                        </span>
                      </div>
                      <Button type="button" variant="secondary" onClick={() => editClient(client)} className="text-xs py-1 px-3">
                        Edit
                      </Button>
                    </div>

                    <div className="mt-4 space-y-2">
                      <p className="text-xs font-bold text-muted uppercase tracking-wider">
                        Assigned Projects ({assignedProjects.length})
                      </p>
                      {assignedProjects.length ? (
                        assignedProjects.map((project) => (
                          <div key={project.id} className="rounded-md bg-ivory px-3 py-2 text-sm border border-border/50">
                            <p className="font-semibold text-ink">{project.project_title}</p>
                            <p className="text-xs text-muted">{project.project_number}</p>
                          </div>
                        ))
                      ) : (
                        <p className="rounded-md border border-dashed border-border p-2.5 text-xs text-muted">
                          No projects assigned.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-border flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setCreatedInviteModalData({
                          name: client.full_name,
                          email: client.email,
                          role: 'client',
                          projectTitles: assignedProjects.map((p) => p.project_title),
                        });
                      }}
                      className="text-xs font-bold text-gold hover:underline flex items-center gap-1"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                      Get Shareable Invite
                    </button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState
          title="No clients yet"
          message={`Add the first client above. Client usernames can use the first name, for example ${firstName(
            fullName || 'Client'
          )}.`}
        />
      )}

      {createdInviteModalData && (
        <ShareableInviteModal
          isOpen={!!createdInviteModalData}
          onClose={() => setCreatedInviteModalData(null)}
          recipientName={createdInviteModalData.name}
          recipientEmail={createdInviteModalData.email}
          role={createdInviteModalData.role}
          temporaryPassword={createdInviteModalData.password}
          assignedProjectTitles={createdInviteModalData.projectTitles}
        />
      )}
    </div>
  );
}
