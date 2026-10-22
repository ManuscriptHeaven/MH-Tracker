/** Social Studio domain rules. No provider calls or client-side authorization here. */
export type SocialPostStatus =
  | 'draft' | 'in_review' | 'approved' | 'scheduled'
  | 'publishing' | 'published' | 'failed' | 'cancelled';

export interface SocialPostRevision {
  id: string;
  postId: string;
  revision: number;
  caption: string;
  assetIds: string[];
  targetAccountIds: string[];
  createdAt: string;
}

export interface SocialPostTarget {
  id: string;
  postId: string;
  approvedRevisionId: string | null;
  status: SocialPostStatus;
  scheduledAt: string | null;
  publishedExternalId: string | null;
}

export function isApprovalCurrent(
  target: SocialPostTarget,
  latestRevision: SocialPostRevision,
): boolean {
  return target.postId === latestRevision.postId &&
    target.approvedRevisionId === latestRevision.id;
}

export function canSchedule(
  target: SocialPostTarget,
  latestRevision: SocialPostRevision,
  scheduledAt: string,
): boolean {
  return target.status === 'approved' &&
    isApprovalCurrent(target, latestRevision) &&
    Number.isFinite(Date.parse(scheduledAt)) &&
    Date.parse(scheduledAt) > Date.now();
}

export function invalidateApprovalOnEdit(
  target: SocialPostTarget,
): SocialPostTarget {
  if (target.status === 'published' || target.status === 'publishing') {
    throw new Error('Published or publishing targets cannot be edited; create a new post.');
  }
  return {
    ...target,
    approvedRevisionId: null,
    scheduledAt: null,
    status: 'draft',
  };
}

export function canClaimForPublishing(
  target: SocialPostTarget,
  latestRevision: SocialPostRevision,
  now: string,
): boolean {
  return target.status === 'scheduled' &&
    isApprovalCurrent(target, latestRevision) &&
    target.scheduledAt !== null &&
    Number.isFinite(Date.parse(now)) &&
    Date.parse(target.scheduledAt) <= Date.parse(now) &&
    !target.publishedExternalId;
}

/** This guard is advisory only. The worker must enforce claims atomically in PostgreSQL. */
export function assertPublishReady(
  target: SocialPostTarget,
  latestRevision: SocialPostRevision,
  now: string,
): void {
  if (!canClaimForPublishing(target, latestRevision, now)) {
    throw new Error('Target is not scheduled with a current approved revision.');
  }
}
