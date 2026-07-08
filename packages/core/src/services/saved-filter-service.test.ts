import { describe, it, expect } from 'vitest';
import { createDb, runMigrations } from '../db/client';
import { NotFoundError } from '../errors';
import { savedFilterService } from './saved-filter-service';

const now = new Date('2026-07-08T12:00:00.000Z');

function db() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return db;
}

describe('savedFilterService', () => {
  it('creates, lists, gets, updates and deletes a filter', () => {
    const d = db();
    const created = savedFilterService.create(
      d,
      { name: 'Overdue P0', query: { priorities: ['p0'], due: 'overdue' } },
      now,
    );
    expect(created.id).toMatch(/[0-9a-f-]{36}/);
    expect(created.query).toEqual({ priorities: ['p0'], due: 'overdue' });

    expect(savedFilterService.list(d)).toHaveLength(1);
    expect(savedFilterService.get(d, created.id).name).toBe('Overdue P0');

    const updated = savedFilterService.update(d, created.id, { name: 'Renamed' }, now);
    expect(updated.name).toBe('Renamed');

    savedFilterService.remove(d, created.id);
    expect(savedFilterService.list(d)).toHaveLength(0);
  });

  it('throws NotFoundError for a missing id', () => {
    const d = db();
    expect(() => savedFilterService.get(d, 'nope')).toThrow(NotFoundError);
    expect(() => savedFilterService.remove(d, 'nope')).toThrow(NotFoundError);
  });

  it('rejects an empty name via schema validation', () => {
    const d = db();
    expect(() => savedFilterService.create(d, { name: '', query: {} } as never)).toThrow();
  });
});
