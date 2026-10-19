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
};

export function attendanceLockName(userId: string, sessionId: string) {
  return `mh-attendance-v2:${userId}:${sessionId}`;
}

export function startAttendanceTabLeadership(
  userId: string,
  sessionId: string,
  onOwnershipChange: (isLeader: boolean) => void,
  manager: AttendanceLockManager | undefined = (
    typeof navigator !== 'undefined' ? navigator.locks : undefined
  ),
): AttendanceTabLeadership {
  if (!manager || typeof manager.request !== 'function') {
    onOwnershipChange(false);
    return { supported: false, stop: () => undefined };
  }

  let stopped = false;
  let releaseLeader: (() => void) | undefined;
  const controller = new AbortController();

  // The Web Lock request waits until any previous tab releases the session.
  // No timers, visibility events, or offline connectivity are needed to
  // decide which tab owns the running attendance clock.
  void manager.request(
    attendanceLockName(userId, sessionId),
    { mode: 'exclusive', signal: controller.signal },
    async () => {
      if (stopped) return;
      onOwnershipChange(true);
      try {
        await new Promise<void>((resolve) => { releaseLeader = resolve; });
      } finally {
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
    },
  };
}
