/**
 * Ensure one MH Tracker browser tab owns a user/session attendance timer.
 *
 * Web Locks survive tab minimization/background throttling without an expiring
 * localStorage lease. Waiting tabs never accrue or upload duplicate time.
 * A lock is released on normal component cleanup, tab close, or page unload.
 *
 * Fail closed on browsers with no Web Locks API: do not pretend that a
 * single-tab verifier is running when cross-tab ownership cannot be enforced.
 */
export type AttendanceLockManager = {
  request: (
    name: string,
    options: { mode: 'exclusive'; signal: AbortSignal },
    callback: () => Promise<void>,
  ) => Promise<void>;
};

export type AttendanceTabLeadership = {
  supported: boolean;
  stop: () => void;
  /** Ask the owning tab to flush its queue and relinquish the Web Lock. */
  requestTakeover: () => boolean;
};

type AttendanceControlChannel = Pick<BroadcastChannel, 'postMessage' | 'addEventListener' | 'removeEventListener' | 'close'>;

export type AttendanceLeadershipOptions = {
  onTransferRequested?: () => Promise<void> | void;
  createChannel?: (name: string) => AttendanceControlChannel | null;
};

export function attendanceLockName(userId: string, sessionId: string) {
  return `mh-attendance-v2:${userId}:${sessionId}`;
}

export function startAttendanceTabLeadership(
  userId: string,
  sessionId: string,
  onOwnershipChange: (isLeader: boolean) => void,
  manager: AttendanceLockManager | undefined = (
    typeof navigator !== 'undefined' ? navigator.locks as AttendanceLockManager | undefined : undefined
  ),
  options: AttendanceLeadershipOptions = {},
): AttendanceTabLeadership {
  if (!manager || typeof manager.request !== 'function') {
    onOwnershipChange(false);
    return { supported: false, stop: () => undefined, requestTakeover: () => false };
  }

  let stopped = false;
  let releaseLeader: (() => void) | undefined;
  let isLeader = false;
  let transferInProgress = false;
  const controller = new AbortController();

  // Handoff is cooperative: the current leader flushes before releasing the
  // exclusive browser lock. Other tabs never force or bypass a held Web Lock.
  const channelName = `mh-attendance-handoff:${userId}:${sessionId}`;
  let channel: AttendanceControlChannel | null = null;
  try {
    channel = options.createChannel
      ? options.createChannel(channelName)
      : typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(channelName);
  } catch {
    channel = null;
  }

  const onControlMessage = (event: MessageEvent) => {
    if (!event.data || event.data.kind !== 'request-attendance-handoff' ||
        stopped || !isLeader || transferInProgress) return;

    transferInProgress = true;
    void Promise.resolve()
      .then(() => options.onTransferRequested?.())
      .catch((error) => console.warn('Attendance transfer flush failed; local queue is retained:', error))
      .finally(() => {
        if (!stopped) releaseLeader?.();
        transferInProgress = false;
      });
  };
  channel?.addEventListener('message', onControlMessage);

  // The Web Lock request waits until any previous tab releases the session.
  // No timers, visibility events, or offline connectivity are needed to
  // decide which tab owns the running attendance clock.
  void manager.request(
    attendanceLockName(userId, sessionId),
    { mode: 'exclusive', signal: controller.signal },
    async () => {
      if (stopped) return;
      isLeader = true;
      onOwnershipChange(true);
      try {
        await new Promise<void>((resolve) => { releaseLeader = resolve; });
      } finally {
        isLeader = false;
        releaseLeader = undefined;
        onOwnershipChange(false);
      }
    },
  ).catch(() => {
    if (!stopped) onOwnershipChange(false);
  });

  return {
    supported: true,
    stop: () => {
      if (stopped) return;
      stopped = true;
      controller.abort();
      releaseLeader?.();
      channel?.removeEventListener('message', onControlMessage);
      channel?.close();
    },
    requestTakeover: () => {
      if (stopped || isLeader || !channel) return false;
      channel.postMessage({ kind: 'request-attendance-handoff' });
      return true;
    },
  };
}
