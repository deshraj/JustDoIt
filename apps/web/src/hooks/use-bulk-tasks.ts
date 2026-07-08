'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, type BulkTaskPatch } from '@/lib/api';
import { qk } from '@/lib/query-keys';

export function useBulkUpdateTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, patch }: { ids: string[]; patch: BulkTaskPatch }) =>
      api.bulkUpdateTasks(ids, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tasks.all }),
    onError: () => toast.error('Could not update the selected tasks — try again.'),
  });
}

export function useBulkDeleteTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.bulkDeleteTasks(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tasks.all }),
    onError: () => toast.error('Could not delete the selected tasks — try again.'),
  });
}
