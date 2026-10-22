import type { Task } from './types';

export type TaskAlertKind = 'assigned' | 'status_changed';

/**
 * Notifications must be relevant to the signed-in recipient. This classifier
 * is pure and deliberately ignores cached/initial-load data; call it only on
 * an actual Realtime INSERT or UPDATE event.
 */
export function classifyTaskAlert(
  previous: Task | undefined,
  current: Task,
  recipientId: string,
  canManageTeam: boolean,
  isCollaborator: boolean,
  isOwnMutation = false,
): TaskAlertKind | null {
  if (isOwnMutation || !recipientId || current.archived_at) return null;

  const newlyAssigned = current.assigned_to === recipientId
    && previous?.assigned_to !== recipientId
    && (previous !== undefined || current.created_by !== recipientId);

  if (newlyAssigned) return 'assigned';

  if (previous && previous.status !== current.status) {
    // Admins and managers monitor team status changes; other team members
    // hear only changes to their own/collaborative/created tasks.
    if (
      canManageTeam || current.assigned_to === recipientId ||
      current.created_by === recipientId || isCollaborator
    ) return 'status_changed';
  }
  return null;
}

// Local memory handles repeated callbacks; localStorage provides best-effort
// cross-tab deduplication for the SAME authenticated user. Limit storage size.
const playedEvents = new Set<string>();
const MAX_EVENT_IDS = 120;
const STORAGE_PREFIX = 'mh_realtime_sound_ids:';

export function claimRealtimeSound(recipientId: string, eventId: string): boolean {
  if (!recipientId || !eventId) return false;
  const composite = recipientId + ':' + eventId;
  if (playedEvents.has(composite)) return false;

  if (typeof window !== 'undefined') {
    try {
      const key = STORAGE_PREFIX + recipientId;
      const history: string[] = JSON.parse(window.localStorage.getItem(key) || '[]');
      if (Array.isArray(history) && history.includes(eventId)) {
        playedEvents.add(composite);
        return false;
      }
      const list = Array.isArray(history) ? history.slice(-(MAX_EVENT_IDS - 1)) : [];
      window.localStorage.setItem(key, JSON.stringify([...list, eventId]));
    } catch {
      // Storage may be blocked, so rely on the in-memory deduplication.
    }
  }

  playedEvents.add(composite);
  if (playedEvents.size > 1000) {
    const oldest = playedEvents.values().next().value;
    if (oldest) playedEvents.delete(oldest);
  }
  return true;
}
