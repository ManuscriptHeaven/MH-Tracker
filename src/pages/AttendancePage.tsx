import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  Coffee,
  Download,
  History,
  LogIn,
  LogOut,
  PauseCircle,
  Pencil,
  PlayCircle,
  TimerReset,
  Users,
} from 'lucide-react';
import { Button, Card, Field, TextareaField } from '../components/ui';
import { roleLabels } from '../lib/constants';
import { firstName, isClientRole } from '../lib/utils';
import type { AttendanceBreak, AttendanceSession, Profile } from '../lib/types';

type Props = {
  currentProfile: Profile;
  profiles: Profile[];
  sessions: AttendanceSession[];
  breaks: AttendanceBreak[];
  canManageAll: boolean;
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

function getBreakSeconds(session: AttendanceSession, breaks: AttendanceBreak[], nowMs: number) {
  return breaks
    .filter((item) => item.session_id === session.id)
    .reduce((total, item) => {
      const start = new Date(item.started_at).getTime();
      const end = item.ended_at ? new Date(item.ended_at).getTime() : nowMs;
      return total + Math.max(0, Math.floor((end - start) / 1000));
    }, 0);
}

function getSessionSeconds(session: AttendanceSession, breaks: AttendanceBreak[], nowMs: number) {
  const start = new Date(session.clock_in).getTime();
  const end = session.clock_out ? new Date(session.clock_out).getTime() : nowMs;
  return Math.max(0, Math.floor((end - start) / 1000) - getBreakSeconds(session, breaks, nowMs));
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
  const [editing, setEditing] = useState<AttendanceSession | null>(null);
  const [editClockIn, setEditClockIn] = useState('');
  const [editClockOut, setEditClockOut] = useState('');
  const [editReason, setEditReason] = useState('');
  const [teamWindow, setTeamWindow] = useState<'today' | '7d' | '30d'>('today');

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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

  function exportCsv() {
    const rows = [['Name', 'Role', 'Clock In', 'Clock Out', 'Net Hours', 'Note', 'Correction Reason']];
    const cutoff =
      teamWindow === 'today'
        ? new Date(new Date(nowMs).setHours(0, 0, 0, 0)).getTime()
        : nowMs - (teamWindow === '7d' ? 7 : 30) * 24 * 60 * 60 * 1000;

    sessions
      .filter((session) => new Date(session.clock_in).getTime() >= cutoff)
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

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mh-attendance-${teamWindow}-${todayKey}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function openCorrection(session: AttendanceSession) {
    if (!session.clock_out) return;
    setEditing(session);
    setEditClockIn(dateTimeLocalValue(session.clock_in));
    setEditClockOut(dateTimeLocalValue(session.clock_out));
    setEditReason('');
    setError(null);
  }

  const currentStatus = activeSession ? (activeBreak ? 'On break' : 'Working') : 'Off duty';

  return (
    <div className="mx-auto max-w-[1480px] space-y-5 pb-8">
      <section className="rounded-2xl border border-border bg-gradient-to-br from-ink via-ink to-[#26241f] p-4 text-white shadow-md sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Office Attendance</p>
            <h2 className="mt-1 font-display text-2xl font-semibold sm:text-3xl">Time & Attendance</h2>
            <p className="mt-2 max-w-2xl text-sm text-white/65">
              Clock in when you start, use Break when you step away, and clock out when your office day ends.
              Times are recorded by the server and shown in your local time.
            </p>
          </div>

          <div className="min-w-0 rounded-2xl border border-white/10 bg-white/5 p-4 sm:min-w-[300px]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-white/55">Current status</p>
                <p className="mt-1 text-lg font-bold">{currentStatus}</p>
              </div>
              <span className={`h-3 w-3 rounded-full ${activeSession ? (activeBreak ? 'bg-amber-400' : 'bg-emerald-400') : 'bg-white/30'}`} />
            </div>
            <p className="mt-3 font-mono text-3xl font-bold tracking-tight text-gold">
              {activeSession ? formatTimer(getSessionSeconds(activeSession, myBreaks, nowMs)) : '00:00:00'}
            </p>
            {activeSession ? (
              <p className="mt-1 text-xs text-white/55">
                Clocked in {new Date(activeSession.clock_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {activeBreak ? ' · break active' : ''}
              </p>
            ) : (
              <p className="mt-1 text-xs text-white/55">No active office session.</p>
            )}
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          {error}
        </div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <Card className="p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <TimerReset className="h-5 w-5 text-gold" />
            <div>
              <h3 className="font-display text-xl font-semibold text-ink">My office session</h3>
              <p className="text-xs text-muted">One active session at a time. Active breaks are excluded from worked time.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {!activeSession ? (
              <Button
                type="button"
                disabled={busy}
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

          <div className="mt-4">
            <TextareaField
              label={activeSession ? 'End-of-day note (optional)' : 'Start note (optional)'}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={activeSession ? 'Anything the team should know before you leave?' : 'Optional note for today'}
              rows={2}
              className="min-h-20"
            />
          </div>

          {activeSession && activeBreak ? (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <PauseCircle className="h-4 w-4 shrink-0" />
              Your timer is paused for break. Clocking out will automatically close the active break.
            </div>
          ) : null}
        </Card>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
          {[
            ['Today', formatDuration(todaySeconds), CalendarDays],
            ['This week', formatDuration(weekSeconds), History],
            ['This month', formatDuration(monthSeconds), TimerReset],
            ['Days worked', String(daysWorked), CheckCircle2],
          ].map(([label, value, Icon]) => (
            <Card key={String(label)} className="min-w-0 p-4">
              <Icon className="h-4 w-4 text-gold" />
              <p className="mt-3 text-[10px] font-bold uppercase tracking-wider text-muted">{String(label)}</p>
              <p className="mt-1 truncate text-xl font-extrabold text-ink">{String(value)}</p>
            </Card>
          ))}
        </div>
      </section>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-border px-4 py-4 sm:px-5">
          <h3 className="font-display text-xl font-semibold text-ink">My attendance history</h3>
          <p className="text-xs text-muted">Recent sessions with breaks already deducted from net office time.</p>
        </div>
        <div className="divide-y divide-border">
          {mySessions.slice(0, 20).map((session) => {
            const sessionBreaks = myBreaks.filter((item) => item.session_id === session.id);
            return (
              <div key={session.id} className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[140px_1fr_1fr_100px] sm:items-center sm:px-5">
                <div>
                  <p className="font-semibold text-ink">{new Date(session.clock_in).toLocaleDateString()}</p>
                  <p className="text-[10px] text-muted">{session.status === 'active' ? 'Active session' : 'Completed'}</p>
                </div>
                <p className="text-xs text-charcoal">
                  {new Date(session.clock_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {' → '}
                  {session.clock_out ? new Date(session.clock_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Now'}
                </p>
                <p className="text-xs text-muted">
                  {sessionBreaks.length} break{sessionBreaks.length === 1 ? '' : 's'}
                  {session.adjustment_reason ? ' · corrected' : ''}
                </p>
                <p className="text-right text-sm font-bold text-ink">{formatDuration(getSessionSeconds(session, myBreaks, nowMs))}</p>
                {session.note || session.adjustment_reason ? (
                  <div className="sm:col-span-4 rounded-lg bg-ivory px-3 py-2 text-xs text-muted">
                    {session.note ? <span>Note: {session.note}</span> : null}
                    {session.note && session.adjustment_reason ? <span> · </span> : null}
                    {session.adjustment_reason ? <span>Correction: {session.adjustment_reason}</span> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          {!mySessions.length ? <div className="px-5 py-10 text-center text-sm text-muted">No attendance records yet.</div> : null}
        </div>
      </Card>

      {canManageAll ? (
        <>
          <Card className="p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-gold" />
                  <h3 className="font-display text-xl font-semibold text-ink">Team attendance today</h3>
                </div>
                <p className="mt-1 text-xs text-muted">Live office status, today’s net time, and month-to-date hours.</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {teamProfiles.map((profile) => {
                const personSessions = sessions.filter((session) => session.user_id === profile.id);
                const personBreaks = breaks.filter((item) => item.user_id === profile.id);
                const personActive = personSessions.find((session) => session.status === 'active') || null;
                const personBreak = personActive
                  ? personBreaks.find((item) => item.session_id === personActive.id && !item.ended_at) || null
                  : null;
                const personToday = personSessions
                  .filter((session) => localDayKey(session.clock_in) === todayKey)
                  .reduce((total, session) => total + getSessionSeconds(session, personBreaks, nowMs), 0);
                const personMonth = personSessions
                  .filter((session) => new Date(session.clock_in).getTime() >= monthStart)
                  .reduce((total, session) => total + getSessionSeconds(session, personBreaks, nowMs), 0);

                return (
                  <article key={profile.id} className="rounded-2xl border border-border bg-[#fcfbf8] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-ink">{profile.full_name}</p>
                        <p className="mt-0.5 text-[10px] text-muted">{roleLabels[profile.role]}</p>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${personActive ? (personBreak ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800') : 'bg-stone-100 text-stone-600'}`}>
                        {personActive ? (personBreak ? 'On break' : 'Working') : 'Off duty'}
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-white p-2.5">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-muted">Today</p>
                        <p className="mt-1 text-sm font-bold text-ink">{formatDuration(personToday)}</p>
                      </div>
                      <div className="rounded-xl bg-white p-2.5">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-muted">This month</p>
                        <p className="mt-1 text-sm font-bold text-ink">{formatDuration(personMonth)}</p>
                      </div>
                    </div>
                    <p className="mt-3 text-[10px] text-muted">
                      {personActive
                        ? `In since ${new Date(personActive.clock_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
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
                        <p className="text-[10px] text-muted">{profile ? roleLabels[profile.role] : ''}</p>
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
                          <span className="text-[10px] text-muted">{session.status === 'active' ? 'Live' : 'Recorded'}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </Card>
        </>
      ) : null}

      {editing ? (
        <div className="fixed inset-0 z-50 grid place-items-stretch bg-ink/50 p-0 sm:place-items-center sm:p-4">
          <Card className="m-0 max-h-[100dvh] w-full overflow-y-auto rounded-none bg-white p-4 shadow-2xl sm:max-w-lg sm:rounded-2xl sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-xl font-semibold text-ink">Correct attendance record</h3>
                <p className="mt-1 text-xs text-muted">Admin corrections are audit-marked and require a reason.</p>
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
                disabled={busy || editReason.trim().length < 5 || !editClockIn || !editClockOut}
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
