import { and, asc, eq, lte } from 'drizzle-orm';
import type { Db } from '../db';
import { reminders, tasks, type Reminder } from '../db/schema';
import { NotFoundError } from '../errors';
import type { CreateReminderInput, UpdateReminderInput } from '../schemas/reminder';
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

export const reminderService = {
  create(ctx: Ctx, input: CreateReminderInput): Reminder {
    requireOwnedTask(ctx, input.taskId);
    const [row] = ctx.db
      .insert(reminders)
      .values({ userId: ctx.userId, taskId: input.taskId, remindAt: input.remindAt })
      .returning()
      .all();
    return row!;
  },

  get(ctx: Ctx, id: string): Reminder {
    const row = ctx.db
      .select()
      .from(reminders)
      .where(and(eq(reminders.id, id), userScope(reminders, ctx.userId)))
      .get();
    if (!row) throw new NotFoundError('Reminder', id);
    return row;
  },

  list(ctx: Ctx, filter: { taskId?: string; delivered?: boolean } = {}): Reminder[] {
    const conditions = [userScope(reminders, ctx.userId)];
    if (filter.taskId !== undefined) conditions.push(eq(reminders.taskId, filter.taskId));
    if (filter.delivered !== undefined) conditions.push(eq(reminders.delivered, filter.delivered));
    return ctx.db
      .select()
      .from(reminders)
      .where(and(...conditions))
      .orderBy(asc(reminders.remindAt))
      .all();
  },

  update(ctx: Ctx, id: string, input: UpdateReminderInput): Reminder {
    reminderService.get(ctx, id); // throws NotFoundError if missing
    const [row] = ctx.db
      .update(reminders)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(reminders.id, id), userScope(reminders, ctx.userId)))
      .returning()
      .all();
    return row!;
  },

  remove(ctx: Ctx, id: string): void {
    const deleted = ctx.db
      .delete(reminders)
      .where(and(eq(reminders.id, id), userScope(reminders, ctx.userId)))
      .returning()
      .all();
    if (deleted.length === 0) throw new NotFoundError('Reminder', id);
  },

  /**
   * System-wide: the in-process scheduler polls due reminders across every
   * user, so this stays on a bare `db` (not `Ctx`) by design — see plan
   * Global Constraints / Task 15. Each returned reminder still carries its
   * own `userId` for per-reminder ctx construction (e.g. `markDelivered`).
   */
  dueReminders(db: Db, now: Date): Reminder[] {
    return db
      .select()
      .from(reminders)
      .where(and(eq(reminders.delivered, false), lte(reminders.remindAt, now)))
      .orderBy(asc(reminders.remindAt))
      .all();
  },

  markDelivered(ctx: Ctx, id: string): Reminder {
    reminderService.get(ctx, id);
    const [row] = ctx.db
      .update(reminders)
      .set({ delivered: true, updatedAt: new Date() })
      .where(and(eq(reminders.id, id), userScope(reminders, ctx.userId)))
      .returning()
      .all();
    return row!;
  },
};
