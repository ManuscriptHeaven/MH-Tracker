/** Trusted only as a client-side estimate; server validates every submitted slice. */
export type AttendanceDailySlice = {
  source_key: string;
  started_at: string;
  ended_at: string;
  local_work_date: string;
  time_zone: string;
};

const MAX_ATTENDANCE_SLICE_MS = 16 * 60 * 60 * 1000;

function formatLocalAttendanceDate(time: Date) {
  const year = time.getFullYear();
  const month = String(time.getMonth() + 1).padStart(2, '0');
  const day = String(time.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Split a credited, awake/unlocked runtime interval at every local midnight.
 *
 * Dates use the machine's local timezone, which must match the IANA time_zone
 * sent alongside the slices. This function never treats browser visibility as
 * an attendance break. Call it only AFTER sleep/lock/idle policy has accepted
 * the interval.
 *
 * Start/end are rounded down together to whole seconds so Postgres does not
 * lose an extra second at each midnight split from separate floor operations.
 */
export function splitAttendanceIntervalByLocalDate(
  startMs: number,
  endMs: number,
  createSourceKey: () => string,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): AttendanceDailySlice[] {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
  if (!timeZone || typeof timeZone !== 'string') return [];

  const firstMs = Math.floor(startMs / 1000) * 1000;
  const lastMs = Math.floor(endMs / 1000) * 1000;
  if (lastMs <= firstMs) return [];

  const result: AttendanceDailySlice[] = [];
  let cursor = firstMs;

  while (cursor < lastMs) {
    const startDate = new Date(cursor);
    const nextMidnight = new Date(cursor);
    nextMidnight.setHours(24, 0, 0, 0);

    // The 16-hour bound is also applied server-side. A very long minimized
    // tab interval is split into bounded pieces rather than silently discarded.
    const nextMs = Math.min(lastMs, nextMidnight.getTime(), cursor + MAX_ATTENDANCE_SLICE_MS);
    if (nextMs <= cursor) throw new Error('Unable to split attendance interval');

    result.push({
      source_key: createSourceKey(),
      started_at: new Date(cursor).toISOString(),
      ended_at: new Date(nextMs).toISOString(),
      local_work_date: formatLocalAttendanceDate(startDate),
      time_zone: timeZone,
    });
    cursor = nextMs;
  }

  return result;
}

export function sumAttendanceDailySliceSeconds(slices: AttendanceDailySlice[]) {
  return slices.reduce((total, slice) =>
    total + Math.floor((new Date(slice.ended_at).getTime() - new Date(slice.started_at).getTime()) / 1000), 0);
}

/**
 * A normalized source-key queue. Keep exact slices in localStorage until the
 * server acknowledges the ENTIRE RPC transaction; retransmit unchanged keys
 * after a network interruption to enable server idempotency.
 */
export function mergeAttendanceDailySlices(
  queued: AttendanceDailySlice[],
  incoming: AttendanceDailySlice[],
): AttendanceDailySlice[] {
  const byKey = new Map<string, AttendanceDailySlice>();
  for (const slice of [...queued, ...incoming]) {
    if (!byKey.has(slice.source_key)) byKey.set(slice.source_key, slice);
  }
  return [...byKey.values()];
}

const DAILY_QUEUE_PREFIX = 'mh_attendance_daily_slices_v1';

/** Queue keys are scoped to the signed-in actor and attendance session. */
function dailyQueueKey(userId: string, sessionId: string) {
  return `${DAILY_QUEUE_PREFIX}:${userId}:${sessionId}`;
}

export function readPendingAttendanceDailySlices(userId: string, sessionId: string): AttendanceDailySlice[] {
  try {
    const raw = window.localStorage.getItem(dailyQueueKey(userId, sessionId));
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const valid = value.filter((item): item is AttendanceDailySlice =>
      typeof item === 'object' && item !== null &&
      typeof item.source_key === 'string' &&
      typeof item.started_at === 'string' &&
      typeof item.ended_at === 'string' &&
      typeof item.time_zone === 'string' &&
      typeof item.local_work_date === 'string'
    );
    return mergeAttendanceDailySlices([], valid);
  } catch {
    return [];
  }
}

export function writePendingAttendanceDailySlices(
  userId: string,
  sessionId: string,
  slices: AttendanceDailySlice[],
): void {
  try {
    const key = dailyQueueKey(userId, sessionId);
    if (slices.length === 0) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(slices));
    }
  } catch {
    // Storage-denied environments still track in memory and retry on reconnect.
  }
}

