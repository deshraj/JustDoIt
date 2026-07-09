import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { projectService, createProjectSchema, updateProjectSchema } from '@justdoit/core';
import type { AppEnv } from '../context';

export function projectRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/', (c) => {
    const archived = c.req.query('archived');
    const opts = archived === undefined ? {} : { archived: archived === 'true' };
    return c.json(projectService.list(c.var.ctx, opts));
  });

  r.post('/', zValidator('json', createProjectSchema), (c) =>
    c.json(projectService.create(c.var.ctx, c.req.valid('json')), 201),
  );

  r.get('/:id', (c) => c.json(projectService.get(c.var.ctx, c.req.param('id'))));

  r.patch('/:id', zValidator('json', updateProjectSchema), (c) =>
    c.json(projectService.update(c.var.ctx, c.req.param('id'), c.req.valid('json'))),
  );

  r.delete('/:id', (c) => {
    projectService.remove(c.var.ctx, c.req.param('id'));
    return c.body(null, 204);
  });

  return r;
}
