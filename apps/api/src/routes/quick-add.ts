import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { quickAddService, quickAddSchema } from '@justdoit/core';
import type { AppEnv } from '../context';

export function quickAddRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.post('/quick-add', zValidator('json', quickAddSchema), (c) =>
    c.json(quickAddService.create(c.var.ctx, c.req.valid('json').text), 201),
  );
  return r;
}
