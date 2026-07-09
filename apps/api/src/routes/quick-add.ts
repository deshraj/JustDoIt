import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { quickAddService, quickAddSchema, type Db } from '@justdoit/core';
import type { AppEnv } from '../context';

export function quickAddRoutes(db: Db): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.post('/quick-add', zValidator('json', quickAddSchema), (c) =>
    c.json(quickAddService.create(c.var.ctx, c.req.valid('json').text), 201),
  );
  return r;
}
