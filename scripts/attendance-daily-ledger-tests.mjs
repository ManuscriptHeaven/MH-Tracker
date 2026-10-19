import { splitAttendanceIntervalByLocalDate, sumAttendanceDailySliceSeconds, mergeAttendanceDailySlices } from '../src/lib/attendanceDailyLedger.ts';
import fs from 'node:fs';

function assert(condition, message) {
  if (!condition) {
    process.exitCode = 1;
    console.error('✗ FAIL: ' + message);
  } else {
    console.log('✓ PASS: ' + message);
  }
}

console.log('--- Attendance V2 Daily Ledger Foundation Tests ---');

let next = 0;
const key = () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`;

const today = new Date(2026, 9, 19, 12, 0, 0);
const single = splitAttendanceIntervalByLocalDate(today.getTime(), today.getTime() + 15_000, key);
assert(single.length === 1 && sumAttendanceDailySliceSeconds(single) === 15, '15 seconds remain one dated slice');
assert(single[0].started_at !== single[0].ended_at, 'one slice has a nonempty interval');

const beforeMidnight = new Date(2026, 9, 19, 23, 59, 50);
const crossing = splitAttendanceIntervalByLocalDate(beforeMidnight.getTime(), beforeMidnight.getTime() + 30_000, key);
assert(crossing.length === 2, '30-second interval across local midnight is split');
assert(crossing[0].local_work_date === '2026-10-19' && crossing[1].local_work_date === '2026-10-20', 'each date uses the earned local work date');
assert(sumAttendanceDailySliceSeconds(crossing) === 30, 'midnight splitting preserves all 30 earned seconds without double counting');
assert(crossing[0].ended_at === crossing[1].started_at, 'split intervals are contiguous and not overlapping');
assert(new Set(crossing.map((x) => x.source_key)).size === 2, 'every slice has a different stable idempotency key');
assert(mergeAttendanceDailySlices(crossing, crossing).length === 2, 'retransmitted slices preserve idempotency keys');

const subSecond = splitAttendanceIntervalByLocalDate(beforeMidnight.getTime() + 450, beforeMidnight.getTime() + 30_450, key);
assert(sumAttendanceDailySliceSeconds(subSecond) === 30, 'sub-second timestamps do not create midnight rounding loss');

const long = splitAttendanceIntervalByLocalDate(new Date(2026, 9, 19, 0, 0).getTime(), new Date(2026, 9, 20, 23, 59).getTime(), key);
assert(long.length >= 4 && long.every(x => {
  const seconds = sumAttendanceDailySliceSeconds([x]);
  return seconds > 0 && seconds <= 16 * 3600;
}), 'very long minimized intervals split into bounded single-day server slices');

assert(splitAttendanceIntervalByLocalDate(10_000, 10_000, key).length === 0, 'no time credited for zero-duration slice');
assert(splitAttendanceIntervalByLocalDate(10_000, 9_000, key).length === 0, 'backward clock does not credit time');

const sql = fs.readFileSync('supabase/migrations/20261019000100_attendance_daily_credits.sql','utf8');
assert(sql.includes('enable row level security') && sql.includes('for select to authenticated') && sql.includes('auth.uid()'), 'ledger has actor-scoped read RLS');
assert(sql.includes('revoke all on public.attendance_daily_credits') && sql.includes('grant select on public.attendance_daily_credits'), 'clients cannot insert directly');
assert(sql.includes('source_key uuid not null') && sql.includes('attendance_daily_credit_source_unique'), 'source keys are deduplicated by database');
assert(sql.includes('for update') && sql.includes('attendance_slice_overlap'), 'per-session lock prevents overlapping concurrent tab/device credits');
assert(sql.includes('attendance_slice_overlaps_break') && sql.includes('v_max_verified'), 'break overlaps and impossible session totals are refused');
assert(sql.includes("at time zone v_time_zone") && sql.includes('attendance_slice_outside_session_or_day'), 'server validates the local work date');
assert(!sql.includes('update public.attendance_daily_credits c set local_work_date'), 'migration does not fabricate historical days');

if (process.exitCode) console.error('Attendance daily ledger foundation tests FAILED.');
else console.log('ALL ATTENDANCE DAILY LEDGER FOUNDATION TESTS PASSED.');
