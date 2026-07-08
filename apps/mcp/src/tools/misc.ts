import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { reminderService, quickAddService, type Db } from '@justdoit/core';
import { guard } from '../helpers.js';

const isoDate = z.coerce.date();

export function registerMiscTools(server: McpServer, db: Db): void {
  server.registerTool(
    'quick_add',
    {
      title: 'Quick add',
      description:
        'Create a task from natural language, e.g. "buy milk tomorrow 5pm #errands p1".',
      inputSchema: { text: z.string().min(1) },
    },
    ({ text }) => guard(() => quickAddService.create(db, text, new Date())),
  );

  server.registerTool(
    'set_reminder',
    {
      title: 'Set reminder',
      description: 'Schedule a reminder for a task at a given time (ISO 8601).',
      inputSchema: { taskId: z.string(), remindAt: isoDate },
    },
    ({ taskId, remindAt }) => guard(() => reminderService.create(db, { taskId, remindAt })),
  );
}
