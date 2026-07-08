import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { isPast, isSameDay, isToday, isTomorrow, isYesterday, format } from 'date-fns';

/** Merge conditional class names, resolving Tailwind conflicts (shadcn/ui convention). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Compact, human due-date label: "Today", "Tomorrow", "Yesterday", or "Jan 5". */
export function formatDueDate(date: Date, now: Date = new Date()): string {
  if (isToday(date)) return 'Today';
  if (isTomorrow(date)) return 'Tomorrow';
  if (isYesterday(date)) return 'Yesterday';
  const sameYear = date.getFullYear() === now.getFullYear();
  return format(date, sameYear ? 'MMM d' : 'MMM d, yyyy');
}

/** A task is overdue once its due date is in the past and isn't today. */
export function isOverdue(date: Date, now: Date = new Date()): boolean {
  return isPast(date) && !isSameDay(date, now);
}

export const PRIORITY_LABELS: Record<'p0' | 'p1' | 'p2' | 'p3', string> = {
  p0: 'Urgent',
  p1: 'High',
  p2: 'Medium',
  p3: 'Low',
};

export const STATUS_LABELS: Record<
  'backlog' | 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled',
  string
> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};
