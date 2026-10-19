import { splitAttendanceIntervalByLocalDate, sumAttendanceDailySliceSeconds, mergeAttendanceDailySlices, readPendingAttendanceDailySlices, writePendingAttendanceDailySlices } from '../src/lib/attendanceDailyLedger.ts';
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


const simulatedStorage = new Map();
globalThis.window = { localStorage: {
  getItem: (k) => simulatedStorage.get(k) ?? null,
  setItem: (k, v) => simulatedStorage.set(k, String(v)),
  removeItem: (k) => simulatedStorage.delete(k),
}};
writePendingAttendanceDailySlices('user1', 'session1', crossing);
assert(readPendingAttendanceDailySlices('user1','session1').length === 2,
  'queued offline slices survive a simulated restart');
assert(readPendingAttendanceDailySlices('user2','session1').length === 0,
  'pending slices cannot leak into a different user storage key');
writePendingAttendanceDailySlices('user1','session1',[]);
assert(readPendingAttendanceDailySlices('user1','session1').length === 0,
  'acknowledged offline slices are removed from the queue');
delete globalThis.window;

const tracker = fs.readFileSync('src/lib/useTracker.ts','utf8');
assert(tracker.includes("supabase.rpc('attendance_sync_daily_slices'") &&
  tracker.includes('pendingDailySlices: AttendanceDailySlice[]') &&
  tracker.includes('splitAttendanceIntervalByLocalDate') &&
  tracker.includes('recordAttendanceDailySlices(batch)'),
  'attendance runtime sends dated slices using the new server RPC');
assert(tracker.includes('await recordAttendanceHeartbeat(legacySeconds)') &&
  !tracker.includes('runtime.pendingSeconds += elapsedSeconds'),
  'pre-ledger scalar queue remains separately attributable instead of becoming fabricated daily credits');
assert(tracker.includes('allCreditedTimeSynced === false') &&
  tracker.includes('Unsynced attendance is still queued'),
  'manual break/clock-out cannot silently discard failed offline daily syncs');

const sql = fs.readFileSync('supabase/migrations/20261019000100_attendance_daily_credits.sql','utf8');
assert(sql.includes('enable row level security') && sql.includes('for select to authenticated') && sql.includes('auth.uid()'), 'ledger has actor-scoped read RLS');
assert(sql.includes('revoke all on public.attendance_daily_credits') && sql.includes('grant select on public.attendance_daily_credits'), 'clients cannot insert directly');
assert(sql.includes('source_key uuid not null') && sql.includes('attendance_daily_credit_source_unique'), 'source keys are deduplicated by database');
assert(sql.includes('references public.attendance_sessions(id) on delete restrict') &&
       sql.includes('references public.profiles(id) on delete restrict'),
  'ledger records cannot disappear silently when an employee or session is deleted');
assert(sql.includes("create or replace function public.attendance_start_break()") &&
       sql.includes("create or replace function public.attendance_clock_out(p_note text default null)"),
  'break/clock-out are updated to prevent legacy auto-credit after daily sync');
assert(sql.includes('for update') && sql.includes('attendance_slice_overlap'), 'per-session lock prevents overlapping concurrent tab/device credits');
assert(sql.includes('attendance_slice_overlaps_break') && sql.includes('v_max_verified'), 'break overlaps and impossible session totals are refused');
assert(sql.includes("at time zone v_time_zone") && sql.includes('attendance_slice_outside_session_or_day'), 'server validates the local work date');
assert(!sql.includes('update public.attendance_daily_credits c set local_work_date'), 'migration does not fabricate historical days');


const page = fs.readFileSync('src/pages/AttendancePage.tsx','utf8');
assert(sql.includes('attendance_session_credit_reconciliation') &&
       sql.includes('unattributed_seconds') &&
       sql.includes('with (security_invoker = true)') &&
       sql.includes('attendance_daily_totals'),
  'security-invoker reporting separates accepted dated time from legacy historical seconds');
assert(page.includes("from('attendance_daily_totals')") &&
       page.includes("from('attendance_session_credit_reconciliation')") &&
       page.includes("ledgerState === 'ready'") &&
       page.includes('Month · Dated actual') &&
       page.includes('Historical · Unattributed') &&
       page.includes('mh-attendance-daily-verified.csv'),
  'attendance UI shows real server accepted daily dates and a read-only export');
assert(sql.includes('from public.attendance_sessions s') &&
       sql.includes('s.id = attendance_daily_credits.session_id'),
  'daily ledger visibility inherits existing parent attendance session RLS');

if (process.exitCode) console.error('Attendance daily ledger foundation tests FAILED.');
else console.log('ALL ATTENDANCE DAILY LEDGER FOUNDATION TESTS PASSED.');
