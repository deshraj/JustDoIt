import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations } from '../db/client';
import { events } from '../events/bus';
import { taskService } from './task-service';
import { activityService, startActivityLog } from './activity-service';

describe('activityService', () => {
  beforeEach(() => events.reset());

  it('records an entry for every mutation once the logger is attached', () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const stop = startActivityLog(db);

    const task = taskService.create(db, { title: 'Write docs' });
    taskService.setStatus(db, task.id, 'done');

    const entries = activityService.list(db, { entityType: 'task', entityId: task.id });
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
    stop();
    taskService.create(db, { title: 'Untracked' });
    expect(activityService.list(db)).toHaveLength(0);
  });

  it('filters by entity and honours limit', () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    startActivityLog(db);
    const a = taskService.create(db, { title: 'A' });
    taskService.create(db, { title: 'B' });
    expect(activityService.list(db, { entityId: a.id })).toHaveLength(1);
    expect(activityService.list(db, { limit: 1 })).toHaveLength(1);
  });
});
