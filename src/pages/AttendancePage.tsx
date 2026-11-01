import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronDown,
  Coffee,
  Download,
  History,
  Laptop2,
  LogIn,
  LogOut,
  PauseCircle,
  Pencil,
  PlayCircle,
  TimerReset,
  Users,
  WifiOff,
} from 'lucide-react';
import { Button, Card, Field, TextareaField } from '../components/ui';
import { roleLabels } from '../lib/constants';
import { resolveTeamAttendancePeriod, summarizeVerifiedAttendance, type TeamAttendancePeriod } from '../lib/teamAttendanceReport';
import { formatEightHourDayEquivalent, groupAttendanceHistoryByDay } from '../lib/attendanceHistoryPresentation';
import { supabase } from '../lib/supabase';
import { isClientRole } from '../lib/utils';
import type { AttendanceBreak, AttendanceSession, Profile } from '../lib/types';

type AttendanceDayTotal = {
  user_id: string;
  local_work_date: string;
  actual_seconds: number | string;
  counts_as_day_worked: boolean;
  accepted_slices: number | string;
};

type AttendanceSessionReconciliation = {
  session_id: string;
  user_id: string;
  clock_in: string;
  clock_out: string | null;
  recorded_seconds: number | string;
  dated_seconds: number | string;
  unattributed_seconds: number | string;
  overcredited_discrepancy_seconds: number | string;
  crosses_24h: boolean;
};

type Props = {
  currentProfile: Profile;
  profiles: Profile[];
  sessions: AttendanceSession[];
  breaks: AttendanceBreak[];
  canManageAll: boolean;
  desktopAttendanceCapable: boolean;
  attendanceTabRole: 'leader' | 'secondary' | 'unsupported';
  onRequestAttendanceTakeover: () => boolean;
  onClockIn: (note?: string) => Promise<AttendanceSession>;
  onClockOut: (note?: string) => Promise<AttendanceSession>;
  onStartBreak: () => Promise<AttendanceBreak>;
  onEndBreak: () => Promise<AttendanceBreak>;
  onAdjustSession: (sessionId: string, clockIn: string, clockOut: string, reason: string) => Promise<AttendanceSession>;
};

