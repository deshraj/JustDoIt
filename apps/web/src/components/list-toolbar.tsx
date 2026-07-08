'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { TaskFilters, TaskPriority, TaskStatus } from '@/lib/api';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PRIORITY_LABELS, STATUS_LABELS } from '@/lib/utils';
import { SavedFiltersMenu } from '@/components/saved-filters-menu';

export const GROUP_OPTIONS = ['status', 'project', 'priority', 'due', 'none'] as const;
export type GroupBy = (typeof GROUP_OPTIONS)[number];

export const SORT_OPTIONS = ['position', 'dueAt', 'priority', 'createdAt', 'title'] as const;
export type SortBy = (typeof SORT_OPTIONS)[number];

export interface ListQueryState {
  filters: TaskFilters;
  group: GroupBy;
  sort: SortBy;
}

/** Parse the List view's shareable/bookmarkable URL query into filters + view state. */
export function parseListSearchParams(sp: URLSearchParams): ListQueryState {
  const status = sp.get('status');
  const priority = sp.get('priority');
  const project = sp.get('project');
  const tag = sp.get('tag');
  const due = sp.get('due');
  const search = sp.get('q');
  const group = sp.get('group');
  const sort = sp.get('sort');

  return {
    filters: {
      status: status ? (status as TaskStatus) : undefined,
      priority: priority ? (priority as TaskPriority) : undefined,
      projectId: project ? (project === 'none' ? null : project) : undefined,
      tagId: tag ?? undefined,
      due: due === 'overdue' || due === 'today' || due === 'upcoming' ? due : undefined,
      search: search ?? undefined,
    },
    group: (GROUP_OPTIONS as readonly string[]).includes(group ?? '')
      ? (group as GroupBy)
      : 'status',
    sort: (SORT_OPTIONS as readonly string[]).includes(sort ?? '') ? (sort as SortBy) : 'position',
  };
}

const ANY = '__any__';

export function ListToolbar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { filters, group, sort } = parseListSearchParams(searchParams);

  function setParam(key: string, value: string | undefined): void {
    const next = new URLSearchParams(searchParams.toString());
    if (value === undefined || value === ANY) next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}?${next.toString()}`);
  }

  // Only the actual filter fields (not group/sort) round-trip through a
  // saved view — this shape matches @justdoit/core's savedFilterQuerySchema.
  const currentFilterQuery: Record<string, unknown> = {
    status: filters.status,
    priority: filters.priority,
    projectId: filters.projectId,
    tagId: filters.tagId,
    due: filters.due,
    search: filters.search,
  };

  function applySavedFilter(query: Record<string, unknown>): void {
    const next = new URLSearchParams();
    if (typeof query.status === 'string') next.set('status', query.status);
    if (typeof query.priority === 'string') next.set('priority', query.priority);
    if (typeof query.projectId === 'string') next.set('project', query.projectId);
    else if (query.projectId === null) next.set('project', 'none');
    if (typeof query.tagId === 'string') next.set('tag', query.tagId);
    if (typeof query.due === 'string') next.set('due', query.due);
    if (typeof query.search === 'string') next.set('q', query.search);
    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2 pb-4"
      role="toolbar"
      aria-label="List filters"
    >
      <Select
        value={group}
        onValueChange={(v) => setParam('group', v === 'status' ? undefined : v)}
      >
        <SelectTrigger aria-label="Group by" className="w-36">
          <span className="text-muted-foreground">Group:</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {GROUP_OPTIONS.map((g) => (
            <SelectItem key={g} value={g}>
              {g === 'none' ? 'None' : g[0]!.toUpperCase() + g.slice(1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={sort}
        onValueChange={(v) => setParam('sort', v === 'position' ? undefined : v)}
      >
        <SelectTrigger aria-label="Sort by" className="w-36">
          <span className="text-muted-foreground">Sort:</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((s) => (
            <SelectItem key={s} value={s}>
              {s === 'dueAt'
                ? 'Due date'
                : s === 'createdAt'
                  ? 'Created'
                  : s[0]!.toUpperCase() + s.slice(1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.status ?? ANY}
        onValueChange={(v) => setParam('status', v === ANY ? undefined : v)}
      >
        <SelectTrigger aria-label="Filter by status" className="w-32">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any status</SelectItem>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.priority ?? ANY}
        onValueChange={(v) => setParam('priority', v === ANY ? undefined : v)}
      >
        <SelectTrigger aria-label="Filter by priority" className="w-32">
          <SelectValue placeholder="Priority" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any priority</SelectItem>
          {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.due ?? ANY}
        onValueChange={(v) => setParam('due', v === ANY ? undefined : v)}
      >
        <SelectTrigger aria-label="Filter by due" className="w-32">
          <SelectValue placeholder="Due" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any due date</SelectItem>
          <SelectItem value="overdue">Overdue</SelectItem>
          <SelectItem value="today">Due today</SelectItem>
          <SelectItem value="upcoming">Upcoming</SelectItem>
        </SelectContent>
      </Select>

      <SavedFiltersMenu current={currentFilterQuery} onApply={applySavedFilter} />
    </div>
  );
}
