import { Hono } from 'hono';
import { taskService, ValidationError } from '@justdoit/core';
import type { AppEnv } from '../context';

export function searchRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/search', (c) => {
    const q = c.req.query('q');
    if (!q) throw new ValidationError('Missing required query parameter: q');
    return c.json(taskService.list(c.var.ctx, { search: q }));
  });
  return r;
}
