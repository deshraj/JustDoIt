import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from '../db';
import { tasks, type TaskStatus } from '../db/schema';
import { ValidationError } from '../errors';
import { assertValidWindow, listOverdue, listDueToday, listUpcoming } from './schedule-service';

function freshDb(): Db {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return db;
}

function makeTask(db: Db, title: string, dueAt: Date | null, status: TaskStatus = 'todo') {
  const [row] = db.insert(tasks).values({ title, dueAt, status }).returning().all();
  return row!;
}

describe('schedule-service window validation', () => {
  it('accepts a window where startAt <= dueAt', () => {
    expect(() =>
      assertValidWindow({
        startAt: new Date('2026-01-01T00:00:00Z'),
        dueAt: new Date('2026-01-02T00:00:00Z'),
      }),
    ).not.toThrow();
  });

  it('accepts partial windows', () => {
    expect(() => assertValidWindow({ dueAt: new Date() })).not.toThrow();
    expect(() => assertValidWindow({})).not.toThrow();
  });

  it('rejects startAt after dueAt', () => {
    expect(() =>
      assertValidWindow({
        startAt: new Date('2026-01-03T00:00:00Z'),
        dueAt: new Date('2026-01-02T00:00:00Z'),
      }),
    ).toThrow(ValidationError);
  });
});

describe('schedule-service window queries', () => {
  let db: Db;
  // Use LOCAL calendar dates so "today" is TZ-independent for the test machine.
  const now = new Date(2026, 0, 15, 12, 0, 0); // 2026-01-15 12:00 local

  beforeEach(() => {
    db = freshDb();
  });

  it('listOverdue returns only past-due, non-terminal tasks', () => {
    makeTask(db, 'yesterday', new Date(2026, 0, 14, 9, 0, 0));
    makeTask(db, 'done-overdue', new Date(2026, 0, 14, 9, 0, 0), 'done');
    makeTask(db, 'tomorrow', new Date(2026, 0, 16, 9, 0, 0));
    makeTask(db, 'no-due', null);
    const overdue = listOverdue(db, now);
    expect(overdue.map((t) => t.title)).toEqual(['yesterday']);
  });

  it('listDueToday returns tasks due within the local day', () => {
    makeTask(db, 'early-today', new Date(2026, 0, 15, 8, 0, 0));
    makeTask(db, 'late-today', new Date(2026, 0, 15, 23, 30, 0));
    makeTask(db, 'yesterday', new Date(2026, 0, 14, 9, 0, 0));
    makeTask(db, 'tomorrow', new Date(2026, 0, 16, 9, 0, 0));
    const today = listDueToday(db, now);
    expect(today.map((t) => t.title)).toEqual(['early-today', 'late-today']);
  });

  it('listUpcoming returns tasks due after now through now+days', () => {
    makeTask(db, 'in-2-days', new Date(2026, 0, 17, 9, 0, 0));
    makeTask(db, 'in-7-days', new Date(2026, 0, 22, 9, 0, 0));
    makeTask(db, 'in-30-days', new Date(2026, 1, 14, 9, 0, 0));
    makeTask(db, 'past', new Date(2026, 0, 10, 9, 0, 0));
    const upcoming = listUpcoming(db, now, 7);
    expect(upcoming.map((t) => t.title)).toEqual(['in-2-days', 'in-7-days']);
  });
});