/**
 * Recover a queue after the database reports overlapping accepted intervals.
 * Already accepted seconds are removed, and any overlap between remaining
 * queued slices is trimmed before retrying. Never grant duplicate seconds or
 * modify an already accepted source-key payload.
 *
 * Newly split/trimmed slices get fresh UUIDs. Callers persist the returned
 * queue BEFORE retrying so a network interruption keeps those IDs stable.
 */
export function reconcilePendingAttendanceDailySlices(
  pending: AttendanceDailySlice[],
  accepted: ReadonlyArray<{ started_at: string; ended_at: string }>,
  createSourceKey: () => string,
): AttendanceDailySlice[] {
  const occupied: Array<[number, number]> = [];
  for (const slice of accepted) {
    const a = Date.parse(slice.started_at);
    const b = Date.parse(slice.ended_at);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) occupied.push([a, b]);
  }
  const sorted = [...pending].sort((a, b) =>
    Date.parse(a.started_at) - Date.parse(b.started_at) || a.source_key.localeCompare(b.source_key));
  const unique: AttendanceDailySlice[] = [];

  for (const slice of sorted) {
    const a = Date.parse(slice.started_at);
    const b = Date.parse(slice.ended_at);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) {
      // Preserve malformed entries for diagnosis rather than quietly losing time.
      unique.push(slice);
      continue;
    }
    let remaining: Array<[number, number]> = [[a, b]];
    for (const [start, end] of occupied) {
      remaining = remaining.flatMap(([left, right]) => {
        if (end <= left || start >= right) return [[left, right] as [number, number]];
        const fragments: Array<[number, number]> = [];
        if (left < start) fragments.push([left, start]);
        if (end < right) fragments.push([end, right]);
        return fragments;
      });
      if (!remaining.length) break;
    }
    for (const [start, end] of remaining) {
      if (end - start < 1000) continue;
      const unchanged = start === a && end === b;
      const part: AttendanceDailySlice = unchanged ? slice : {
        ...slice,
        source_key: createSourceKey(),
        started_at: new Date(start).toISOString(),
        ended_at: new Date(end).toISOString(),
      };
      unique.push(part);
      occupied.push([start, end]);
    }
  }
  return unique;
}

/**
 * Rebuild queued slices that carry a stale local day, for example after a
 * desktop timezone change. Never change the credited duration or invent time.
 * All repaired pieces receive new stable source keys before an RPC retry.
 *
 * This is deliberately NOT a workaround for time outside a session, in the
 * future, or during a break: those intervals require explicit review.
 */
export function repairPendingAttendanceDailySliceDates(
  pending: AttendanceDailySlice[],
  createSourceKey: () => string,
): AttendanceDailySlice[] {
  const formatters = new Map<string, Intl.DateTimeFormat>();
  const localDate = (timestampMs: number, zone: string) => {
    let formatter = formatters.get(zone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      });
      formatters.set(zone, formatter);
    }
    const parts = formatter.formatToParts(new Date(timestampMs));
    const field = (name: string) => parts.find((part) => part.type === name)?.value || '';
    return `${field('year')}-${field('month')}-${field('day')}`;
  };

  return pending.flatMap((slice) => {
    const originalStart = Date.parse(slice.started_at);
    const originalEnd = Date.parse(slice.ended_at);
    if (!Number.isFinite(originalStart) || !Number.isFinite(originalEnd) ||
        originalEnd - originalStart < 1000) return [slice];

    try {
      const pieces: AttendanceDailySlice[] = [];
      let cursor = originalStart;
      while (cursor < originalEnd) {
        const date = localDate(cursor, slice.time_zone);
        let end = Math.min(originalEnd, cursor + MAX_ATTENDANCE_SLICE_MS);
        if (localDate(end - 1, slice.time_zone) !== date) {
          // Find the first whole second belonging to the following local day.
          // Both endpoints are second-granular in the persisted attendance queue.
          let lo = cursor;
          let hi = end;
          while (hi - lo > 1000) {
            const mid = Math.floor((lo + hi) / 2000) * 1000;
            if (localDate(mid, slice.time_zone) === date) lo = mid;
            else hi = mid;
          }
          end = hi;
        }
        if (end <= cursor) return [slice];
        const unchanged = cursor === originalStart && end === originalEnd &&
          date === slice.local_work_date;
        pieces.push(unchanged ? slice : {
          ...slice,
          source_key: createSourceKey(),
          started_at: new Date(cursor).toISOString(),
          ended_at: new Date(end).toISOString(),
          local_work_date: date,
        });
        cursor = end;
      }
      return pieces;
    } catch {
      // Leave invalid timezone/payload untouched so the server can reject it
      // with an actionable error instead of silently discarding attendance.
      return [slice];
    }
  });
}
