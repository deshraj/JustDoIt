import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLiveSync } from './use-live-sync';

class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  close = vi.fn();
  #listeners = new Map<string, (e: { data: string }) => void>();
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, listener: (e: { data: string }) => void): void {
    this.#listeners.set(type, listener);
  }
  /** Test helper: simulate the API's named `event: change` SSE frames. */
  dispatch(type: string, data: unknown): void {
    this.#listeners.get(type)?.({ data: JSON.stringify(data) });
  }
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
});

describe('useLiveSync', () => {
  it('invalidates task queries when a "change" event arrives (the API tags real frames this way)', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useLiveSync(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    FakeEventSource.last!.dispatch('change', {
      type: 'task.updated',
      entityType: 'task',
      entityId: 't1',
      action: 'updated',
      at: 1,
    });
    // Query keys mirror this app's actual `qk` factory (lib/query-keys.ts) —
    // everything task-related is nested under the ['tasks', ...] prefix, so
    // invalidating ['tasks'] alone would already cover list + detail, but we
    // also invalidate the specific detail/activity keys explicitly.
    expect(spy).toHaveBeenCalledWith({ queryKey: ['tasks'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['tasks', 'detail', 't1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['activity', 'task', 't1'] });
  });

  it('also handles a plain default-message frame (no explicit event name)', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useLiveSync(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    FakeEventSource.last!.onmessage!({
      data: JSON.stringify({
        type: 'project.created',
        entityType: 'project',
        entityId: 'p1',
        action: 'created',
        at: 1,
      }),
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['projects'] });
  });

  it('wires an onerror handler that invalidates tasks and projects to catch up after a reconnect', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useLiveSync(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });

    expect(FakeEventSource.last!.onerror).toBeInstanceOf(Function);
    FakeEventSource.last!.onerror!(new Event('error'));

    expect(spy).toHaveBeenCalledWith({ queryKey: ['tasks'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['projects'] });
  });

  it('closes the EventSource on unmount', () => {
    const qc = new QueryClient();
    const { unmount } = renderHook(() => useLiveSync(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    const source = FakeEventSource.last!;
    unmount();
    expect(source.close).toHaveBeenCalled();
  });
});
