import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations } from '../db/client';
import { events } from '../events/bus';
import { taskService } from './task-service';
import { activityService, startActivityLog } from './activity-service';
import { userService } from './user-service';
import { LOCAL_USER_ID } from '../constants';
import type { Ctx } from '../context';

describe('activityService', () => {
  beforeEach(() => events.reset());

  it('records an entry for every mutation once the logger is attached', () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const stop = startActivityLog(db);
    const ctx: Ctx = { db, userId: LOCAL_USER_ID };

    const task = taskService.create(ctx, { title: 'Write docs' });
    taskService.setStatus(ctx, task.id, 'done');

    const entries = activityService.list(ctx, { entityType: 'task', entityId: task.id });
    expect(entries.map((e) => e.action)).toEqual(['status_changed', 'created']); // newest first
    expect(entries[0]!.payload).toMatchObject({ to: 'done' });
    expect(entries[1]!.createdAt).toBeInstanceOf(Date);
    // newest-first ordering: the later status_changed is at or after the created entry
    expect(entries[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(entries[1]!.createdAt.getTime());
    stop();
  });

  it('stops recording after unsubscribe', () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const stop = startActivityLog(db);
    const ctx: Ctx = { db, userId: LOCAL_USER_ID };
    stop();
    taskService.create(ctx, { title: 'Untracked' });
    expect(activityService.list(ctx)).toHaveLength(0);
  });

  it('filters by entity and honours limit', () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    startActivityLog(db);
    const ctx: Ctx = { db, userId: LOCAL_USER_ID };
    const a = taskService.create(ctx, { title: 'A' });
    taskService.create(ctx, { title: 'B' });
    expect(activityService.list(ctx, { entityId: a.id })).toHaveLength(1);
    expect(activityService.list(ctx, { limit: 1 })).toHaveLength(1);
  });

  it('cross-tenant isolation: A never sees B activity', () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    startActivityLog(db);
    userService.create(db, { id: 'user-b', name: 'B' });
    const a: Ctx = { db, userId: LOCAL_USER_ID };
    const b: Ctx = { db, userId: 'user-b' };

    // Simulate a B-owned event directly on the bus (services aren't ctx-aware yet in this task).
    events.publish({
      type: 'task.created',
      userId: 'user-b',
      entityType: 'task',
      entityId: 'b-task',
      action: 'created',
      at: Date.now(),
    });
    taskService.create(a, { title: 'A task' });

    expect(activityService.list(a).every((e) => e.entityId !== 'b-task')).toBe(true);
    expect(activityService.list(b).map((e) => e.entityId)).toEqual(['b-task']);
  });
});
