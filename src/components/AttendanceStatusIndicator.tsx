import { useEffect, useState } from 'react';
import type { AttendanceBreak, AttendanceSession } from '../lib/types';

type Props = {
  userId: string;
  sessions: AttendanceSession[];
  breaks: AttendanceBreak[];
  tabRole?: 'leader' | 'secondary' | 'unsupported';
  onOpenAttendance: () => void;
};

const STALE_AFTER_MS = 90_000;

/** Shows session/connection state; a fresh heartbeat does not establish active OS work. */
export function AttendanceStatusIndicator({ userId, sessions, breaks, tabRole = 'leader', onOpenAttendance }: Props) {
  const [nowMs, setNowMs] = useState(Date.now());
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  useEffect(() => {
    const refresh = () => { setNowMs(Date.now()); setOnline(navigator.onLine); };
    const interval = window.setInterval(refresh, 15_000);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    return () => { window.clearInterval(interval); window.removeEventListener('online', refresh); window.removeEventListener('offline', refresh); };
  }, []);
  const session = sessions.find((item) => item.user_id === userId && item.status === 'active');
  const onBreak = !!session && breaks.some((item) => item.session_id === session.id && !item.ended_at);
  const lastSignalMs = session?.last_app_heartbeat_at ? new Date(session.last_app_heartbeat_at).getTime() : 0;
  const recentSignal = Number.isFinite(lastSignalMs) && lastSignalMs > 0 && nowMs - lastSignalMs <= STALE_AFTER_MS;
  const state = !session ? 'off' : onBreak ? 'break' : tabRole === 'secondary' ? 'secondary' : tabRole === 'unsupported' ? 'unsupported' : !online ? 'offline' : recentSignal ? 'connected' : 'stale';
  const label = state === 'off' ? 'Tracking OFF'
    : state === 'break' ? 'On break'
      : state === 'secondary' ? 'Other tab tracking'
        : state === 'unsupported' ? 'Verification unavailable'
          : state === 'offline' ? 'Sync pending'
            : state === 'stale' ? 'Signal stale' : 'Session connected';
  const explanation = state === 'off' ? 'No active attendance session.'
    : state === 'break' ? 'Break time is paused.'
      : state === 'secondary' ? 'Another tab owns the attendance lock.'
        : state === 'unsupported' ? 'This browser cannot verify single-tab ownership.'
          : state === 'offline' ? 'Offline time may queue locally; confirm credits after reconnecting.'
            : state === 'stale' ? 'No recent server heartbeat; check attendance.'
              : 'Recently connected. Accepted work minutes are confirmed in the daily ledger.';
  const dot = state === 'off' || state === 'stale' ? 'bg-red-500' : state === 'connected' ? 'bg-emerald-500' : 'bg-amber-500';
  return (
    <button type="button" onClick={onOpenAttendance} title={explanation + ' Open Attendance.'}
      aria-label={label + '. ' + explanation + ' Open Attendance.'}
      className="inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-1.5 text-xs font-semibold text-ink shadow-sm transition hover:border-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold">
      <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}
