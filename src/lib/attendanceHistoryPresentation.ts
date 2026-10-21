/** Human-readable presentation helpers; never mutate or redistribute ledger credits. */
const SECONDS_PER_EIGHT_HOUR_DAY = 8 * 60 * 60;

export function formatEightHourDayEquivalent(seconds: number): string {
  const safeMinutes = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds / 60)) : 0;
  const days = Math.floor(safeMinutes / (SECONDS_PER_EIGHT_HOUR_DAY / 60));
  const leftoverMinutes = safeMinutes % (SECONDS_PER_EIGHT_HOUR_DAY / 60);
  const hours = Math.floor(leftoverMinutes / 60);
  const minutes = leftoverMinutes % 60;
  return `${days}d ${hours}h ${minutes}m`;
}

export type AttendanceHistoryDay<T> = { dateKey: string; sessions: T[] };

/**
 * Groups existing session records by their *clock-in* date in the viewer's
 * local time zone. A multi-day session stays under its clock-in date; do NOT
 * assign its historical minutes to fictional verified work dates.
 */
export function groupAttendanceHistoryByDay<T extends { clock_in: string }>(
  sessions: readonly T[],
): AttendanceHistoryDay<T>[] {
  const sorted = [...sessions].sort((left, right) =>
    new Date(right.clock_in).getTime() - new Date(left.clock_in).getTime());
  const groups = new Map<string, T[]>();
  for (const session of sorted) {
    const date = new Date(session.clock_in);
    const dateKey = Number.isFinite(date.getTime())
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      : 'unknown';
    const existing = groups.get(dateKey) || [];
    existing.push(session);
    groups.set(dateKey, existing);
  }
  return [...groups].map(([dateKey, sessionsForDay]) => ({
    dateKey,
    sessions: sessionsForDay,
  }));
}
