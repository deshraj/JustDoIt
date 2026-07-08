'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';

/** The running time entry for this task, if any (null once stopped). */
export function useRunningEntry(taskId: string) {
  const filters = { taskId, running: true as const };
  return useQuery({
    queryKey: qk.timeEntries.list(filters),
    queryFn: () => api.listTimeEntries(filters),
    enabled: Boolean(taskId),
    select: (entries) => entries[0] ?? null,
  });
}

export function useStartTimer(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.startTimer(taskId),
    // Starting a timer auto-stops whatever else was running system-wide
    // (the API's single-running-timer rule), so invalidate broadly.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.timeEntries.all });
      qc.invalidateQueries({ queryKey: qk.tasks.all });
    },
    onError: () => toast.error('Could not start the timer — try again.'),
  });
}

export function useStopTimer(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.stopTimer(taskId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.timeEntries.all });
      qc.invalidateQueries({ queryKey: qk.tasks.all });
    },
    onError: () => toast.error('Could not stop the timer — try again.'),
  });
}
