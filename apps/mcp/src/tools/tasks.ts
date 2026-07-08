import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { taskService, TASK_STATUSES, TASK_PRIORITIES, type Db } from '@justdoit/core';
import { guard } from '../helpers.js';

// Coerce ISO date strings from agents into Date for date fields.
const isoDate = z.coerce.date();

const createShape = {
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  projectId: z.string().optional(),
  parentTaskId: z.string().optional(),
  dueAt: isoDate.optional(),
  startAt: isoDate.optional(),
  estimateMinutes: z.number().int().positive().optional(),
  recurrence: z.string().optional(),
};

// NOTE: written as an explicit literal (all `createShape` fields repeated as
// `.optional()`, plus `id`) rather than deriving via `Object.fromEntries` +
// a cast, per the plan's own fallback — this keeps the raw shape's inferred
// TS type sound under `verbatimModuleSyntax`/strict without an `as` cast.
const updateShape = {
  id: z.string(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  projectId: z.string().optional(),
  parentTaskId: z.string().optional(),
  dueAt: isoDate.optional(),
  startAt: isoDate.optional(),
  estimateMinutes: z.number().int().positive().optional(),
  recurrence: z.string().optional(),
};

export function registerTaskTools(server: McpServer, db: Db): void {
  server.registerTool(
    'create_task',
    {
      title: 'Create task',
      description: 'Create a new task. Dates accept ISO 8601 strings.',
      inputSchema: createShape,
    },
    (args) => guard(() => taskService.create(db, args)),
  );

  server.registerTool(
    'update_task',
    {
      title: 'Update task',
      description: 'Patch an existing task by id.',
      inputSchema: updateShape,
    },
    ({ id, ...patch }) => guard(() => taskService.update(db, id, patch)),
  );

  server.registerTool(
    'set_status',
    {
      title: 'Set task status',
      description: 'Move a task to a new status.',
      inputSchema: { id: z.string(), status: z.enum(TASK_STATUSES) },
    },
    ({ id, status }) => guard(() => taskService.setStatus(db, id, status)),
  );

  server.registerTool(
    'complete_task',
    {
      title: 'Complete task',
      description: 'Mark a task done (spawns next occurrence if recurring).',
      inputSchema: { id: z.string() },
    },
    ({ id }) => guard(() => taskService.complete(db, id, new Date())),
  );

  server.registerTool(
    'delete_task',
    {
      title: 'Delete task',
      description: 'Permanently delete a task and its subtasks.',
      inputSchema: { id: z.string() },
    },
    ({ id }) => guard(() => taskService.remove(db, id)),
  );
}
