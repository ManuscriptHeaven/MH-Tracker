import fs from 'node:fs';

function assert(condition, message) {
  if (!condition) {
    console.error('✗ FAIL: ' + message);
    process.exitCode = 1;
    return;
  }
  console.log('✓ PASS: ' + message);
}

const migration = fs.readFileSync('supabase/migrations/20260921000101_team_attendance.sql', 'utf8');
const tracker = fs.readFileSync('src/lib/useTracker.ts', 'utf8');
const types = fs.readFileSync('src/lib/types.ts', 'utf8');
const page = fs.readFileSync('src/pages/AttendancePage.tsx', 'utf8');
const layout = fs.readFileSync('src/components/Layout.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');

console.log('--- Team Attendance Regression Tests ---');

assert(
  migration.includes('create table if not exists public.attendance_sessions') &&
  migration.includes('create table if not exists public.attendance_breaks') &&
  migration.includes('attendance_one_active_session_per_user') &&
  migration.includes('attendance_one_active_break_per_session'),
  'attendance schema prevents duplicate active sessions and duplicate active breaks',
);

assert(
  migration.includes('attendance_sessions_select') &&
  migration.includes('attendance_breaks_select') &&
  migration.includes("phase6_app_actor_class() in ('admin','project_manager')") &&
  migration.includes('user_id = auth.uid()'),
  'RLS keeps personal attendance private while managers can review team records',
);

assert(
  migration.includes('attendance_clock_in') &&
  migration.includes('attendance_clock_out') &&
  migration.includes('attendance_start_break') &&
  migration.includes('attendance_end_break') &&
  migration.includes('security definer') &&
  migration.includes('set search_path = public, pg_temp'),
  'clock actions are server-timestamped through hardened RPCs',
);

assert(
  migration.includes('attendance_admin_adjust_session') &&
  migration.includes("coalesce(public.phase6_app_actor_class(), '') <> 'admin'") &&
  migration.includes('adjustment_reason') &&
  migration.includes('length(btrim(coalesce(p_reason'),
  'only Admin can correct completed attendance and every correction requires an audit reason',
);

assert(
  types.includes('export interface AttendanceSession') &&
  types.includes('export interface AttendanceBreak') &&
  types.includes('attendanceSessions?: AttendanceSession[]') &&
  types.includes('attendanceBreaks?: AttendanceBreak[]'),
  'attendance records are represented in tracker data',
);

assert(
  tracker.includes("supabase.rpc('attendance_clock_in'") &&
  tracker.includes("supabase.rpc('attendance_clock_out'") &&
  tracker.includes("supabase.rpc('attendance_start_break'") &&
  tracker.includes("supabase.rpc('attendance_end_break'") &&
  tracker.includes("supabase.rpc('attendance_admin_adjust_session'"),
  'tracker exposes clock, break and correction actions',
);

assert(
  tracker.includes("table: 'attendance_sessions'") &&
  tracker.includes("table: 'attendance_breaks'") &&
  migration.includes('alter publication supabase_realtime add table public.attendance_sessions') &&
  migration.includes('alter publication supabase_realtime add table public.attendance_breaks'),
  'attendance changes synchronize in realtime across team and manager panels',
);

assert(
  page.includes('Clock In') &&
  page.includes('Clock Out') &&
  page.includes('Start Break') &&
  page.includes('End Break') &&
  page.includes('Today') &&
  page.includes('This week') &&
  page.includes('This month') &&
  page.includes('Days worked'),
  'team members can track live office time, breaks and personal attendance totals',
);

assert(
  page.includes('Team attendance today') &&
  page.includes('Team attendance records') &&
  page.includes('Export CSV') &&
  page.includes('Correct attendance record'),
  'management gets live team status, history, CSV export and admin corrections',
);

assert(
  layout.includes("| 'attendance'") &&
  layout.includes("attendance: 'Time & Attendance'") &&
  layout.includes("{ id: 'attendance', label: 'Attendance'") &&
  layout.includes("{ id: 'attendance', label: 'Time'") &&
  app.includes("activeView === 'attendance'") &&
  app.includes('<AttendancePage'),
  'attendance is accessible on desktop and mobile for internal team accounts',
);

if (process.exitCode) {
  console.error('Team attendance checks failed.');
} else {
  console.log('ALL TEAM ATTENDANCE CHECKS PASSED.');
}
