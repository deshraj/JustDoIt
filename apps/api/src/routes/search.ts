import { Hono } from 'hono';
import { taskService, ValidationError, type Db } from '@justdoit/core';

export function searchRoutes(db: Db): Hono {
  const r = new Hono();
  r.get('/search', (c) => {
    const q = c.req.query('q');
    if (!q) throw new ValidationError('Missing required query parameter: q');
    return c.json(taskService.list(db, { search: q }));
  });
  return r;
}
