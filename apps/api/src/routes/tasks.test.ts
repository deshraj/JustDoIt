import { describe, it, expect } from 'vitest';
import { createDb, runMigrations } from '@justdoit/core';
import { createApp } from '../app';

interface TaskJson {
  id: string;
  title: string;
  status: string;
  completedAt: string | null;
}

function app() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return createApp(db);
}

async function createTask(a: ReturnType<typeof createApp>, body: unknown) {
  const res = await a.request('/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const task = res.status < 300 ? ((await res.json()) as TaskJson) : undefined;
  return { res, task: task as TaskJson };
}

describe('tasks routes', () => {
  it('creates a task and reads it back', async () => {
    const a = app();
    const { res, task } = await createTask(a, { title: 'Write plan' });
    expect(res.status).toBe(201);
    expect(task.status).toBe('todo');
    expect((await a.request(`/tasks/${task.id}`)).status).toBe(200);
  });

  it('changes status and completes a task', async () => {
    const a = app();
    const { task } = await createTask(a, { title: 'x' });

    const statusRes = await a.request(`/tasks/${task.id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' }),
    });
    const statusBody = (await statusRes.json()) as TaskJson;
    expect(statusBody.status).toBe('in_progress');

    const done = await a.request(`/tasks/${task.id}/complete`, { method: 'POST' });
    const doneBody = (await done.json()) as TaskJson;
    expect(doneBody.status).toBe('done');
    expect(doneBody.completedAt).not.toBeNull();
  });

  it('adds and lists subtasks', async () => {
    const a = app();
    const { task } = await createTask(a, { title: 'parent' });
    const sub = await a.request(`/tasks/${task.id}/subtasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'child' }),
    });
    expect(sub.status).toBe(201);
    const list = (await (await a.request(`/tasks/${task.id}/subtasks`)).json()) as TaskJson[];
    expect(list.map((t) => t.title)).toEqual(['child']);
  });

  it('filters via query params', async () => {
    const a = app();
    await createTask(a, { title: 'a', priority: 'p1' });
    await createTask(a, { title: 'b' });
    const p1 = (await (await a.request('/tasks?priority=p1')).json()) as TaskJson[];
    expect(p1).toHaveLength(1);
    const inbox = (await (await a.request('/tasks?project_id=none')).json()) as TaskJson[];
    expect(inbox).toHaveLength(2);
  });

  it('searches via GET /search?q=', async () => {
    const a = app();
    await createTask(a, { title: 'buy milk' });
    await createTask(a, { title: 'call bank' });
    const hits = (await (await a.request('/search?q=milk')).json()) as TaskJson[];
    expect(hits.map((t) => t.title)).toEqual(['buy milk']);
    expect((await a.request('/search')).status).toBe(400);
  });

  it('returns 404 for a missing task', async () => {
    expect((await app().request('/tasks/nope')).status).toBe(404);
  });
});
