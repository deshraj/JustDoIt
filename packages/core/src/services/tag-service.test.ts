import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, tasks, type Db } from '../db';
import { tagService } from './tag-service';
import { taskService } from './task-service';
import { NotFoundError, ConflictError } from '../errors';
import { LOCAL_USER_ID } from '../constants';
import { userService } from './user-service';
import type { Ctx } from '../context';

function freshDb(): Db {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return db;
}

function ctxFor(db: Db, userId: string): Ctx {
  return { db, userId };
}

describe('tagService', () => {
  let db: Db;
  let ctx: Ctx;
  beforeEach(() => {
    db = freshDb();
    ctx = ctxFor(db, LOCAL_USER_ID);
  });

  it('creates a tag and rejects duplicate names', () => {
    const t = tagService.create(ctx, { name: 'errands', color: '#0f0' });
    expect(t.name).toBe('errands');
    expect(() => tagService.create(ctx, { name: 'errands' })).toThrow(ConflictError);
  });

  it('lists tags alphabetically', () => {
    tagService.create(ctx, { name: 'zeta' });
    tagService.create(ctx, { name: 'alpha' });
    expect(tagService.list(ctx).map((t) => t.name)).toEqual(['alpha', 'zeta']);
  });

  it('updates and removes a tag', () => {
    const t = tagService.create(ctx, { name: 'a' });
    expect(tagService.update(ctx, t.id, { name: 'b' }).name).toBe('b');
    tagService.remove(ctx, t.id);
    expect(() => tagService.get(ctx, t.id)).toThrow(NotFoundError);
  });

  it('attaches and detaches tags on a task (idempotent)', () => {
    // Task 3 stays self-contained: insert the parent task directly via the schema
    // rather than importing taskService (implemented later in Task 4).
    const task = db
      .insert(tasks)
      .values({ userId: LOCAL_USER_ID, title: 'x' })
      .returning()
      .all()[0]!;
    const tag = tagService.create(ctx, { name: 'home' });
    tagService.attach(ctx, task.id, tag.id);
    tagService.attach(ctx, task.id, tag.id); // idempotent
    expect(tagService.listForTask(ctx, task.id).map((t) => t.name)).toEqual(['home']);
    tagService.detach(ctx, task.id, tag.id);
    expect(tagService.listForTask(ctx, task.id)).toHaveLength(0);
  });

  it('attach throws NotFoundError for a missing task or tag', () => {
    const task = db
      .insert(tasks)
      .values({ userId: LOCAL_USER_ID, title: 'x' })
      .returning()
      .all()[0]!;
    expect(() => tagService.attach(ctx, task.id, 'nope')).toThrow(NotFoundError);
    expect(() => tagService.attach(ctx, 'nope', 'nope')).toThrow(NotFoundError);
  });

  describe('cross-tenant isolation', () => {
    let a: Ctx;
    let b: Ctx;
    beforeEach(() => {
      userService.create(db, { id: 'user-b', name: 'B' });
      a = ctxFor(db, LOCAL_USER_ID);
      b = ctxFor(db, 'user-b');
    });

    it('same tag name allowed across users; duplicate per user rejected', () => {
      tagService.create(a, { name: 'urgent' });
      expect(() => tagService.create(b, { name: 'urgent' })).not.toThrow();
      expect(() => tagService.create(a, { name: 'urgent' })).toThrow(ConflictError);
    });

    it('A cannot attach B tag, nor attach onto B task', () => {
      const aTask = taskService.create(a, { title: 'A' });
      const bTag = tagService.create(b, { name: 'secret' });
      expect(() => tagService.attach(a, aTask.id, bTag.id)).toThrow(NotFoundError); // B tag
      const bTask = taskService.create(b, { title: 'B' });
      const aTag = tagService.create(a, { name: 'mine' });
      expect(() => tagService.attach(a, bTask.id, aTag.id)).toThrow(NotFoundError); // B task
    });

    it('A cannot get/update/remove B tag, nor see it in list', () => {
      const bTag = tagService.create(b, { name: 'B tag' });
      expect(tagService.list(a).map((t) => t.id)).not.toContain(bTag.id);
      expect(() => tagService.get(a, bTag.id)).toThrow(NotFoundError);
      expect(() => tagService.update(a, bTag.id, { name: 'hijack' })).toThrow(NotFoundError);
      expect(() => tagService.remove(a, bTag.id)).toThrow(NotFoundError);
    });
  });
});
