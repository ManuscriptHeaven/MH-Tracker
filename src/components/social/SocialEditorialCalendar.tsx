import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Lightbulb, RotateCcw } from 'lucide-react';

export type CalendarEntry = {
  id: string;
  brandId: string;
  channel: string;
  status: string;
  caption: string;
  scheduledAt: string | null;
};

export const WEEKLY_EDUCATIONAL_TOPICS = [
  'Running headers: when a chapter opener should omit them',
  '300 DPI print images: comparing sharp and pixelated book illustrations',
  'Reflowable EPUB: why a clickable table of contents matters',
  'Professional font pairing for a memoir book interior',
  'Widows and orphans: a quick book-layout quality check',
  'Print PDF versus Kindle EPUB: their different layout requirements',
  'Seven-point book interior preflight before uploading to KDP',
];

export function mondayOfWeek(value: Date): Date {
  const day = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const weekDay = day.getDay();
  day.setDate(day.getDate() - (weekDay === 0 ? 6 : weekDay - 1));
  return day;
}

export function localDayKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return [year, month, day].join('-');
}

function addDays(value: Date, days: number): Date {
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  date.setDate(date.getDate() + days);
  return date;
}

const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const calendarDay = new Intl.DateTimeFormat(undefined, { day: 'numeric' });
const rangeMonth = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const localTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function SocialEditorialCalendar({
  entries,
  brandId,
  onChooseTopic,
}: {
  entries: CalendarEntry[];
  brandId: string;
  onChooseTopic: (topic: string) => void;
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const start = useMemo(() => {
    const monday = mondayOfWeek(new Date());
    monday.setDate(monday.getDate() + weekOffset * 7);
    return monday;
  }, [weekOffset]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(start, index)), [start]);
  const brandEntries = entries.filter(entry => entry.brandId === brandId);
  const planned = brandEntries.filter(entry => entry.status === 'scheduled' && entry.scheduledAt);
  const noDate = brandEntries.filter(entry => entry.status !== 'scheduled');
  const byDay = new Map<string, CalendarEntry[]>();
  for (const entry of planned) {
    const parsed = new Date(entry.scheduledAt!);
    if (Number.isNaN(parsed.getTime())) continue;
    const key = localDayKey(parsed);
    const day = byDay.get(key) || [];
    day.push(entry);
    byDay.set(key, day);
  }
  const weekCount = days.reduce((sum, date) => sum + (byDay.get(localDayKey(date))?.length || 0), 0);

  const label = rangeMonth.format(start) + ' – ' + rangeMonth.format(addDays(start, 6));
  return (
    <section className="space-y-5 rounded-2xl border border-border bg-white p-5 shadow-sm sm:p-7"
      aria-label="Social media editorial calendar">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-gold" />
            <h2 className="text-xl font-bold text-ink">Weekly Content Calendar</h2>
          </div>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Your approved posting plans and seven educational content ideas. No posts are published automatically.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" aria-label="Navigate calendar weeks">
          <button type="button" onClick={() => setWeekOffset(value => value - 1)}
            aria-label="Previous week"
            className="rounded-lg border border-border p-2 text-ink hover:bg-linen"><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-[155px] text-center text-sm font-semibold text-ink">{label}</span>
          <button type="button" onClick={() => setWeekOffset(value => value + 1)}
            aria-label="Next week"
            className="rounded-lg border border-border p-2 text-ink hover:bg-linen"><ChevronRight className="h-4 w-4" /></button>
          {weekOffset !== 0 && <button type="button" onClick={() => setWeekOffset(0)}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-ink hover:bg-linen">
            <RotateCcw className="h-3.5 w-3.5" /> Today
          </button>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs font-medium text-muted">
        <span className="rounded-full border border-border bg-linen px-3 py-1.5">{weekCount} planned this week</span>
        <span className="rounded-full border border-border bg-linen px-3 py-1.5">{noDate.length} awaiting planning or approval</span>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-800">Planning mode · no publishing</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
        {days.map((date, i) => {
          const key = localDayKey(date);
          const slot = byDay.get(key) || [];
          const isToday = localDayKey(date) === localDayKey(new Date());
          return (
            <div key={key} className={isToday
              ? 'min-w-0 rounded-xl border-2 border-gold/60 bg-linen p-3'
              : 'min-w-0 rounded-xl border border-border bg-white p-3'}>
              <div className="flex items-center justify-between gap-1 text-xs text-muted">
                <span className="font-bold uppercase tracking-wide">{weekday.format(date)}</span>
                {isToday && <span className="text-[10px] font-semibold text-gold">Today</span>}
              </div>
              <div className="mt-1 text-xl font-bold text-ink">{calendarDay.format(date)}</div>
              <div className="mt-3 space-y-2">
                {slot.length ? slot.sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt))).map(item => (
                  <article key={item.id} className="min-w-0 rounded-lg border border-border bg-linen p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gold">
                      {localTime.format(new Date(item.scheduledAt!))} · {item.channel}
                    </div>
                    <p className="mt-1 line-clamp-4 break-words text-xs leading-relaxed text-ink">
                      {item.caption || 'Planned content'}
                    </p>
                    <span className="mt-2 block text-[10px] font-semibold text-muted">Planned · not posted</span>
                  </article>
                )) : <p className="text-xs text-muted">No planned posts</p>}
              </div>
              <div className="mt-4 border-t border-border pt-3">
                <div className="flex items-start gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  <Lightbulb className="h-3 w-3 shrink-0 text-gold" /> Starter idea
                </div>
                <p className="mt-1 line-clamp-4 break-words text-xs leading-relaxed text-ink">
                  {WEEKLY_EDUCATIONAL_TOPICS[i]}
                </p>
                <button type="button" onClick={() => onChooseTopic(WEEKLY_EDUCATIONAL_TOPICS[i])}
                  disabled={!brandId} className="mt-2 text-left text-xs font-semibold text-gold hover:underline disabled:opacity-40">
                  Use topic →
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted">Times are displayed in your browser’s local timezone. Topic ideas are optional prompts, not posts or scheduled actions.</p>
    </section>
  );
}
