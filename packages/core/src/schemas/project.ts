import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z.string().min(1),
  color: z.string().nullish(),
  icon: z.string().nullish(),
  description: z.string().nullish(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial().extend({
  position: z.number().optional(),
  archived: z.boolean().optional(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
