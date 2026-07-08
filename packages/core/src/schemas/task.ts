import { z } from 'zod';
import { TASK_STATUSES, TASK_PRIORITIES } from '../db/schema';

export const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullish(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).nullish(),
  projectId: z.string().nullish(),
  parentTaskId: z.string().nullish(),
  dueAt: z.coerce.date().nullish(),
  startAt: z.coerce.date().nullish(),
  estimateMinutes: z.number().int().positive().nullish(),
  recurrence: z.string().nullish(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

// Status is changed via setStatus; parentTaskId via addSubtask. Both are excluded here.
export const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullish(),
  priority: z.enum(TASK_PRIORITIES).nullish(),
  projectId: z.string().nullish(),
  dueAt: z.coerce.date().nullish(),
  startAt: z.coerce.date().nullish(),
  estimateMinutes: z.number().int().positive().nullish(),
  recurrence: z.string().nullish(),
  position: z.number().optional(),
  archived: z.boolean().optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const setStatusSchema = z.object({ status: z.enum(TASK_STATUSES) });
export type SetStatusInput = z.infer<typeof setStatusSchema>;
