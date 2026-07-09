import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { reminderService, quickAddService, type Ctx } from '@justdoit/core';
import { guard } from '../helpers.js';

// Restrict to string/number/Date so a bare `null` is rejected rather than
// silently coerced to 1970-01-01 by `z.coerce.date()` (`new Date(null)`).
// `remindAt` is required by core (createReminderBody), so it is not nullish.
const isoDate = z.union([z.string(), z.number(), z.date()]).pipe(z.coerce.date());

export function registerMiscTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    'quick_add',
    {
      title: 'Quick add',
      description: 'Create a task from natural language, e.g. "buy milk tomorrow 5pm #errands p1".',
      inputSchema: { text: z.string().min(1) },
    },
    ({ text }) => guard(() => quickAddService.create(ctx, text, new Date())),
  );

  server.registerTool(
    'set_reminder',
    {
      title: 'Set reminder',
      description: 'Schedule a reminder for a task at a given time (ISO 8601).',
      inputSchema: { taskId: z.string(), remindAt: isoDate },
    },
    ({ taskId, remindAt }) => guard(() => reminderService.create(ctx, { taskId, remindAt })),
  );
}
