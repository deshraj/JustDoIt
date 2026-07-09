import { Hono } from 'hono';
import { exportService, type Snapshot } from '@justdoit/core';
import type { AppEnv } from '../context';

export function transferRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/export', (c) => c.json(exportService.exportSnapshot(c.var.ctx)));

  r.post('/import', async (c) => {
    const snapshot = (await c.req.json()) as Snapshot;
    return c.json(exportService.importSnapshot(c.var.ctx, snapshot));
  });

  return r;
}
