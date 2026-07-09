import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from '../db';
import { events, type DomainEvent } from '../events/bus';
import { NotFoundError, ValidationError } from '../errors';
import { taskService } from './task-service';
import { userService } from './user-service';
import { LOCAL_USER_ID } from '../constants';
import type { Ctx } from '../context';

function ctxFor(db: Db, userId: string): Ctx {
  return { db, userId };
}

describe('taskService.bulkUpdate / bulkDelete', () => {
  beforeEach(() => events.reset());

  it('updates status/priority across many tasks and emits per task', () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const ctx: Ctx = { db, userId: LOCAL_USER_ID };
    const seen: DomainEvent[] = [];
    events.subscribe((e) => seen.push(e));
    const a = taskService.create(ctx, { title: 'A' });
    const b = taskService.create(ctx, { title: 'B' });
    seen.length = 0;

    const updated = taskService.bulkUpdate(ctx, [a.id, b.id], { status: 'done', priority: 'p1' });
    expect(updated).toHaveLength(2);
    expect(updated.every((t) => t.status === 'done' && t.priority === 'p1')).toBe(true);
    expect(seen.filter((e) => e.type === 'task.status_changed')).toHaveLength(2);
  });

  it('bulkDelete removes tasks and reports the count', () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const ctx: Ctx = { db, userId: LOCAL_USER_ID };
    const a = taskService.create(ctx, { title: 'A' });
    const b = taskService.create(ctx, { title: 'B' });
    expect(taskService.bulkDelete(ctx, [a.id, b.id])).toEqual({ deleted: 2 });
    expect(taskService.list(ctx)).toHaveLength(0);
  });

  it('throws NotFoundError if any id is missing and ValidationError on empty ids', () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const ctx: Ctx = { db, userId: LOCAL_USER_ID };
    const a = taskService.create(ctx, { title: 'A' });
    expect(() => taskService.bulkUpdate(ctx, [a.id, 'ghost'], { status: 'todo' })).toThrow(
      NotFoundError,
    );
    expect(() => taskService.bulkUpdate(ctx, [], { status: 'todo' })).toThrow(ValidationError);
  });

  describe('cross-tenant isolation', () => {
    let db: Db;
    let a: Ctx;
    let b: Ctx;
    beforeEach(() => {
      const created = createDb(':memory:');
      db = created.db;
      runMigrations(db);
      userService.create(db, { id: 'user-b', name: 'B' });
      a = ctxFor(db, LOCAL_USER_ID);
      b = ctxFor(db, 'user-b');
    });

    it('bulkUpdate rejects when an id belongs to B', () => {
      const bTask = taskService.create(b, { title: 'B' });
      const aTask = taskService.create(a, { title: 'A' });
      expect(() => taskService.bulkUpdate(a, [aTask.id, bTask.id], { status: 'done' })).toThrow(
        NotFoundError,
      );
      expect(taskService.get(b, bTask.id).status).toBe('todo'); // untouched
    });

    it('bulkDelete only deletes A tasks', () => {
      const bTask = taskService.create(b, { title: 'B' });
      const aTask = taskService.create(a, { title: 'A' });
      expect(taskService.bulkDelete(a, [aTask.id, bTask.id])).toEqual({ deleted: 1 });
      expect(taskService.get(b, bTask.id)).toBeDefined();
    });
  });
});
