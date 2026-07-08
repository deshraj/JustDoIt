import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

const BASE = 'http://localhost:8787';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function lastCall(mock: ReturnType<typeof vi.fn>): { url: URL; init: RequestInit | undefined } {
  const call = mock.mock.calls.at(-1);
  if (!call) throw new Error('fetch was not called');
  const [input, init] = call as [string, RequestInit | undefined];
  return { url: new URL(String(input)), init };
}

describe('api client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listTasks builds GET /tasks with snake_case query params', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await api.listTasks({ status: 'todo', projectId: 'p1' });

    const { url, init } = lastCall(fetchMock);
    expect(url.origin + url.pathname).toBe(`${BASE}/tasks`);
    expect(url.searchParams.get('status')).toBe('todo');
    expect(url.searchParams.get('project_id')).toBe('p1');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('listTasks maps a null projectId to the "none" sentinel', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await api.listTasks({ projectId: null });
    const { url } = lastCall(fetchMock);
    expect(url.searchParams.get('project_id')).toBe('none');
  });

  it('createTask POSTs JSON to /tasks', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 't1', title: 'x' }, 201));
    await api.createTask({ title: 'x' });

    const { url, init } = lastCall(fetchMock);
    expect(url.origin + url.pathname).toBe(`${BASE}/tasks`);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual({ title: 'x' });
  });

  it('setTaskStatus PATCHes /tasks/:id/status', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 't1', status: 'done' }));
    await api.setTaskStatus('t1', 'done');

    const { url, init } = lastCall(fetchMock);
    expect(url.pathname).toBe('/tasks/t1/status');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ status: 'done' });
  });

  it('startTimer POSTs /tasks/:id/timer/start', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'e1', taskId: 't1', startedAt: new Date().toISOString() }, 201),
    );
    await api.startTimer('t1');

    const { url, init } = lastCall(fetchMock);
    expect(url.pathname).toBe('/tasks/t1/timer/start');
    expect(init?.method).toBe('POST');
  });

  it('quickAdd POSTs { text } to /quick-add', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 't9', title: 'buy milk' }, 201));
    await api.quickAdd('buy milk tomorrow');

    const { url, init } = lastCall(fetchMock);
    expect(url.pathname).toBe('/quick-add');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ text: 'buy milk tomorrow' });
  });

  it('rejects with a typed ApiError on a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Task not found: nope' }, 404));

    await expect(api.getTask('nope')).rejects.toMatchObject({
      status: 404,
      message: 'Task not found: nope',
    });
    await expect(api.getTask('nope')).rejects.toBeInstanceOf(Error);
  });

  it('ApiError instances carry status/body and are instanceof Error', () => {
    const err = new ApiError(404, 'nope', { error: 'nope' });
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(404);
    expect(err.body).toEqual({ error: 'nope' });
  });

  it('listReminders sends the (camelCase) taskId query param the real route expects', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await api.listReminders({ taskId: 't1', delivered: false });
    const { url } = lastCall(fetchMock);
    expect(url.pathname).toBe('/reminders');
    expect(url.searchParams.get('taskId')).toBe('t1');
    expect(url.searchParams.get('delivered')).toBe('false');
  });

  it('getTimeReport maps groupBy -> group_by', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        groupBy: 'day',
        from: null,
        to: null,
        totalSeconds: 0,
        buckets: [],
        estimateVsActual: [],
      }),
    );
    await api.getTimeReport({ groupBy: 'day' });
    const { url } = lastCall(fetchMock);
    expect(url.pathname).toBe('/reports/time');
    expect(url.searchParams.get('group_by')).toBe('day');
  });

  it('deleteTask DELETEs /tasks/:id and tolerates a 204 empty body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(undefined, 204));
    await expect(api.deleteTask('t1')).resolves.toBeUndefined();
    const { url, init } = lastCall(fetchMock);
    expect(url.pathname).toBe('/tasks/t1');
    expect(init?.method).toBe('DELETE');
  });
});
