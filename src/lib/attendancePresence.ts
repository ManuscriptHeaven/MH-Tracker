export const ATTENDANCE_SLEEP_CLOCK_SKEW_MS = 10_000;

export type AttendancePresenceSampleInput = {
  lastWallMs: number;
  lastMonotonicMs: number;
  nowWallMs: number;
  nowMonotonicMs: number;
  screenLocked?: boolean;
  userIdle?: boolean;
  pageAway?: boolean;
  maxCreditableMs?: number;
};

export type AttendancePresenceSample = {
  creditSeconds: number;
  wallElapsedMs: number;
  creditableElapsedMs: number;
  monotonicElapsedMs: number;
  clockSkewMs: number;
  pauseReason: 'screen_locked' | 'user_idle' | 'page_away' | 'sleep_detected' | null;
};

/**
 * Decide how much attendance time can be credited for one local runtime slice.
 *
 * We intentionally do not use document.visibilityState here: minimizing MH Tracker,
 * switching tabs, or working in another desktop app must keep counting.
 *
 * A large positive difference between wall-clock time and performance.now() means
 * the operating system likely slept while the page runtime was suspended on browsers
 * where the monotonic clock does not tick through sleep.
 */
export function evaluateAttendancePresenceSample(
  input: AttendancePresenceSampleInput,
): AttendancePresenceSample {
  const wallElapsedMs = Math.max(0, input.nowWallMs - input.lastWallMs);
  const monotonicElapsedMs = Math.max(0, input.nowMonotonicMs - input.lastMonotonicMs);
  const clockSkewMs = Math.max(0, wallElapsedMs - monotonicElapsedMs);
  // In an idle-transition event delayed by background throttling, cap the
  // unknown gap to the detector threshold instead of granting many idle hours.
  const creditableElapsedMs = Math.min(
    wallElapsedMs,
    Math.max(0, input.maxCreditableMs ?? wallElapsedMs),
  );

  let pauseReason: AttendancePresenceSample['pauseReason'] = null;

  if (input.screenLocked) {
    pauseReason = 'screen_locked';
  } else if (input.userIdle) {
    pauseReason = 'user_idle';
  } else if (input.pageAway) {
    pauseReason = 'page_away';
  } else if (clockSkewMs >= ATTENDANCE_SLEEP_CLOCK_SKEW_MS) {
    pauseReason = 'sleep_detected';
  }

  return {
    creditSeconds: pauseReason ? 0 : Math.floor(creditableElapsedMs / 1000),
    creditableElapsedMs,
    wallElapsedMs,
    monotonicElapsedMs,
    clockSkewMs,
    pauseReason,
  };
}
