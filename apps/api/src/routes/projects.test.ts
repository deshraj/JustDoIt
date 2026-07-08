import { describe, it, expect } from 'vitest';
import { createDb, runMigrations } from '@justdoit/core';
import { createApp } from '../app';

function app() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return createApp(db);
}

describe('projects routes', () => {
  it('creates, reads, lists, updates, deletes a project', async () => {
    const a = app();
    const created = await a.request('/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Work' }),
    });
    expect(created.status).toBe(201);
    const project = (await created.json()) as { id: string; name: string };
    expect(project.name).toBe('Work');

    expect((await a.request('/projects')).status).toBe(200);
    expect((await a.request(`/projects/${project.id}`)).status).toBe(200);

    const patched = await a.request(`/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Work2' }),
    });
    const patchedBody = (await patched.json()) as { name: string };
    expect(patchedBody.name).toBe('Work2');

    const del = await a.request(`/projects/${project.id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);
    expect((await a.request(`/projects/${project.id}`)).status).toBe(404);
  });

  it('rejects an invalid create body with 400', async () => {
    const res = await app().request('/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(400);
  });
});
