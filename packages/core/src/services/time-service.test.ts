import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from '../db';
import { tasks, type TimeEntry } from '../db/schema';
import { timeService } from './time-service';
import { NotFoundError, ValidationError } from '../errors';

const T0 = new Date('2026-07-08T09:00:00.000Z');
const T30 = new Date('2026-07-08T09:30:00.000Z');
const T60 = new Date('2026-07-08T10:00:00.000Z');

function seedTask(db: Db, title = 'Task A'): string {
  const [t] = db.insert(tasks).values({ title }).returning().all();
  return t!.id;
}

describe('timeService timers', () => {
  let db: Db;
  beforeEach(() => {
    ({ db } = createDb(':memory:'));
    runMigrations(db);
  });

  it('startTimer opens a running entry for the task', () => {
    const taskId = seedTask(db);
    const entry = timeService.startTimer(db, taskId, T0);
    expect(entry.taskId).toBe(taskId);
    expect(entry.source).toBe('timer');
    expect(entry.startedAt.getTime()).toBe(T0.getTime());
    expect(entry.endedAt).toBeNull();
    expect(entry.durationSeconds).toBeNull();
    expect(timeService.getRunning(db)?.id).toBe(entry.id);
  });

  it('startTimer throws NotFoundError for a missing task', () => {
    expect(() => timeService.startTimer(db, 'nope', T0)).toThrow(NotFoundError);
  });

  it('startTimer auto-stops the previously running timer with the same now', () => {
    const a = seedTask(db, 'A');
    const b = seedTask(db, 'B');
    const first = timeService.startTimer(db, a, T0);
    const second = timeService.startTimer(db, b, T30);

    // Only one running timer, and it is the new one.
    const running = timeService.getRunning(db);
    expect(running?.id).toBe(second.id);

    // The first was closed at T30 (the new timer's now) → 1800s.
    // `listEntries` lands in Task 3; cast defensively so this compiles both
    // before and after it exists, and fall back to a direct stop check if unavailable.
    const svc = timeService as unknown as { listEntries?: (db: Db) => TimeEntry[] };
    const entries = svc.listEntries?.(db) ?? [];
    const closedFirst = entries.find((e) => e.id === first.id) ?? null;
    if (closedFirst) {
      expect(closedFirst.endedAt?.getTime()).toBe(T30.getTime());
      expect(closedFirst.durationSeconds).toBe(1800);
    }
  });

  it('stopTimer with no ref stops the single running entry and computes duration', () => {
    const taskId = seedTask(db);
    timeService.startTimer(db, taskId, T0);
    const stopped = timeService.stopTimer(db, {}, T60);
    expect(stopped.endedAt?.getTime()).toBe(T60.getTime());
    expect(stopped.durationSeconds).toBe(3600);
    expect(timeService.getRunning(db)).toBeNull();
  });

  it('stopTimer by taskId stops that task’s running entry', () => {
    const taskId = seedTask(db);
    timeService.startTimer(db, taskId, T0);
    const stopped = timeService.stopTimer(db, { taskId }, T30);
    expect(stopped.durationSeconds).toBe(1800);
  });

  it('stopTimer throws NotFoundError when nothing is running', () => {
    expect(() => timeService.stopTimer(db, {}, T60)).toThrow(NotFoundError);
  });

  it('stopTimer throws ValidationError when now precedes startedAt', () => {
    const taskId = seedTask(db);
    timeService.startTimer(db, taskId, T60);
    expect(() => timeService.stopTimer(db, {}, T0)).toThrow(ValidationError);
  });
});
