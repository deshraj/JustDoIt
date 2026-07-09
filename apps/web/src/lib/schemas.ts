import { z } from 'zod';

/**
 * Tolerant response schemas mirroring @justdoit/core's DB row shapes
 * (packages/core/src/db/schema.ts). apps/web never imports @justdoit/core —
 * these are hand-mirrored so REST responses can be validated at the
 * boundary. Parsing is tolerant: `parseTolerant` below warns and falls back
 * to the raw payload on a mismatch rather than throwing, so a REST shape
 * drift degrades gracefully instead of crashing the UI.
 */

export const TASK_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const TASK_PRIORITIES = ['p0', 'p1', 'p2', 'p3'] as const;
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

export const TIME_ENTRY_SOURCES = ['timer', 'manual'] as const;
export const timeEntrySourceSchema = z.enum(TIME_ENTRY_SOURCES);
export type TimeEntrySource = z.infer<typeof timeEntrySourceSchema>;

export const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: taskStatusSchema,
  priority: taskPrioritySchema.nullable(),
  projectId: z.string().nullable(),
  parentTaskId: z.string().nullable(),
  position: z.number(),
  dueAt: z.coerce.date().nullable(),
  startAt: z.coerce.date().nullable(),
  estimateMinutes: z.number().nullable(),
  recurrence: z.string().nullable(),
  completedAt: z.coerce.date().nullable(),
  archived: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Task = z.infer<typeof taskSchema>;

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  icon: z.string().nullable(),
  description: z.string().nullable(),
  position: z.number(),
  archived: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Project = z.infer<typeof projectSchema>;

export const tagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Tag = z.infer<typeof tagSchema>;

export const timeEntrySchema = z.object({
  id: z.string(),
  taskId: z.string(),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().nullable(),
  durationSeconds: z.number().nullable(),
  note: z.string().nullable(),
  source: timeEntrySourceSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type TimeEntry = z.infer<typeof timeEntrySchema>;

export const reminderSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  remindAt: z.coerce.date(),
  delivered: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Reminder = z.infer<typeof reminderSchema>;

export const timeReportBucketSchema = z.object({
  key: z.string(),
  label: z.string(),
  totalSeconds: z.number(),
  entryCount: z.number(),
});
export type TimeReportBucket = z.infer<typeof timeReportBucketSchema>;

export const estimateVsActualSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  estimateMinutes: z.number().nullable(),
  actualSeconds: z.number(),
  actualMinutes: z.number(),
  varianceMinutes: z.number().nullable(),
});
export type EstimateVsActual = z.infer<typeof estimateVsActualSchema>;

export const timeReportSchema = z.object({
  groupBy: z.enum(['day', 'project', 'tag']),
  from: z.coerce.date().nullable(),
  to: z.coerce.date().nullable(),
  totalSeconds: z.number(),
  buckets: z.array(timeReportBucketSchema),
  estimateVsActual: z.array(estimateVsActualSchema),
});
export type TimeReport = z.infer<typeof timeReportSchema>;

// The quick-add endpoint just returns the created Task.
export const quickAddResultSchema = taskSchema;
export type QuickAddResult = z.infer<typeof quickAddResultSchema>;

export const activityEntrySchema = z.object({
  id: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  action: z.string(),
  payload: z.record(z.unknown()).nullable(),
  createdAt: z.coerce.date(),
});
export type ActivityEntry = z.infer<typeof activityEntrySchema>;

export const savedFilterSchema = z.object({
  id: z.string(),
  name: z.string(),
  query: z.record(z.unknown()),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type SavedFilter = z.infer<typeof savedFilterSchema>;

export const attachmentSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  filename: z.string(),
  path: z.string(),
  mime: z.string().nullable(),
  size: z.number().nullable(),
  createdAt: z.coerce.date(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const apiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.coerce.date(),
  lastUsedAt: z.coerce.date().nullable(),
});
export type ApiKey = z.infer<typeof apiKeySchema>;

/**
 * Parse `data` against `schema`; on mismatch, warn (dev-only) and return the
 * raw data as-is instead of throwing. Keeps the UI resilient to REST shape
 * drift — see Notes for later phases in the Phase 5 plan.
 */
export function parseTolerant<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[api] response for "${label}" did not match the expected shape`, {
        issues: result.error.issues,
        data,
      });
    }
    return data as T;
  }
  return result.data;
}
