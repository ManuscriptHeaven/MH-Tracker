import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  fetchAllAcceptedAttendanceIntervals,
  reconcilePendingAttendanceDailySlices,
} from '../src/lib/attendanceDailyLedger.ts';

const base = Date.parse('2026-10-31T08:00:00Z');
const accepted = Array.from({ length: 1016 }, (_, i) => ({
  started_at: new Date(base + i * 30_000).toISOString(),
  ended_at: new Date(base + (i + 1) * 30_000).toISOString(),
}));
let calls = 0;
const loaded = await fetchAllAcceptedAttendanceIntervals(async (from, to) => {
  calls += 1;
  return accepted.slice(from, to + 1);
});
assert.equal(calls, 3, 'all three pages are requested beyond the 1000-row cap');
assert.equal(loaded.length, 1016, 'last 16 accepted intervals must not be omitted');
assert.deepEqual(loaded.at(-1), accepted.at(-1));

let key = 0;
const uuid = () => `recovered-${++key}`;
const queuedOverlap = [{
  source_key: 'original-pending',
  started_at: accepted[1015].started_at,
  ended_at: accepted[1015].ended_at,
  local_work_date: '2026-10-31',
  time_zone: 'UTC',
}];
const recovered = reconcilePendingAttendanceDailySlices(queuedOverlap, loaded, uuid);
assert.equal(recovered.length, 0, 'already-credited overlapping pending interval is safely removed after readback');
assert.equal(queuedOverlap[0].source_key, 'original-pending', 'input queue is never mutated');

const unsyncedTail = [{
  ...queuedOverlap[0],
  ended_at: new Date(Date.parse(accepted[1015].ended_at) + 10_000).toISOString(),
}];
const trimmed = reconcilePendingAttendanceDailySlices(unsyncedTail, loaded, uuid);
assert.equal(trimmed.length, 1, 'uncredited tail is kept for retry');
assert.equal(trimmed[0].started_at, accepted[1015].ended_at);
assert.equal(trimmed[0].ended_at, unsyncedTail[0].ended_at);
assert.notEqual(trimmed[0].source_key, unsyncedTail[0].source_key, 'trimmed slice gets a new stable idempotency key');

await assert.rejects(
  fetchAllAcceptedAttendanceIntervals(async (from, to) => {
    if (from > 0) throw new Error('database read failed');
    return accepted.slice(from, to + 1);
  }),
  /database read failed/,
  'failed later page must not be silently treated as complete history',
);

const tracker = fs.readFileSync('src/lib/useTracker.ts','utf8');
assert(tracker.includes('fetchAllAcceptedAttendanceIntervals(async (from, to) => {'));
assert(tracker.includes(".eq('session_id', activeSession.id)") && tracker.includes(".order('started_at', { ascending: true })") && tracker.includes('.range(from, to)'));
assert(tracker.includes("query.gt('ended_at', windowStart)") && tracker.includes("query.lt('started_at', windowEnd)"));
assert(tracker.includes('writePendingAttendanceDailySlices(currentProfile.id, activeSession.id, repaired)'));
assert(tracker.includes('allCreditedTimeSynced === false'), 'failed sync must keep queued attendance and block unsafe data loss');

console.log('ALL ATTENDANCE OVERLAP PAGINATION TESTS PASSED.');
