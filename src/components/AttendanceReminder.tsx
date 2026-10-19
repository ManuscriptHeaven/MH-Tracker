import { useEffect, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';
import type { AttendanceBreak, AttendanceSession } from '../lib/types';

const REMINDER_EVERY_SECONDS = 30 * 60;

type Props = {
  userId: string;
  sessions: AttendanceSession[];
  breaks: AttendanceBreak[];
  enabled: boolean;
};

/** A discreet reminder after each 30 minutes of credited, not just elapsed, work. */
export function AttendanceReminder({ userId, sessions, breaks, enabled }: Props) {
  const [visible, setVisible] = useState(false);
  const lastBoundary = useRef<{ sessionId: string; boundary: number } | null>(null);

  const activeSession = sessions.find((session) => session.user_id === userId && session.status === 'active');
  const activeBreak = activeSession && breaks.some((item) => item.session_id === activeSession.id && !item.ended_at);
  const sessionId = activeSession?.id || '';
  const verifiedSeconds = Math.max(0, Number(activeSession?.verified_seconds || 0));

  useEffect(() => {
    if (!enabled || !sessionId) {
      lastBoundary.current = null;
      setVisible(false);
      return;
    }
    const boundary = Math.floor(verifiedSeconds / REMINDER_EVERY_SECONDS);
    if (lastBoundary.current?.sessionId !== sessionId) {
      // Reloading midway through an active shift must not replay old reminders.
      lastBoundary.current = { sessionId, boundary };
      return;
    }
    if (activeBreak || boundary <= lastBoundary.current.boundary) return;

    lastBoundary.current.boundary = boundary;
    setVisible(true);

    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
      try {
        new Notification('MH Tracker · Attendance active', {
          body: 'Your verified work timer is still running. Take a break when needed.',
          tag: 'mh-tracker-attendance-reminder',
        });
      } catch {
        // In-app toast remains available; native notification support varies by browser.
      }
    }
  }, [activeBreak, enabled, sessionId, verifiedSeconds]);

  useEffect(() => {
    if (!visible) return;
    const timeout = window.setTimeout(() => setVisible(false), 7000);
    return () => window.clearTimeout(timeout);
  }, [visible]);

  if (!visible || !enabled) return null;
  return (
    <aside role="status" className="fixed bottom-20 right-4 z-[105] w-[min(360px,calc(100vw-2rem))] rounded-xl border border-gold/40 bg-white p-4 text-ink shadow-xl">
      <div className="flex items-start gap-3">
        <Bell className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Attendance tracking is active</p>
          <p className="mt-1 text-xs text-muted">Another 30 minutes of verified work has been recorded. Remember to take breaks.</p>
        </div>
        <button type="button" aria-label="Dismiss attendance reminder" onClick={() => setVisible(false)} className="rounded-md p-1 text-muted hover:bg-black/5">
          <X className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
