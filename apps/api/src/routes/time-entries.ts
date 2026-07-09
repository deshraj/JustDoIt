import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  timeService,
  logManualSchema,
  updateEntrySchema,
  timeEntryFilterSchema,
  type Db,
} from '@justdoit/core';
import type { AppEnv } from '../context';

export function timeRoutes(db: Db): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.post('/tasks/:id/timer/start', (c) => {
    const entry = timeService.startTimer(c.var.ctx, c.req.param('id'));
    return c.json(entry, 201);
  });

  r.post('/tasks/:id/timer/stop', (c) => {
    const entry = timeService.stopTimer(c.var.ctx, { taskId: c.req.param('id') });
    return c.json(entry, 200);
  });

  r.get('/time-entries', zValidator('query', timeEntryFilterSchema), (c) => {
    return c.json(timeService.listEntries(c.var.ctx, c.req.valid('query')));
  });

  r.post('/time-entries', zValidator('json', logManualSchema), (c) => {
    const entry = timeService.logManual(c.var.ctx, c.req.valid('json'));
    return c.json(entry, 201);
  });

  r.patch('/time-entries/:id', zValidator('json', updateEntrySchema), (c) => {
    const entry = timeService.updateEntry(c.var.ctx, c.req.param('id'), c.req.valid('json'));
    return c.json(entry, 200);
  });

  r.delete('/time-entries/:id', (c) => {
    timeService.deleteEntry(c.var.ctx, c.req.param('id'));
    return c.body(null, 204);
  });

  return r;
}
