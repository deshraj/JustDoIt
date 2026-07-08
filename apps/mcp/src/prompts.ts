import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

function userText(text: string) {
  return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'plan_my_day',
    {
      title: 'Plan my day',
      description: 'Draft a focused plan from today and overdue tasks.',
      argsSchema: { focus: z.string().optional() },
    },
    ({ focus }) =>
      userText(
        [
          'Plan my day. Read the `tasks://today` and `tasks://overdue` resources and the',
          '`list_tasks` tool to see in-progress work. Propose an ordered, realistic plan',
          'that respects priorities (p0 first) and due dates, calling out anything overdue.',
          focus ? `Focus especially on: ${focus}.` : '',
        ]
          .filter(Boolean)
          .join(' '),
      ),
  );

  server.registerPrompt(
    'summarize_progress',
    {
      title: 'Summarize progress',
      description: 'Summarize what was completed and time spent in a period.',
      argsSchema: { period: z.string().optional() },
    },
    ({ period }) =>
      userText(
        [
          `Summarize my progress${period ? ` for ${period}` : ' recently'}.`,
          'Use `list_tasks` (status done) and `get_time_report` to report completed tasks,',
          'time spent by project, and anything still blocked or overdue.',
        ].join(' '),
      ),
  );
}
