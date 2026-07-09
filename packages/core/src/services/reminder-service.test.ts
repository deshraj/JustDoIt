import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from '../db';
import { tasks } from '../db/schema';
import { NotFoundError } from '../errors';
import { reminderService } from './reminder-service';
import { taskService } from './task-service';
import { userService } from './user-service';
import { LOCAL_USER_ID } from '../constants';
import type { Ctx } from '../context';

function freshDb(): Db {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return db;
}

function ctxFor(db: Db, userId: string): Ctx {
  return { db, userId };
}

function makeTask(db: Db, title = 'task'): string {
  const [row] = db
    .insert(tasks)
    .values({ userId: LOCAL_USER_ID, title })
    .returning()
    .all();
  return row!.id;
}

describe('reminder-service', () => {
  let db: Db;
  let ctx: Ctx;
  beforeEach(() => {
    db = freshDb();
    ctx = ctxFor(db, LOCAL_USER_ID);
  });

  it('creates and gets a reminder', () => {
    const taskId = makeTask(db);
    const r = reminderService.create(ctx, { taskId, remindAt: new Date('2026-04-01T09:00:00Z') });
    expect(r.delivered).toBe(false);
    expect(reminderService.get(ctx, r.id).id).toBe(r.id);
  });

  it('rejects a reminder for a missing task', () => {
    expect(() =>
      reminderService.create(ctx, {
        taskId: '00000000-0000-0000-0000-000000000000',
        remindAt: new Date(),
      }),
    ).toThrow(NotFoundError);
  });

  it('lists and filters reminders', () => {
    const taskId = makeTask(db);
    reminderService.create(ctx, { taskId, remindAt: new Date('2026-04-02T09:00:00Z') });
    reminderService.create(ctx, { taskId, remindAt: new Date('2026-04-01T09:00:00Z') });
    const all = reminderService.list(ctx, { taskId });
    expect(all.map((r) => r.remindAt.toISOString())).toEqual([
      '2026-04-01T09:00:00.000Z',
      '2026-04-02T09:00:00.000Z',
    ]);
  });

  it('updates and deletes a reminder', () => {
    const taskId = makeTask(db);
    const r = reminderService.create(ctx, { taskId, remindAt: new Date('2026-04-01T09:00:00Z') });
    const updated = reminderService.update(ctx, r.id, {
      remindAt: new Date('2026-04-05T09:00:00Z'),
    });
    expect(updated.remindAt.toISOString()).toBe('2026-04-05T09:00:00.000Z');
    reminderService.remove(ctx, r.id);
    expect(() => reminderService.get(ctx, r.id)).toThrow(NotFoundError);
  });

  it('returns only undelivered reminders at/under now', () => {
    const taskId = makeTask(db);
    const now = new Date('2026-04-10T12:00:00Z');
    const past = reminderService.create(ctx, { taskId, remindAt: new Date('2026-04-10T11:00:00Z') });
    reminderService.create(ctx, { taskId, remindAt: new Date('2026-04-10T13:00:00Z') }); // future
    const alreadyDone = reminderService.create(ctx, {
      taskId,
      remindAt: new Date('2026-04-10T10:00:00Z'),
    });
    reminderService.markDelivered(ctx, alreadyDone.id);

    const due = reminderService.dueReminders(db, now);
    expect(due.map((r) => r.id)).toEqual([past.id]);
  });

  it('markDelivered flips the flag', () => {
    const taskId = makeTask(db);
    const r = reminderService.create(ctx, { taskId, remindAt: new Date('2026-04-01T09:00:00Z') });
    expect(reminderService.markDelivered(ctx, r.id).delivered).toBe(true);
  });

  describe('cross-tenant isolation', () => {
    let a: Ctx;
    let b: Ctx;
    beforeEach(() => {
      userService.create(db, { id: 'user-b', name: 'B' });
      a = ctxFor(db, LOCAL_USER_ID);
      b = ctxFor(db, 'user-b');
    });

    it('A cannot create against B task, nor get/update/delete/markDelivered B reminder', () => {
      const bTask = taskService.create(b, { title: 'B' });
      expect(() => reminderService.create(a, { taskId: bTask.id, remindAt: new Date() })).toThrow(
        NotFoundError,
      );
      const bRem = reminderService.create(b, { taskId: bTask.id, remindAt: new Date() });
      expect(reminderService.list(a).map((r) => r.id)).not.toContain(bRem.id);
      expect(() => reminderService.get(a, bRem.id)).toThrow(NotFoundError);
      expect(() => reminderService.update(a, bRem.id, { delivered: true })).toThrow(NotFoundError);
      expect(() => reminderService.markDelivered(a, bRem.id)).toThrow(NotFoundError);
      expect(() => reminderService.remove(a, bRem.id)).toThrow(NotFoundError);
    });

    it('dueReminders (scheduler) sees all users', () => {
      const now = new Date('2026-04-10T12:00:00Z');
      const aTask = taskService.create(a, { title: 'A' });
      const bTask = taskService.create(b, { title: 'B' });
      const aRem = reminderService.create(a, {
        taskId: aTask.id,
        remindAt: new Date('2026-04-10T11:00:00Z'),
      });
      const bRem = reminderService.create(b, {
        taskId: bTask.id,
        remindAt: new Date('2026-04-10T11:00:00Z'),
      });
      const due = reminderService.dueReminders(db, now);
      expect(due.map((r) => r.id).sort()).toEqual([aRem.id, bRem.id].sort());
    });
  });
});
