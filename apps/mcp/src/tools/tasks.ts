import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  taskService,
  tagService,
  dueFilterSchema,
  listOverdue,
  listDueToday,
  listUpcoming,
  TASK_STATUSES,
  TASK_PRIORITIES,
  type Db,
  type Task,
  type TaskListFilters,
} from '@justdoit/core';
import { guard } from '../helpers.js';

// Coerce ISO date strings / Dates from agents into Date for date fields.
// IMPORTANT: `z.coerce.date()` alone silently turns an explicit `null` into
// 1970-01-01 (`new Date(null)`), corrupting data. This restricts the input to
// string/number/Date so a bare `null` is rejected rather than coerced. For
// fields core allows clearing, wrap with `.nullish()` (which short-circuits
// `null` through untouched, before coercion) so `null` means "clear the field".
const isoDate = z.union([z.string(), z.number(), z.date()]).pipe(z.coerce.date());

const createShape = {
  title: z.string().min(1),
  description: z.string().nullish(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).nullish(),
  projectId: z.string().nullish(),
  parentTaskId: z.string().nullish(),
  dueAt: isoDate.nullish(),
  startAt: isoDate.nullish(),
  estimateMinutes: z.number().int().positive().nullish(),
  recurrence: z.string().nullish(),
};

// NOTE: written as an explicit literal (all `createShape` fields repeated as
// `.optional()`, plus `id`) rather than deriving via `Object.fromEntries` +
// a cast, per the plan's own fallback — this keeps the raw shape's inferred
// TS type sound under `verbatimModuleSyntax`/strict without an `as` cast.
const updateShape = {
  id: z.string(),
  title: z.string().min(1).optional(),
  description: z.string().nullish(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).nullish(),
  projectId: z.string().nullish(),
  parentTaskId: z.string().nullish(),
  dueAt: isoDate.nullish(),
  startAt: isoDate.nullish(),
  estimateMinutes: z.number().int().positive().nullish(),
  recurrence: z.string().nullish(),
};

// NOTE (deviation from plan draft): `taskService.list`'s `TaskListFilters` (Phase 1)
// filters by `tagId` (not a tag name) and has no `dueBefore`/`dueAfter`/`limit`/`sort`
// fields — those were the plan's assumed shape, but core's actual due-window queries
// live as separate `listOverdue`/`listDueToday`/`listUpcoming` functions (Phase 2's
// schedule-service), exactly mirroring how `apps/api`'s `GET /tasks?due=...` short-
// circuits to them (see apps/api/src/routes/tasks.ts). So `list_tasks` here accepts
// `tag` (a name, resolved to `tagId` via `tagService.list`) and `due` (the core
// `dueFilterSchema` enum) instead of `dueBefore`/`dueAfter`, and applies `limit` by
// slicing the result array (a display-size convenience, not a business rule).
function applyLimit(rows: Task[], limit: number | undefined): Task[] {
  return limit === undefined ? rows : rows.slice(0, limit);
}

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

  server.registerTool(
    'get_task',
    {
      title: 'Get task',
      description: 'Fetch a single task by id.',
      inputSchema: { id: z.string() },
    },
    ({ id }) => guard(() => taskService.get(db, id)),
  );

  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks',
      description:
        'List tasks with optional filters. `tag` filters by tag name; `due` filters by ' +
        'due-date window (overdue/today/upcoming) and excludes done/cancelled tasks.',
      inputSchema: {
        status: z.enum(TASK_STATUSES).optional(),
        projectId: z.string().optional(),
        priority: z.enum(TASK_PRIORITIES).optional(),
        tag: z.string().optional(),
        parentTaskId: z.string().optional(),
        due: dueFilterSchema.optional(),
        archived: z.boolean().optional(),
        limit: z.number().int().positive().max(500).optional(),
      },
    },
    ({ tag, due, limit, ...rest }) =>
      guard(() => {
        // Resolve tag name -> id once; an unknown tag matches nothing.
        let tagId: string | undefined;
        if (tag) {
          const match = tagService.list(db).find((t) => t.name === tag);
          if (!match) return [];
          tagId = match.id;
        }
        if (due) {
          // Core's due-window queries (overdue/today/upcoming) don't accept the
          // other filters, so apply status/projectId/priority/parentTaskId/archived
          // (and tag) to their results here so combined filters compose rather than
          // silently dropping everything but `due`.
          const now = new Date();
          let rows =
            due === 'overdue'
              ? listOverdue(db, now)
              : due === 'today'
                ? listDueToday(db, now)
                : listUpcoming(db, now);
          rows = rows.filter((t) => {
            if (rest.status !== undefined && t.status !== rest.status) return false;
            if (rest.priority !== undefined && t.priority !== rest.priority) return false;
            if (rest.projectId !== undefined && t.projectId !== rest.projectId) return false;
            if (rest.parentTaskId !== undefined && t.parentTaskId !== rest.parentTaskId)
              return false;
            if (rest.archived !== undefined && t.archived !== rest.archived) return false;
            return true;
          });
          if (tagId !== undefined) {
            const taggedIds = new Set(taskService.list(db, { tagId }).map((t) => t.id));
            rows = rows.filter((t) => taggedIds.has(t.id));
          }
          return applyLimit(rows, limit);
        }
        const filters: TaskListFilters = { ...rest };
        if (tagId !== undefined) filters.tagId = tagId;
        return applyLimit(taskService.list(db, filters), limit);
      }),
  );

  server.registerTool(
    'search_tasks',
    {
      title: 'Search tasks',
      description: 'Full-text search over task title/description.',
      inputSchema: { q: z.string().min(1), limit: z.number().int().positive().max(500).optional() },
    },
    ({ q, limit }) => guard(() => applyLimit(taskService.list(db, { search: q }), limit)),
  );
}
