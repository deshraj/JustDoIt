import type { Db } from '../db';
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
  exportSnapshot(db: Db): Snapshot {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      projects: db.select().from(projects).all(),
      tasks: db.select().from(tasks).all(),
      tags: db.select().from(tags).all(),
      taskTags: db.select().from(taskTags).all(),
      timeEntries: db.select().from(timeEntries).all(),
      reminders: db.select().from(reminders).all(),
      activityLog: db.select().from(activityLog).all(),
      attachments: db.select().from(attachments).all(),
      savedFilters: db.select().from(savedFilters).all(),
    };
  },

  importSnapshot(db: Db, snapshot: Snapshot): ImportResult {
    if (!snapshot || typeof snapshot !== 'object') {
      throw new ValidationError('Snapshot must be an object');
    }
    for (const key of REQUIRED_ARRAYS) {
      if (!Array.isArray((snapshot as unknown as Record<string, unknown>)[key])) {
        throw new ValidationError(`Snapshot is missing array: ${key}`);
      }
    }

    // Coerce timestamp fields (which arrive as ISO strings or ms after JSON) back to Date
    // for Drizzle's timestamp_ms columns.
    const toDate = <T extends Record<string, unknown>>(row: T, keys: string[]): T => {
      const copy: Record<string, unknown> = { ...row };
      for (const k of keys) {
        const v = copy[k];
        if (v !== null && v !== undefined && !(v instanceof Date)) {
          copy[k] = new Date(v as string | number);
        }
      }
      return copy as T;
    };

    db.transaction((tx) => {
      // Delete children first (FK-safe).
      tx.delete(taskTags).run();
      tx.delete(timeEntries).run();
      tx.delete(reminders).run();
      tx.delete(attachments).run();
      tx.delete(activityLog).run();
      tx.delete(savedFilters).run();
      tx.delete(tasks).run();
      tx.delete(projects).run();
      tx.delete(tags).run();

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
