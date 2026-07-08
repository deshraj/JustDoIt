'use client';

import Link from 'next/link';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task } from '@/lib/api';
import { useTaskTags } from '@/hooks/use-tags';
import { Badge } from '@/components/ui/badge';
import { TagPills } from '@/components/tag-pills';
import { cn, formatDueDate, isOverdue } from '@/lib/utils';

const PRIORITY_DOT: Record<NonNullable<Task['priority']>, string> = {
  p0: 'bg-priority-p0',
  p1: 'bg-priority-p1',
  p2: 'bg-priority-p2',
  p3: 'bg-priority-p3',
};

export function TaskCard({ task, projectName }: { task: Task; projectName?: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  const { data: tags } = useTaskTags(task.id);
  const overdue = task.dueAt != null && task.status !== 'done' && isOverdue(task.dueAt);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid={`task-card-${task.id}`}
      {...attributes}
      {...listeners}
      tabIndex={0}
      role="group"
      aria-roledescription="Draggable task card"
      aria-label={task.title}
      className={cn(
        'flex cursor-grab flex-col gap-1.5 rounded-md bg-background p-2.5 text-sm shadow-sm outline-none transition-opacity duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing',
        isDragging && 'opacity-50',
      )}
    >
      <div className="flex items-center gap-1.5">
        {task.priority && (
          <span
            className={cn('size-1.5 shrink-0 rounded-full', PRIORITY_DOT[task.priority])}
            aria-hidden="true"
          />
        )}
        <Link href={`/tasks/${task.id}`} className="min-w-0 flex-1 truncate text-foreground">
          {task.title}
        </Link>
      </div>
      {(task.dueAt || projectName) && (
        <div className="flex items-center gap-2">
          {task.dueAt && (
            <span className={cn('text-xs text-muted-foreground', overdue && 'text-destructive')}>
              {formatDueDate(task.dueAt)}
            </span>
          )}
          {projectName && (
            <Badge variant="secondary" className="text-xs">
              {projectName}
            </Badge>
          )}
        </div>
      )}
      {tags && tags.length > 0 && <TagPills tags={tags} />}
    </div>
  );
}