function formatDuration(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function formatTimer(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((safe % 3600) / 60).toString().padStart(2, '0');
  const seconds = (safe % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function localDayKey(value: string | Date) {
  const d = typeof value === 'string' ? new Date(value) : value;
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + delta);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

const APP_PRESENCE_STALE_MS = 90_000;

function isPresenceFresh(session: AttendanceSession | null, nowMs: number) {
  if (!session?.last_app_heartbeat_at) return false;
  const heartbeat = new Date(session.last_app_heartbeat_at).getTime();
  return Number.isFinite(heartbeat) && nowMs - heartbeat <= APP_PRESENCE_STALE_MS;
}

function getSessionSeconds(session: AttendanceSession, breaks: AttendanceBreak[], nowMs: number) {
  if (typeof session.verified_seconds === 'number') {
    const base = Math.max(0, Number(session.verified_seconds || 0));
    if (session.status !== 'active' || !session.last_app_heartbeat_at) return base;

    const hasActiveBreak = breaks.some(
      (item) => item.session_id === session.id && !item.ended_at,
    );
    if (hasActiveBreak || !isPresenceFresh(session, nowMs)) return base;

    const heartbeat = new Date(session.last_app_heartbeat_at).getTime();
    const liveTail = Math.max(0, Math.floor((nowMs - heartbeat) / 1000));
    return base + Math.min(liveTail, 30);
  }

  // Legacy/demo fallback for records created before verified app-presence accounting.
  const start = new Date(session.clock_in).getTime();
  const end = session.clock_out ? new Date(session.clock_out).getTime() : nowMs;
  const breakSeconds = breaks
    .filter((item) => item.session_id === session.id)
    .reduce((total, item) => {
      const breakStart = new Date(item.started_at).getTime();
      const breakEnd = item.ended_at ? new Date(item.ended_at).getTime() : nowMs;
      return total + Math.max(0, Math.floor((breakEnd - breakStart) / 1000));
    }, 0);
  return Math.max(0, Math.floor((end - start) / 1000) - breakSeconds);
}

function dateTimeLocalValue(value: string) {
  const d = new Date(value);
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 16);
}

export function AttendancePage({
  currentProfile,
  profiles,
  sessions,
  breaks,
  canManageAll,
  desktopAttendanceCapable,
  attendanceTabRole,
  onRequestAttendanceTakeover,
  onClockIn,
  onClockOut,
  onStartBreak,
  onEndBreak,
  onAdjustSession,
}: Props) {
  const [nowMs, setNowMs] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [handoffNotice, setHandoffNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<AttendanceSession | null>(null);
  const [editClockIn, setEditClockIn] = useState('');
  const [editClockOut, setEditClockOut] = useState('');
  const [editReason, setEditReason] = useState('');
  const [teamWindow, setTeamWindow] = useState<TeamAttendancePeriod>('lastMonth');
  const [teamMonth, setTeamMonth] = useState(() => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; });
  const [showAllTeamDays, setShowAllTeamDays] = useState(false);
  const [reportLedger, setReportLedger] = useState<AttendanceDayTotal[]>([]);
  const [reportLedgerState, setReportLedgerState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [workspace, setWorkspace] = useState<'mine' | 'team'>('mine');
  const [personalTab, setPersonalTab] = useState<'overview' | 'ledger' | 'history'>('overview');
  const [teamMemberFilter, setTeamMemberFilter] = useState('all');
  const [teamReviewOnly, setTeamReviewOnly] = useState(false);
  const [teamStatusFilter, setTeamStatusFilter] = useState<'all' | 'working' | 'break' | 'paused' | 'off'>('all');
  const [historyRange, setHistoryRange] = useState<'all' | '7d' | '30d'>('30d');
  const [showOlderHistory, setShowOlderHistory] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [showSessionNote, setShowSessionNote] = useState(false);
  const [showAllLedgerDays, setShowAllLedgerDays] = useState(false);
  const [dailyTotals, setDailyTotals] = useState<AttendanceDayTotal[]>([]);
  const [sessionReconciliation, setSessionReconciliation] = useState<AttendanceSessionReconciliation[]>([]);
  const [ledgerState, setLedgerState] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (attendanceTabRole === 'leader') setHandoffNotice(null);
  }, [attendanceTabRole]);

  useEffect(() => {
    if (!supabase) {
      setLedgerState('unavailable');
      return undefined;
    }

    let disposed = false;
    const refreshLedger = async () => {
      if (!supabase) return;
      const cutoff = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
      const [daysResult, sessionsResult] = await Promise.all([
        supabase.from('attendance_daily_totals')
          .select('user_id,local_work_date,actual_seconds,counts_as_day_worked,accepted_slices')
          .gte('local_work_date', localDayKey(cutoff))
          .order('local_work_date', { ascending: false }),
        supabase.from('attendance_session_credit_reconciliation')
          .select('session_id,user_id,clock_in,clock_out,recorded_seconds,dated_seconds,unattributed_seconds,overcredited_discrepancy_seconds,crosses_24h')
          .gte('clock_in', cutoff.toISOString()),
      ]);

      if (disposed) return;
      if (daysResult.error || sessionsResult.error) {
        // Old deployments must not silently label historical values as verified
        // daily ledger credits when the migration is not installed.
        setLedgerState('unavailable');
        return;
      }
      setDailyTotals((daysResult.data || []) as AttendanceDayTotal[]);
      setSessionReconciliation((sessionsResult.data || []) as AttendanceSessionReconciliation[]);
      setLedgerState('ready');
    };

    void refreshLedger();
    const refreshId = window.setInterval(() => void refreshLedger(), 30_000);
    window.addEventListener('online', refreshLedger);
    return () => {
      disposed = true;
      window.clearInterval(refreshId);
      window.removeEventListener('online', refreshLedger);
    };
  }, [currentProfile.id]);

  // Independent manager report query: not limited to the tracker-wide 120-day
  // session window. Fetch accepted dated credits for the selected calendar
  // period, with stable pagination (PostgREST responses can cap at 1000).
  const reportPeriod = resolveTeamAttendancePeriod(teamWindow, new Date(nowMs), teamMonth);
  useEffect(() => {
    if (!canManageAll || workspace !== 'team' || !supabase) return undefined;
    let cancelled = false;
    const client = supabase;
    const reload = async () => {
      setReportLedgerState('loading');
      try {
        const all: AttendanceDayTotal[] = [];
        const pageSize = 500;
        let complete = false;
        for (let page = 0; page < 20; page += 1) {
          const { data, error: readError } = await client.from('attendance_daily_totals')
            .select('user_id,local_work_date,actual_seconds,counts_as_day_worked,accepted_slices')
            .gte('local_work_date', reportPeriod.startDate)
            .lt('local_work_date', reportPeriod.endDateExclusive)
            .order('local_work_date', { ascending: false })
            .order('user_id', { ascending: true })
            .range(page * pageSize, (page + 1) * pageSize - 1);
          if (readError) throw readError;
          const rows = (data || []) as AttendanceDayTotal[];
          all.push(...rows);
          if (rows.length < pageSize) { complete = true; break; }
        }
        if (!complete) throw new Error('Report exceeds safe pagination limit');
        if (!cancelled) { setReportLedger(all); setReportLedgerState('ready'); }
      } catch {
        if (!cancelled) { setReportLedger([]); setReportLedgerState('unavailable'); }
      }
    };
    void reload();
    // Refresh verified credits periodically without modifying or approving time.
    const refreshId = window.setInterval(() => void reload(), 60_000);
    window.addEventListener('online', reload);
    return () => {
      cancelled = true;
      window.clearInterval(refreshId);
      window.removeEventListener('online', reload);
    };
  }, [canManageAll, workspace, reportPeriod.startDate, reportPeriod.endDateExclusive]);

  const teamProfiles = useMemo(
    () => profiles.filter((profile) => !isClientRole(profile.role) && profile.status !== 'inactive'),
    [profiles],
  );

  const mySessions = useMemo(
    () => sessions.filter((session) => session.user_id === currentProfile.id),
    [currentProfile.id, sessions],
  );
  const myBreaks = useMemo(
    () => breaks.filter((item) => item.user_id === currentProfile.id),
    [breaks, currentProfile.id],
  );
  const historyDays = useMemo(() => groupAttendanceHistoryByDay(mySessions), [mySessions]);
  const historyCutoff = historyRange === 'all' ? 0 : nowMs - (historyRange === '7d' ? 7 : 30) * 86_400_000;
  const filteredHistoryDays = historyDays.filter((day) => day.dateKey.includes(historyQuery.trim().toLowerCase()) && (historyRange === 'all' || day.dateKey === 'unknown' || new Date(`${day.dateKey}T23:59:59`).getTime() >= historyCutoff));
  const visibleHistoryDays = showOlderHistory ? filteredHistoryDays : filteredHistoryDays.slice(0, 5);
  const activeSession = mySessions.find((session) => session.status === 'active') || null;
  const activeBreak = activeSession
    ? myBreaks.find((item) => item.session_id === activeSession.id && !item.ended_at) || null
    : null;

  const todayKey = localDayKey(new Date(nowMs));
  const todaySessions = mySessions.filter((session) => localDayKey(session.clock_in) === todayKey);
  const todaySeconds = todaySessions.reduce((total, session) => total + getSessionSeconds(session, myBreaks, nowMs), 0);

  const weekStart = startOfWeek(new Date(nowMs)).getTime();
  const weekSeconds = mySessions
    .filter((session) => new Date(session.clock_in).getTime() >= weekStart)
    .reduce((total, session) => total + getSessionSeconds(session, myBreaks, nowMs), 0);

  const monthStart = new Date(new Date(nowMs).getFullYear(), new Date(nowMs).getMonth(), 1).getTime();
  const monthSeconds = mySessions
    .filter((session) => new Date(session.clock_in).getTime() >= monthStart)
    .reduce((total, session) => total + getSessionSeconds(session, myBreaks, nowMs), 0);

  const daysWorked = new Set(
    mySessions
      .filter((session) => new Date(session.clock_in).getTime() >= monthStart)
      .map((session) => localDayKey(session.clock_in)),
  ).size;
  const monthKey = localDayKey(new Date(nowMs)).slice(0, 7);
  const myLedgerDays = dailyTotals.filter((day) =>
    day.user_id === currentProfile.id && day.local_work_date.startsWith(monthKey),
  );
  const ledgerMonthSeconds = myLedgerDays.reduce((total, day) => total + Number(day.actual_seconds || 0), 0);
  const ledgerDaysWorked = myLedgerDays.filter((day) => Number(day.actual_seconds || 0) >= 60).length;
  const ledgerTargetSeconds = ledgerDaysWorked * 8 * 3600;
  const todayVerifiedSeconds = Math.max(0, Number(dailyTotals.find((day) => day.user_id === currentProfile.id && day.local_work_date === todayKey)?.actual_seconds || 0));
  const todayTargetPercent = Math.min(100, todayVerifiedSeconds / (8 * 3600) * 100);
  const legacyUnattributedSeconds = sessionReconciliation
    .filter((row) => row.user_id === currentProfile.id && localDayKey(row.clock_in).startsWith(monthKey))
    .reduce((total, row) => total + Number(row.unattributed_seconds || 0), 0);
  const ledgerReviewCount = sessionReconciliation.filter((row) =>
    row.crosses_24h || Number(row.overcredited_discrepancy_seconds || 0) > 0,
  ).length;
  const reviewedTeamSessionIds = new Set(sessionReconciliation
    .filter((row) => row.crosses_24h || Number(row.overcredited_discrepancy_seconds || 0) > 0)
    .map((row) => row.session_id));
  const filteredTeamProfiles = teamProfiles.filter((profile) => {
    if (teamMemberFilter !== 'all' && profile.id !== teamMemberFilter) return false;
    if (teamStatusFilter === 'all') return true;
    const memberSession = sessions.find((session) => session.user_id === profile.id && session.status === 'active');
    const memberBreak = memberSession && breaks.some((item) => item.session_id === memberSession.id && !item.ended_at);
    const memberStatus = !memberSession ? 'off' : memberBreak ? 'break' : isPresenceFresh(memberSession, nowMs) ? 'working' : 'paused';
    return memberStatus === teamStatusFilter;
  });
  // Historical totals must NOT be filtered by live connected/off-duty state.
  const reportTeamProfiles = teamProfiles.filter((person) =>
    teamMemberFilter === 'all' || person.id === teamMemberFilter);
  const reportTeamIds = new Set(reportTeamProfiles.map((person) => person.id));
  const reportDays = reportLedger.filter((day) => reportTeamIds.has(day.user_id));
  const reportSummary = summarizeVerifiedAttendance(reportDays);
  const perPersonReport = reportTeamProfiles.map((person) => ({
    profile: person,
    ...summarizeVerifiedAttendance(reportDays.filter((day) => day.user_id === person.id)),
  }));
  const reportHoursMissing = Math.max(0, reportSummary.targetSeconds - reportSummary.seconds);
  const reportOverTarget = Math.max(0, reportSummary.seconds - reportSummary.targetSeconds);

  const liveTeamSessions = teamProfiles.map((profile) => sessions.find((session) => session.user_id === profile.id && session.status === 'active') || null);
  const workingCount = liveTeamSessions.filter((session) => session && isPresenceFresh(session, nowMs) && !breaks.some((item) => item.session_id === session.id && !item.ended_at)).length;
  const breakCount = liveTeamSessions.filter((session) => session && breaks.some((item) => item.session_id === session.id && !item.ended_at)).length;
  const pausedCount = liveTeamSessions.filter((session) => session && !isPresenceFresh(session, nowMs) && !breaks.some((item) => item.session_id === session.id && !item.ended_at)).length;
  const offCount = teamProfiles.length - workingCount - breakCount - pausedCount;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Attendance action could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  function downloadReportCsv(rows: string[][], filename: string) {
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportVerifiedCsv() {
    if (reportLedgerState !== 'ready') return;
    const rows = [[
      'Team member', 'Work date', 'Verified hours', 'Verified seconds',
      '8-hour reference target', 'Difference (hours)', 'Credited day', 'Accepted slices',
    ]];
    for (const day of reportDays) {
      const person = profiles.find((profile) => profile.id === day.user_id);
      const seconds = Math.max(0, Number(day.actual_seconds || 0));
      rows.push([
        person?.full_name || 'Team member',
        day.local_work_date,
        (seconds / 3600).toFixed(2),
        String(seconds),
        '8',
        ((seconds - 8 * 3600) / 3600).toFixed(2),
        seconds >= 60 ? 'Yes' : 'No',
        String(day.accepted_slices),
      ]);
    }
    downloadReportCsv(rows, `mh-attendance-verified-${reportPeriod.startDate}-to-${reportPeriod.endDateExclusive}.csv`);
  }

  function exportCsv() {
    // Detailed sessions are for audit, NOT a substitute for dated verified credits.
    const rows = [['Name', 'Role', 'Clock In', 'Clock Out', 'Whole-session recorded hours · Provisional', 'Note', 'Correction Reason']];
    sessions
      .filter((session) => reportTeamIds.has(session.user_id))
      .filter((session) => !teamReviewOnly || reviewedTeamSessionIds.has(session.id))
      .filter((session) => {
        const day = localDayKey(session.clock_in);
        return day >= reportPeriod.startDate && day < reportPeriod.endDateExclusive;
      })
      .forEach((session) => {
        const profile = profiles.find((item) => item.id === session.user_id);
        rows.push([
          profile?.full_name || 'Team member',
          profile ? roleLabels[profile.role] : '',
          new Date(session.clock_in).toLocaleString(),
          session.clock_out ? new Date(session.clock_out).toLocaleString() : '',
          (getSessionSeconds(session, breaks, nowMs) / 3600).toFixed(2),
          session.note || '',
          session.adjustment_reason || '',
        ]);
      });
    downloadReportCsv(rows, `mh-attendance-sessions-${reportPeriod.startDate}-to-${reportPeriod.endDateExclusive}.csv`);
  }

  function openCorrection(session: AttendanceSession) {
    if (!session.clock_out) return;
    setEditing(session);
    setEditClockIn(dateTimeLocalValue(session.clock_in));
    setEditClockOut(dateTimeLocalValue(session.clock_out));
    setEditReason('');
    setError(null);
  }

  const appConnected = isPresenceFresh(activeSession, nowMs);
  const browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
  // This label represents session/connection state, not proof of continuous activity.
  const currentStatus = !desktopAttendanceCapable
    ? 'Desktop required'
    : !activeSession
      ? 'Clocked out'
      : attendanceTabRole === 'unsupported'
        ? 'Verification unavailable'
        : attendanceTabRole === 'secondary'
          ? 'Another tab owns tracking'
          : activeBreak
            ? 'On break · Time paused'
            : !browserOnline
              ? 'Offline · Sync pending'
              : !appConnected
                ? 'Connection stale · Check tracking'
                : 'Clocked in · Connected';
  const statusDescription = !activeSession ? 'Clock in to begin a new office session.'
    : activeBreak ? 'Break time is not credited.'
    : attendanceTabRole === 'secondary' ? 'This tab is read-only until tracking ownership transfers.'
    : attendanceTabRole === 'unsupported' ? 'Use an updated desktop browser with Web Locks.'
    : !browserOnline ? 'Work time may queue locally and is subject to server acceptance after reconnecting.'
    : !appConnected ? 'A recent app heartbeat is missing. Check the tracking tab.'
    : 'A recent app heartbeat is present. Accepted daily credits are confirmed in the ledger.';
  const statusTone = !activeSession || !desktopAttendanceCapable ? 'bg-slate-400'
    : activeBreak || attendanceTabRole !== 'leader' || !browserOnline ? 'bg-amber-400'
    : appConnected ? 'bg-emerald-400' : 'bg-rose-400';
  const dailyRemainingSeconds = Math.max(0, 8 * 3600 - todayVerifiedSeconds);
  const dailyOvertimeSeconds = Math.max(0, todayVerifiedSeconds - 8 * 3600);

  return (
    <div className="mx-auto max-w-[1480px] space-y-5 pb-8 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold">Office attendance · V3</p>
          <h2 className="font-display text-2xl font-semibold text-ink sm:text-3xl">Time & Attendance</h2>
          <p className="mt-1 text-sm text-muted">See your workday clearly without confusing recorded sessions with accepted verified hours.</p>
        </div>
        {canManageAll && (
          <div className="flex rounded-xl border border-border bg-white p-1" role="group" aria-label="Attendance workspace">
            <button type="button" onClick={() => setWorkspace('mine')} aria-pressed={workspace === 'mine'} className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${workspace === 'mine' ? 'bg-ink text-white' : 'text-muted hover:bg-ivory'}`}>My attendance</button>
            <button type="button" onClick={() => setWorkspace('team')} aria-pressed={workspace === 'team'} className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${workspace === 'team' ? 'bg-ink text-white' : 'text-muted hover:bg-ivory'}`}>Team overview</button>
          </div>
        )}
      </div>
      {workspace === 'mine' && (
        <>
          <nav className="flex flex-wrap gap-2 border-b border-border pb-3" aria-label="Personal attendance views">
            {([
              { id: 'overview', label: 'Overview' },
              { id: 'ledger', label: 'Verified ledger' },
              { id: 'history', label: 'My history' },
            ] as const).map((item) => (
              <button key={item.id} type="button" onClick={() => setPersonalTab(item.id)} aria-current={personalTab === item.id ? 'page' : undefined} className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${personalTab === item.id ? 'bg-gold text-ink' : 'bg-white text-muted hover:bg-ivory'}`}>
                {item.label}
              </button>
            ))}
          </nav>
          {personalTab === 'overview' && (
            <>

      <section className="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-ink via-[#282923] to-[#313027] p-5 text-white shadow-lg sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold">My office session</p>
            <h2 className="mt-1 font-display text-2xl font-semibold sm:text-3xl">Your workday at a glance</h2>
            <p className="mt-2 max-w-2xl text-sm text-white/70">One place to track your shift, breaks, and daily goal. Verified hours are confirmed by the dated ledger.</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white">
            <span className={`h-2.5 w-2.5 rounded-full ${statusTone}`} />
            {currentStatus}
          </span>
        </div>
        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div className="rounded-2xl border border-white/15 bg-white/10 p-5 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-white/65">Current session · provisional timer</p>
            <p className="mt-2 font-mono text-5xl font-bold tabular-nums tracking-tight text-white sm:text-6xl" aria-label="Recorded session time">
              {activeSession ? formatTimer(getSessionSeconds(activeSession, myBreaks, nowMs)) : '00:00:00'}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-white/75" role="status">{statusDescription}</p>
            {activeSession && (
              <p className="mt-2 text-xs text-white/60">
                Clocked in at {new Date(activeSession.clock_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {activeSession.last_app_heartbeat_at ? ` · Last signal ${new Date(activeSession.last_app_heartbeat_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ' · No heartbeat yet'}
              </p>
            )}
                      <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {!activeSession ? (
              <Button
                type="button"
                disabled={busy || !desktopAttendanceCapable || (typeof navigator !== 'undefined' && !navigator.locks)}
                onClick={() => void run(async () => { await onClockIn(note.trim()); setNote(''); })}
                className="min-h-12 w-full"
              >
                <LogIn className="h-4 w-4" />
                Clock In
              </Button>
            ) : (
              <>
                {activeBreak ? (
                  <Button type="button" disabled={busy} onClick={() => void run(onEndBreak)} className="min-h-12 w-full">
                    <PlayCircle className="h-4 w-4" />
                    End Break
                  </Button>
                ) : (
                  <Button type="button" variant="secondary" disabled={busy} onClick={() => void run(onStartBreak)} className="min-h-12 w-full">
                    <Coffee className="h-4 w-4" />
                    Start Break
                  </Button>
                )}
                <Button
                  type="button"
                  variant="danger"
                  disabled={busy}
                  onClick={() => void run(async () => { await onClockOut(note.trim()); setNote(''); })}
                  className="min-h-12 w-full"
                >
                  <LogOut className="h-4 w-4" />
                  Clock Out
                </Button>
              </>
            )}
          </div>


            <div className="mt-3 [&_label]:text-white">
                        <div className="mt-4">
            <button type="button" onClick={() => setShowSessionNote((value) => !value)} className="text-xs font-semibold text-ink underline-offset-4 hover:underline">{showSessionNote ? 'Hide optional session note' : 'Add optional session note'}</button>
            {showSessionNote && <TextareaField
              label={activeSession ? 'End-of-day note (optional)' : 'Start note (optional)'}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={activeSession ? 'Anything the team should know before you leave?' : 'Optional note for today'}
              rows={2}
              className="min-h-20"
            />}
          </div>


            </div>
          </div>
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-white/15 bg-white/10 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">Today's verified progress</p>
                <span className="rounded-full bg-white/10 px-2.5 py-1 font-mono text-xs text-white/85">{formatDuration(todayVerifiedSeconds)} / 8h</span>
              </div>
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/20" role="progressbar" aria-label="Today's verified hours toward eight-hour target" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(todayTargetPercent)}>
                <div className="h-full rounded-full bg-gold transition-[width]" style={{ width: `${todayTargetPercent}%` }} />
              </div>
              <p className="mt-3 text-sm text-white/80">
                {dailyOvertimeSeconds > 0 ? `${formatDuration(dailyOvertimeSeconds)} above target` : `${formatDuration(dailyRemainingSeconds)} remaining to 8 hours`}
              </p>
              <p className="mt-1 text-xs text-white/55">Accepted credits only; overtime isn't capped or automatically payroll-approved.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
                <p className="text-xs text-white/65">Verified this month</p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-white">{ledgerState === 'ready' ? formatDuration(ledgerMonthSeconds) : '—'}</p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
                <p className="text-xs text-white/65">Verified days</p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-white">{ledgerState === 'ready' ? ledgerDaysWorked : '—'}</p>
              </div>
            </div>
            <button type="button" onClick={() => setPersonalTab('ledger')} className="rounded-xl border border-white/20 px-4 py-2.5 text-left text-sm font-semibold text-white transition hover:bg-white/10">
              View verified daily ledger →
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          {error}
        </div>
      ) : null}

      <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
        <Card className="p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <TimerReset className="h-5 w-5 text-gold" />
            <div>
              <h3 className="font-display text-xl font-semibold text-ink">My office session</h3>
              <p className="text-xs text-muted">Verified time is earned while MH Tracker stays open on desktop, even when minimized. Breaks, screen-lock/sleep gaps, and app-closed gaps are excluded automatically.</p>
            </div>
          </div>

          {activeSession && attendanceTabRole !== 'leader' ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              {attendanceTabRole === 'unsupported'
                ? 'This browser does not support the Web Locks API required to prevent duplicate attendance across tabs. Use an updated desktop browser to earn verified time.'
                : 'Another MH Tracker tab currently holds the exclusive attendance lock. This tab displays the saved time but cannot add or sync time until ownership transfers. You can request a safe handoff below, or close the other tab.'}
            </div>
          ) : null}

          {activeSession && attendanceTabRole === 'secondary' && desktopAttendanceCapable ? (
            <div className="mt-3 space-y-2">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setHandoffNotice(onRequestAttendanceTakeover()
                    ? 'Transfer requested. The other tab will sync its saved time and release attendance tracking. This tab will become active once the browser grants it the lock.'
                    : 'This browser cannot contact the owning tab. Close other MH Tracker tabs and keep this tab open to take over safely.');
                }}
              >
                Use This Tab · Transfer Tracking
              </Button>
              {handoffNotice ? (
                <p className="text-xs text-muted" role="status">{handoffNotice}</p>
              ) : null}
            </div>
          ) : null}

          {!desktopAttendanceCapable ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              <Laptop2 className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Verified attendance requires a laptop or desktop.</p>
                <p className="mt-0.5 text-xs leading-5">Mobile can be used to review attendance, but it does not start or earn verified office time.</p>
              </div>
            </div>
          ) : null}

          {activeSession && !activeBreak && !browserOnline && desktopAttendanceCapable ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Offline tracking may continue locally.</p>
                <p className="mt-0.5 text-xs leading-5">Time may be queued locally while this tracker remains open. Confirm accepted credits after reconnecting.</p>
              </div>
            </div>
          ) : null}

          {activeSession && !activeBreak && !appConnected && browserOnline && desktopAttendanceCapable ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">App presence is paused.</p>
                <p className="mt-0.5 text-xs leading-5">{attendanceTabRole === 'secondary'
                  ? 'This tab is waiting for the attendance lock. The most recent verified heartbeat is stale; it does not prove another tab is currently recording.'
                  : 'No recent verified app heartbeat was received. Reopen or reactivate the tracking tab to resume, without crediting a closed gap.'}</p>
              </div>
            </div>
          ) : null}

          {activeSession && activeBreak ? (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <PauseCircle className="h-4 w-4 shrink-0" />
              Your timer is paused for break. Clocking out will automatically close the active break.
            </div>
          ) : null}
        </Card>

        <Card className="p-4 sm:p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Session records · Provisional</p>
          <p className="mt-1 text-xs text-muted">For reference only. Accepted work time is shown in the verified ledger below.</p>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <p><span className="text-muted">Today</span><span className="ml-2 font-semibold tabular-nums">{formatDuration(todaySeconds)}</span></p>
            <p><span className="text-muted">This week</span><span className="ml-2 font-semibold tabular-nums">{formatDuration(weekSeconds)}</span></p>
            <p><span className="text-muted">This month</span><span className="ml-2 font-semibold tabular-nums">{formatDuration(monthSeconds)}</span></p>
            <p><span className="text-muted">Clock-in dates</span><span className="ml-2 font-semibold tabular-nums">{daysWorked}</span></p>
          </div>
        </Card>
      </section>

            </>
          )}
          {personalTab === 'ledger' && (
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h3 className="font-display text-xl font-semibold text-ink">Daily verified attendance ledger</h3>
            <p className="text-xs text-muted">
              Accepted day-by-day time only; historical session totals are shown separately and never assigned to invented dates.
            </p>
          </div>
          {ledgerState === 'ready' ? (
            <Button type="button" variant="secondary" onClick={() => {
              const rows = [['Team member', 'Work date', 'Credited hours', 'Worked day', 'Accepted slices']];
              for (const day of dailyTotals) {
                const profile = profiles.find((member) => member.id === day.user_id);
                rows.push([
                  profile?.full_name || 'Team member',
                  day.local_work_date,
                  (Number(day.actual_seconds || 0) / 3600).toFixed(3),
                  Number(day.actual_seconds || 0) >= 60 ? 'Yes' : 'No',
                  String(day.accepted_slices),
                ]);
              }
              const csv = rows.map((row) =>
                row.map((cell) => `"${String(cell).replace(/"/g,'""')}"`).join(',')
              ).join('\n');
              const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
              const a = document.createElement('a');
              a.href = url;
              a.download = 'mh-attendance-daily-verified.csv';
              a.click();
              URL.revokeObjectURL(url);
            }} className="min-h-9 px-3 text-xs">
              <Download className="h-3.5 w-3.5" /> Daily CSV
            </Button>
          ) : null}
        </div>
        {ledgerState !== 'ready' ? (
          <p className="mt-4 text-sm text-amber-700">
            {ledgerState === 'loading'
              ? 'Loading the verified daily ledger…'
              : 'Daily-ledger verification is unavailable. Existing session totals should not be used for payroll reconciliation.'}
          </p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
              {([
                { label: 'Month · Verified actual', value: formatDuration(ledgerMonthSeconds), detail: 'Accepted dated credits only' },
                { label: 'Days with verified time', value: String(ledgerDaysWorked), detail: 'At least 1 minute credited per date' },
                { label: 'Target · 8h/day', value: formatDuration(ledgerTargetSeconds), detail: 'For verified attendance dates' },
              ] as const).map(({ label, value, detail }) => (
                <div key={label} className="rounded-xl border border-border p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted">{label}</p>
                  <p className="mt-2 text-xl font-bold tabular-nums text-ink">{value}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-muted">{detail}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-ink">Today's verified progress · 8-hour target</span>
                <span className="tabular-nums text-muted">{formatDuration(todayVerifiedSeconds)} / 8h</span>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${todayTargetPercent}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-muted">Accepted daily credit only. Overtime remains recorded beyond the progress-bar maximum.</p>
            </div>
            <p className="mt-3 rounded-lg bg-ivory p-3 text-xs leading-relaxed text-muted">
              Dated actual vs 8-hour target: {ledgerMonthSeconds >= ledgerTargetSeconds ? '+' : '−'}
              {formatDuration(Math.abs(ledgerMonthSeconds - ledgerTargetSeconds))}.
              No daily cap or automatic overtime approval. Earlier unattributed time: {formatDuration(legacyUnattributedSeconds)} ({formatEightHourDayEquivalent(legacyUnattributedSeconds)} eight-hour equivalents), excluded from verified daily totals.
              {ledgerReviewCount > 0 ? ` ${ledgerReviewCount} multi-day/discrepant sessions require audit.` : ''}
            </p>
            <div className="mt-4 overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[620px] text-left text-sm">
                <caption className="sr-only">Daily accepted attendance credits compared with an eight-hour reference target</caption>
                <thead className="bg-ivory text-xs font-bold uppercase tracking-wide text-muted">
                  <tr><th scope="col" className="px-4 py-3">Work date</th><th scope="col" className="px-4 py-3">Verified</th><th scope="col" className="px-4 py-3">Daily target</th><th scope="col" className="px-4 py-3">Difference</th><th scope="col" className="px-4 py-3">Reference status</th></tr>
                </thead>
                <tbody className="divide-y divide-border bg-white">
                  {myLedgerDays.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-5 text-sm text-muted">No accepted daily credits for this month.</td></tr>
                  ) : myLedgerDays.slice(0, showAllLedgerDays ? 35 : 7).map((day) => {
                    const actual = Math.max(0, Number(day.actual_seconds || 0));
                    const variance = actual - 8 * 3600;
                    return (
                      <tr key={day.local_work_date}>
                        <th scope="row" className="px-4 py-3 font-semibold text-ink">{day.local_work_date}</th>
                        <td className="px-4 py-3 font-semibold tabular-nums text-ink">{formatDuration(actual)}</td>
                        <td className="px-4 py-3 tabular-nums text-muted">8h</td>
                        <td className={`px-4 py-3 font-semibold tabular-nums ${variance >= 0 ? 'text-emerald-700' : 'text-amber-700'}`}>{variance >= 0 ? '+' : '−'}{formatDuration(Math.abs(variance))}</td>
                        <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${variance >= 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{variance > 0 ? 'Over target' : variance === 0 ? 'Target met' : 'Below target'}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {myLedgerDays.length > 7 && (
              <button type="button" onClick={() => setShowAllLedgerDays((value) => !value)} className="mt-3 rounded-lg border border-border px-4 py-2 text-xs font-semibold text-ink hover:bg-ivory focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">
                {showAllLedgerDays ? 'Show recent 7 days' : `View all ${Math.min(myLedgerDays.length, 35)} ledger days`}
              </button>
            )}
            {canManageAll && (
              <p className="mt-3 text-xs text-muted">
                Managers can download all authorized employees' dated ledger rows in the CSV above.
              </p>
            )}
          </>
        )}
      </Card>

          )}
          {personalTab === 'history' && (
      <Card className="overflow-hidden p-0">
        <div className="border-b border-border px-4 py-4 sm:px-5">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-gold" />
            <h3 className="font-display text-xl font-semibold text-ink">My attendance history</h3>
          </div>
          <p className="mt-1 text-xs text-muted">
            Choose a date to expand its sessions, clock times, breaks and notes. These are session records, not audited daily credits.
          </p>
        </div>
        <div className="px-3 pt-3 sm:px-4">
          <label htmlFor="attendance-history-filter" className="block text-xs font-semibold text-muted">Find date (YYYY-MM-DD)</label>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="History date range">
            {(['7d', '30d', 'all'] as const).map((range) => (
              <button key={range} type="button" onClick={() => { setHistoryRange(range); setShowOlderHistory(false); }} aria-pressed={historyRange === range} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${historyRange === range ? 'bg-ink text-white' : 'bg-ivory text-muted'}`}>{range === '7d' ? 'Last 7 days' : range === '30d' ? 'Last 30 days' : 'All dates'}</button>
            ))}
          </div>
          <input id="attendance-history-filter" type="search" value={historyQuery} onChange={(event) => { setHistoryQuery(event.target.value); setShowOlderHistory(true); }} placeholder="e.g. 2026-10-23" className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-ink focus:border-gold sm:max-w-xs" />
        </div>
        <div className="space-y-2 p-3 sm:p-4">
          {visibleHistoryDays.length === 0 && <p className="text-sm text-muted">No attendance dates match this search.</p>}
          {visibleHistoryDays.map((day) => {
            const recordedSeconds = day.sessions.reduce(
              (total, session) => total + getSessionSeconds(session, myBreaks, nowMs), 0,
            );
            const sessionCount = day.sessions.length;
            const containsActive = day.sessions.some((session) => session.status === 'active');
            const verifiedDay = dailyTotals.find((row) => row.user_id === currentProfile.id && row.local_work_date === day.dateKey);
            const readableDate = day.dateKey === 'unknown' ? 'Unknown clock-in date'
              : new Date(`${day.dateKey}T12:00:00`).toLocaleDateString([], {
                weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
              });
            return (
              <details key={day.dateKey} className="group overflow-hidden rounded-xl border border-border bg-white">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 outline-offset-[-3px] transition-colors hover:bg-ivory focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold [&::-webkit-details-marker]:hidden sm:px-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ivory text-gold">
                      <CalendarDays className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-ink">{readableDate}</p>
                      <p className="mt-0.5 text-[11px] text-muted">
                        {sessionCount} session{sessionCount === 1 ? '' : 's'}
                        {containsActive ? ' · Active now' : ' · Completed'}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 sm:gap-4">
                    <div className="text-right">
                      <p className="text-sm font-bold tabular-nums text-ink">{formatDuration(recordedSeconds)}</p>
                      <p className="text-[10px] text-muted">Session time</p>
                    </div>
                    <ChevronDown className="h-4 w-4 text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
                  </div>
                </summary>
                <div className="border-t border-border bg-[#fcfbf8] px-3 py-3 sm:px-4">
                  {verifiedDay && ledgerState === 'ready' ? (
                    <p className="mb-3 rounded-lg border border-border bg-white px-3 py-2 text-xs text-charcoal">
                      Accepted dated time on this date: <strong>{formatDuration(Number(verifiedDay.actual_seconds || 0))}</strong>
                    </p>
                  ) : null}
                  <div className="space-y-3">
                    {day.sessions.map((session) => {
                      const sessionBreaks = myBreaks.filter((item) => item.session_id === session.id);
                      const totalBreakSeconds = sessionBreaks.reduce((total, item) => {
                        const stop = item.ended_at ? new Date(item.ended_at).getTime() : nowMs;
                        return total + Math.max(0, Math.floor((stop - new Date(item.started_at).getTime()) / 1000));
                      }, 0);
                      return (
                        <article key={session.id} className="rounded-lg border border-border bg-white p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-bold text-ink">
                                {session.status === 'active' ? 'Active session' : 'Completed session'}
                              </p>
                              <p className="mt-0.5 text-[10px] text-muted">Clock-in date · {day.dateKey}</p>
                            </div>
                            <span className="text-sm font-bold tabular-nums text-ink">
                              {formatDuration(getSessionSeconds(session, myBreaks, nowMs))}
                            </span>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <div>
                              <p className="text-[10px] uppercase tracking-wide text-muted">Clock in</p>
                              <p className="mt-1 text-xs font-semibold text-ink">
                                {new Date(session.clock_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-wide text-muted">Clock out</p>
                              <p className="mt-1 text-xs font-semibold text-ink">
                                {session.clock_out
                                  ? new Date(session.clock_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                  : 'In progress'}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-wide text-muted">Breaks</p>
                              <p className="mt-1 text-xs font-semibold text-ink">
                                {sessionBreaks.length} · {formatDuration(totalBreakSeconds)}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-wide text-muted">Record</p>
                              <p className="mt-1 text-xs font-semibold text-ink">
                                {session.adjustment_reason ? 'Corrected' : 'Session total'}
                              </p>
                            </div>
                          </div>
                          {session.clock_out && localDayKey(session.clock_out) !== day.dateKey ? (
                            <p className="mt-2 text-[11px] text-muted">
                              Crosses midnight · clocked out {new Date(session.clock_out).toLocaleDateString()}.
                              This record stays under its clock-in date.
                            </p>
                          ) : null}
                          {session.note || session.adjustment_reason ? (
                            <div className="mt-3 rounded-lg bg-ivory px-3 py-2 text-xs text-muted">
                              {session.note ? <p>Note: {session.note}</p> : null}
                              {session.adjustment_reason ? <p>Correction: {session.adjustment_reason}</p> : null}
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </div>
              </details>
            );
          })}
          {!historyDays.length ? (
            <div className="px-3 py-8 text-center text-sm text-muted">No attendance records yet.</div>
          ) : null}
          {filteredHistoryDays.length > 5 ? (
            <div className="pt-2 text-center">
              <Button type="button" variant="secondary" onClick={() => setShowOlderHistory((previous) => !previous)}>
                {showOlderHistory ? 'Show recent dates' : `Show all ${filteredHistoryDays.length} dates`}
              </Button>
            </div>
          ) : null}
        </div>
      </Card>

          )}
        </>
      )}
      {canManageAll && workspace === 'team' && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Team live attendance summary">
            {([
              { label: 'Connected sessions', value: workingCount, tone: 'text-emerald-700' },
              { label: 'On break', value: breakCount, tone: 'text-amber-700' },
              { label: 'Presence stale', value: pausedCount, tone: 'text-rose-700' },
              { label: 'Clocked out', value: offCount, tone: 'text-slate-700' },
            ] as const).map((item) => (
              <Card key={item.label} className="p-4">
                <p className="text-xs font-semibold text-muted">{item.label}</p>
                <p className={`mt-2 text-3xl font-bold tabular-nums ${item.tone}`}>{item.value}</p>
              </Card>
            ))}
          </section>
          <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-xs font-semibold text-muted">
                Team member
                <select value={teamMemberFilter} onChange={(event) => setTeamMemberFilter(event.target.value)} className="min-h-10 rounded-lg border border-border bg-white px-3 text-sm text-ink">
                  <option value="all">All team members</option>
                  {teamProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name}</option>)}
                </select>
              </label>
              <label className="flex min-w-[170px] flex-1 flex-col gap-1 text-xs font-semibold text-muted">
                Live status (live cards only)
                <select value={teamStatusFilter} onChange={(event) => setTeamStatusFilter(event.target.value as typeof teamStatusFilter)} className="min-h-10 rounded-lg border border-border bg-white px-3 text-sm text-ink">
                  <option value="all">All statuses</option>
                  <option value="working">Connected session</option>
                  <option value="break">On break</option>
                  <option value="paused">Presence stale</option>
                  <option value="off">Clocked out</option>
                </select>
              </label>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                {ledgerReviewCount} dated reconciliation exceptions need audit
              </div>
            </div>
            <div className="mt-4 border-t border-border pt-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Historical report period</p>
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Team attendance report period">
                {([
                  ['today', 'Today'],
                  ['7d', '7 days'],
                  ['30d', '30 days'],
                  ['thisMonth', 'This month'],
                  ['lastMonth', 'Last month'],
                  ['month', 'Choose month'],
                ] as const).map(([period, label]) => (
                  <button key={period} type="button" aria-pressed={teamWindow === period}
                    onClick={() => { setTeamWindow(period); setShowAllTeamDays(false); }}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${teamWindow === period ? 'bg-ink text-white' : 'border border-border bg-white text-muted hover:bg-ivory'}`}>
                    {label}
                  </button>
                ))}
                {teamWindow === 'month' && (
                  <label className="flex items-center gap-2 text-xs font-semibold text-muted">
                    Month
                    <input type="month" value={teamMonth} max={monthKey} min="2020-01" aria-label="Select attendance report month"
                      onChange={(event) => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) { setTeamMonth(event.target.value); setShowAllTeamDays(false); } }}
                      className="min-h-9 rounded-lg border border-border bg-white px-2 text-sm text-ink" />
                  </label>
                )}
              </div>
              <p className="mt-2 text-xs text-muted">
                {reportPeriod.label} · {reportPeriod.startDate} through {new Date(new Date(reportPeriod.endDateExclusive + 'T12:00:00').getTime() - 24 * 60 * 60 * 1000).toLocaleDateString()}.
                Live status filters affect the live team cards only; historical reports use accepted dated credits.
              </p>
            </div>
          </Card>
          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
              <div>
                <h3 className="font-display text-xl font-semibold text-ink">Verified hours report</h3>
                <p className="mt-1 text-sm text-muted">{reportPeriod.label} · {teamMemberFilter === 'all' ? 'All team members' : reportTeamProfiles[0]?.full_name || 'Selected member'}</p>
                <p className="mt-1 text-xs text-muted">Accepted daily credits only. Session totals and uncredited/offline time are not added to these figures.</p>
              </div>
              <Button type="button" variant="secondary" disabled={reportLedgerState !== 'ready'} onClick={exportVerifiedCsv} className="min-h-10 px-3 text-xs">
                <Download className="h-4 w-4" /> Export verified CSV
              </Button>
            </div>
            {reportLedgerState === 'loading' ? (
              <p role="status" className="px-5 py-6 text-sm text-muted">Loading verified attendance for the selected dates…</p>
            ) : reportLedgerState === 'unavailable' ? (
              <p role="alert" className="px-5 py-6 text-sm text-amber-800">Verified attendance is currently unavailable. No session totals are being substituted for accepted hours.</p>
            ) : (
              <div className="space-y-5 p-4 sm:p-5">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {([
                    { label: 'Total verified hours', value: formatDuration(reportSummary.seconds), detail: 'Accepted for selected dates' },
                    { label: 'Days with verified time', value: String(reportSummary.workedDays), detail: 'At least one minute credited' },
                    { label: 'Average per credited day', value: formatDuration(reportSummary.averageSeconds), detail: 'Verified hours divided by days' },
                    { label: '8-hour reference target', value: formatDuration(reportSummary.targetSeconds), detail: '8h × verified attendance dates' },
                  ] as const).map((item) => (
                    <div key={item.label} className="rounded-xl border border-border bg-[#fcfbf8] p-4">
                      <p className="text-xs font-semibold text-muted">{item.label}</p>
                      <p className="mt-2 text-2xl font-bold tabular-nums text-ink">{item.value}</p>
                      <p className="mt-1 text-xs text-muted">{item.detail}</p>
                    </div>
                  ))}
                </div>
                <p className="rounded-lg bg-ivory px-4 py-3 text-xs text-muted">
                  {reportOverTarget > 0 ? `${formatDuration(reportOverTarget)} above` : `${formatDuration(reportHoursMissing)} below`} the 8-hour-per-credited-day reference.
                  This is not payroll approval or a required-workday calculation.
                </p>
                {teamMemberFilter === 'all' && (
                  <div>
                    <h4 className="mb-2 text-sm font-bold text-ink">Hours by team member</h4>
                    <div className="overflow-x-auto rounded-xl border border-border">
                      <table className="w-full min-w-[490px] text-left text-sm">
                        <thead className="bg-ivory text-xs font-semibold uppercase tracking-wide text-muted">
                          <tr><th scope="col" className="px-4 py-3">Employee</th><th scope="col" className="px-4 py-3">Verified hours</th><th scope="col" className="px-4 py-3">Days</th><th scope="col" className="px-4 py-3">Daily average</th></tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {perPersonReport.map((member) => (
                            <tr key={member.profile.id}>
                              <th scope="row" className="px-4 py-3 font-semibold text-ink">{member.profile.full_name}</th>
                              <td className="px-4 py-3 font-bold tabular-nums text-ink">{formatDuration(member.seconds)}</td>
                              <td className="px-4 py-3 tabular-nums text-muted">{member.workedDays}</td>
                              <td className="px-4 py-3 tabular-nums text-muted">{formatDuration(member.averageSeconds)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-bold text-ink">Daily verified breakdown</h4>
                    <p className="text-xs text-muted">{reportDays.length} dated records</p>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full min-w-[670px] text-left text-sm">
                      <thead className="bg-ivory text-xs font-semibold uppercase tracking-wide text-muted">
                        <tr><th scope="col" className="px-4 py-3">Date</th><th scope="col" className="px-4 py-3">Employee</th><th scope="col" className="px-4 py-3">Verified</th><th scope="col" className="px-4 py-3">8h target</th><th scope="col" className="px-4 py-3">Difference</th><th scope="col" className="px-4 py-3">Reference status</th></tr>
                      </thead>
                      <tbody className="divide-y divide-border bg-white">
                        {reportDays.length === 0 ? (
                          <tr><td colSpan={6} className="px-4 py-6 text-sm text-muted">No accepted verified credits for this selection. Offline or unreconciled work may require review.</td></tr>
                        ) : (showAllTeamDays ? reportDays : reportDays.slice(0, 35)).map((day) => {
                          const seconds = Math.max(0, Number(day.actual_seconds || 0));
                          const variance = seconds - 8 * 3600;
                          const person = profiles.find((profile) => profile.id === day.user_id);
                          return (
                            <tr key={`${day.user_id}-${day.local_work_date}`}>
                              <th scope="row" className="px-4 py-3 font-semibold text-ink">{day.local_work_date}</th>
                              <td className="px-4 py-3 text-ink">{person?.full_name || 'Team member'}</td>
                              <td className="px-4 py-3 font-bold tabular-nums text-ink">{formatDuration(seconds)}</td>
                              <td className="px-4 py-3 tabular-nums text-muted">8h</td>
                              <td className={`px-4 py-3 tabular-nums ${variance >= 0 ? 'text-emerald-700' : 'text-amber-700'}`}>{variance >= 0 ? '+' : '−'}{formatDuration(Math.abs(variance))}</td>
                              <td className="px-4 py-3 text-muted">{variance > 0 ? 'Above target' : variance === 0 ? 'Target met' : 'Below target'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {reportDays.length > 35 && (
                    <button type="button" onClick={() => setShowAllTeamDays((value) => !value)} className="mt-3 rounded-lg border border-border px-4 py-2 text-xs font-semibold text-ink hover:bg-ivory">
                      {showAllTeamDays ? 'Show first 35 rows' : `View all ${reportDays.length} daily records`}
                    </button>
                  )}
                </div>
              </div>
            )}
          </Card>

          <Card className="p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-gold" />
                  <h3 className="font-display text-xl font-semibold text-ink">Team attendance today</h3>
                </div>
                <p className="mt-1 text-xs text-muted">Live verified app presence, today’s credited time, and month-to-date hours.</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filteredTeamProfiles.map((profile) => {
                const personSessions = sessions.filter((session) => session.user_id === profile.id);
                const personBreaks = breaks.filter((item) => item.user_id === profile.id);
                const personActive = personSessions.find((session) => session.status === 'active') || null;
                const personBreak = personActive
                  ? personBreaks.find((item) => item.session_id === personActive.id && !item.ended_at) || null
                  : null;
                const personConnected = isPresenceFresh(personActive, nowMs);
                const personStatus = personActive
                  ? personBreak
                    ? 'On break'
                    : personConnected
                      ? 'Connected'
                      : 'Presence stale'
                  : 'Off duty';
                const personToday = dailyTotals
                  .filter((day) => day.user_id === profile.id && day.local_work_date === todayKey)
                  .reduce((total, day) => total + Number(day.actual_seconds || 0), 0);
                const personMonth = dailyTotals
                  .filter((day) => day.user_id === profile.id && day.local_work_date.startsWith(monthKey))
                  .reduce((total, day) => total + Number(day.actual_seconds || 0), 0);

                return (
                  <article key={profile.id} className="rounded-2xl border border-border bg-[#fcfbf8] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-ink">{profile.full_name}</p>
                        <p className="mt-0.5 text-[10px] text-muted">{roleLabels[profile.role]}</p>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${
                        personActive
                          ? personBreak
                            ? 'bg-amber-100 text-amber-800'
                            : personConnected
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-700'
                          : 'bg-stone-100 text-stone-600'
                      }`}>
                        {personStatus}
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-white p-2.5">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-muted">Verified today</p>
                        <p className="mt-1 text-sm font-bold text-ink">{ledgerState === 'ready' ? formatDuration(personToday) : '—'}</p>
                      </div>
                      <div className="rounded-xl bg-white p-2.5">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-muted">Verified month</p>
                        <p className="mt-1 text-sm font-bold text-ink">{ledgerState === 'ready' ? formatDuration(personMonth) : '—'}</p>
                      </div>
                    </div>
                    <p className="mt-3 text-[10px] text-muted">
                      {personActive
                        ? personConnected || personBreak
                          ? `Clocked in ${new Date(personActive.clock_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                          : `Time paused · last app signal ${personActive.last_app_heartbeat_at ? new Date(personActive.last_app_heartbeat_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'not received'}`
                        : 'Not currently clocked in'}
                    </p>
                  </article>
                );
              })}
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <h3 className="font-display text-xl font-semibold text-ink">Team attendance records</h3>
                <p className="text-xs text-muted">Review attendance and export records. Only Admin can change completed times.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setTeamReviewOnly((value) => !value)} aria-pressed={teamReviewOnly} className={`rounded-lg px-3 py-2 text-xs font-bold ${teamReviewOnly ? 'bg-amber-100 text-amber-900' : 'bg-ivory text-muted'}`}>Needs review only</button>
                {(['today', '7d', '30d'] as const).map((window) => (
                  <button
                    key={window}
                    type="button"
                    onClick={() => setTeamWindow(window)}
                    className={`rounded-lg px-3 py-2 text-xs font-bold ${teamWindow === window ? 'bg-ink text-white' : 'bg-ivory text-muted'}`}
                  >
                    {window === 'today' ? 'Today' : window === '7d' ? '7 days' : '30 days'}
                  </button>
                ))}
                <Button type="button" variant="secondary" onClick={exportCsv} className="min-h-9 px-3 text-xs">
                  <Download className="h-3.5 w-3.5" /> Export CSV
                </Button>
              </div>
            </div>

            <div className="divide-y divide-border">
              {sessions
                .filter((session) => {
                  if (!filteredTeamProfiles.some((profile) => profile.id === session.user_id)) return false;
                  if (teamReviewOnly && !reviewedTeamSessionIds.has(session.id)) return false;
                  const ts = new Date(session.clock_in).getTime();
                  if (teamWindow === 'today') return localDayKey(session.clock_in) === todayKey;
                  return ts >= nowMs - (teamWindow === '7d' ? 7 : 30) * 24 * 60 * 60 * 1000;
                })
                .slice(0, 100)
                .map((session) => {
                  const profile = profiles.find((item) => item.id === session.user_id);
                  return (
                    <div key={session.id} className="grid gap-2 px-4 py-3 text-xs sm:grid-cols-[minmax(150px,1fr)_160px_160px_90px_auto] sm:items-center sm:px-5">
                      <div className="min-w-0">
                        <p className="truncate font-bold text-ink">{profile?.full_name || 'Team member'}</p>
                        <p className="text-[10px] text-muted">{profile ? roleLabels[profile.role] : ''}{reviewedTeamSessionIds.has(session.id) ? ' · Needs reconciliation review' : ''}</p>
                      </div>
                      <p className="text-charcoal">{new Date(session.clock_in).toLocaleString()}</p>
                      <p className="text-charcoal">{session.clock_out ? new Date(session.clock_out).toLocaleString() : 'Active now'}</p>
                      <p className="font-bold text-ink">{formatDuration(getSessionSeconds(session, breaks, nowMs))}</p>
                      <div className="flex justify-end">
                        {currentProfile.role === 'admin' && session.status === 'completed' && session.clock_out ? (
                          <Button type="button" variant="secondary" onClick={() => openCorrection(session)} className="min-h-8 px-2.5 text-[10px]">
                            <Pencil className="h-3 w-3" /> Correct
                          </Button>
                        ) : (
                          <span className="text-[10px] text-muted">
                            {session.status === 'active'
                              ? isPresenceFresh(session, nowMs)
                                ? 'Verified live'
                                : 'Paused'
                              : 'Recorded'}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </Card>
        </>
      )}

      {editing ? (
        <div className="fixed inset-0 z-50 grid place-items-stretch bg-ink/50 p-0 sm:place-items-center sm:p-4">
          <Card className="m-0 max-h-[100dvh] w-full overflow-y-auto rounded-none bg-white p-4 shadow-2xl sm:max-w-lg sm:rounded-2xl sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-xl font-semibold text-ink">Correct attendance record</h3>
                <p className="mt-1 text-xs text-muted">Admin corrections now create an immutable audit entry with before/after snapshots and require a detailed reason (15+ characters). Adjusting session times never manufactures dated verified credits.</p>
              </div>
              <button type="button" className="text-sm font-bold text-muted" onClick={() => setEditing(null)}>✕</button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Clock in" type="datetime-local" value={editClockIn} onChange={(event) => setEditClockIn(event.target.value)} />
              <Field label="Clock out" type="datetime-local" value={editClockOut} onChange={(event) => setEditClockOut(event.target.value)} />
            </div>
            <div className="mt-4">
              <TextareaField label="Correction reason" value={editReason} onChange={(event) => setEditReason(event.target.value)} placeholder="Why is this record being corrected?" />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
              <Button
                type="button"
                disabled={busy || editReason.trim().length < 15 || !editClockIn || !editClockOut}
                onClick={() => void run(async () => {
                  await onAdjustSession(
                    editing.id,
                    new Date(editClockIn).toISOString(),
                    new Date(editClockOut).toISOString(),
                    editReason.trim(),
                  );
                  setEditing(null);
                })}
              >
                Save correction
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
