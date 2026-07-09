import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from '../db';
import { tasks, projects, type TimeEntry } from '../db/schema';
import { timeService } from './time-service';
import { taskService } from './task-service';
import { userService } from './user-service';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { LOCAL_USER_ID } from '../constants';
import type { Ctx } from '../context';

const T0 = new Date('2026-07-08T09:00:00.000Z');
const T30 = new Date('2026-07-08T09:30:00.000Z');
const T60 = new Date('2026-07-08T10:00:00.000Z');

function ctxFor(db: Db, userId: string): Ctx {
  return { db, userId };
}

function seedTask(db: Db, title = 'Task A'): string {
  const [t] = db.insert(tasks).values({ userId: LOCAL_USER_ID, title }).returning().all();
  return t!.id;
}

describe('timeService timers', () => {
  let db: Db;
  let ctx: Ctx;
  beforeEach(() => {
    ({ db } = createDb(':memory:'));
    runMigrations(db);
    ctx = ctxFor(db, LOCAL_USER_ID);
  });

  it('startTimer opens a running entry for the task', () => {
    const taskId = seedTask(db);
    const entry = timeService.startTimer(ctx, taskId, T0);
    expect(entry.taskId).toBe(taskId);
    expect(entry.source).toBe('timer');
    expect(entry.startedAt.getTime()).toBe(T0.getTime());
    expect(entry.endedAt).toBeNull();
    expect(entry.durationSeconds).toBeNull();
    expect(timeService.getRunning(ctx)?.id).toBe(entry.id);
  });

  it('startTimer throws NotFoundError for a missing task', () => {
    expect(() => timeService.startTimer(ctx, 'nope', T0)).toThrow(NotFoundError);
  });

  it('startTimer auto-stops the previously running timer with the same now', () => {
    const a = seedTask(db, 'A');
    const b = seedTask(db, 'B');
    const first = timeService.startTimer(ctx, a, T0);
    const second = timeService.startTimer(ctx, b, T30);

    // Only one running timer, and it is the new one.
    const running = timeService.getRunning(ctx);
    expect(running?.id).toBe(second.id);

    // The first was closed at T30 (the new timer's now) → 1800s.
    const entries: TimeEntry[] = timeService.listEntries(ctx);
    const closedFirst = entries.find((e) => e.id === first.id);
    expect(closedFirst).toBeDefined();
    expect(closedFirst!.endedAt?.getTime()).toBe(T30.getTime());
    expect(closedFirst!.durationSeconds).toBe(1800);
  });

  it('stopTimer with no ref stops the single running entry and computes duration', () => {
    const taskId = seedTask(db);
    timeService.startTimer(ctx, taskId, T0);
    const stopped = timeService.stopTimer(ctx, {}, T60);
    expect(stopped.endedAt?.getTime()).toBe(T60.getTime());
    expect(stopped.durationSeconds).toBe(3600);
    expect(timeService.getRunning(ctx)).toBeNull();
  });

  it('stopTimer by taskId stops that task’s running entry', () => {
    const taskId = seedTask(db);
    timeService.startTimer(ctx, taskId, T0);
    const stopped = timeService.stopTimer(ctx, { taskId }, T30);
    expect(stopped.durationSeconds).toBe(1800);
  });

  it('stopTimer throws NotFoundError when nothing is running', () => {
    expect(() => timeService.stopTimer(ctx, {}, T60)).toThrow(NotFoundError);
  });

  it('stopTimer throws ValidationError when now precedes startedAt', () => {
    const taskId = seedTask(db);
    timeService.startTimer(ctx, taskId, T60);
    expect(() => timeService.stopTimer(ctx, {}, T0)).toThrow(ValidationError);
  });
});

