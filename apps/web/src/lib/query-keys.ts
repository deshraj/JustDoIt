import type { ReminderFilters, TaskFilters, TimeEntryFilters, TimeReportParams } from './api';

/**
 * Centralized TanStack Query key factory. Every hook builds its keys from
 * here so invalidation (after a mutation, or later an SSE event — see Notes
 * for later phases in the Phase 5 plan) has one canonical source of truth.
 */
export const qk = {
  tasks: {
    all: ['tasks'] as const,
    list: (filters: TaskFilters = {}) => ['tasks', 'list', filters] as const,
    detail: (id: string) => ['tasks', 'detail', id] as const,
    subtasks: (id: string) => ['tasks', 'detail', id, 'subtasks'] as const,
    tags: (id: string) => ['tasks', 'detail', id, 'tags'] as const,
  },
  projects: {
    all: ['projects'] as const,
    list: (opts: { archived?: boolean } = {}) => ['projects', 'list', opts] as const,
    detail: (id: string) => ['projects', 'detail', id] as const,
  },
  tags: {
    all: ['tags'] as const,
  },
  search: (q: string) => ['search', q] as const,
  timeEntries: {
    all: ['time-entries'] as const,
    list: (filters: TimeEntryFilters = {}) => ['time-entries', 'list', filters] as const,
  },
  timeReport: (params: TimeReportParams) => ['reports', 'time', params] as const,
  reminders: {
    all: ['reminders'] as const,
    list: (filters: ReminderFilters = {}) => ['reminders', 'list', filters] as const,
  },
} as const;
