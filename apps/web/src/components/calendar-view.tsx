'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday as isTodayFn,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTasks } from '@/hooks/use-tasks';
import { CalendarDayCell } from '@/components/calendar-day-cell';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { Task } from '@/lib/api';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function monthGridRange(monthAnchor: Date): {
  gridStart: Date;
  gridEnd: Date;
  days: Date[];
} {
  const gridStart = startOfWeek(startOfMonth(monthAnchor));
  const gridEnd = endOfWeek(endOfMonth(monthAnchor));
  return { gridStart, gridEnd, days: eachDayOfInterval({ start: gridStart, end: gridEnd }) };
}

export function groupTasksByDay(tasks: Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.dueAt) continue;
    const key = format(task.dueAt, 'yyyy-MM-dd');
    const list = map.get(key) ?? [];
    list.push(task);
    map.set(key, list);
  }
  return map;
}

export function CalendarView({ initialMonth }: { initialMonth?: Date } = {}) {
  const [monthAnchor, setMonthAnchor] = useState(() => startOfMonth(initialMonth ?? new Date()));
  const { gridStart, gridEnd, days } = useMemo(() => monthGridRange(monthAnchor), [monthAnchor]);

  const { data: tasks, isLoading } = useTasks({ dueFrom: gridStart, dueTo: gridEnd });
  const byDay = useMemo(() => groupTasksByDay(tasks ?? []), [tasks]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.key === '[') setMonthAnchor((m) => subMonths(m, 1));
      if (e.key === ']') setMonthAnchor((m) => addMonths(m, 1));
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg text-foreground">{format(monthAnchor, 'MMMM yyyy')}</h1>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            onClick={() => setMonthAnchor((m) => subMonths(m, 1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMonthAnchor(startOfMonth(new Date()))}
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next month"
            onClick={() => setMonthAnchor((m) => addMonths(m, 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-[600px] w-full" />
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className="px-1.5 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              {label}
            </div>
          ))}
          {days.map((day) => (
            <CalendarDayCell
              key={day.toISOString()}
              date={day}
              tasks={byDay.get(format(day, 'yyyy-MM-dd')) ?? []}
              isCurrentMonth={isSameMonth(day, monthAnchor)}
              isToday={isTodayFn(day)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
