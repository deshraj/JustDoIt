import { describe, it, expect } from 'vitest';
import { createDb, runMigrations, taskService } from '@justdoit/core';
import { createApp } from '../app';

interface TaskJson {
  id: string;
  status: string;
  priority: string | null;
}

function harness() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return { db, app: createApp(db) };
}

describe('bulk task routes', () => {
  it('PATCH /tasks/bulk updates many tasks', async () => {
    const { db, app } = harness();
    const a = taskService.create(db, { title: 'A' });
    const b = taskService.create(db, { title: 'B' });
    const res = await app.request('/tasks/bulk', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [a.id, b.id], patch: { status: 'done' } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tasks: TaskJson[] };
    expect(body.tasks).toHaveLength(2);
    expect(body.tasks.every((t) => t.status === 'done')).toBe(true);
  });

  it('POST /tasks/bulk-delete returns the count', async () => {
    const { db, app } = harness();
    const a = taskService.create(db, { title: 'A' });
    const res = await app.request('/tasks/bulk-delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [a.id] }),
    });
    expect(await res.json()).toEqual({ deleted: 1 });
  });

  it('404s when an id in PATCH /tasks/bulk does not exist', async () => {
    const { app } = harness();
    const res = await app.request('/tasks/bulk', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: ['ghost'], patch: { status: 'done' } }),
    });
    expect(res.status).toBe(404);
  });
});
