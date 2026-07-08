import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  index,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

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

export const projects = sqliteTable('projects', {
  id: pk(),
  name: text('name').notNull(),
  color: text('color'),
  icon: text('icon'),
  description: text('description'),
  position: real('position').notNull().default(0),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const tasks = sqliteTable(
  'tasks',
  {
    id: pk(),
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
  ],
);

export const tags = sqliteTable('tags', {
  id: pk(),
  name: text('name').notNull().unique(),
  color: text('color'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

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
  (t) => [index('time_entries_task_idx').on(t.taskId)],
);

export const reminders = sqliteTable(
  'reminders',
  {
    id: pk(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    remindAt: integer('remind_at', { mode: 'timestamp_ms' }).notNull(),
    delivered: integer('delivered', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('reminders_remind_at_idx').on(t.remindAt)],
);

export const activityLog = sqliteTable(
  'activity_log',
  {
    id: pk(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action').notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('activity_entity_idx').on(t.entityType, t.entityId)],
);

export const attachments = sqliteTable(
  'attachments',
  {
    id: pk(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    path: text('path').notNull(),
    mime: text('mime'),
    size: integer('size'),
    createdAt: createdAt(),
  },
  (t) => [index('attachments_task_idx').on(t.taskId)],
);

export const savedFilters = sqliteTable('saved_filters', {
  id: pk(),
  name: text('name').notNull(),
  query: text('query', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

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
