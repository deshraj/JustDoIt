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
import { useSetTaskStatus, useTasks, useUpdateTask } from '@/hooks/use-tasks';
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

/**
 * Pure reorder resolver for an intra-column drag (companion to
 * `resolveDropStatus`, which only handles cross-column moves). `overId` is
 * either another task's id (dropped on/near a card) or a column's status
 * (dropped in that column's empty space). Returns the new `position` value
 * for the dragged task, or null when this isn't a same-column reorder (a
 * cross-column drop, an unknown task, dropping on itself, or a column with
 * no other tasks to reorder against).
 *
 * `position` is just a sort key, not necessarily contiguous, so the new
 * value is derived as the midpoint between the dragged task's new neighbors
 * — cheap, and avoids renumbering the whole column on every drop.
 */
export function resolveReorderPosition(
  tasks: Task[],
  activeId: string,
  overId: string | null,
): number | null {
  if (!overId || overId === activeId) return null;
  const active = tasks.find((t) => t.id === activeId);
  if (!active) return null;

  const overTask = tasks.find((t) => t.id === overId);
  const overStatus = overTask
    ? overTask.status
    : (STATUS_LIFECYCLE as readonly string[]).includes(overId)
      ? (overId as TaskStatus)
      : null;
  if (!overStatus || overStatus !== active.status) return null;

  const siblings = tasks
    .filter((t) => t.status === overStatus && t.id !== activeId)
    .sort((a, b) => a.position - b.position);
  if (siblings.length === 0) return null;

  // Dropped in the column's empty space (no specific card target): append
  // to the end. Otherwise slot in just before the card dropped on.
  const overIndex = overTask ? siblings.findIndex((t) => t.id === overId) : siblings.length;
  const before = siblings[overIndex - 1];
  const after = overTask ? siblings[overIndex] : undefined;

  if (before && after) return (before.position + after.position) / 2;
  if (after) return after.position - 1;
  if (before) return before.position + 1;
  return active.position;
}

export interface DragEndDeps {
  setStatus: (vars: { id: string; status: TaskStatus }) => void;
  updateTask: (vars: { id: string; patch: { position: number } }) => void;
  announce: (message: string) => void;
}

/**
 * Orchestrates a drag-end drop: resolves whether it's a cross-column status
 * change or a same-column reorder and fires the matching mutation. Side
 * effects are injected via `deps` so this stays testable without a real DnD
 * backend or React Query context (see board-view.test.tsx).
 */
export function runDragEnd(
  tasks: Task[],
  activeId: string,
  overId: string | null,
  deps: DragEndDeps,
): void {
  const nextStatus = resolveDropStatus(tasks, activeId, overId);
  if (nextStatus) {
    const title = tasks.find((t) => t.id === activeId)?.title ?? 'Task';
    deps.announce(`${title} moved to ${nextStatus.replace('_', ' ')}`);
    deps.setStatus({ id: activeId, status: nextStatus });
    return;
  }

  const nextPosition = resolveReorderPosition(tasks, activeId, overId);
  const active = tasks.find((t) => t.id === activeId);
  if (nextPosition !== null && active && nextPosition !== active.position) {
    deps.updateTask({ id: activeId, patch: { position: nextPosition } });
  }
}

export function BoardView() {
  const { data: tasks, isLoading } = useTasks();
  const { data: projects } = useProjects();
  const setStatus = useSetTaskStatus();
  const updateTask = useUpdateTask();
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
    runDragEnd(tasks ?? [], activeTaskId, overId, {
      setStatus: (vars) => setStatus.mutate(vars),
      updateTask: (vars) => updateTask.mutate(vars),
      announce: setAnnouncement,
    });
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
