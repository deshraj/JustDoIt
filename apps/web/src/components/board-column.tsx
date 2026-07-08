'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Task, TaskStatus } from '@/lib/api';
import { TaskCard } from '@/components/task-card';
import { STATUS_LABELS, cn } from '@/lib/utils';

export function BoardColumn({
  status,
  tasks,
  projectNames,
}: {
  status: TaskStatus;
  tasks: Task[];
  projectNames: Map<string, string>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      data-testid={`board-column-${status}`}
      className={cn(
        'flex w-64 shrink-0 flex-col gap-2 rounded-lg bg-muted/40 p-2.5 transition-colors duration-150 ease-out',
        isOver && 'bg-muted',
      )}
    >
      <div className="flex items-center justify-between px-1 py-1">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {STATUS_LABELS[status]}
        </h2>
        <span className="text-xs text-muted-foreground/60">{tasks.length}</span>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-8 flex-col gap-2">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              projectName={task.projectId ? projectNames.get(task.projectId) : undefined}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
