import { and, desc, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm';
import type { Db } from '../db';
import { tasks, timeEntries, type TimeEntry } from '../db/schema';
import { NotFoundError, ValidationError } from '../errors';
import type {
  LogManualInput,
  TimeEntryFilter,
  UpdateEntryInput,
} from '../schemas/time-entry-schema';

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

  /** Record a completed time entry with an explicit end or explicit duration. */
  logManual(db: Db, input: LogManualInput, now: Date = new Date()): TimeEntry {
    requireTask(db, input.taskId);

    let endedAt: Date;
    let durationSeconds: number;
    if (input.endedAt !== undefined) {
      endedAt = input.endedAt;
      durationSeconds = Math.round((endedAt.getTime() - input.startedAt.getTime()) / 1000);
    } else if (input.durationSeconds !== undefined) {
      durationSeconds = input.durationSeconds;
      endedAt = new Date(input.startedAt.getTime() + durationSeconds * 1000);
    } else {
      throw new ValidationError('Provide either endedAt or durationSeconds');
    }
    if (durationSeconds < 0) throw new ValidationError('Duration must be non-negative');

    const [entry] = db
      .insert(timeEntries)
      .values({
        taskId: input.taskId,
        startedAt: input.startedAt,
        endedAt,
        durationSeconds,
        note: input.note ?? null,
        source: 'manual',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .all();
    return entry!;
  },

  /** List entries with optional filters; newest first. */
  listEntries(db: Db, filter: TimeEntryFilter = {}): TimeEntry[] {
    const conds = [];
    if (filter.taskId) conds.push(eq(timeEntries.taskId, filter.taskId));
    if (filter.source) conds.push(eq(timeEntries.source, filter.source));
    if (filter.from) conds.push(gte(timeEntries.startedAt, filter.from));
    if (filter.to) conds.push(lte(timeEntries.startedAt, filter.to));
    if (filter.running === true) conds.push(isNull(timeEntries.endedAt));
    if (filter.running === false) conds.push(isNotNull(timeEntries.endedAt));
    const base = conds.length ? and(...conds) : undefined;
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;

    if (filter.projectId) {
      const where = base
        ? and(base, eq(tasks.projectId, filter.projectId))
        : eq(tasks.projectId, filter.projectId);
      return db
        .select({ entry: timeEntries })
        .from(timeEntries)
        .innerJoin(tasks, eq(timeEntries.taskId, tasks.id))
        .where(where)
        .orderBy(desc(timeEntries.startedAt))
        .limit(limit)
        .offset(offset)
        .all()
        .map((r) => r.entry);
    }

    return db
      .select()
      .from(timeEntries)
      .where(base)
      .orderBy(desc(timeEntries.startedAt))
      .limit(limit)
      .offset(offset)
      .all();
  },

  /** Patch a time entry, recomputing duration when timestamps change. */
  updateEntry(db: Db, id: string, patch: UpdateEntryInput, now: Date = new Date()): TimeEntry {
    const existing = db.select().from(timeEntries).where(eq(timeEntries.id, id)).get();
    if (!existing) throw new NotFoundError('Time entry', id);

    const startedAt = patch.startedAt ?? existing.startedAt;
    let endedAt = patch.endedAt !== undefined ? patch.endedAt : existing.endedAt;
    let durationSeconds =
      patch.durationSeconds !== undefined ? patch.durationSeconds : existing.durationSeconds;

    if (endedAt) {
      // A concrete end time is authoritative: derive duration from timestamps.
      durationSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
    } else if (patch.durationSeconds != null) {
      // Open entry with an explicit duration → derive the end time.
      endedAt = new Date(startedAt.getTime() + patch.durationSeconds * 1000);
      durationSeconds = patch.durationSeconds;
    }

    if (endedAt && endedAt.getTime() < startedAt.getTime()) {
      throw new ValidationError('endedAt must be at or after startedAt');
    }

    const [updated] = db
      .update(timeEntries)
      .set({
        startedAt,
        endedAt,
        durationSeconds,
        note: patch.note !== undefined ? patch.note : existing.note,
        source: patch.source ?? existing.source,
        updatedAt: now,
      })
      .where(eq(timeEntries.id, id))
      .returning()
      .all();
    return updated!;
  },

  /** Hard-delete a time entry. */
  deleteEntry(db: Db, id: string): void {
    const res = db.delete(timeEntries).where(eq(timeEntries.id, id)).run();
    if (res.changes === 0) throw new NotFoundError('Time entry', id);
  },
};
