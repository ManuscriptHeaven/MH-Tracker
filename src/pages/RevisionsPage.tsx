import { Repeat2 } from 'lucide-react';
import { StatusBadge } from '../components/Badges';
import { Card, EmptyState } from '../components/ui';
import type { Profile, Project, RevisionNote } from '../lib/types';

function profileName(profiles: Profile[], id?: string | null) {
  return profiles.find((profile) => profile.id === id)?.full_name || 'Unknown';
}

function projectFor(projects: Project[], id: string) {
  return projects.find((project) => project.id === id);
}

export function RevisionsPage({
  revisions,
  projects,
  profiles,
  onSelectProject,
}: {
  revisions: RevisionNote[];
  projects: Project[];
  profiles: Profile[];
  onSelectProject: (project: Project) => void;
}) {
  if (!revisions.length) {
    return (
      <EmptyState
        title="No revision notes"
        message="Revision notes will appear here once the team starts tracking client changes."
      />
    );
  }

  return (
    <div className="space-y-4">
      {revisions.map((revision) => {
        const project = projectFor(projects, revision.project_id);
        if (!project) {
          return null;
        }

        return (
          <Card key={revision.id}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-md bg-orange-50 text-orange-700">
                  <Repeat2 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gold">Revision {revision.revision_number}</p>
                  <button
                    className="text-left font-display text-xl font-semibold text-ink hover:text-gold"
                    onClick={() => onSelectProject(project)}
                  >
                    {project.project_title}
                  </button>
                  <p className="mt-1 text-sm text-muted">
                    Added by {profileName(profiles, revision.added_by)} on{' '}
                    {new Date(revision.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <StatusBadge status={project.status} />
            </div>
            <p className="mt-4 rounded-md bg-ivory p-4 text-sm leading-6 text-charcoal">{revision.note}</p>
            <p className="mt-3 text-sm font-semibold text-muted">Revision status: {revision.status}</p>
          </Card>
        );
      })}
    </div>
  );
}
