import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db';
import { tasks, timeEntries, type TimeEntry } from '../db/schema';
import { NotFoundError, ValidationError } from '../errors';

function requireTask(db: Db, taskId: string): void {
  const row = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).get();
  if (!row) throw new NotFoundError('Task', taskId);
}

export const timeService = {
  /** The single system-wide running entry (endedAt IS NULL), or null. */
  getRunning(db: Db): TimeEntry | null {
    const entry = db
      .select()
      .from(timeEntries)
      .where(isNull(timeEntries.endedAt))
      .orderBy(desc(timeEntries.startedAt))
      .limit(1)
      .get();
    return entry ?? null;
  },

  /**
   * Start a timer for a task. Enforces the single-running-timer invariant by
   * auto-stopping any currently running entry (with the same `now`) first —
   * this policy never throws ConflictError for an already-running timer, it
   * silently closes the previous one before opening the new one.
   */
  startTimer(db: Db, taskId: string, now: Date = new Date()): TimeEntry {
    requireTask(db, taskId);
    const running = timeService.getRunning(db);
    if (running) {
      timeService.stopTimer(db, { entryId: running.id }, now);
    }
    const [entry] = db
      .insert(timeEntries)
      .values({
        taskId,
        startedAt: now,
        endedAt: null,
        durationSeconds: null,
        source: 'timer',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .all();
    return entry!;
  },

  /**
   * Stop a timer. Target resolution order: explicit entryId, else the running
   * entry for taskId, else the single system-wide running entry.
   */
  stopTimer(
    db: Db,
    ref: { entryId?: string; taskId?: string } = {},
    now: Date = new Date(),
  ): TimeEntry {
    let entry: TimeEntry | undefined;
    if (ref.entryId) {
      entry = db.select().from(timeEntries).where(eq(timeEntries.id, ref.entryId)).get();
      if (!entry) throw new NotFoundError('Time entry', ref.entryId);
    } else if (ref.taskId) {
      entry = db
        .select()
        .from(timeEntries)
        .where(and(eq(timeEntries.taskId, ref.taskId), isNull(timeEntries.endedAt)))
        .orderBy(desc(timeEntries.startedAt))
        .limit(1)
        .get();
      if (!entry) throw new NotFoundError('Running timer for task', ref.taskId);
    } else {
      entry = timeService.getRunning(db) ?? undefined;
      if (!entry) throw new NotFoundError('Running timer', '(none running)');
    }

    if (entry.endedAt) throw new ValidationError('Time entry is already stopped');
    if (now.getTime() < entry.startedAt.getTime()) {
      throw new ValidationError('Stop time must be at or after start time');
    }

    const durationSeconds = Math.round((now.getTime() - entry.startedAt.getTime()) / 1000);
    const [updated] = db
      .update(timeEntries)
      .set({ endedAt: now, durationSeconds, updatedAt: now })
      .where(eq(timeEntries.id, entry.id))
      .returning()
      .all();
    return updated!;
  },
};
