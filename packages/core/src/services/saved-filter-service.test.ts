import { describe, it, expect } from 'vitest';
import { createDb, runMigrations } from '../db/client';
import { NotFoundError } from '../errors';
import { savedFilterService } from './saved-filter-service';
import { userService } from './user-service';
import { LOCAL_USER_ID } from '../constants';
import type { Ctx } from '../context';
import type { Db } from '../db';

const now = new Date('2026-07-08T12:00:00.000Z');

function db(): Db {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return db;
}

function ctxFor(d: Db, userId: string): Ctx {
  return { db: d, userId };
}

describe('savedFilterService', () => {
  it('creates, lists, gets, updates and deletes a filter', () => {
    const d = db();
    const ctx = ctxFor(d, LOCAL_USER_ID);
    const created = savedFilterService.create(
      ctx,
      { name: 'Overdue P0', query: { priorities: ['p0'], due: 'overdue' } },
      now,
    );
    expect(created.id).toMatch(/[0-9a-f-]{36}/);
    expect(created.query).toEqual({ priorities: ['p0'], due: 'overdue' });

    expect(savedFilterService.list(ctx)).toHaveLength(1);
    expect(savedFilterService.get(ctx, created.id).name).toBe('Overdue P0');

    const updated = savedFilterService.update(ctx, created.id, { name: 'Renamed' }, now);
    expect(updated.name).toBe('Renamed');

    savedFilterService.remove(ctx, created.id);
    expect(savedFilterService.list(ctx)).toHaveLength(0);
  });

  it('throws NotFoundError for a missing id', () => {
    const d = db();
    const ctx = ctxFor(d, LOCAL_USER_ID);
    expect(() => savedFilterService.get(ctx, 'nope')).toThrow(NotFoundError);
    expect(() => savedFilterService.remove(ctx, 'nope')).toThrow(NotFoundError);
  });

  it('rejects an empty name via schema validation', () => {
    const d = db();
    const ctx = ctxFor(d, LOCAL_USER_ID);
    expect(() => savedFilterService.create(ctx, { name: '', query: {} } as never)).toThrow();
  });

  describe('cross-tenant isolation', () => {
    it("A's list excludes B's filters; get/update/remove of B's id 404s", () => {
      const d = db();
      userService.create(d, { id: 'user-b', name: 'B' });
      const a = ctxFor(d, LOCAL_USER_ID);
      const b = ctxFor(d, 'user-b');

      const bFilter = savedFilterService.create(b, { name: 'B filter', query: {} }, now);
      expect(savedFilterService.list(a)).toHaveLength(0);
      expect(() => savedFilterService.get(a, bFilter.id)).toThrow(NotFoundError);
      expect(() => savedFilterService.update(a, bFilter.id, { name: 'hijack' })).toThrow(
        NotFoundError,
      );
      expect(() => savedFilterService.remove(a, bFilter.id)).toThrow(NotFoundError);
      // B still owns an untouched row.
      expect(savedFilterService.get(b, bFilter.id).name).toBe('B filter');
    });
  });
});
