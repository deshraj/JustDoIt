import { z } from 'zod';

export const createReminderBody = z.object({
  taskId: z.string().uuid(),
  remindAt: z.coerce.date(),
});
export type CreateReminderInput = z.infer<typeof createReminderBody>;

export const updateReminderBody = z
  .object({
    remindAt: z.coerce.date().optional(),
    delivered: z.boolean().optional(),
  })
  .refine((v) => v.remindAt !== undefined || v.delivered !== undefined, {
    message: 'At least one field is required',
  });
export type UpdateReminderInput = z.infer<typeof updateReminderBody>;
