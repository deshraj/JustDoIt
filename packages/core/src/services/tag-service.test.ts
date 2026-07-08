import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, tasks, type Db } from '../db';
import { tagService } from './tag-service';
import { NotFoundError, ConflictError } from '../errors';

function freshDb(): Db {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return db;
}

describe('tagService', () => {
  let db: Db;
  beforeEach(() => {
    db = freshDb();
  });

  it('creates a tag and rejects duplicate names', () => {
    const t = tagService.create(db, { name: 'errands', color: '#0f0' });
    expect(t.name).toBe('errands');
    expect(() => tagService.create(db, { name: 'errands' })).toThrow(ConflictError);
  });

  it('lists tags alphabetically', () => {
    tagService.create(db, { name: 'zeta' });
    tagService.create(db, { name: 'alpha' });
    expect(tagService.list(db).map((t) => t.name)).toEqual(['alpha', 'zeta']);
  });

  it('updates and removes a tag', () => {
    const t = tagService.create(db, { name: 'a' });
    expect(tagService.update(db, t.id, { name: 'b' }).name).toBe('b');
    tagService.remove(db, t.id);
    expect(() => tagService.get(db, t.id)).toThrow(NotFoundError);
  });

  it('attaches and detaches tags on a task (idempotent)', () => {
    // Task 3 stays self-contained: insert the parent task directly via the schema
    // rather than importing taskService (implemented later in Task 4).
    const task = db.insert(tasks).values({ title: 'x' }).returning().all()[0]!;
    const tag = tagService.create(db, { name: 'home' });
    tagService.attach(db, task.id, tag.id);
    tagService.attach(db, task.id, tag.id); // idempotent
    expect(tagService.listForTask(db, task.id).map((t) => t.name)).toEqual(['home']);
    tagService.detach(db, task.id, tag.id);
    expect(tagService.listForTask(db, task.id)).toHaveLength(0);
  });

  it('attach throws NotFoundError for a missing task or tag', () => {
    const task = db.insert(tasks).values({ title: 'x' }).returning().all()[0]!;
    expect(() => tagService.attach(db, task.id, 'nope')).toThrow(NotFoundError);
    expect(() => tagService.attach(db, 'nope', 'nope')).toThrow(NotFoundError);
  });
});
