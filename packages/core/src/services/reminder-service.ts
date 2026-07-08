import { and, asc, eq, lte } from 'drizzle-orm';
import type { Db } from '../db';
import { reminders, tasks, type Reminder } from '../db/schema';
import { NotFoundError } from '../errors';
import type { CreateReminderInput, UpdateReminderInput } from '../schemas/reminder';

function requireTask(db: Db, taskId: string): void {
  const row = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).get();
  if (!row) throw new NotFoundError('Task', taskId);
}

export const reminderService = {
  create(db: Db, input: CreateReminderInput): Reminder {
    requireTask(db, input.taskId);
    const [row] = db
      .insert(reminders)
      .values({ taskId: input.taskId, remindAt: input.remindAt })
      .returning()
      .all();
    return row!;
  },

  get(db: Db, id: string): Reminder {
    const row = db.select().from(reminders).where(eq(reminders.id, id)).get();
    if (!row) throw new NotFoundError('Reminder', id);
    return row;
  },

  list(db: Db, filter: { taskId?: string; delivered?: boolean } = {}): Reminder[] {
    const conditions = [];
    if (filter.taskId !== undefined) conditions.push(eq(reminders.taskId, filter.taskId));
    if (filter.delivered !== undefined) conditions.push(eq(reminders.delivered, filter.delivered));
    return db
      .select()
      .from(reminders)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(reminders.remindAt))
      .all();
  },

  update(db: Db, id: string, input: UpdateReminderInput): Reminder {
    reminderService.get(db, id); // throws NotFoundError if missing
    const [row] = db
      .update(reminders)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(reminders.id, id))
      .returning()
      .all();
    return row!;
  },

  remove(db: Db, id: string): void {
    const deleted = db.delete(reminders).where(eq(reminders.id, id)).returning().all();
    if (deleted.length === 0) throw new NotFoundError('Reminder', id);
  },

  dueReminders(db: Db, now: Date): Reminder[] {
    return db
      .select()
      .from(reminders)
      .where(and(eq(reminders.delivered, false), lte(reminders.remindAt, now)))
      .orderBy(asc(reminders.remindAt))
      .all();
  },

  markDelivered(db: Db, id: string): Reminder {
    reminderService.get(db, id);
    const [row] = db
      .update(reminders)
      .set({ delivered: true, updatedAt: new Date() })
      .where(eq(reminders.id, id))
      .returning()
      .all();
    return row!;
  },
};
