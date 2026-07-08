'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CreateTaskInput } from '@/lib/api';
import { qk } from '@/lib/query-keys';

export function useSubtasks(taskId: string) {
  return useQuery({
    queryKey: qk.tasks.subtasks(taskId),
    queryFn: () => api.listSubtasks(taskId),
    enabled: Boolean(taskId),
  });
}

export function useCreateSubtask(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskInput) => api.createSubtask(taskId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tasks.subtasks(taskId) }),
  });
}
