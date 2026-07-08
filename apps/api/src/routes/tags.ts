import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { tagService, createTagSchema, updateTagSchema, type Db } from '@justdoit/core';

export function tagRoutes(db: Db): Hono {
  const r = new Hono();

  r.get('/', (c) => c.json(tagService.list(db)));

  r.post('/', zValidator('json', createTagSchema), (c) =>
    c.json(tagService.create(db, c.req.valid('json')), 201),
  );

  r.get('/:id', (c) => c.json(tagService.get(db, c.req.param('id'))));

  r.patch('/:id', zValidator('json', updateTagSchema), (c) =>
    c.json(tagService.update(db, c.req.param('id'), c.req.valid('json'))),
  );

  r.delete('/:id', (c) => {
    tagService.remove(db, c.req.param('id'));
    return c.body(null, 204);
  });

  return r;
}
