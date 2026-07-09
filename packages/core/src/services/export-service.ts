import { eq, inArray } from 'drizzle-orm';
import {
  projects,
  tasks,
  tags,
  taskTags,
  timeEntries,
  reminders,
  activityLog,
  attachments,
  savedFilters,
  type Project,
  type Task,
  type Tag,
  type TimeEntry,
} from '../db/schema';
import { ValidationError } from '../errors';
import { userScope } from '../scope';
import type { Ctx } from '../context';

export interface Snapshot {
  version: 1;
  exportedAt: string;
  projects: Project[];
  tasks: Task[];
  tags: Tag[];
  taskTags: { taskId: string; tagId: string }[];
  timeEntries: TimeEntry[];
  reminders: (typeof reminders.$inferSelect)[];
  activityLog: (typeof activityLog.$inferSelect)[];
  attachments: (typeof attachments.$inferSelect)[];
  savedFilters: (typeof savedFilters.$inferSelect)[];
}

export interface ImportResult {
  counts: Record<
    | 'projects'
    | 'tasks'
    | 'tags'
    | 'taskTags'
    | 'timeEntries'
    | 'reminders'
    | 'activityLog'
    | 'attachments'
    | 'savedFilters',
    number
  >;
}

const REQUIRED_ARRAYS = [
  'projects',
  'tasks',
  'tags',
  'taskTags',
  'timeEntries',
  'reminders',
  'activityLog',
  'attachments',
  'savedFilters',
] as const;

