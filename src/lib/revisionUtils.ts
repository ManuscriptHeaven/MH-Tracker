import { RevisionRequest } from './types';

export interface RevisionRequestAmbiguityCandidate {
  id?: string;
  project_id?: string;
  stage_key?: string | null;
  revision_round?: number | null;
  canonical_status?: string | null;
}

export function hasAmbiguousRevisionRequests(
  projectId: string,
  revisionRequests: RevisionRequestAmbiguityCandidate[] | null | undefined
): boolean {
  if (!revisionRequests || revisionRequests.length === 0) return false;
  const projectRevisions = revisionRequests.filter((req) => req.project_id === projectId);
  if (projectRevisions.length === 0) return false;
  return projectRevisions.some(
    (req) =>
      !req.stage_key ||
      req.revision_round === undefined ||
      req.revision_round === null ||
      req.revision_round < 1 ||
      !req.canonical_status
  );
}

export function normalizeRevisionRequest(request: Partial<RevisionRequest>): RevisionRequest {
  const now = new Date().toISOString();

  return {
    id: request.id || `req-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    project_id: request.project_id || '',
    client_id: request.client_id || '',
    title: request.title || 'Revision Request',
    description: request.description || '',
    instructions: request.instructions || request.description || request.title || '',
    team_response: request.team_response || null,
    priority: request.priority || 'Normal',
    status: request.status || 'Submitted',
    stage_key: request.stage_key ?? null,
    revision_round: request.revision_round ?? null,
    canonical_status: request.canonical_status ?? null,
    parent_revision_request_id: request.parent_revision_request_id ?? null,
    assigned_to: request.assigned_to || null,
    submitted_at: request.submitted_at || request.created_at || now,
    completed_at: request.completed_at || null,
    created_at: request.created_at || now,
    updated_at: request.updated_at || now,
  };
}
