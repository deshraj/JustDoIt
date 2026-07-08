import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '@/lib/query-keys';
import { useCreateSubtask } from './use-subtasks';

const createSubtask = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    createSubtask: (...a: unknown[]) => createSubtask(...a),
  },
}));

beforeEach(() => {
  createSubtask.mockReset().mockResolvedValue({ id: 'sub1', title: 'New subtask' });
});

describe('useCreateSubtask', () => {
  it('on success, invalidates both the subtasks query and the broad tasks query (so List/Board refetch)', async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useCreateSubtask('parent1'), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });

    result.current.mutate({ title: 'New subtask' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(spy).toHaveBeenCalledWith({ queryKey: qk.tasks.subtasks('parent1') });
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.tasks.all });
  });
});
