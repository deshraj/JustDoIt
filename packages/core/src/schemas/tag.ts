import { z } from 'zod';

export const createTagSchema = z.object({
  name: z.string().min(1),
  color: z.string().nullish(),
});
export type CreateTagInput = z.infer<typeof createTagSchema>;

export const updateTagSchema = createTagSchema.partial();
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
