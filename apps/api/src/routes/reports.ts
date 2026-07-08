import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { reportService, timeReportQueryParamsSchema, type Db } from '@justdoit/core';

export function reportRoutes(db: Db): Hono {
  const r = new Hono();

  r.get('/reports/time', zValidator('query', timeReportQueryParamsSchema), (c) => {
    return c.json(reportService.timeReport(db, c.req.valid('query')));
  });

  return r;
}
