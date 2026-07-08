'use client';

import Link from 'next/link';
import type { Task } from '@/lib/api';
import { cn } from '@/lib/utils';

const PRIORITY_DOT: Record<NonNullable<Task['priority']>, string> = {
  p0: 'bg-priority-p0',
  p1: 'bg-priority-p1',
  p2: 'bg-priority-p2',
  p3: 'bg-priority-p3',
};

const MAX_VISIBLE = 3;

export function CalendarDayCell({
  date,
  tasks,
  isCurrentMonth,
  isToday,
}: {
  date: Date;
  tasks: Task[];
  isCurrentMonth: boolean;
  isToday: boolean;
}) {
  const visible = tasks.slice(0, MAX_VISIBLE);
  const overflow = tasks.length - visible.length;

  return (
    <div
      data-testid={`calendar-day-${date.toISOString().slice(0, 10)}`}
      className={cn(
        'flex min-h-24 flex-col gap-1 rounded-md p-1.5 transition-colors duration-150 ease-out',
        isCurrentMonth ? 'bg-background' : 'bg-transparent opacity-50',
        isToday && 'ring-1 ring-inset ring-ring',
      )}
    >
      <span
        className={cn(
          'px-0.5 text-xs',
          isCurrentMonth ? 'text-muted-foreground' : 'text-muted-foreground/50',
        )}
      >
        {date.getDate()}
      </span>
      <div className="flex flex-col gap-0.5">
        {visible.map((task) => (
          <Link
            key={task.id}
            href={`/tasks/${task.id}`}
            className="flex items-center gap-1 truncate rounded-sm px-1 py-0.5 text-xs text-foreground transition-colors duration-150 ease-out hover:bg-muted"
          >
            {task.priority && (
              <span
                className={cn('size-1 shrink-0 rounded-full', PRIORITY_DOT[task.priority])}
                aria-hidden="true"
              />
            )}
            <span className="truncate">{task.title}</span>
          </Link>
        ))}
        {overflow > 0 && (
          <span className="px-1 text-xs text-muted-foreground">+{overflow} more</span>
        )}
      </div>
    </div>
  );
}
