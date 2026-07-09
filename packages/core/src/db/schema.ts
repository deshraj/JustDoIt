import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  index,
  unique,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { LOCAL_USER_ID } from '../constants';

export const TASK_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['p0', 'p1', 'p2', 'p3'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TIME_ENTRY_SOURCES = ['timer', 'manual'] as const;
export type TimeEntrySource = (typeof TIME_ENTRY_SOURCES)[number];

const pk = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date());
const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date());

export const users = sqliteTable('users', {
  id: pk(),
  githubId: text('github_id').unique(),
  email: text('email'),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: pk(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (t) => [index('api_keys_user_idx').on(t.userId)],
);

/**
 * Owner column for user-owned tables. The trailing `.$defaultFn` is TRANSITIONAL
 * scaffolding: it keeps every pre-tenancy `(db, …)` insert compiling while
 * services are converted to `(ctx, …)` one cluster at a time. Task 16 removes it
 * so the type system forces explicit `userId: ctx.userId` stamping. The declared
 * FK documents intent; the 0001 migration adds the physical column without the
 * DB-level FK (SQLite ALTER limitation — see plan Global Constraints).
 */
const ownerId = () =>
  text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .$defaultFn(() => LOCAL_USER_ID);

export const projects = sqliteTable(
  'projects',
  {
    id: pk(),
    userId: ownerId(),
    name: text('name').notNull(),
    color: text('color'),
    icon: text('icon'),
    description: text('description'),
    position: real('position').notNull().default(0),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('projects_user_idx').on(t.userId)],
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: pk(),
    userId: ownerId(),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status', { enum: TASK_STATUSES }).notNull().default('todo'),
    priority: text('priority', { enum: TASK_PRIORITIES }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    parentTaskId: text('parent_task_id').references((): AnySQLiteColumn => tasks.id, {
      onDelete: 'cascade',
    }),
    position: real('position').notNull().default(0),
    dueAt: integer('due_at', { mode: 'timestamp_ms' }),
    startAt: integer('start_at', { mode: 'timestamp_ms' }),
    estimateMinutes: integer('estimate_minutes'),
    recurrence: text('recurrence'),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('tasks_project_idx').on(t.projectId),
    index('tasks_status_idx').on(t.status),
    index('tasks_parent_idx').on(t.parentTaskId),
    index('tasks_user_idx').on(t.userId),
  ],
);

export const tags = sqliteTable(
  'tags',
  {
    id: pk(),
    userId: ownerId(),
    name: text('name').notNull(), // NOTE: `.unique()` removed — now composite below
    color: text('color'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('tags_user_id_name_unique').on(t.userId, t.name),
    index('tags_user_idx').on(t.userId),
  ],
);

export const taskTags = sqliteTable(
  'task_tags',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.tagId] })],
);

export const timeEntries = sqliteTable(
  'time_entries',
  {
    id: pk(),
    userId: ownerId(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
    durationSeconds: integer('duration_seconds'),
    note: text('note'),
    source: text('source', { enum: TIME_ENTRY_SOURCES }).notNull().default('timer'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('time_entries_task_idx').on(t.taskId), index('time_entries_user_idx').on(t.userId)],
);

export const reminders = sqliteTable(
  'reminders',
  {
    id: pk(),
    userId: ownerId(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    remindAt: integer('remind_at', { mode: 'timestamp_ms' }).notNull(),
    delivered: integer('delivered', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('reminders_remind_at_idx').on(t.remindAt),
    index('reminders_user_idx').on(t.userId),
  ],
);

export const activityLog = sqliteTable(
  'activity_log',
  {
    id: pk(),
    userId: ownerId(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action').notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index('activity_entity_idx').on(t.entityType, t.entityId),
    index('activity_log_user_idx').on(t.userId),
  ],
);

export const attachments = sqliteTable(
  'attachments',
  {
    id: pk(),
    userId: ownerId(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    path: text('path').notNull(),
    mime: text('mime'),
    size: integer('size'),
    createdAt: createdAt(),
  },
  (t) => [index('attachments_task_idx').on(t.taskId), index('attachments_user_idx').on(t.userId)],
);

export const savedFilters = sqliteTable(
  'saved_filters',
  {
    id: pk(),
    userId: ownerId(),
    name: text('name').notNull(),
    query: text('query', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('saved_filters_user_idx').on(t.userId)],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type NewTimeEntry = typeof timeEntries.$inferInsert;
export type Reminder = typeof reminders.$inferSelect;
export type NewReminder = typeof reminders.$inferInsert;
export type ActivityLogEntry = typeof activityLog.$inferSelect;
export type NewActivityLogEntry = typeof activityLog.$inferInsert;
export type AttachmentRow = typeof attachments.$inferSelect;
export type NewAttachmentRow = typeof attachments.$inferInsert;
export type SavedFilterRow = typeof savedFilters.$inferSelect;
export type NewSavedFilterRow = typeof savedFilters.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
