import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  taskService,
  createTaskSchema,
  updateTaskSchema,
  setStatusSchema,
  dueFilterSchema,
  listOverdue,
  listDueToday,
  listUpcoming,
  TASK_STATUSES,
  TASK_PRIORITIES,
  ValidationError,
  type TaskListFilters,
  type TaskStatus,
  type TaskPriority,
} from '@justdoit/core';
import type { AppEnv } from '../context';

const bulkPatchSchema = z.object({
  ids: z.array(z.string()).min(1),
  patch: z.object({
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(TASK_PRIORITIES).nullable().optional(),
    projectId: z.string().nullable().optional(),
    addTagIds: z.array(z.string()).optional(),
    removeTagIds: z.array(z.string()).optional(),
  }),
});

const bulkDeleteSchema = z.object({ ids: z.array(z.string()).min(1) });

// Validated shape of the schedule-related query params. Unlike the free-form
// string filters, these must parse cleanly (a bad `due`, `due_from`, `due_to`,
// or `days` is a 400, not a silently-ignored value).
const listQuerySchema = z.object({
  due: dueFilterSchema.optional(),
  due_from: z.coerce.date().optional(),
  due_to: z.coerce.date().optional(),
  days: z.coerce.number().int().positive().optional(),
});

type ListQuery = z.infer<typeof listQuerySchema>;

function parseListQuery(query: Record<string, string>): ListQuery {
  const parsed = listQuerySchema.safeParse(query);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'query'}: ${i.message}`)
      .join('; ');
    throw new ValidationError(`Invalid list query: ${detail}`);
  }
  return parsed.data;
}

function parseFilters(query: Record<string, string>, valid: ListQuery): TaskListFilters {
  const filters: TaskListFilters = {};
  if (query.status) filters.status = query.status as TaskStatus;
  if (query.priority) filters.priority = query.priority as TaskPriority;
  if (query.tag_id) filters.tagId = query.tag_id;
  if (query.search) filters.search = query.search;
  if (query.project_id !== undefined) {
    filters.projectId = query.project_id === 'none' ? null : query.project_id;
  }
  if (query.parent_task_id !== undefined) {
    filters.parentTaskId = query.parent_task_id === 'none' ? null : query.parent_task_id;
  }
  if (query.archived !== undefined) filters.archived = query.archived === 'true';
  if (valid.due_from) filters.dueFrom = valid.due_from;
  if (valid.due_to) filters.dueTo = valid.due_to;
  if (valid.due) filters.due = valid.due;
  return filters;
}

export function taskRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/', (c) => {
    const ctx = c.var.ctx;
    const query = c.req.query();
    const valid = parseListQuery(query);
    const filters = parseFilters(query, valid);
    if (filters.due) {
      const now = new Date();
      const days = valid.days ?? 7;
      const window =
        filters.due === 'overdue'
          ? listOverdue(ctx, now)
          : filters.due === 'today'
            ? listDueToday(ctx, now)
            : listUpcoming(ctx, now, days);
      // The relative `due` window is a separate query from `taskService.list`,
      // so compose them: intersect the window with the tasks matching the
      // remaining filters (status/priority/project/parent/archived/search/
      // due_from/due_to/tag) instead of dropping those filters silently.
      const allowed = new Set(taskService.list(ctx, filters).map((t) => t.id));
      return c.json(window.filter((t) => allowed.has(t.id)));
    }
    return c.json(taskService.list(ctx, filters));
  });

  r.post('/', zValidator('json', createTaskSchema), (c) =>
    c.json(taskService.create(c.var.ctx, c.req.valid('json')), 201),
  );

  // Registered before `/:id` so `bulk` / `bulk-delete` aren't swallowed by
  // the `:id` param matcher.
  r.patch('/bulk', zValidator('json', bulkPatchSchema), (c) => {
    const { ids, patch } = c.req.valid('json');
    return c.json({ tasks: taskService.bulkUpdate(c.var.ctx, ids, patch) });
  });

  r.post('/bulk-delete', zValidator('json', bulkDeleteSchema), (c) => {
    const { ids } = c.req.valid('json');
    return c.json(taskService.bulkDelete(c.var.ctx, ids));
  });

  r.get('/:id', (c) => c.json(taskService.get(c.var.ctx, c.req.param('id'))));

  r.patch('/:id', zValidator('json', updateTaskSchema), (c) =>
    c.json(taskService.update(c.var.ctx, c.req.param('id'), c.req.valid('json'))),
  );

  r.delete('/:id', (c) => {
    taskService.remove(c.var.ctx, c.req.param('id'));
    return c.body(null, 204);
  });

  r.patch('/:id/status', zValidator('json', setStatusSchema), (c) =>
    c.json(taskService.setStatus(c.var.ctx, c.req.param('id'), c.req.valid('json').status)),
  );

  r.post('/:id/complete', (c) => c.json(taskService.complete(c.var.ctx, c.req.param('id'))));

  r.get('/:id/subtasks', (c) => c.json(taskService.listSubtasks(c.var.ctx, c.req.param('id'))));

  r.post('/:id/subtasks', zValidator('json', createTaskSchema), (c) =>
    c.json(taskService.addSubtask(c.var.ctx, c.req.param('id'), c.req.valid('json')), 201),
  );

  return r;
}
