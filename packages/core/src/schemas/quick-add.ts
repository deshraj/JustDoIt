import { z } from 'zod';

export const quickAddSchema = z.object({ text: z.string().min(1) });
export type QuickAddInput = z.infer<typeof quickAddSchema>;
