import { describe, it, expect } from 'vitest';
import { createDb, runMigrations, taskService, LOCAL_USER_ID } from '@justdoit/core';
import { createApp } from '../app';

interface ActivityEntryJson {
  entityType: string;
  entityId: string;
  action: string;
}

function app() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return { db, app: createApp(db) };
}

describe('GET /activity', () => {
  it('returns activity for a task via entity=task:<id>', async () => {
    const { db, app: a } = app();
    const task = taskService.create({ db, userId: LOCAL_USER_ID }, { title: 'X' });
    const res = await a.request(`/activity?entity=task:${task.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { activity: ActivityEntryJson[] };
    expect(body.activity[0]).toMatchObject({
      entityType: 'task',
      entityId: task.id,
      action: 'created',
    });
  });

  it('400s on a malformed entity param', async () => {
    const { app: a } = app();
    const res = await a.request('/activity?entity=garbage');
    expect(res.status).toBe(400);
  });
});
