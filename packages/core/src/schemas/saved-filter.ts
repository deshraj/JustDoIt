import { z } from 'zod';

/**
 * The saved "query" is an opaque, forward-compatible bag of filter/sort/group
 * state (mirrors apps/web's TaskFilters + List view state) — `.passthrough()`
 * so the web app can evolve its filter shape without a core schema change.
 */
export const savedFilterQuerySchema = z
  .object({
    statuses: z.array(z.string()).optional(),
    priorities: z.array(z.string()).optional(),
    projectId: z.string().nullable().optional(),
    tagIds: z.array(z.string()).optional(),
    search: z.string().optional(),
    due: z.enum(['overdue', 'today', 'week', 'upcoming', 'none']).optional(),
    sort: z.string().optional(),
    groupBy: z.string().optional(),
  })
  .passthrough();
export type SavedFilterQuery = z.infer<typeof savedFilterQuerySchema>;

export const createSavedFilterSchema = z.object({
  name: z.string().min(1).max(120),
  query: savedFilterQuerySchema,
});
export type CreateSavedFilterInput = z.infer<typeof createSavedFilterSchema>;

export const updateSavedFilterSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  query: savedFilterQuerySchema.optional(),
});
export type UpdateSavedFilterInput = z.infer<typeof updateSavedFilterSchema>;
