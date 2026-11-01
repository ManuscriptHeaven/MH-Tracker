import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveTeamAttendancePeriod, summarizeVerifiedAttendance } from '../src/lib/teamAttendanceReport.ts';

const november = new Date(2026, 10, 1, 17, 30);
assert.deepEqual(resolveTeamAttendancePeriod('lastMonth', november, '2026-11'), {
  startDate: '2026-10-01', endDateExclusive: '2026-11-01', label: 'October 2026',
});
assert.deepEqual(resolveTeamAttendancePeriod('thisMonth', november, '2026-11'), {
  startDate: '2026-11-01', endDateExclusive: '2026-12-01', label: 'November 2026',
});
assert.equal(resolveTeamAttendancePeriod('7d', november, '2026-11').startDate, '2026-10-26');
assert.equal(resolveTeamAttendancePeriod('30d', november, '2026-11').startDate, '2026-10-03');
assert.equal(resolveTeamAttendancePeriod('today', november, '2026-11').endDateExclusive, '2026-11-02');
assert.deepEqual(resolveTeamAttendancePeriod('lastMonth', new Date(2027, 0, 11), '2027-01'), {
  startDate: '2026-12-01', endDateExclusive: '2027-01-01', label: 'December 2026',
});
assert.deepEqual(resolveTeamAttendancePeriod('month', november, '2024-02'), {
  startDate: '2024-02-01', endDateExclusive: '2024-03-01', label: 'February 2024',
});
assert.throws(() => resolveTeamAttendancePeriod('month', november, '2027-01'), /current or previous/);
assert.throws(() => resolveTeamAttendancePeriod('month', november, 'all'), /valid report month/);

const days = [
  { user_id: 'zain', local_work_date: '2026-10-12', actual_seconds: '28800' },
  { user_id: 'zain', local_work_date: '2026-10-13', actual_seconds: 14400 },
  { user_id: 'zain', local_work_date: '2026-10-14', actual_seconds: '0' },
];
const report = summarizeVerifiedAttendance(days);
assert.equal(report.seconds, 43200);
assert.equal(report.workedDays, 2);
assert.equal(report.targetSeconds, 57600);
assert.equal(report.averageSeconds, 21600);

const page = fs.readFileSync('src/pages/AttendancePage.tsx', 'utf8');
assert.ok(page.includes("useState<TeamAttendancePeriod>('lastMonth')"));
assert.ok(page.includes("['lastMonth', 'Last month']"));
assert.ok(page.includes("['month', 'Choose month']"));
assert.ok(page.includes('type="month" value={teamMonth}'));
assert.ok(page.includes(".gte('local_work_date', reportPeriod.startDate)"));
assert.ok(page.includes(".lt('local_work_date', reportPeriod.endDateExclusive)"));
assert.ok(page.includes(".order('local_work_date', { ascending: false })"));
assert.ok(page.includes('.range(page * pageSize, (page + 1) * pageSize - 1)'));
assert.ok(page.includes('const reportTeamIds = new Set(reportTeamProfiles.map'));
assert.ok(page.includes('const reportDays = reportLedger.filter'));
assert.ok(page.includes('const reportSummary = summarizeVerifiedAttendance(reportDays)'));
assert.ok(page.includes('function exportVerifiedCsv()'));
assert.ok(page.includes('No accepted verified credits for this selection'));
assert.ok(page.includes('Live status (live cards only)'));
assert.ok(page.includes('Session details & corrections'));
assert.ok(page.includes('Whole-session recorded hours · Provisional'));
console.log('ALL TEAM ATTENDANCE PERIOD REPORT TESTS PASSED');
