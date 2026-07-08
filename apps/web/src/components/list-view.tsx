'use client';

import { useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTasks } from '@/hooks/use-tasks';
import { useProjects } from '@/hooks/use-projects';
import { TaskRow } from '@/components/task-row';
import {
  ListToolbar,
  parseListSearchParams,
  type GroupBy,
  type SortBy,
} from '@/components/list-toolbar';
import { Skeleton } from '@/components/ui/skeleton';
import { PRIORITY_LABELS, STATUS_LABELS, isOverdue } from '@/lib/utils';
import type { Task } from '@/lib/api';
import { TASK_STATUSES, TASK_PRIORITIES } from '@/lib/schemas';

interface Group {
  key: string;
  label: string;
  tasks: Task[];
}

const STATUS_ORDER = new Map(TASK_STATUSES.map((s, i) => [s, i]));
const PRIORITY_ORDER = new Map(TASK_PRIORITIES.map((p, i) => [p, i]));
const DUE_GROUP_ORDER = ['overdue', 'today', 'upcoming', 'none'];

function groupTasks(tasks: Task[], group: GroupBy, projectNames: Map<string, string>): Group[] {
  if (group === 'none') return tasks.length ? [{ key: 'all', label: 'All tasks', tasks }] : [];

  const buckets = new Map<string, Group>();
  for (const task of tasks) {
    let key: string;
    let label: string;
    if (group === 'status') {
      key = task.status;
      label = STATUS_LABELS[task.status];
    } else if (group === 'priority') {
      key = task.priority ?? 'none';
      label = task.priority ? PRIORITY_LABELS[task.priority] : 'No priority';
    } else if (group === 'project') {
      key = task.projectId ?? 'none';
      label = task.projectId ? (projectNames.get(task.projectId) ?? 'Unknown project') : 'Inbox';
    } else {
      if (!task.dueAt) {
        key = 'none';
        label = 'No due date';
      } else if (isOverdue(task.dueAt)) {
        key = 'overdue';
        label = 'Overdue';
      } else {
        const isToday = task.dueAt.toDateString() === new Date().toDateString();
        key = isToday ? 'today' : 'upcoming';
        label = isToday ? 'Today' : 'Upcoming';
      }
    }
    const bucket = buckets.get(key) ?? { key, label, tasks: [] };
    bucket.tasks.push(task);
    buckets.set(key, bucket);
  }

  const groups = [...buckets.values()];
  if (group === 'status') {
    groups.sort(
      (a, b) => (STATUS_ORDER.get(a.key as never) ?? 99) - (STATUS_ORDER.get(b.key as never) ?? 99),
    );
  } else if (group === 'priority') {
    groups.sort(
      (a, b) =>
        (a.key === 'none' ? 99 : (PRIORITY_ORDER.get(a.key as never) ?? 99)) -
        (b.key === 'none' ? 99 : (PRIORITY_ORDER.get(b.key as never) ?? 99)),
    );
  } else if (group === 'due') {
    groups.sort((a, b) => DUE_GROUP_ORDER.indexOf(a.key) - DUE_GROUP_ORDER.indexOf(b.key));
  } else {
    groups.sort((a, b) => a.label.localeCompare(b.label));
  }
  return groups;
}

function compareTasks(sort: SortBy): (a: Task, b: Task) => number {
  switch (sort) {
    case 'dueAt':
      return (a, b) => {
        if (!a.dueAt && !b.dueAt) return 0;
        if (!a.dueAt) return 1;
        if (!b.dueAt) return -1;
        return a.dueAt.getTime() - b.dueAt.getTime();
      };
    case 'priority':
      return (a, b) => {
        const ap = a.priority ? PRIORITY_ORDER.get(a.priority)! : 99;
        const bp = b.priority ? PRIORITY_ORDER.get(b.priority)! : 99;
        return ap - bp;
      };
    case 'createdAt':
      return (a, b) => a.createdAt.getTime() - b.createdAt.getTime();
    case 'title':
      return (a, b) => a.title.localeCompare(b.title);
    case 'position':
    default:
      return (a, b) => a.position - b.position;
  }
}

export function ListView() {
  const searchParams = useSearchParams();
  const { filters, group, sort } = parseListSearchParams(searchParams);
  const { data: tasks, isLoading } = useTasks(filters);
  const { data: projects } = useProjects();

  const projectNames = useMemo(
    () => new Map((projects ?? []).map((p) => [p.id, p.name])),
    [projects],
  );

  const groups = useMemo(() => {
    const sorted = [...(tasks ?? [])].sort(compareTasks(sort));
    return groupTasks(sorted, group, projectNames);
  }, [tasks, group, sort, projectNames]);

  const rowRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const flatTasks = useMemo(() => groups.flatMap((g) => g.tasks), [groups]);

  function focusRow(index: number): void {
    const clamped = Math.max(0, Math.min(index, flatTasks.length - 1));
    rowRefs.current[clamped]?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    const target = e.target as HTMLElement;
    const currentIndex = rowRefs.current.findIndex((el) => el === target);
    if (currentIndex === -1) return;
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      focusRow(currentIndex + 1);
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusRow(currentIndex - 1);
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 pt-2">
        <ListToolbar />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <ListToolbar />
      {flatTasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
          <p className="text-2xl">No tasks here</p>
          <p className="text-sm text-muted-foreground">
            Try clearing a filter, or add something above.
          </p>
        </div>
      ) : (
        <div
          role="list"
          aria-label="Tasks"
          onKeyDown={handleKeyDown}
          className="flex flex-col gap-6"
        >
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <h2 className="px-2 pb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {g.label} <span className="text-muted-foreground/60">({g.tasks.length})</span>
              </h2>
              <div className="flex flex-col">
                {g.tasks.map((task) => {
                  const flatIndex = flatTasks.indexOf(task);
                  return (
                    <TaskRow
                      key={task.id}
                      task={task}
                      projectName={task.projectId ? projectNames.get(task.projectId) : undefined}
                      ref={(el) => {
                        rowRefs.current[flatIndex] = el;
                      }}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
