import { z } from 'zod';

export const upsertGithubUserSchema = z.object({
  githubId: z.string().min(1),
  email: z.string().email().nullish(),
  name: z.string().nullish(),
  avatarUrl: z.string().url().nullish(),
});
export type UpsertGithubUserInput = z.infer<typeof upsertGithubUserSchema>;

export const createUserSchema = z.object({
  id: z.string().min(1).optional(),
  githubId: z.string().min(1).nullish(),
  email: z.string().email().nullish(),
  name: z.string().nullish(),
  avatarUrl: z.string().url().nullish(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;
