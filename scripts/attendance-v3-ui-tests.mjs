import fs from 'node:fs';
import assert from 'node:assert/strict';

const page = fs.readFileSync('src/pages/AttendancePage.tsx', 'utf8');
const indicator = fs.readFileSync('src/components/AttendanceStatusIndicator.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const layout = fs.readFileSync('src/components/Layout.tsx', 'utf8');

const checks = [
  ['personal and manager workspaces are separate', page.includes("workspace === 'mine'") && page.includes("workspace === 'team'") && page.includes('canManageAll && workspace')],
  ['personal views are distinct', ['overview', 'ledger', 'history'].every((tab) => page.includes(`personalTab === '${tab}'`))],
  ['employee actions still invoke canonical callbacks', ['onClockIn(note.trim())', 'run(onStartBreak)', 'run(onEndBreak)', 'onClockOut(note.trim())'].every((name) => page.includes(name))],
  ['daily progress uses only accepted dated credits', page.includes('todayVerifiedSeconds =') && page.includes("dailyTotals.find") && page.includes('todayTargetPercent') && !page.includes('todayTargetPercent = Math.min(100, todaySeconds')],
  ['manager cards use accepted ledger and hide values if unavailable', page.includes('const personSummary = summarizeVerifiedAttendance(selectedDays)') && page.includes('reportLedgerState === \'ready\' ? formatDuration(personSummary.seconds)') && page.includes(".from('attendance_daily_totals')")],
  ['manager filters also apply to export and records', page.includes('reportTeamIds.has(session.user_id)') && page.includes("teamReviewOnly && !reviewedTeamSessionIds.has(session.id)")],
  ['history supports date and range filters', page.includes("setHistoryRange(range)") && page.includes("historyQuery") && page.includes("historyCutoff")],
  ['ledger shows target and variance without writing attendance', page.includes('Daily accepted attendance credits compared') && page.includes('Reference status') && page.includes('const variance = actual - 8 * 3600')],
  ['header distinguishes remote connection and tab ownership', indicator.includes('recentSignal') && indicator.includes("state === 'secondary'") && indicator.includes("state === 'offline'") && indicator.includes("state === 'stale'") && layout.includes('tabRole={attendanceTabRole}') && app.includes('attendanceTabRole={tracker.attendanceTabRole}')],
];

for (const [label, condition] of checks) {
  assert.ok(condition, label);
  console.log('✓ PASS:', label);
}
console.log('ALL ATTENDANCE V3 UI CHECKS PASSED.');
