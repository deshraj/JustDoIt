import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  taskService,
  createTaskSchema,
  updateTaskSchema,
  setStatusSchema,
  dueFilterSchema,
  listOverdue,
  listDueToday,
  listUpcoming,
  type Db,
  type TaskListFilters,
  type TaskStatus,
  type TaskPriority,
} from '@justdoit/core';

function parseFilters(query: Record<string, string>): TaskListFilters {
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
  if (query.due_from) filters.dueFrom = new Date(query.due_from);
  if (query.due_to) filters.dueTo = new Date(query.due_to);
  const due = dueFilterSchema.safeParse(query.due);
  if (due.success) filters.due = due.data;
  return filters;
}

export function taskRoutes(db: Db): Hono {
  const r = new Hono();

  r.get('/', (c) => {
    const query = c.req.query();
    const filters = parseFilters(query);
    if (filters.due) {
      const now = new Date();
      const days = query.days ? Number(query.days) : 7;
      const result =
        filters.due === 'overdue'
          ? listOverdue(db, now)
          : filters.due === 'today'
            ? listDueToday(db, now)
            : listUpcoming(db, now, days);
      return c.json(result);
    }
    return c.json(taskService.list(db, filters));
  });

  r.post('/', zValidator('json', createTaskSchema), (c) =>
    c.json(taskService.create(db, c.req.valid('json')), 201),
  );

  r.get('/:id', (c) => c.json(taskService.get(db, c.req.param('id'))));

  r.patch('/:id', zValidator('json', updateTaskSchema), (c) =>
    c.json(taskService.update(db, c.req.param('id'), c.req.valid('json'))),
  );

  r.delete('/:id', (c) => {
    taskService.remove(db, c.req.param('id'));
    return c.body(null, 204);
  });

  r.patch('/:id/status', zValidator('json', setStatusSchema), (c) =>
    c.json(taskService.setStatus(db, c.req.param('id'), c.req.valid('json').status)),
  );

  r.post('/:id/complete', (c) => c.json(taskService.complete(db, c.req.param('id'))));

  r.get('/:id/subtasks', (c) => c.json(taskService.listSubtasks(db, c.req.param('id'))));

  r.post('/:id/subtasks', zValidator('json', createTaskSchema), (c) =>
    c.json(taskService.addSubtask(db, c.req.param('id'), c.req.valid('json')), 201),
  );

  return r;
}
