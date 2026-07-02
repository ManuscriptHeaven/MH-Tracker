import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PriorityBadge } from '../components/Badges';
import { Card, IconButton } from '../components/ui';
import { cn } from '../lib/utils';
import type { Project } from '../lib/types';

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function toInputDate(date: Date) {
  const copy = new Date(date);
  copy.setHours(12, 0, 0, 0);
  return copy.toISOString().slice(0, 10);
}

export function CalendarPage({
  projects,
  onSelectProject,
}: {
  projects: Project[];
  onSelectProject: (project: Project) => void;
}) {
  const [cursor, setCursor] = useState(() => new Date());

  const days = useMemo(() => {
    const start = startOfMonth(cursor);
    const end = endOfMonth(cursor);
    const firstVisible = new Date(start);
    firstVisible.setDate(start.getDate() - start.getDay());
    const lastVisible = new Date(end);
    lastVisible.setDate(end.getDate() + (6 - end.getDay()));

    const result: Date[] = [];
    const current = new Date(firstVisible);
    while (current <= lastVisible) {
      result.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    return result;
  }, [cursor]);

  function moveMonth(offset: number) {
    setCursor((previous) => new Date(previous.getFullYear(), previous.getMonth() + offset, 1));
  }

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-semibold">
            {cursor.toLocaleString('en', { month: 'long', year: 'numeric' })}
          </h2>
          <p className="text-sm text-muted">Projects arranged by due date.</p>
        </div>
        <div className="flex gap-2">
          <IconButton title="Previous month" onClick={() => moveMonth(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </IconButton>
          <IconButton title="Next month" onClick={() => moveMonth(1)}>
            <ChevronRight className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border text-xs font-semibold uppercase tracking-[0.12em] text-muted">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <div key={day} className="bg-ivory p-3 text-center">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 pt-3 md:grid-cols-7">
        {days.map((day) => {
          const key = toInputDate(day);
          const dayProjects = projects.filter((project) => project.due_date === key);
          const isCurrentMonth = day.getMonth() === cursor.getMonth();
          const isToday = key === toInputDate(new Date());

          return (
            <div
              key={key}
              className={cn(
                'min-h-36 rounded-lg border border-border bg-white p-3',
                !isCurrentMonth && 'opacity-55',
                isToday && 'border-gold shadow-soft',
              )}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className={cn('font-semibold', isToday && 'text-gold')}>{day.getDate()}</span>
                {dayProjects.length ? <span className="text-xs text-muted">{dayProjects.length}</span> : null}
              </div>
              <div className="space-y-2">
                {dayProjects.slice(0, 3).map((project) => (
                  <button
                    key={project.id}
                    onClick={() => onSelectProject(project)}
                    className="w-full rounded-md border border-border bg-ivory p-2 text-left transition hover:border-gold"
                  >
                    <p className="truncate text-sm font-semibold">{project.project_title}</p>
                    <div className="mt-1">
                      <PriorityBadge priority={project.priority} />
                    </div>
                  </button>
                ))}
                {dayProjects.length > 3 ? (
                  <p className="text-xs font-semibold text-muted">+{dayProjects.length - 3} more</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
