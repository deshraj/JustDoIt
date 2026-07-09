import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { apiKeyService } from '@justdoit/core';
import type { AppEnv } from '../context';

const createKeySchema = z.object({ name: z.string().min(1).max(100) });

export function apiKeyRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/', (c) => {
    const { db, userId } = c.var.ctx;
    return c.json({ keys: apiKeyService.listForUser(db, userId) });
  });

  r.post('/', zValidator('json', createKeySchema), (c) => {
    const { db, userId } = c.var.ctx;
    // core returns { apiKey, token }; the wire shape shows the plaintext once as `raw`.
    const { apiKey, token } = apiKeyService.create(db, userId, c.req.valid('json').name);
    return c.json({ raw: token, key: apiKey }, 201);
  });

  r.delete('/:id', (c) => {
    const { db, userId } = c.var.ctx;
    apiKeyService.revoke(db, userId, c.req.param('id'));
    return c.body(null, 204);
  });

  return r;
}
