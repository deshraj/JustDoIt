import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { reminderService, createReminderBody, updateReminderBody, type Db } from '@justdoit/core';
import type { AppEnv } from '../context';

const listQuery = z.object({
  taskId: z.string().uuid().optional(),
  delivered: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export function reminderRoutes(db: Db): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/', zValidator('query', listQuery), (c) =>
    c.json(reminderService.list(c.var.ctx, c.req.valid('query'))),
  );

  r.post('/', zValidator('json', createReminderBody), (c) =>
    c.json(reminderService.create(c.var.ctx, c.req.valid('json')), 201),
  );

  r.patch('/:id', zValidator('json', updateReminderBody), (c) =>
    c.json(reminderService.update(c.var.ctx, c.req.param('id'), c.req.valid('json'))),
  );

  r.delete('/:id', (c) => {
    reminderService.remove(c.var.ctx, c.req.param('id'));
    return c.body(null, 204);
  });

  return r;
}
