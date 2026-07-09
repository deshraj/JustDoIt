import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, tasks, LOCAL_USER_ID, type Db } from '@justdoit/core';
import { createApp } from '../app';

interface ReminderJson {
  id: string;
  taskId: string;
  remindAt: string;
  delivered: boolean;
}

function setup(): { app: ReturnType<typeof createApp>; db: Db } {
  const { db } = createDb(':memory:');
  runMigrations(db);
  const app = createApp(db);
  return { app, db };
}

describe('reminders routes', () => {
  let app: ReturnType<typeof createApp>;
  let db: Db;
  let taskId: string;

  beforeEach(() => {
    ({ app, db } = setup());
    const [t] = db
      .insert(tasks)
      .values({ userId: LOCAL_USER_ID, title: 'ping me' })
      .returning()
      .all();
    taskId = t!.id;
  });

  it('creates, lists, patches, and deletes a reminder', async () => {
    const created = await app.request('/reminders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId, remindAt: '2026-05-01T09:00:00Z' }),
    });
    expect(created.status).toBe(201);
    const reminder = (await created.json()) as ReminderJson;
    expect(reminder.delivered).toBe(false);

    const list = await app.request(`/reminders?taskId=${taskId}`);
    expect(((await list.json()) as ReminderJson[]).length).toBe(1);

    const patched = await app.request(`/reminders/${reminder.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ delivered: true }),
    });
    expect(((await patched.json()) as ReminderJson).delivered).toBe(true);

    const del = await app.request(`/reminders/${reminder.id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);
  });

  it('404s creating a reminder for a missing task', async () => {
    const res = await app.request('/reminders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        taskId: '00000000-0000-0000-0000-000000000000',
        remindAt: '2026-05-01T09:00:00Z',
      }),
    });
    expect(res.status).toBe(404);
  });
});
