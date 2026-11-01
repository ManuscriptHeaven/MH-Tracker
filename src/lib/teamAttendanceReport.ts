export type TeamAttendancePeriod = 'today' | '7d' | '30d' | 'thisMonth' | 'lastMonth' | 'month';

export type AttendanceReportPeriod = {
  startDate: string;
  endDateExclusive: string;
  label: string;
};

function dateKey(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

/**
 * Dated verified attendance periods are calendar-date ranges, not rolling
 * session-clock intervals. End is exclusive for exact month boundaries.
 * The dashboard works in the viewer's local calendar, matching the other
 * attendance date presentation. Server-ledger dates remain authoritative.
 */
export function resolveTeamAttendancePeriod(
  period: TeamAttendancePeriod,
  now: Date,
  selectedMonth: string,
): AttendanceReportPeriod {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  if (period === 'today') {
    return { startDate: dateKey(today), endDateExclusive: dateKey(tomorrow), label: 'Today' };
  }
  if (period === '7d' || period === '30d') {
    const days = period === '7d' ? 7 : 30;
    return {
      startDate: dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1)),
      endDateExclusive: dateKey(tomorrow),
      label: `Last ${days} calendar days`,
    };
  }
  if (period === 'thisMonth') {
    return { startDate: dateKey(thisMonthStart), endDateExclusive: dateKey(nextMonthStart), label: thisMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
  }
  if (period === 'lastMonth') {
    return { startDate: dateKey(lastMonthStart), endDateExclusive: dateKey(thisMonthStart), label: lastMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
  }
  // Invalid/custom future dates must not accidentally query an unrestricted range.
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(selectedMonth);
  if (!match) throw new Error('Select a valid report month.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1)) {
    throw new Error('Select a current or previous report month.');
  }
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  return {
    startDate: dateKey(start),
    endDateExclusive: dateKey(end),
    label: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
  };
}

export function summarizeVerifiedAttendance(
  rows: ReadonlyArray<{ user_id: string; local_work_date: string; actual_seconds: number | string }>,
) {
  const seconds = rows.reduce((total, day) => total + Math.max(0, Number(day.actual_seconds) || 0), 0);
  const workedDays = rows.filter((day) => Number(day.actual_seconds) >= 60).length;
  const targetSeconds = workedDays * 8 * 3600;
  return { seconds, workedDays, targetSeconds, averageSeconds: workedDays ? seconds / workedDays : 0 };
}
