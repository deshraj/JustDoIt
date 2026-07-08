import { Hono } from 'hono';
import { exportService, type Db, type Snapshot } from '@justdoit/core';

export function transferRoutes(db: Db): Hono {
  const r = new Hono();

  r.get('/export', (c) => c.json(exportService.exportSnapshot(db)));

  r.post('/import', async (c) => {
    const snapshot = (await c.req.json()) as Snapshot;
    return c.json(exportService.importSnapshot(db, snapshot));
  });

  return r;
}
