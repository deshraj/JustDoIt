'use client';

import { forwardRef } from 'react';
import Link from 'next/link';
import type { Task } from '@/lib/api';
import { useCompleteTask, useSetTaskStatus } from '@/hooks/use-tasks';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { cn, formatDueDate, isOverdue } from '@/lib/utils';

const PRIORITY_DOT: Record<NonNullable<Task['priority']>, string> = {
  p0: 'bg-priority-p0',
  p1: 'bg-priority-p1',
  p2: 'bg-priority-p2',
  p3: 'bg-priority-p3',
};

function HighlightedText({ text, query }: { text: string; query?: string }) {
  const needle = query?.trim();
  if (!needle) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx === -1) return <>{text}</>;
  const end = idx + needle.length;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-sm bg-primary/25 text-inherit">{text.slice(idx, end)}</mark>
      {text.slice(end)}
    </>
  );
}

export interface TaskRowProps {
  task: Task;
  projectName?: string;
  detailHref?: string;
  /** When set, the matched substring of the title is wrapped in <mark> (search results). */
  highlightQuery?: string;
  /** Multi-select for bulk actions — omit both to hide the select checkbox entirely. */
  selected?: boolean;
  onToggleSelect?: () => void;
}

export const TaskRow = forwardRef<HTMLAnchorElement, TaskRowProps>(function TaskRow(
  { task, projectName, detailHref, highlightQuery, selected, onToggleSelect },
  titleRef,
) {
  const completeTask = useCompleteTask();
  const setStatus = useSetTaskStatus();
  const isDone = task.status === 'done';
  const overdue = task.dueAt != null && !isDone && isOverdue(task.dueAt);

  return (
    <div
      role="listitem"
      data-testid={`task-row-${task.id}`}
      className="group flex items-center gap-3 rounded-md px-2 py-2.5 text-sm transition-colors duration-150 ease-out hover:bg-muted"
    >
      {onToggleSelect && (
        <Checkbox
          aria-label={`Select "${task.title}"`}
          checked={selected ?? false}
          onCheckedChange={() => onToggleSelect()}
        />
      )}

      <Checkbox
        aria-label={isDone ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        checked={isDone}
        onCheckedChange={(checked) => {
          if (checked) completeTask.mutate(task.id);
          else setStatus.mutate({ id: task.id, status: 'todo' });
        }}
      />

      {task.priority && (
        <span
          className={cn('size-1.5 shrink-0 rounded-full', PRIORITY_DOT[task.priority])}
          aria-hidden="true"
          title={task.priority}
        />
      )}

      <Link
        ref={titleRef}
        href={detailHref ?? `/tasks/${task.id}`}
        className={cn(
          'min-w-0 flex-1 truncate rounded-sm font-normal text-foreground',
          isDone && 'text-muted-foreground line-through',
        )}
      >
        <HighlightedText text={task.title} query={highlightQuery} />
      </Link>

      {task.dueAt && (
        <span
          className={cn('shrink-0 text-xs text-muted-foreground', overdue && 'text-destructive')}
        >
          {formatDueDate(task.dueAt)}
        </span>
      )}

      {projectName && (
        <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">
          {projectName}
        </Badge>
      )}
    </div>
  );
});
