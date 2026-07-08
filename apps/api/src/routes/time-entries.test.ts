import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, tasks, type Db } from '@justdoit/core';
import { createApp } from '../app';

interface TimeEntryJson {
  id: string;
  taskId: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  note: string | null;
  source: string;
}

let db: Db;
let app: ReturnType<typeof createApp>;

function seedTask(title = 'Task A'): string {
  const [t] = db.insert(tasks).values({ title }).returning().all();
  return t!.id;
}

beforeEach(() => {
  ({ db } = createDb(':memory:'));
  runMigrations(db);
  app = createApp(db);
});

describe('timer + time-entry routes', () => {
  it('starts and stops a timer', async () => {
    const taskId = seedTask();
    const startRes = await app.request(`/tasks/${taskId}/timer/start`, { method: 'POST' });
    expect(startRes.status).toBe(201);
    const started = (await startRes.json()) as TimeEntryJson;
    expect(started.endedAt).toBeNull();

    const stopRes = await app.request(`/tasks/${taskId}/timer/stop`, { method: 'POST' });
    expect(stopRes.status).toBe(200);
    const stopped = (await stopRes.json()) as TimeEntryJson;
    expect(typeof stopped.durationSeconds).toBe('number');
    expect(stopped.endedAt).not.toBeNull();
  });

  it('returns 404 stopping a task with no running timer', async () => {
    const taskId = seedTask();
    const res = await app.request(`/tasks/${taskId}/timer/stop`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('logs a manual entry with explicit duration (201)', async () => {
    const taskId = seedTask();
    const res = await app.request('/time-entries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        taskId,
        startedAt: '2026-07-08T09:00:00.000Z',
        durationSeconds: 1800,
      }),
    });
    expect(res.status).toBe(201);
    const entry = (await res.json()) as TimeEntryJson;
    expect(entry.source).toBe('manual');
    expect(entry.durationSeconds).toBe(1800);
  });

  it('rejects a manual entry with both endedAt and durationSeconds (400)', async () => {
    const taskId = seedTask();
    const res = await app.request('/time-entries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        taskId,
        startedAt: '2026-07-08T09:00:00.000Z',
        endedAt: '2026-07-08T10:00:00.000Z',
        durationSeconds: 1800,
      }),
    });
    expect(res.status).toBe(400);
  });

  it('lists, filters, patches, and deletes entries', async () => {
    const taskId = seedTask();
    await app.request('/time-entries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId, startedAt: '2026-07-08T09:00:00.000Z', durationSeconds: 600 }),
    });

    const listRes = await app.request(`/time-entries?task_id=${taskId}`);
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as TimeEntryJson[];
    expect(list).toHaveLength(1);
    const id = list[0]!.id;

    const patchRes = await app.request(`/time-entries/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'pairing' }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as TimeEntryJson;
    expect(patched.note).toBe('pairing');

    const delRes = await app.request(`/time-entries/${id}`, { method: 'DELETE' });
    expect(delRes.status).toBe(204);
    const remaining = (await (await app.request('/time-entries')).json()) as TimeEntryJson[];
    expect(remaining).toHaveLength(0);
  });
});
