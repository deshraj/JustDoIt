import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  timeService,
  logManualSchema,
  updateEntrySchema,
  timeEntryFilterSchema,
  type Db,
} from '@justdoit/core';

export function timeRoutes(db: Db): Hono {
  const r = new Hono();

  r.post('/tasks/:id/timer/start', (c) => {
    const entry = timeService.startTimer(db, c.req.param('id'));
    return c.json(entry, 201);
  });

  r.post('/tasks/:id/timer/stop', (c) => {
    const entry = timeService.stopTimer(db, { taskId: c.req.param('id') });
    return c.json(entry, 200);
  });

  r.get('/time-entries', zValidator('query', timeEntryFilterSchema), (c) => {
    return c.json(timeService.listEntries(db, c.req.valid('query')));
  });

  r.post('/time-entries', zValidator('json', logManualSchema), (c) => {
    const entry = timeService.logManual(db, c.req.valid('json'));
    return c.json(entry, 201);
  });

  r.patch('/time-entries/:id', zValidator('json', updateEntrySchema), (c) => {
    const entry = timeService.updateEntry(db, c.req.param('id'), c.req.valid('json'));
    return c.json(entry, 200);
  });

  r.delete('/time-entries/:id', (c) => {
    timeService.deleteEntry(db, c.req.param('id'));
    return c.body(null, 204);
  });

  return r;
}
