import { describe, it, expect } from 'vitest';
import { createDb, runMigrations } from '@justdoit/core';
import { createApp } from '../app';

interface TagJson {
  id: string;
  name: string;
}
interface TaskJson {
  id: string;
}

function app() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return createApp(db);
}

async function postJson(a: ReturnType<typeof createApp>, path: string, body: unknown) {
  return a.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('task-tags routes', () => {
  it('attaches, lists, and detaches a tag on a task', async () => {
    const a = app();
    const task = (await (await postJson(a, '/tasks', { title: 'x' })).json()) as TaskJson;
    const tag = (await (await postJson(a, '/tags', { name: 'errands' })).json()) as TagJson;

    const attach = await postJson(a, `/tasks/${task.id}/tags`, { tagId: tag.id });
    expect(attach.status).toBe(201);
    expect((await attach.json()) as TagJson[]).toEqual([{ ...tag }]);

    const list = (await (await a.request(`/tasks/${task.id}/tags`)).json()) as TagJson[];
    expect(list.map((t) => t.name)).toEqual(['errands']);

    const detach = await a.request(`/tasks/${task.id}/tags/${tag.id}`, { method: 'DELETE' });
    expect(detach.status).toBe(200);
    expect((await detach.json()) as TagJson[]).toEqual([]);
  });

  it('404s for an unknown task', async () => {
    const a = app();
    expect((await a.request('/tasks/nope/tags')).status).toBe(404);
  });
});
