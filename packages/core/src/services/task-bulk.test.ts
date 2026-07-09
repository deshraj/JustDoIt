import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations } from '../db/client';
import { events, type DomainEvent } from '../events/bus';
import { NotFoundError, ValidationError } from '../errors';
import { taskService } from './task-service';
import { LOCAL_USER_ID } from '../constants';
import type { Ctx } from '../context';

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

    const updated = taskService.bulkUpdate(db, [a.id, b.id], { status: 'done', priority: 'p1' });
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
    expect(taskService.bulkDelete(db, [a.id, b.id])).toEqual({ deleted: 2 });
    expect(taskService.list(ctx)).toHaveLength(0);
  });

  it('throws NotFoundError if any id is missing and ValidationError on empty ids', () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const ctx: Ctx = { db, userId: LOCAL_USER_ID };
    const a = taskService.create(ctx, { title: 'A' });
    expect(() => taskService.bulkUpdate(db, [a.id, 'ghost'], { status: 'todo' })).toThrow(
      NotFoundError,
    );
    expect(() => taskService.bulkUpdate(db, [], { status: 'todo' })).toThrow(ValidationError);
  });
});
