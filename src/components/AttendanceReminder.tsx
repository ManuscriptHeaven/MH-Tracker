import { useEffect, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';
import type { AttendanceBreak, AttendanceSession } from '../lib/types';

const REMINDER_INTERVAL_MS = 30 * 60 * 1000;
const REMINDER_VISIBLE_MS = 8000;

type Props = {
  userId: string;
  sessions: AttendanceSession[];
  breaks: AttendanceBreak[];
  enabled: boolean;
};

type TrackingState = 'on' | 'break' | 'off';

/**
 * A wall-clock status check every 30 minutes while the desktop app is mounted.
 * This does not increment or alter credited attendance.
 */
export function AttendanceReminder({ userId, sessions, breaks, enabled }: Props) {
  const [visible, setVisible] = useState(false);
  const [checkNumber, setCheckNumber] = useState(0);
  const lastShownCheck = useRef(0);

  const activeSession = sessions.find((session) => session.user_id === userId && session.status === 'active');
  const activeBreak = !!activeSession && breaks.some((item) => item.session_id === activeSession.id && !item.ended_at);
  const state: TrackingState = !activeSession ? 'off' : activeBreak ? 'break' : 'on';

  // Use actual elapsed app-open time, not verified work time: paused users also need updates.
  useEffect(() => {
    if (!enabled) {
      setVisible(false);
      setCheckNumber(0);
      lastShownCheck.current = 0;
      return;
    }
    const interval = window.setInterval(() => setCheckNumber((previous) => previous + 1), REMINDER_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [enabled, userId]);

  useEffect(() => {
    if (!enabled || checkNumber === 0 || lastShownCheck.current === checkNumber) return;
    lastShownCheck.current = checkNumber;
    setVisible(true);

    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
      const title = state === 'off' ? 'MH Tracker · Attendance OFF' :
        state === 'break' ? 'MH Tracker · Attendance on break' : 'MH Tracker · Attendance session ON';
      const body = state === 'off' ? 'You are not clocked in. No work time is being recorded.' :
        state === 'break' ? 'Your break is active. Work time is paused.' :
          'You are clocked in. Verified work time is subject to idle and device-presence checks.';
      try {
        new Notification(title, { body, tag: 'mh-tracker-attendance-reminder' });
      } catch {
        // Browser/OS notification support varies. The in-app reminder still works.
      }
    }
  }, [enabled, checkNumber, state]);

  useEffect(() => {
    if (!visible) return;
    const timeout = window.setTimeout(() => setVisible(false), REMINDER_VISIBLE_MS);
    return () => window.clearTimeout(timeout);
  }, [visible, checkNumber]);

  if (!visible || !enabled) return null;

  const title = state === 'off' ? 'Attendance tracking is OFF' :
    state === 'break' ? 'Attendance tracking is PAUSED' : 'Attendance session is ON';
  const detail = state === 'off' ? 'You are not clocked in. Open Attendance to start tracking.' :
    state === 'break' ? 'You are on a break, so work time is not being credited.' :
      'You are clocked in. Actual credited time depends on activity, device presence and attendance verification.';

  return (
    <aside role="status" aria-live="polite" className="fixed bottom-20 right-4 z-[105] w-[min(360px,calc(100vw-2rem))] rounded-xl border border-gold/40 bg-white p-4 text-ink shadow-xl">
      <div className="flex items-start gap-3">
        <Bell className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{title}</p>
          <p className="mt-1 text-xs text-muted">{detail}</p>
          <p className="mt-2 text-xs text-muted">30-minute attendance status check</p>
        </div>
        <button type="button" aria-label="Dismiss attendance reminder" onClick={() => setVisible(false)} className="rounded-md p-1 text-muted hover:bg-black/5">
          <X className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
