import { and, desc, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm';
import { tasks, timeEntries, type TimeEntry } from '../db/schema';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import type {
  LogManualInput,
  TimeEntryFilter,
  UpdateEntryInput,
} from '../schemas/time-entry-schema';
import { emit } from '../events/emit';
import { userScope } from '../scope';
import type { Ctx } from '../context';

function requireOwnedTask(ctx: Ctx, taskId: string): void {
  const row = ctx.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), userScope(tasks, ctx.userId)))
    .get();
  if (!row) throw new NotFoundError('Task', taskId);
}

export const timeService = {
  /** The single running entry (endedAt IS NULL) for this user, or null. */
  getRunning(ctx: Ctx): TimeEntry | null {
    const entry = ctx.db
      .select()
      .from(timeEntries)
      .where(and(userScope(timeEntries, ctx.userId), isNull(timeEntries.endedAt)))
      .orderBy(desc(timeEntries.startedAt))
      .limit(1)
      .get();
    return entry ?? null;
  },

  /**
   * Start a timer for a task. Enforces the single-running-timer invariant (per
   * user) by auto-stopping any currently running entry (with the same `now`)
   * first — this policy never throws ConflictError for an already-running
   * timer, it silently closes the previous one before opening the new one.
   */
  startTimer(ctx: Ctx, taskId: string, now: Date = new Date()): TimeEntry {
    requireOwnedTask(ctx, taskId);
    const running = timeService.getRunning(ctx);
    if (running) {
      timeService.stopTimer(ctx, { entryId: running.id }, now);
    }
    const [entry] = ctx.db
      .insert(timeEntries)
      .values({
        userId: ctx.userId,
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
    emit(ctx.userId, 'time_entry', entry!.id, 'started', { taskId: entry!.taskId });
    return entry!;
  },

  /**
   * Stop a timer. Target resolution order: explicit entryId, else the running
   * entry for taskId, else the single running entry for this user.
   */
  stopTimer(
    ctx: Ctx,
    ref: { entryId?: string; taskId?: string } = {},
    now: Date = new Date(),
  ): TimeEntry {
    let entry: TimeEntry | undefined;
    if (ref.entryId) {
      entry = ctx.db
        .select()
        .from(timeEntries)
        .where(and(eq(timeEntries.id, ref.entryId), userScope(timeEntries, ctx.userId)))
        .get();
      if (!entry) throw new NotFoundError('Time entry', ref.entryId);
    } else if (ref.taskId) {
      entry = ctx.db
        .select()
        .from(timeEntries)
        .where(
          and(
            userScope(timeEntries, ctx.userId),
            eq(timeEntries.taskId, ref.taskId),
            isNull(timeEntries.endedAt),
          ),
        )
        .orderBy(desc(timeEntries.startedAt))
        .limit(1)
        .get();
      if (!entry) throw new NotFoundError('Running timer for task', ref.taskId);
    } else {
      entry = timeService.getRunning(ctx) ?? undefined;
      if (!entry) throw new NotFoundError('Running timer', '(none running)');
    }

    if (entry.endedAt) throw new ValidationError('Time entry is already stopped');
    if (now.getTime() < entry.startedAt.getTime()) {
      throw new ValidationError('Stop time must be at or after start time');
    }

    const durationSeconds = Math.round((now.getTime() - entry.startedAt.getTime()) / 1000);
    const [updated] = ctx.db
      .update(timeEntries)
      .set({ endedAt: now, durationSeconds, updatedAt: now })
      .where(and(eq(timeEntries.id, entry.id), userScope(timeEntries, ctx.userId)))
      .returning()
      .all();
    emit(ctx.userId, 'time_entry', updated!.id, 'stopped', {
      taskId: updated!.taskId,
      durationSeconds: updated!.durationSeconds,
    });
    return updated!;
  },

  /** Record a completed time entry with an explicit end or explicit duration. */
  logManual(ctx: Ctx, input: LogManualInput, now: Date = new Date()): TimeEntry {
    requireOwnedTask(ctx, input.taskId);

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

    const [entry] = ctx.db
      .insert(timeEntries)
      .values({
        userId: ctx.userId,
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
    emit(ctx.userId, 'time_entry', entry!.id, 'logged', {
      taskId: entry!.taskId,
      durationSeconds: entry!.durationSeconds,
    });
    return entry!;
  },

  /** List entries with optional filters; newest first. */
  listEntries(ctx: Ctx, filter: TimeEntryFilter = {}): TimeEntry[] {
    const conds = [userScope(timeEntries, ctx.userId)];
    if (filter.taskId) conds.push(eq(timeEntries.taskId, filter.taskId));
    if (filter.source) conds.push(eq(timeEntries.source, filter.source));
    if (filter.from) conds.push(gte(timeEntries.startedAt, filter.from));
    if (filter.to) conds.push(lte(timeEntries.startedAt, filter.to));
    if (filter.running === true) conds.push(isNull(timeEntries.endedAt));
    if (filter.running === false) conds.push(isNotNull(timeEntries.endedAt));
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;

    if (filter.projectId) {
      return ctx.db
        .select({ entry: timeEntries })
        .from(timeEntries)
        .innerJoin(tasks, eq(timeEntries.taskId, tasks.id))
        .where(and(...conds, eq(tasks.projectId, filter.projectId)))
        .orderBy(desc(timeEntries.startedAt))
        .limit(limit)
        .offset(offset)
        .all()
        .map((r) => r.entry);
    }

    return ctx.db
      .select()
      .from(timeEntries)
      .where(and(...conds))
      .orderBy(desc(timeEntries.startedAt))
      .limit(limit)
      .offset(offset)
      .all();
  },

  /** Patch a time entry, recomputing duration when timestamps change. */
  updateEntry(ctx: Ctx, id: string, patch: UpdateEntryInput, now: Date = new Date()): TimeEntry {
    const existing = ctx.db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.id, id), userScope(timeEntries, ctx.userId)))
      .get();
    if (!existing) throw new NotFoundError('Time entry', id);

    const startedAt = patch.startedAt ?? existing.startedAt;
    let endedAt = patch.endedAt !== undefined ? patch.endedAt : existing.endedAt;
    let durationSeconds =
      patch.durationSeconds !== undefined ? patch.durationSeconds : existing.durationSeconds;

    if (patch.endedAt === null) {
      // Clearing the end time reopens the entry — it becomes "running" again, so any
      // previously computed duration is now stale and must be cleared too.
      durationSeconds = null;
      // Preserve the single-running-entry invariant: reopening this entry must not
      // create a second concurrent `endedAt IS NULL` row for a different entry.
      if (existing.endedAt !== null) {
        const otherRunning = timeService.getRunning(ctx);
        if (otherRunning && otherRunning.id !== id) {
          throw new ConflictError('Another time entry is already running');
        }
      }
    } else if (endedAt) {
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

    const [updated] = ctx.db
      .update(timeEntries)
      .set({
        startedAt,
        endedAt,
        durationSeconds,
        note: patch.note !== undefined ? patch.note : existing.note,
        source: patch.source ?? existing.source,
        updatedAt: now,
      })
      .where(and(eq(timeEntries.id, id), userScope(timeEntries, ctx.userId)))
      .returning()
      .all();
    return updated!;
  },

  /** Hard-delete a time entry. */
  deleteEntry(ctx: Ctx, id: string): void {
    const res = ctx.db
      .delete(timeEntries)
      .where(and(eq(timeEntries.id, id), userScope(timeEntries, ctx.userId)))
      .run();
    if (res.changes === 0) throw new NotFoundError('Time entry', id);
  },
};
