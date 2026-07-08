import { z } from 'zod';

export const dueFilterSchema = z.enum(['overdue', 'today', 'upcoming']);
export type DueFilter = z.infer<typeof dueFilterSchema>;

export const upcomingQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(365).default(7),
});
export type UpcomingQuery = z.infer<typeof upcomingQuerySchema>;
