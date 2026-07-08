import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  savedFilterService,
  createSavedFilterSchema,
  updateSavedFilterSchema,
  type Db,
} from '@justdoit/core';

export function savedFilterRoutes(db: Db): Hono {
  const r = new Hono();

  r.get('/saved-filters', (c) => c.json({ savedFilters: savedFilterService.list(db) }));

  r.post('/saved-filters', zValidator('json', createSavedFilterSchema), (c) =>
    c.json({ savedFilter: savedFilterService.create(db, c.req.valid('json')) }, 201),
  );

  r.get('/saved-filters/:id', (c) =>
    c.json({ savedFilter: savedFilterService.get(db, c.req.param('id')) }),
  );

  r.patch('/saved-filters/:id', zValidator('json', updateSavedFilterSchema), (c) =>
    c.json({
      savedFilter: savedFilterService.update(db, c.req.param('id'), c.req.valid('json')),
    }),
  );

  r.delete('/saved-filters/:id', (c) => {
    savedFilterService.remove(db, c.req.param('id'));
    return c.body(null, 204);
  });

  return r;
}
