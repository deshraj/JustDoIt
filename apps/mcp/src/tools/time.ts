import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { timeService, reportService, timeReportQuerySchema, type Ctx } from '@justdoit/core';
import { guard } from '../helpers.js';

// Restrict to string/number/Date so a bare `null` is rejected rather than
// silently coerced to 1970-01-01 by `z.coerce.date()` (`new Date(null)`).
const isoDate = z.union([z.string(), z.number(), z.date()]).pipe(z.coerce.date());

export function registerTimeTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    'start_timer',
    {
      title: 'Start timer',
      description: 'Start a running timer on a task (one running timer enforced by core).',
      inputSchema: { taskId: z.string() },
    },
    ({ taskId }) => guard(() => timeService.startTimer(ctx, taskId, new Date())),
  );

  server.registerTool(
    'stop_timer',
    {
      title: 'Stop timer',
      description: 'Stop the running timer (defaults to the currently running one).',
      inputSchema: { taskId: z.string().optional() },
    },
    ({ taskId }) => guard(() => timeService.stopTimer(ctx, { taskId }, new Date())),
  );

  server.registerTool(
    'log_time',
    {
      title: 'Log time',
      description:
        'Record a manual time entry. `minutes` is converted to core `durationSeconds` ' +
        '(minutes x 60) by the handler; `startedAt` defaults to now if omitted.',
      inputSchema: {
        taskId: z.string(),
        // Core allows a zero-duration entry (`durationSeconds` is nonnegative), so
        // mirror that here rather than requiring `.positive()`.
        minutes: z.number().int().nonnegative(),
        startedAt: isoDate.optional(),
        note: z.string().optional(),
      },
    },
    ({ taskId, minutes, startedAt, note }) =>
      guard(() => {
        const now = new Date();
        // NOTE (deviation): `LogManualInput.startedAt` (core) is a required `Date` —
        // the plan's draft passed the tool's optional `startedAt` straight through,
        // which fails core's schema/typecheck when omitted. Default to `now` here so
        // an agent can log "X minutes" without specifying a start time.
        return timeService.logManual(
          ctx,
          { taskId, startedAt: startedAt ?? now, durationSeconds: minutes * 60, note },
          now,
        );
      }),
  );

  server.registerTool(
    'get_time_report',
    {
      title: 'Time report',
      description: 'Aggregate tracked time grouped by day, project, or tag.',
      inputSchema: timeReportQuerySchema.shape,
    },
    (opts) => guard(() => reportService.timeReport(ctx, opts)),
  );
}
