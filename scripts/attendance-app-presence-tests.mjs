import fs from 'node:fs';

function assert(condition, message) {
  if (!condition) {
    console.error('✗ FAIL: ' + message);
    process.exitCode = 1;
    return;
  }
  console.log('✓ PASS: ' + message);
}

const migration = fs.readFileSync('supabase/migrations/20260921000800_attendance_app_presence.sql', 'utf8');
const offlineMigration = fs.readFileSync('supabase/migrations/20260923122430_attendance_offline_resilience.sql', 'utf8');
const tracker = fs.readFileSync('src/lib/useTracker.ts', 'utf8');
const page = fs.readFileSync('src/pages/AttendancePage.tsx', 'utf8');
const types = fs.readFileSync('src/lib/types.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');

console.log('--- Attendance App Presence Regression Tests ---');

assert(
  migration.includes('verified_seconds bigint not null default 0') &&
    migration.includes('last_app_heartbeat_at timestamptz') &&
    migration.includes('presence_client_kind text'),
  'attendance sessions persist verified app time and last desktop heartbeat',
);

assert(
  migration.includes('attendance_record_heartbeat') &&
    migration.includes("p_client_kind <> 'desktop_web'") &&
    migration.includes('v_elapsed <= 90'),
  'original server heartbeat keeps the strict compatibility lease for older clients',
);

assert(
  offlineMigration.includes('p_client_elapsed_seconds bigint default null') &&
    offlineMigration.includes('v_max_verified') &&
    offlineMigration.includes('v_credit := least(') &&
    offlineMigration.includes('v_client_elapsed') &&
    offlineMigration.includes("grant execute on function public.attendance_record_heartbeat(text, bigint) to authenticated"),
  'new heartbeat accepts locally measured elapsed time and caps credit to physically possible non-break session time',
);

assert(
  migration.includes('create or replace function public.attendance_start_break') &&
    migration.includes('create or replace function public.attendance_end_break') &&
    migration.includes('create or replace function public.attendance_clock_out'),
  'break and clock-out actions cooperate with presence accounting',
);

assert(
  tracker.includes('function isDesktopAttendanceClient()') &&
    tracker.includes("supabase.rpc('attendance_record_heartbeat'") &&
    tracker.includes("p_client_kind: 'desktop_web'") &&
    tracker.includes('p_client_elapsed_seconds: safeElapsedSeconds') &&
    tracker.includes('window.setInterval(() => void flushPresence(), 30_000)'),
  'MH Tracker syncs locally measured desktop attendance slices every 30 seconds',
);

assert(
  tracker.includes('ATTENDANCE_PENDING_STORAGE_PREFIX') &&
    tracker.includes('writeAttendancePendingSeconds') &&
    tracker.includes('accrueLocalPresence') &&
    tracker.includes('navigator.onLine') &&
    tracker.includes("window.addEventListener('online'") &&
    tracker.includes("window.addEventListener('pageshow'") &&
    tracker.includes("window.addEventListener('pagehide'") &&
    tracker.includes("document.addEventListener('visibilitychange'"),
  'attendance keeps a local offline queue and checkpoints minimize/page lifecycle events without counting time after the page closes',
);

assert(
  tracker.includes('await attendanceFlushRef.current?.();') &&
    tracker.includes('Never let realtime move that timer backward'),
  'break/clock-out actions flush pending time and realtime cannot roll the local timer backward',
);

assert(
  types.includes('verified_seconds?: number') &&
    types.includes('last_app_heartbeat_at?: string | null') &&
    types.includes('presence_client_kind?: string | null'),
  'frontend attendance model carries verified presence state',
);

assert(
  page.includes('APP_PRESENCE_STALE_MS = 90_000') &&
    page.includes('Working · Verified') &&
    page.includes('Working · Offline') &&
    page.includes('Offline tracking is active.') &&
    page.includes('App closed · Time paused') &&
    page.includes('Verified attendance requires a laptop or desktop') &&
    page.includes('Mobile can be used to review attendance'),
  'attendance UI distinguishes online verified time, offline queued time, closed-app pauses and mobile review-only mode',
);

assert(
  page.includes('Verified App Hours') &&
    page.includes('Time paused · last app signal') &&
    page.includes('Verified live') &&
    app.includes('desktopAttendanceCapable={tracker.desktopAttendanceCapable}'),
  'manager reporting and CSV exports use verified app-presence time',
);

if (process.exitCode) {
  console.error('Attendance app presence checks failed.');
} else {
  console.log('ALL ATTENDANCE APP PRESENCE CHECKS PASSED.');
}
