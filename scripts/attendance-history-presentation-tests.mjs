import fs from 'node:fs';
import {
  formatEightHourDayEquivalent,
  groupAttendanceHistoryByDay,
} from '../src/lib/attendanceHistoryPresentation.ts';

function assert(condition, message) {
  if (!condition) { console.error('✗ FAIL: ' + message); process.exitCode = 1; }
  else console.log('✓ PASS: ' + message);
}

console.log('--- Attendance 8h Day Equivalents and Date Disclosure UI ---');

assert(formatEightHourDayEquivalent((112 * 60 + 26) * 60) === '14d 0h 26m',
  '112h 26m displays 14 eight-hour equivalents plus 26 minutes');
assert(formatEightHourDayEquivalent((111 * 60 + 49) * 60) === '13d 7h 49m',
  '111h 49m displays 13 eight-hour equivalents plus 7h 49m');
assert(formatEightHourDayEquivalent(8 * 3600) === '1d 0h 0m',
  'exactly eight hours equals one full equivalent');
assert(formatEightHourDayEquivalent(0) === '0d 0h 0m' &&
  formatEightHourDayEquivalent(-3600) === '0d 0h 0m' &&
  formatEightHourDayEquivalent(Number.NaN) === '0d 0h 0m',
  'zero, negative and invalid inputs do not create fictitious days');

const time = (day, hour) => new Date(2026, 9, day, hour, 0, 0).toISOString();
const sessions = [
  { id: 'one', clock_in: time(19, 13) },
  { id: 'two', clock_in: time(21, 9) },
  { id: 'three', clock_in: time(21, 10) },
  { id: 'four', clock_in: time(20, 20), clock_out: time(21, 2) },
];
const before = JSON.stringify(sessions);
const grouped = groupAttendanceHistoryByDay(sessions);
assert(grouped.length === 3 && grouped.map(g => g.dateKey).join(',') ===
  '2026-10-21,2026-10-20,2026-10-19',
  'history returns newest clock-in dates first');
assert(grouped[0].sessions.length === 2 && grouped[0].sessions[0].id === 'three',
  'multiple same-day sessions are grouped and newest session appears first');
assert(grouped[1].sessions[0].id === 'four',
  'session crossing midnight stays under clock-in date, never inventing daily credits');
assert(JSON.stringify(sessions) === before,
  'history presentation sorting never mutates tracker sessions');

const page = fs.readFileSync('src/pages/AttendancePage.tsx', 'utf8');
assert(page.includes('Session records · Provisional') &&
  page.includes("formatDuration(monthSeconds)") &&
  page.includes("formatEightHourDayEquivalent(legacyUnattributedSeconds)") &&
  page.includes('excluded from verified daily totals'),
  'provisional session totals stay distinct from verified daily credits');
assert(page.includes("formatDuration(monthSeconds)") &&
  page.includes("formatDuration(legacyUnattributedSeconds)") &&
  page.includes('Month · Verified actual') &&
  page.includes('Days with verified time'),
  'raw durations remain visible and accepted dated actuals remain separate');
assert(page.includes('groupAttendanceHistoryByDay(mySessions)') &&
  page.includes('<details key={day.dateKey}') &&
  page.includes('<summary') &&
  page.includes('group-open:rotate-180') &&
  page.includes('Show all'),
  'personal history uses keyboard-accessible native compact date disclosures');
assert(page.includes('sessionBreaks.length') &&
  page.includes('session.adjustment_reason') &&
  page.includes('session.note') &&
  page.includes('getSessionSeconds(session, myBreaks, nowMs)'),
  'expanded dates retain recorded duration, break and correction details');

if (process.exitCode) console.error('ATTENDANCE PRESENTATION CERTIFICATION FAILED');
else console.log('ALL ATTENDANCE PRESENTATION CERTIFICATION CHECKS PASSED');
