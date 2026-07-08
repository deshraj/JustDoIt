'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';

export function useActivity(taskId: string) {
  return useQuery({
    queryKey: qk.activity.task(taskId),
    queryFn: () => api.listActivity('task', taskId),
    enabled: Boolean(taskId),
  });
}
