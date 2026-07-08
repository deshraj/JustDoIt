'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { api, type Task, type TaskPriority } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useCompleteTask, useUpdateTask } from '@/hooks/use-tasks';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PriorityPicker } from '@/components/priority-picker';
import { DatePickerField } from '@/components/date-picker-field';
import { MarkdownEditor } from '@/components/markdown-editor';
import { SubtaskList } from '@/components/subtask-list';
import { TagPicker } from '@/components/tag-picker';
import { InlineTimer } from '@/components/inline-timer';
import { cn } from '@/lib/utils';

function TitleField({ task, onSave }: { task: Task; onSave: (title: string) => void }) {
  const [value, setValue] = useState(task.title);
  useEffect(() => setValue(task.title), [task.title]);

  return (
    <input
      aria-label="Task title"
      className="w-full rounded-sm bg-transparent text-lg text-foreground outline-none"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const trimmed = value.trim();
        if (trimmed && trimmed !== task.title) onSave(trimmed);
        else setValue(task.title);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setValue(task.title);
      }}
    />
  );
}

function TaskDetailSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-7 w-3/4" />
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

export function TaskDetail({ taskId }: { taskId: string }) {
  const { data: task, isLoading } = useQuery({
    queryKey: qk.tasks.detail(taskId),
    queryFn: () => api.getTask(taskId),
    enabled: Boolean(taskId),
  });
  const updateTask = useUpdateTask();
  const completeTask = useCompleteTask();

  if (isLoading || !task) return <TaskDetailSkeleton />;

  const isDone = task.status === 'done';

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto pr-1">
      <div className="flex items-start gap-2">
        <TitleField
          task={task}
          onSave={(title) => updateTask.mutate({ id: taskId, patch: { title } })}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label={isDone ? 'Already done' : 'Mark as done'}
          disabled={isDone}
          onClick={() => completeTask.mutate(taskId)}
          className={cn(isDone && 'text-status-done')}
        >
          <CheckCircle2 className="size-4" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <PriorityPicker
          value={task.priority}
          onChange={(priority: TaskPriority | null) =>
            updateTask.mutate({ id: taskId, patch: { priority } })
          }
        />
        <DatePickerField
          label="Due"
          value={task.dueAt}
          onChange={(dueAt) => updateTask.mutate({ id: taskId, patch: { dueAt } })}
        />
        <DatePickerField
          label="Start"
          value={task.startAt}
          onChange={(startAt) => updateTask.mutate({ id: taskId, patch: { startAt } })}
        />
      </div>

      <MarkdownEditor
        value={task.description ?? ''}
        onSave={(description) => updateTask.mutate({ id: taskId, patch: { description } })}
      />

      <TagPicker taskId={taskId} />

      <SubtaskList taskId={taskId} />

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Timer</h3>
        <InlineTimer taskId={taskId} />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Activity
        </h3>
        <p className="text-sm text-muted-foreground">Activity history — coming in Phase 6.</p>
      </section>
    </div>
  );
}
