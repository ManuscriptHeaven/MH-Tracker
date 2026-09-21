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
    migration.includes('v_elapsed <= 90') &&
    migration.includes('v_row.verified_seconds := v_row.verified_seconds + v_elapsed'),
  'server heartbeat credits only desktop presence and ignores gaps over 90 seconds',
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
    tracker.includes('window.setInterval(() => void pulse(), 30_000)') &&
    tracker.includes("p_client_kind: 'desktop_web'"),
  'MH Tracker sends a desktop heartbeat every 30 seconds while an active session exists',
);

assert(
  tracker.includes("attendance_not_clocked_in") &&
    tracker.includes('navigator.onLine') &&
    tracker.includes("window.addEventListener('online'") &&
    tracker.includes("window.addEventListener('pageshow'"),
  'heartbeat loop tolerates offline/reopen conditions without creating fake time',
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
    page.includes('App closed · Time paused') &&
    page.includes('Verified attendance requires a laptop or desktop') &&
    page.includes('Mobile can be used to review attendance'),
  'attendance UI clearly distinguishes verified desktop time, closed-app pauses and mobile review-only mode',
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
