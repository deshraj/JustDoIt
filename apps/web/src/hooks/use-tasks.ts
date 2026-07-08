'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, type Task, type TaskFilters, type TaskStatus, type UpdateTaskInput } from '@/lib/api';
import { qk } from '@/lib/query-keys';

export function useTasks(filters: TaskFilters = {}) {
  return useQuery({
    queryKey: qk.tasks.list(filters),
    queryFn: () => api.listTasks(filters),
  });
}

/**
 * Patch every cached tasks query in place — both list queries (`Task[]`, e.g.
 * qk.tasks.list(...)) and single-task detail queries (`Task`, e.g.
 * qk.tasks.detail(id)) share the `qk.tasks.all` (`['tasks']`) key prefix, so
 * `getQueriesData` returns both shapes and each must be patched differently.
 * Returns a rollback snapshot.
 */
function optimisticallyPatchLists(
  qc: QueryClient,
  id: string,
  patch: Partial<Task>,
): Array<[readonly unknown[], Task[] | Task | undefined]> {
  const entries = qc.getQueriesData<Task[] | Task>({ queryKey: qk.tasks.all });
  for (const [key, data] of entries) {
    if (!data) continue;
    if (Array.isArray(data)) {
      qc.setQueryData<Task[]>(
        key,
        data.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      );
    } else if (data.id === id) {
      qc.setQueryData<Task>(key, { ...data, ...patch });
    }
  }
  return entries;
}

function rollback(
  qc: QueryClient,
  entries: Array<[readonly unknown[], Task[] | Task | undefined]>,
): void {
  for (const [key, data] of entries) qc.setQueryData(key, data);
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateTaskInput }) =>
      api.updateTask(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: qk.tasks.all });
      const snapshot = optimisticallyPatchLists(qc, id, patch as Partial<Task>);
      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      if (context) rollback(qc, context.snapshot);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.tasks.all }),
  });
}

export function useSetTaskStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) =>
      api.setTaskStatus(id, status),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: qk.tasks.all });
      const snapshot = optimisticallyPatchLists(qc, id, { status });
      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      if (context) rollback(qc, context.snapshot);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.tasks.all }),
  });
}

export function useCompleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.completeTask(id),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: qk.tasks.all });
      const snapshot = optimisticallyPatchLists(qc, id, { status: 'done' });
      return { snapshot };
    },
    onError: (_err, _id, context) => {
      if (context) rollback(qc, context.snapshot);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.tasks.all }),
  });
}
