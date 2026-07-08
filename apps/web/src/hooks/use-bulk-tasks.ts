'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type BulkTaskPatch } from '@/lib/api';
import { qk } from '@/lib/query-keys';

export function useBulkUpdateTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, patch }: { ids: string[]; patch: BulkTaskPatch }) =>
      api.bulkUpdateTasks(ids, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tasks.all }),
  });
}

export function useBulkDeleteTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.bulkDeleteTasks(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tasks.all }),
  });
}
