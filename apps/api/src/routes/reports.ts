import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { reportService, timeReportQueryParamsSchema, type Db } from '@justdoit/core';
import type { AppEnv } from '../context';

export function reportRoutes(db: Db): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/reports/time', zValidator('query', timeReportQueryParamsSchema), (c) => {
    return c.json(reportService.timeReport(c.var.ctx, c.req.valid('query')));
  });

  return r;
}
