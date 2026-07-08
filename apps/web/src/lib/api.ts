import {
  parseTolerant,
  projectSchema,
  reminderSchema,
  tagSchema,
  taskSchema,
  timeEntrySchema,
  timeReportSchema,
  type EstimateVsActual,
  type Project,
  type Reminder,
  type Tag,
  type Task,
  type TaskPriority,
  type TaskStatus,
  type TimeEntry,
  type TimeEntrySource,
  type TimeReport,
} from './schemas';

/**
 * The single data boundary between apps/web and the REST API (apps/api).
 * Nothing else in this app should call `fetch` directly. Base URL comes from
 * NEXT_PUBLIC_API_URL (default http://localhost:8787) — never hardcode it
 * anywhere else.
 */

export type {
  Task,
  Project,
  Tag,
  TimeEntry,
  Reminder,
  TimeReport,
  TaskStatus,
  TaskPriority,
  EstimateVsActual,
};

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';
}

type QueryValue = string | number | boolean | Date | null | undefined;

function toQueryString(params: Record<string, QueryValue>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    usp.set(key, value instanceof Date ? value.toISOString() : String(value));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

function extractErrorMessage(status: number, body: unknown): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error?: unknown }).error;
    if (typeof err === 'string') return err;
  }
  return `Request failed with status ${status}`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const apiKey = process.env.NEXT_PUBLIC_API_KEY;
  if (apiKey) headers['X-API-Key'] = apiKey;

  const res = await fetch(`${getBaseUrl()}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
  });

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    throw new ApiError(res.status, extractErrorMessage(res.status, body), body);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

function json(body: unknown): string {
  return JSON.stringify(body);
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export interface TaskFilters {
  status?: TaskStatus;
  priority?: TaskPriority;
  /** null maps to the REST `project_id=none` (Inbox) sentinel. */
  projectId?: string | null;
  /** null maps to the REST `parent_task_id=none` sentinel. */
  parentTaskId?: string | null;
  tagId?: string;
  archived?: boolean;
  search?: string;
  due?: 'overdue' | 'today' | 'upcoming';
  days?: number;
  /** Arbitrary due-date window (inclusive) — e.g. the Calendar view's visible month. */
  dueFrom?: Date;
  dueTo?: Date;
}

function taskFiltersQuery(filters: TaskFilters = {}): string {
  return toQueryString({
    status: filters.status,
    priority: filters.priority,
    project_id: filters.projectId === null ? 'none' : filters.projectId,
    parent_task_id: filters.parentTaskId === null ? 'none' : filters.parentTaskId,
    tag_id: filters.tagId,
    archived: filters.archived,
    search: filters.search,
    due: filters.due,
    days: filters.days,
    due_from: filters.dueFrom,
    due_to: filters.dueTo,
  });
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority | null;
  projectId?: string | null;
  parentTaskId?: string | null;
  dueAt?: Date | string | null;
  startAt?: Date | string | null;
  estimateMinutes?: number | null;
  recurrence?: string | null;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  priority?: TaskPriority | null;
  projectId?: string | null;
  dueAt?: Date | string | null;
  startAt?: Date | string | null;
  estimateMinutes?: number | null;
  recurrence?: string | null;
  position?: number;
  archived?: boolean;
}

async function listTasks(filters: TaskFilters = {}): Promise<Task[]> {
  const data = await request<unknown[]>(`/tasks${taskFiltersQuery(filters)}`);
  return data.map((t) => parseTolerant(taskSchema, t, 'task'));
}

async function getTask(id: string): Promise<Task> {
  const data = await request<unknown>(`/tasks/${id}`);
  return parseTolerant(taskSchema, data, 'task');
}

async function createTask(input: CreateTaskInput): Promise<Task> {
  const data = await request<unknown>('/tasks', { method: 'POST', body: json(input) });
  return parseTolerant(taskSchema, data, 'task');
}

async function updateTask(id: string, patch: UpdateTaskInput): Promise<Task> {
  const data = await request<unknown>(`/tasks/${id}`, { method: 'PATCH', body: json(patch) });
  return parseTolerant(taskSchema, data, 'task');
}

async function deleteTask(id: string): Promise<void> {
  await request<void>(`/tasks/${id}`, { method: 'DELETE' });
}

async function setTaskStatus(id: string, status: TaskStatus): Promise<Task> {
  const data = await request<unknown>(`/tasks/${id}/status`, {
    method: 'PATCH',
    body: json({ status }),
  });
  return parseTolerant(taskSchema, data, 'task');
}

async function completeTask(id: string): Promise<Task> {
  const data = await request<unknown>(`/tasks/${id}/complete`, { method: 'POST' });
  return parseTolerant(taskSchema, data, 'task');
}

async function listSubtasks(id: string): Promise<Task[]> {
  const data = await request<unknown[]>(`/tasks/${id}/subtasks`);
  return data.map((t) => parseTolerant(taskSchema, t, 'task'));
}

async function createSubtask(parentId: string, input: CreateTaskInput): Promise<Task> {
  const data = await request<unknown>(`/tasks/${parentId}/subtasks`, {
    method: 'POST',
    body: json(input),
  });
  return parseTolerant(taskSchema, data, 'task');
}

async function listTaskTags(taskId: string): Promise<Tag[]> {
  const data = await request<unknown[]>(`/tasks/${taskId}/tags`);
  return data.map((t) => parseTolerant(tagSchema, t, 'tag'));
}

async function attachTag(taskId: string, tagId: string): Promise<Tag[]> {
  const data = await request<unknown[]>(`/tasks/${taskId}/tags`, {
    method: 'POST',
    body: json({ tagId }),
  });
  return data.map((t) => parseTolerant(tagSchema, t, 'tag'));
}

async function detachTag(taskId: string, tagId: string): Promise<Tag[]> {
  const data = await request<unknown[]>(`/tasks/${taskId}/tags/${tagId}`, { method: 'DELETE' });
  return data.map((t) => parseTolerant(tagSchema, t, 'tag'));
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface CreateProjectInput {
  name: string;
  color?: string | null;
  icon?: string | null;
  description?: string | null;
}

export interface UpdateProjectInput extends Partial<CreateProjectInput> {
  position?: number;
  archived?: boolean;
}

async function listProjects(opts: { archived?: boolean } = {}): Promise<Project[]> {
  const data = await request<unknown[]>(`/projects${toQueryString({ archived: opts.archived })}`);
  return data.map((p) => parseTolerant(projectSchema, p, 'project'));
}

async function getProject(id: string): Promise<Project> {
  const data = await request<unknown>(`/projects/${id}`);
  return parseTolerant(projectSchema, data, 'project');
}

async function createProject(input: CreateProjectInput): Promise<Project> {
  const data = await request<unknown>('/projects', { method: 'POST', body: json(input) });
  return parseTolerant(projectSchema, data, 'project');
}

async function updateProject(id: string, patch: UpdateProjectInput): Promise<Project> {
  const data = await request<unknown>(`/projects/${id}`, { method: 'PATCH', body: json(patch) });
  return parseTolerant(projectSchema, data, 'project');
}

async function deleteProject(id: string): Promise<void> {
  await request<void>(`/projects/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export interface CreateTagInput {
  name: string;
  color?: string | null;
}
export type UpdateTagInput = Partial<CreateTagInput>;

async function listTags(): Promise<Tag[]> {
  const data = await request<unknown[]>('/tags');
  return data.map((t) => parseTolerant(tagSchema, t, 'tag'));
}

async function getTag(id: string): Promise<Tag> {
  const data = await request<unknown>(`/tags/${id}`);
  return parseTolerant(tagSchema, data, 'tag');
}

async function createTag(input: CreateTagInput): Promise<Tag> {
  const data = await request<unknown>('/tags', { method: 'POST', body: json(input) });
  return parseTolerant(tagSchema, data, 'tag');
}

async function updateTag(id: string, patch: UpdateTagInput): Promise<Tag> {
  const data = await request<unknown>(`/tags/${id}`, { method: 'PATCH', body: json(patch) });
  return parseTolerant(tagSchema, data, 'tag');
}

async function deleteTag(id: string): Promise<void> {
  await request<void>(`/tags/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Search / quick-add
// ---------------------------------------------------------------------------

async function search(q: string): Promise<Task[]> {
  const data = await request<unknown[]>(`/search${toQueryString({ q })}`);
  return data.map((t) => parseTolerant(taskSchema, t, 'task'));
}

async function quickAdd(text: string): Promise<Task> {
  const data = await request<unknown>('/quick-add', { method: 'POST', body: json({ text }) });
  return parseTolerant(taskSchema, data, 'task');
}

// ---------------------------------------------------------------------------
// Time entries + timer
// ---------------------------------------------------------------------------

export interface TimeEntryFilters {
  taskId?: string;
  projectId?: string;
  from?: Date | string;
  to?: Date | string;
  source?: TimeEntrySource;
  running?: boolean;
  limit?: number;
  offset?: number;
}

function timeEntryFiltersQuery(filters: TimeEntryFilters = {}): string {
  return toQueryString({
    task_id: filters.taskId,
    project_id: filters.projectId,
    from: filters.from ? new Date(filters.from) : undefined,
    to: filters.to ? new Date(filters.to) : undefined,
    source: filters.source,
    running: filters.running,
    limit: filters.limit,
    offset: filters.offset,
  });
}

export interface CreateTimeEntryInput {
  taskId: string;
  startedAt: Date | string;
  endedAt?: Date | string;
  durationSeconds?: number;
  note?: string;
}

export interface UpdateTimeEntryInput {
  startedAt?: Date | string;
  endedAt?: Date | string | null;
  durationSeconds?: number | null;
  note?: string | null;
  source?: TimeEntrySource;
}

async function listTimeEntries(filters: TimeEntryFilters = {}): Promise<TimeEntry[]> {
  const data = await request<unknown[]>(`/time-entries${timeEntryFiltersQuery(filters)}`);
  return data.map((e) => parseTolerant(timeEntrySchema, e, 'timeEntry'));
}

async function createTimeEntry(input: CreateTimeEntryInput): Promise<TimeEntry> {
  const data = await request<unknown>('/time-entries', { method: 'POST', body: json(input) });
  return parseTolerant(timeEntrySchema, data, 'timeEntry');
}

async function updateTimeEntry(id: string, patch: UpdateTimeEntryInput): Promise<TimeEntry> {
  const data = await request<unknown>(`/time-entries/${id}`, {
    method: 'PATCH',
    body: json(patch),
  });
  return parseTolerant(timeEntrySchema, data, 'timeEntry');
}

async function deleteTimeEntry(id: string): Promise<void> {
  await request<void>(`/time-entries/${id}`, { method: 'DELETE' });
}

async function startTimer(taskId: string): Promise<TimeEntry> {
  const data = await request<unknown>(`/tasks/${taskId}/timer/start`, { method: 'POST' });
  return parseTolerant(timeEntrySchema, data, 'timeEntry');
}

async function stopTimer(taskId: string): Promise<TimeEntry> {
  const data = await request<unknown>(`/tasks/${taskId}/timer/stop`, { method: 'POST' });
  return parseTolerant(timeEntrySchema, data, 'timeEntry');
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface TimeReportParams {
  groupBy: 'day' | 'project' | 'tag';
  from?: Date | string;
  to?: Date | string;
}

async function getTimeReport(params: TimeReportParams): Promise<TimeReport> {
  const q = toQueryString({
    group_by: params.groupBy,
    from: params.from ? new Date(params.from) : undefined,
    to: params.to ? new Date(params.to) : undefined,
  });
  const data = await request<unknown>(`/reports/time${q}`);
  return parseTolerant(timeReportSchema, data, 'timeReport');
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

export interface ReminderFilters {
  /** NB: the real route reads the literal `taskId` query param, not `task_id`. */
  taskId?: string;
  delivered?: boolean;
}

export interface CreateReminderInput {
  taskId: string;
  remindAt: Date | string;
}

export interface UpdateReminderInput {
  remindAt?: Date | string;
  delivered?: boolean;
}

async function listReminders(filters: ReminderFilters = {}): Promise<Reminder[]> {
  const q = toQueryString({ taskId: filters.taskId, delivered: filters.delivered });
  const data = await request<unknown[]>(`/reminders${q}`);
  return data.map((r) => parseTolerant(reminderSchema, r, 'reminder'));
}

async function createReminder(input: CreateReminderInput): Promise<Reminder> {
  const data = await request<unknown>('/reminders', { method: 'POST', body: json(input) });
  return parseTolerant(reminderSchema, data, 'reminder');
}

async function updateReminder(id: string, patch: UpdateReminderInput): Promise<Reminder> {
  const data = await request<unknown>(`/reminders/${id}`, { method: 'PATCH', body: json(patch) });
  return parseTolerant(reminderSchema, data, 'reminder');
}

async function deleteReminder(id: string): Promise<void> {
  await request<void>(`/reminders/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------

async function exportData(): Promise<unknown> {
  return request<unknown>('/export');
}

async function importData(snapshot: unknown): Promise<unknown> {
  return request<unknown>('/import', { method: 'POST', body: json(snapshot) });
}

export const api = {
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  setTaskStatus,
  completeTask,
  listSubtasks,
  createSubtask,
  listTaskTags,
  attachTag,
  detachTag,
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  listTags,
  getTag,
  createTag,
  updateTag,
  deleteTag,
  search,
  quickAdd,
  listTimeEntries,
  createTimeEntry,
  updateTimeEntry,
  deleteTimeEntry,
  startTimer,
  stopTimer,
  getTimeReport,
  listReminders,
  createReminder,
  updateReminder,
  deleteReminder,
  exportData,
  importData,
};

export type Api = typeof api;
