import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { quickAddService, quickAddSchema, type Db } from '@justdoit/core';

export function quickAddRoutes(db: Db): Hono {
  const r = new Hono();
  r.post('/quick-add', zValidator('json', quickAddSchema), (c) =>
    c.json(quickAddService.create(db, c.req.valid('json').text), 201),
  );
  return r;
}
