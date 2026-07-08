'use client';

import { useState } from 'react';
import { useCreateSubtask, useSubtasks } from '@/hooks/use-subtasks';
import { useCompleteTask, useSetTaskStatus } from '@/hooks/use-tasks';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function SubtaskList({ taskId }: { taskId: string }) {
  const { data: subtasks } = useSubtasks(taskId);
  const createSubtask = useCreateSubtask(taskId);
  const completeTask = useCompleteTask();
  const setStatus = useSetTaskStatus();
  const [draft, setDraft] = useState('');

  const total = subtasks?.length ?? 0;
  const done = subtasks?.filter((t) => t.status === 'done').length ?? 0;

  function submit(): void {
    const title = draft.trim();
    if (!title) return;
    createSubtask.mutate({ title });
    setDraft('');
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Subtasks{' '}
        {total > 0 && (
          <span className="text-muted-foreground/60">
            ({done}/{total})
          </span>
        )}
      </h3>
      {subtasks && subtasks.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {subtasks.map((sub) => (
            <li
              key={sub.id}
              className="flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted"
            >
              <Checkbox
                aria-label={
                  sub.status === 'done'
                    ? `Mark "${sub.title}" as not done`
                    : `Mark "${sub.title}" as done`
                }
                checked={sub.status === 'done'}
                onCheckedChange={(checked) =>
                  checked
                    ? completeTask.mutate(sub.id)
                    : setStatus.mutate({ id: sub.id, status: 'todo' })
                }
              />
              <span className={cn(sub.status === 'done' && 'text-muted-foreground line-through')}>
                {sub.title}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Input
        aria-label="Add a subtask"
        placeholder="Add a subtask and press Enter"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      />
    </section>
  );
}
