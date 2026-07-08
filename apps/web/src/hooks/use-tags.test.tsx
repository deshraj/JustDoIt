import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAttachTag, useCreateTag, useDetachTag } from './use-tags';

const createTag = vi.fn();
const attachTag = vi.fn();
const detachTag = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    createTag: (...a: unknown[]) => createTag(...a),
    attachTag: (...a: unknown[]) => attachTag(...a),
    detachTag: (...a: unknown[]) => detachTag(...a),
  },
}));

const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { error: (...a: unknown[]) => toastError(...a) },
}));

function wrap() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  createTag.mockReset();
  attachTag.mockReset();
  detachTag.mockReset();
  toastError.mockClear();
});

describe('tag mutation error feedback', () => {
  it('useCreateTag shows an error toast when the request fails', async () => {
    createTag.mockRejectedValue(new Error('server error'));
    const { result } = renderHook(() => useCreateTag(), { wrapper: wrap() });

    result.current.mutate('urgent');

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalled();
  });

  it('useAttachTag shows an error toast when the request fails', async () => {
    attachTag.mockRejectedValue(new Error('server error'));
    const { result } = renderHook(() => useAttachTag('t1'), { wrapper: wrap() });

    result.current.mutate('tag1');

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalled();
  });

  it('useDetachTag shows an error toast when the request fails', async () => {
    detachTag.mockRejectedValue(new Error('server error'));
    const { result } = renderHook(() => useDetachTag('t1'), { wrapper: wrap() });

    result.current.mutate('tag1');

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalled();
  });
});
