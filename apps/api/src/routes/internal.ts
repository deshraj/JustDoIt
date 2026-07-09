import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { userService, type Db } from '@justdoit/core';

const upsertUserSchema = z.object({
  githubId: z.string().min(1),
  email: z.string().email().nullish(),
  name: z.string().nullish(),
  avatarUrl: z.string().url().nullish(),
});

/**
 * Server-to-server surface reached only by the web app during sign-in, before a
 * session `userId` exists. Guarded by its own `X-Internal-Key` check and mounted
 * OUTSIDE `resolveUser` (which would demand an `X-User-Id` it cannot yet supply).
 */
export function internalRoutes(db: Db, opts: { internalSecret?: string } = {}): Hono {
  const secret = opts.internalSecret ?? process.env.INTERNAL_API_SECRET;
  const r = new Hono();

  r.use('*', async (c, next) => {
    if (!secret || c.req.header('X-Internal-Key') !== secret) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    return next();
  });

  r.post('/users', zValidator('json', upsertUserSchema), (c) => {
    const input = c.req.valid('json');
    const user = userService.upsertByGithubId(db, {
      githubId: input.githubId,
      email: input.email ?? null,
      name: input.name ?? null,
      avatarUrl: input.avatarUrl ?? null,
    });
    return c.json({ id: user.id });
  });

  return r;
}
