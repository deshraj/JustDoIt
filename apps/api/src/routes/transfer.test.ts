import { describe, it, expect } from 'vitest';
import { createDb, runMigrations } from '@justdoit/core';
import { createApp } from '../app';

function app() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return createApp(db);
}

describe('quick-add + transfer routes', () => {
  it('POST /quick-add creates a task with a tag', async () => {
    const a = app();
    const res = await a.request('/quick-add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'buy milk #errands p1' }),
    });
    expect(res.status).toBe(201);
    const task = (await res.json()) as { title: string; priority: string };
    expect(task.title).toBe('buy milk');
    expect(task.priority).toBe('p1');
  });

  it('POST /quick-add rejects empty text with 400', async () => {
    const res = await app().request('/quick-add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('GET /export then POST /import round-trips into a fresh server', async () => {
    const source = app();
    await source.request('/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'seed' }),
    });
    const snapshot = await (await source.request('/export')).json();

    const target = app();
    const imported = await target.request('/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
    expect(imported.status).toBe(200);
    const importedBody = (await imported.json()) as { counts: { tasks: number } };
    expect(importedBody.counts.tasks).toBe(1);

    const tasks = (await (await target.request('/tasks')).json()) as { title: string }[];
    expect(tasks.map((t) => t.title)).toEqual(['seed']);
  });

  it('POST /import rejects a malformed snapshot with 400', async () => {
    const res = await app().request('/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nope: true }),
    });
    expect(res.status).toBe(400);
  });
});
