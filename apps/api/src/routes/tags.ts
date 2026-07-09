import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { tagService, createTagSchema, updateTagSchema, type Db } from '@justdoit/core';
import type { AppEnv } from '../context';

export function tagRoutes(db: Db): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/', (c) => c.json(tagService.list(c.var.ctx)));

  r.post('/', zValidator('json', createTagSchema), (c) =>
    c.json(tagService.create(c.var.ctx, c.req.valid('json')), 201),
  );

  r.get('/:id', (c) => c.json(tagService.get(c.var.ctx, c.req.param('id'))));

  r.patch('/:id', zValidator('json', updateTagSchema), (c) =>
    c.json(tagService.update(c.var.ctx, c.req.param('id'), c.req.valid('json'))),
  );

  r.delete('/:id', (c) => {
    tagService.remove(c.var.ctx, c.req.param('id'));
    return c.body(null, 204);
  });

  return r;
}
