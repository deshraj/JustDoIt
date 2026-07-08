import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { taskService, tagService, type Db } from '@justdoit/core';

const attachBody = z.object({ tagId: z.string().min(1) });

/**
 * Task <-> tag association routes. `tagService.attach`/`detach`/`listForTask`
 * already existed in @justdoit/core (used internally by quick-add's `#tag`
 * parsing) but were never exposed over REST — added here so the web UI's
 * TagPicker (Phase 5, Task 5) can read and edit a task's tags like any other
 * field, instead of only being able to create tags in the abstract.
 */
export function taskTagRoutes(db: Db): Hono {
  const r = new Hono();

  r.get('/tasks/:id/tags', (c) => {
    taskService.get(db, c.req.param('id'));
    return c.json(tagService.listForTask(db, c.req.param('id')));
  });

  r.post('/tasks/:id/tags', zValidator('json', attachBody), (c) => {
    taskService.get(db, c.req.param('id'));
    tagService.attach(db, c.req.param('id'), c.req.valid('json').tagId);
    return c.json(tagService.listForTask(db, c.req.param('id')), 201);
  });

  r.delete('/tasks/:id/tags/:tagId', (c) => {
    taskService.get(db, c.req.param('id'));
    tagService.detach(db, c.req.param('id'), c.req.param('tagId'));
    return c.json(tagService.listForTask(db, c.req.param('id')));
  });

  return r;
}
