'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { formatDueDate, PRIORITY_LABELS } from '@/lib/utils';

export function useQuickAdd() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => api.quickAdd(text),
    onSuccess: (task) => {
      // Every view (list/board/calendar) reads from the same ['tasks'] key
      // prefix, so one broad invalidation reflects the new task everywhere.
      qc.invalidateQueries({ queryKey: qk.tasks.all });
      const hints: string[] = [];
      if (task.dueAt) hints.push(formatDueDate(task.dueAt));
      if (task.priority) hints.push(PRIORITY_LABELS[task.priority]);
      toast.success(`Added "${task.title}"`, {
        description: hints.length > 0 ? hints.join(' · ') : undefined,
      });
    },
    onError: () => {
      toast.error('Could not add that task — try again.');
    },
  });
}
