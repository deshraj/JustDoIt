import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { projectService, createProjectSchema, updateProjectSchema, type Db } from '@justdoit/core';

export function projectRoutes(db: Db): Hono {
  const r = new Hono();

  r.get('/', (c) => {
    const archived = c.req.query('archived');
    const opts = archived === undefined ? {} : { archived: archived === 'true' };
    return c.json(projectService.list(db, opts));
  });

  r.post('/', zValidator('json', createProjectSchema), (c) =>
    c.json(projectService.create(db, c.req.valid('json')), 201),
  );

  r.get('/:id', (c) => c.json(projectService.get(db, c.req.param('id'))));

  r.patch('/:id', zValidator('json', updateProjectSchema), (c) =>
    c.json(projectService.update(db, c.req.param('id'), c.req.valid('json'))),
  );

  r.delete('/:id', (c) => {
    projectService.remove(db, c.req.param('id'));
    return c.body(null, 204);
  });

  return r;
}