export const exportService = {
  /** Export only `ctx.userId`'s rows. */
  exportSnapshot(ctx: Ctx): Snapshot {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      projects: ctx.db.select().from(projects).where(userScope(projects, ctx.userId)).all(),
      tasks: ctx.db.select().from(tasks).where(userScope(tasks, ctx.userId)).all(),
      tags: ctx.db.select().from(tags).where(userScope(tags, ctx.userId)).all(),
      // taskTags has no user_id — scope via an inner join on the user's own tasks.
      taskTags: ctx.db
        .select({ taskId: taskTags.taskId, tagId: taskTags.tagId })
        .from(taskTags)
        .innerJoin(tasks, eq(taskTags.taskId, tasks.id))
        .where(userScope(tasks, ctx.userId))
        .all(),
      timeEntries: ctx.db.select().from(timeEntries).where(userScope(timeEntries, ctx.userId)).all(),
      reminders: ctx.db.select().from(reminders).where(userScope(reminders, ctx.userId)).all(),
      activityLog: ctx.db.select().from(activityLog).where(userScope(activityLog, ctx.userId)).all(),
      attachments: ctx.db.select().from(attachments).where(userScope(attachments, ctx.userId)).all(),
      savedFilters: ctx.db
        .select()
        .from(savedFilters)
        .where(userScope(savedFilters, ctx.userId))
        .all(),
    };
  },

  /**
   * Replace only `ctx.userId`'s rows. Every inserted row is re-stamped with
   * `ctx.userId` (any `userId` present in the snapshot — e.g. a hand-forged
   * import — is ignored), so importing as A can never write into B's data.
   */
  importSnapshot(ctx: Ctx, snapshot: Snapshot): ImportResult {
    if (!snapshot || typeof snapshot !== 'object') {
      throw new ValidationError('Snapshot must be an object');
    }
    if (snapshot.version !== 1) {
      throw new ValidationError(`Unsupported snapshot version: ${String(snapshot.version)}`);
    }
    for (const key of REQUIRED_ARRAYS) {
      if (!Array.isArray((snapshot as unknown as Record<string, unknown>)[key])) {
        throw new ValidationError(`Snapshot is missing array: ${key}`);
      }
    }

    // Coerce timestamp fields (which arrive as ISO strings or ms after JSON) back to Date
    // for Drizzle's timestamp_ms columns, and re-stamp userId to the acting user.
    const toDate = <T extends Record<string, unknown>>(row: T, keys: string[]): T => {
      const copy: Record<string, unknown> = { ...row, userId: ctx.userId };
      for (const k of keys) {
        const v = copy[k];
        if (v !== null && v !== undefined && !(v instanceof Date)) {
          copy[k] = new Date(v as string | number);
        }
      }
      return copy as T;
    };

    const ownedTaskIds = ctx.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(userScope(tasks, ctx.userId))
      .all()
      .map((r) => r.id);

    ctx.db.transaction((tx) => {
      // Delete children first (FK-safe), scoped to the acting user only.
      if (ownedTaskIds.length) {
        tx.delete(taskTags).where(inArray(taskTags.taskId, ownedTaskIds)).run();
      }
      tx.delete(timeEntries).where(userScope(timeEntries, ctx.userId)).run();
      tx.delete(reminders).where(userScope(reminders, ctx.userId)).run();
      tx.delete(attachments).where(userScope(attachments, ctx.userId)).run();
      tx.delete(activityLog).where(userScope(activityLog, ctx.userId)).run();
      tx.delete(savedFilters).where(userScope(savedFilters, ctx.userId)).run();
      tx.delete(tasks).where(userScope(tasks, ctx.userId)).run();
      tx.delete(projects).where(userScope(projects, ctx.userId)).run();
      tx.delete(tags).where(userScope(tags, ctx.userId)).run();

      if (snapshot.projects.length) {
        tx.insert(projects)
          .values(snapshot.projects.map((r) => toDate(r, ['createdAt', 'updatedAt'])))
          .run();
      }
      if (snapshot.tags.length) {
        tx.insert(tags)
          .values(snapshot.tags.map((r) => toDate(r, ['createdAt', 'updatedAt'])))
          .run();
      }
      // Insert top-level tasks before subtasks to satisfy the self-referential FK.
      const taskRows = snapshot.tasks.map((r) =>
        toDate(r, ['dueAt', 'startAt', 'completedAt', 'createdAt', 'updatedAt']),
      );
      const topLevel = taskRows.filter((r) => !r.parentTaskId);
      const children = taskRows.filter((r) => r.parentTaskId);
      if (topLevel.length) tx.insert(tasks).values(topLevel).run();
      if (children.length) tx.insert(tasks).values(children).run();

      if (snapshot.taskTags.length) tx.insert(taskTags).values(snapshot.taskTags).run();
      if (snapshot.timeEntries.length) {
        tx.insert(timeEntries)
          .values(
            snapshot.timeEntries.map((r) =>
              toDate(r, ['startedAt', 'endedAt', 'createdAt', 'updatedAt']),
            ),
          )
          .run();
      }
      if (snapshot.reminders.length) {
        tx.insert(reminders)
          .values(snapshot.reminders.map((r) => toDate(r, ['remindAt', 'createdAt', 'updatedAt'])))
          .run();
      }
      if (snapshot.attachments.length) {
        tx.insert(attachments)
          .values(snapshot.attachments.map((r) => toDate(r, ['createdAt'])))
          .run();
      }
      if (snapshot.activityLog.length) {
        tx.insert(activityLog)
          .values(snapshot.activityLog.map((r) => toDate(r, ['createdAt'])))
          .run();
      }
      if (snapshot.savedFilters.length) {
        tx.insert(savedFilters)
          .values(snapshot.savedFilters.map((r) => toDate(r, ['createdAt', 'updatedAt'])))
          .run();
      }
    });

    return {
      counts: {
        projects: snapshot.projects.length,
        tasks: snapshot.tasks.length,
        tags: snapshot.tags.length,
        taskTags: snapshot.taskTags.length,
        timeEntries: snapshot.timeEntries.length,
        reminders: snapshot.reminders.length,
        activityLog: snapshot.activityLog.length,
        attachments: snapshot.attachments.length,
        savedFilters: snapshot.savedFilters.length,
      },
    };
  },
};
