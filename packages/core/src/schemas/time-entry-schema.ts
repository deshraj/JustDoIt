import { z } from 'zod';
import { TIME_ENTRY_SOURCES, type TimeEntrySource } from '../db/schema';

/** Body schema for POST /time-entries (manual log). */
export const logManualSchema = z
  .object({
    taskId: z.string().uuid(),
    startedAt: z.coerce.date(),
    endedAt: z.coerce.date().optional(),
    durationSeconds: z.number().int().nonnegative().optional(),
    note: z.string().max(2000).optional(),
  })
  .refine((v) => v.endedAt !== undefined || v.durationSeconds !== undefined, {
    message: 'Provide either endedAt or durationSeconds',
    path: ['endedAt'],
  })
  .refine((v) => !(v.endedAt !== undefined && v.durationSeconds !== undefined), {
    message: 'Provide only one of endedAt or durationSeconds',
    path: ['durationSeconds'],
  })
  .refine((v) => v.endedAt === undefined || v.endedAt.getTime() >= v.startedAt.getTime(), {
    message: 'endedAt must be at or after startedAt',
    path: ['endedAt'],
  });
export type LogManualInput = z.infer<typeof logManualSchema>;

/** Body schema for PATCH /time-entries/:id. Every field optional; null clears. */
export const updateEntrySchema = z
  .object({
    startedAt: z.coerce.date().optional(),
    endedAt: z.coerce.date().nullable().optional(),
    durationSeconds: z.number().int().nonnegative().nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
    source: z.enum(TIME_ENTRY_SOURCES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;

/**
 * Filter shape consumed by timeService.listEntries. Declared explicitly (rather than
 * via z.infer) because zod's `.transform()` output type carries every key as required
 * with a `| undefined` value, not as an optional key — that shape does not satisfy a
 * `= {}` default parameter or partial-filter call sites. Annotating the `.transform`
 * callback's return type below pins the schema's inferred output back to this interface.
 */
export interface TimeEntryFilter {
  taskId?: string;
  projectId?: string;
  from?: Date;
  to?: Date;
  source?: TimeEntrySource;
  running?: boolean;
  limit?: number;
  offset?: number;
}

/** Query schema for GET /time-entries — snake_case params → camelCase filter. */
export const timeEntryFilterSchema = z
  .object({
    task_id: z.string().uuid().optional(),
    project_id: z.string().uuid().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    source: z.enum(TIME_ENTRY_SOURCES).optional(),
    running: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
    offset: z.coerce.number().int().nonnegative().optional(),
  })
  .transform(
    (v): TimeEntryFilter => ({
      taskId: v.task_id,
      projectId: v.project_id,
      from: v.from,
      to: v.to,
      source: v.source,
      running: v.running === undefined ? undefined : v.running === 'true',
      limit: v.limit,
      offset: v.offset,
    }),
  );
