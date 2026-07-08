import { z } from 'zod';

export const TIME_REPORT_GROUP_BY = ['day', 'project', 'tag'] as const;
export type TimeReportGroupBy = (typeof TIME_REPORT_GROUP_BY)[number];

/** Canonical (camelCase) report query used by reportService.timeReport. */
export const timeReportQuerySchema = z.object({
  groupBy: z.enum(TIME_REPORT_GROUP_BY),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type TimeReportQuery = z.infer<typeof timeReportQuerySchema>;

/** Query schema for GET /reports/time — snake_case `group_by` → camelCase. */
export const timeReportQueryParamsSchema = z
  .object({
    group_by: z.enum(TIME_REPORT_GROUP_BY),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .transform((v): TimeReportQuery => ({ groupBy: v.group_by, from: v.from, to: v.to }));