describe('timeService manual entries & management', () => {
  let db: Db;
  let ctx: Ctx;
  beforeEach(() => {
    ({ db } = createDb(':memory:'));
    runMigrations(db);
    ctx = ctxFor(db, LOCAL_USER_ID);
  });

  it('logManual derives durationSeconds from endedAt', () => {
    const taskId = seedTask(db);
    const e = timeService.logManual(ctx, { taskId, startedAt: T0, endedAt: T60 }, T0);
    expect(e.source).toBe('manual');
    expect(e.durationSeconds).toBe(3600);
    expect(e.endedAt?.getTime()).toBe(T60.getTime());
  });

  it('logManual derives endedAt from durationSeconds', () => {
    const taskId = seedTask(db);
    const e = timeService.logManual(ctx, { taskId, startedAt: T0, durationSeconds: 1800 }, T0);
    expect(e.endedAt?.getTime()).toBe(T30.getTime());
    expect(e.durationSeconds).toBe(1800);
  });

  it('logManual throws NotFoundError for a missing task', () => {
    expect(() =>
      timeService.logManual(ctx, { taskId: 'missing', startedAt: T0, durationSeconds: 60 }, T0),
    ).toThrow(NotFoundError);
  });

  it('listEntries filters by taskId and by project', () => {
    const [proj] = db
      .insert(projects)
      .values({ userId: LOCAL_USER_ID, name: 'Work' })
      .returning()
      .all();
    const a = db
      .insert(tasks)
      .values({ userId: LOCAL_USER_ID, title: 'A', projectId: proj!.id })
      .returning()
      .all()[0]!;
    const b = seedTask(db, 'B'); // no project
    timeService.logManual(ctx, { taskId: a.id, startedAt: T0, durationSeconds: 600 }, T0);
    timeService.logManual(ctx, { taskId: b, startedAt: T0, durationSeconds: 600 }, T0);

    expect(timeService.listEntries(ctx, { taskId: a.id })).toHaveLength(1);
    expect(timeService.listEntries(ctx, { projectId: proj!.id })).toHaveLength(1);
    expect(timeService.listEntries(ctx)).toHaveLength(2);
  });

  it('listEntries filters by running state', () => {
    const taskId = seedTask(db);
    timeService.startTimer(ctx, taskId, T0); // running
    timeService.logManual(ctx, { taskId, startedAt: T0, durationSeconds: 60 }, T0); // closed
    expect(timeService.listEntries(ctx, { running: true })).toHaveLength(1);
    expect(timeService.listEntries(ctx, { running: false })).toHaveLength(1);
  });

  it('updateEntry recomputes duration when endedAt changes', () => {
    const taskId = seedTask(db);
    const e = timeService.logManual(ctx, { taskId, startedAt: T0, durationSeconds: 600 }, T0);
    const updated = timeService.updateEntry(ctx, e.id, { endedAt: T60 }, T60);
    expect(updated.durationSeconds).toBe(3600);
  });

  it('updateEntry clearing endedAt nulls durationSeconds (entry reopens as running)', () => {
    const taskId = seedTask(db);
    const e = timeService.logManual(ctx, { taskId, startedAt: T0, endedAt: T60 }, T0);
    expect(e.durationSeconds).toBe(3600);
    const updated = timeService.updateEntry(ctx, e.id, { endedAt: null }, T60);
    expect(updated.endedAt).toBeNull();
    expect(updated.durationSeconds).toBeNull();
    expect(timeService.getRunning(ctx)?.id).toBe(updated.id);
  });

  it('updateEntry refuses to reopen an entry while another timer is running', () => {
    const a = seedTask(db, 'A');
    const b = seedTask(db, 'B');
    const closed = timeService.logManual(ctx, { taskId: a, startedAt: T0, endedAt: T30 }, T0);
    timeService.startTimer(ctx, b, T60); // another running entry
    expect(() => timeService.updateEntry(ctx, closed.id, { endedAt: null }, T60)).toThrow(
      ConflictError,
    );
  });

  it('updateEntry can set a note without touching duration', () => {
    const taskId = seedTask(db);
    const e = timeService.logManual(ctx, { taskId, startedAt: T0, durationSeconds: 600 }, T0);
    const updated = timeService.updateEntry(ctx, e.id, { note: 'pairing' }, T60);
    expect(updated.note).toBe('pairing');
    expect(updated.durationSeconds).toBe(600);
  });

  it('updateEntry throws NotFoundError for a missing entry', () => {
    expect(() => timeService.updateEntry(ctx, 'nope', { note: 'x' }, T0)).toThrow(NotFoundError);
  });

  it('deleteEntry removes the row; second delete throws NotFoundError', () => {
    const taskId = seedTask(db);
    const e = timeService.logManual(ctx, { taskId, startedAt: T0, durationSeconds: 60 }, T0);
    timeService.deleteEntry(ctx, e.id);
    expect(timeService.listEntries(ctx)).toHaveLength(0);
    expect(() => timeService.deleteEntry(ctx, e.id)).toThrow(NotFoundError);
  });

  describe('cross-tenant isolation', () => {
    let a: Ctx;
    let b: Ctx;
    beforeEach(() => {
      userService.create(db, { id: 'user-b', name: 'B' });
      a = ctxFor(db, LOCAL_USER_ID);
      b = ctxFor(db, 'user-b');
    });

    it('A cannot log time against B task, nor see/stop/update/delete B entries', () => {
      const bTask = taskService.create(b, { title: 'B' });
      expect(() => timeService.startTimer(a, bTask.id)).toThrow(NotFoundError);
      expect(() =>
        timeService.logManual(a, { taskId: bTask.id, startedAt: new Date(), durationSeconds: 60 }),
      ).toThrow(NotFoundError);
      const bEntry = timeService.logManual(b, {
        taskId: bTask.id,
        startedAt: new Date(),
        durationSeconds: 60,
      });
      expect(timeService.listEntries(a).map((e) => e.id)).not.toContain(bEntry.id);
      expect(() => timeService.stopTimer(a, { entryId: bEntry.id })).toThrow(NotFoundError);
      expect(() => timeService.deleteEntry(a, bEntry.id)).toThrow(NotFoundError);
    });

    it('running-timer invariant is per user (A and B can each run one)', () => {
      const at = taskService.create(a, { title: 'A' });
      const bt = taskService.create(b, { title: 'B' });
      timeService.startTimer(a, at.id);
      timeService.startTimer(b, bt.id);
      expect(timeService.getRunning(a)?.taskId).toBe(at.id);
      expect(timeService.getRunning(b)?.taskId).toBe(bt.id);
    });
  });
});
