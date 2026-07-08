import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from '../db';
import { tasks } from '../db/schema';
import { NotFoundError } from '../errors';
import { reminderService } from './reminder-service';

function freshDb(): Db {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return db;
}

function makeTask(db: Db, title = 'task'): string {
  const [row] = db.insert(tasks).values({ title }).returning().all();
  return row!.id;
}

describe('reminder-service', () => {
  let db: Db;
  beforeEach(() => {
    db = freshDb();
  });

  it('creates and gets a reminder', () => {
    const taskId = makeTask(db);
    const r = reminderService.create(db, { taskId, remindAt: new Date('2026-04-01T09:00:00Z') });
    expect(r.delivered).toBe(false);
    expect(reminderService.get(db, r.id).id).toBe(r.id);
  });

  it('rejects a reminder for a missing task', () => {
    expect(() =>
      reminderService.create(db, {
        taskId: '00000000-0000-0000-0000-000000000000',
        remindAt: new Date(),
      }),
    ).toThrow(NotFoundError);
  });

  it('lists and filters reminders', () => {
    const taskId = makeTask(db);
    reminderService.create(db, { taskId, remindAt: new Date('2026-04-02T09:00:00Z') });
    reminderService.create(db, { taskId, remindAt: new Date('2026-04-01T09:00:00Z') });
    const all = reminderService.list(db, { taskId });
    expect(all.map((r) => r.remindAt.toISOString())).toEqual([
      '2026-04-01T09:00:00.000Z',
      '2026-04-02T09:00:00.000Z',
    ]);
  });

  it('updates and deletes a reminder', () => {
    const taskId = makeTask(db);
    const r = reminderService.create(db, { taskId, remindAt: new Date('2026-04-01T09:00:00Z') });
    const updated = reminderService.update(db, r.id, {
      remindAt: new Date('2026-04-05T09:00:00Z'),
    });
    expect(updated.remindAt.toISOString()).toBe('2026-04-05T09:00:00.000Z');
    reminderService.remove(db, r.id);
    expect(() => reminderService.get(db, r.id)).toThrow(NotFoundError);
  });

  it('returns only undelivered reminders at/under now', () => {
    const taskId = makeTask(db);
    const now = new Date('2026-04-10T12:00:00Z');
    const past = reminderService.create(db, { taskId, remindAt: new Date('2026-04-10T11:00:00Z') });
    reminderService.create(db, { taskId, remindAt: new Date('2026-04-10T13:00:00Z') }); // future
    const alreadyDone = reminderService.create(db, {
      taskId,
      remindAt: new Date('2026-04-10T10:00:00Z'),
    });
    reminderService.markDelivered(db, alreadyDone.id);

    const due = reminderService.dueReminders(db, now);
    expect(due.map((r) => r.id)).toEqual([past.id]);
  });

  it('markDelivered flips the flag', () => {
    const taskId = makeTask(db);
    const r = reminderService.create(db, { taskId, remindAt: new Date('2026-04-01T09:00:00Z') });
    expect(reminderService.markDelivered(db, r.id).delivered).toBe(true);
  });
});
