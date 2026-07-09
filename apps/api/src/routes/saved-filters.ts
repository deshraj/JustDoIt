import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  savedFilterService,
  createSavedFilterSchema,
  updateSavedFilterSchema,
  type Db,
} from '@justdoit/core';
import type { AppEnv } from '../context';

export function savedFilterRoutes(db: Db): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/saved-filters', (c) => c.json({ savedFilters: savedFilterService.list(c.var.ctx) }));

  r.post('/saved-filters', zValidator('json', createSavedFilterSchema), (c) =>
    c.json({ savedFilter: savedFilterService.create(c.var.ctx, c.req.valid('json')) }, 201),
  );

  r.get('/saved-filters/:id', (c) =>
    c.json({ savedFilter: savedFilterService.get(c.var.ctx, c.req.param('id')) }),
  );

  r.patch('/saved-filters/:id', zValidator('json', updateSavedFilterSchema), (c) =>
    c.json({
      savedFilter: savedFilterService.update(c.var.ctx, c.req.param('id'), c.req.valid('json')),
    }),
  );

  r.delete('/saved-filters/:id', (c) => {
    savedFilterService.remove(c.var.ctx, c.req.param('id'));
    return c.body(null, 204);
  });

  return r;
}
