'use client';

import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useSetTaskStatus, useTasks } from '@/hooks/use-tasks';
import { useProjects } from '@/hooks/use-projects';
import { BoardColumn } from '@/components/board-column';
import { TaskCard } from '@/components/task-card';
import { Skeleton } from '@/components/ui/skeleton';
import { TASK_STATUSES } from '@/lib/schemas';
import type { Task, TaskStatus } from '@/lib/api';

/** Fixed Kanban column order (also the task lifecycle order). */
export const STATUS_LIFECYCLE = TASK_STATUSES;

export function bucketTasks(tasks: Task[]): Record<TaskStatus, Task[]> {
  const buckets = Object.fromEntries(STATUS_LIFECYCLE.map((s) => [s, [] as Task[]])) as Record<
    TaskStatus,
    Task[]
  >;
  for (const t of [...tasks].sort((a, b) => a.position - b.position)) buckets[t.status].push(t);
  return buckets;
}

/**
 * Pure drop resolver, unit-tested directly since jsdom can't do real pointer
 * drag. `overId` is whatever dnd-kit's `over.id` reports: either a column's
 * status (dropped on empty column space) or another card's task id (dropped
 * on/near a card). Returns the task's new status, or null if the drop is a
 * no-op (dropped back on its own column).
 */
export function resolveDropStatus(
  tasks: Task[],
  activeId: string,
  overId: string | null,
): TaskStatus | null {
  if (!overId) return null;
  const active = tasks.find((t) => t.id === activeId);
  if (!active) return null;
  const overStatus = (STATUS_LIFECYCLE as readonly string[]).includes(overId)
    ? (overId as TaskStatus)
    : (tasks.find((t) => t.id === overId)?.status ?? null);
  if (!overStatus || overStatus === active.status) return null;
  return overStatus;
}

export function BoardView() {
  const { data: tasks, isLoading } = useTasks();
  const { data: projects } = useProjects();
  const setStatus = useSetTaskStatus();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const projectNames = useMemo(
    () => new Map((projects ?? []).map((p) => [p.id, p.name])),
    [projects],
  );
  const buckets = useMemo(() => bucketTasks(tasks ?? []), [tasks]);
  const activeTask = (tasks ?? []).find((t) => t.id === activeId) ?? null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragStart(event: DragStartEvent): void {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent): void {
    const activeTaskId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    setActiveId(null);
    const nextStatus = resolveDropStatus(tasks ?? [], activeTaskId, overId);
    if (nextStatus) {
      const title = (tasks ?? []).find((t) => t.id === activeTaskId)?.title ?? 'Task';
      setAnnouncement(`${title} moved to ${nextStatus.replace('_', ' ')}`);
      setStatus.mutate({ id: activeTaskId, status: nextStatus });
    }
  }

  if (isLoading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-4">
        {STATUS_LIFECYCLE.map((s) => (
          <Skeleton key={s} className="h-96 w-64 shrink-0" />
        ))}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {STATUS_LIFECYCLE.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            tasks={buckets[status]}
            projectNames={projectNames}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? (
          <TaskCard
            task={activeTask}
            projectName={activeTask.projectId ? projectNames.get(activeTask.projectId) : undefined}
          />
        ) : null}
      </DragOverlay>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </DndContext>
  );
}
