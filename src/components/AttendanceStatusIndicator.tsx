import type { AttendanceBreak, AttendanceSession } from '../lib/types';

type Props = {
  userId: string;
  sessions: AttendanceSession[];
  breaks: AttendanceBreak[];
  onOpenAttendance: () => void;
};

/** Session state only: a clocked-in session is not proof that each minute is credited. */
export function AttendanceStatusIndicator({ userId, sessions, breaks, onOpenAttendance }: Props) {
  const session = sessions.find((item) => item.user_id === userId && item.status === 'active');
  const onBreak = !!session && breaks.some((item) => item.session_id === session.id && !item.ended_at);
  const state = !session ? 'off' : onBreak ? 'paused' : 'on';
  const label = state === 'off' ? 'Tracking OFF' : state === 'paused' ? 'On break' : 'Session ON';
  const explanation = state === 'off'
    ? 'Not clocked in. No work time is being recorded.'
    : state === 'paused'
      ? 'Break active. Credited work time is paused.'
      : 'Clocked in. Verified minutes may pause during inactivity, lock or sleep.';
  const dot = state === 'off' ? 'bg-red-500' : state === 'paused' ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <button
      type="button"
      onClick={onOpenAttendance}
      title={explanation + ' Click to open Attendance.'}
      aria-label={label + '. ' + explanation + ' Open Attendance.'}
      className="inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-1.5 text-xs font-semibold text-ink shadow-sm transition hover:border-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
    >
      <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}
