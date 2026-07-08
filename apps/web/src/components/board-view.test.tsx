import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Task } from '@/lib/api';
import { BoardView, STATUS_LIFECYCLE, bucketTasks, resolveDropStatus } from './board-view';

const listTasks = vi.fn();
const setTaskStatus = vi.fn().mockResolvedValue({});

vi.mock('@/lib/api', () => ({
  api: {
    listTasks: (...a: unknown[]) => listTasks(...a),
    listProjects: vi.fn().mockResolvedValue([]),
    setTaskStatus: (...a: unknown[]) => setTaskStatus(...a),
    updateTask: vi.fn().mockResolvedValue({}),
  },
}));

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 't0',
    title: 'Untitled',
    description: null,
    status: 'todo',
    priority: null,
    projectId: null,
    parentTaskId: null,
    position: 0,
    dueAt: null,
    startAt: null,
    estimateMinutes: null,
    recurrence: null,
    completedAt: null,
    archived: false,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

const TASKS: Task[] = [
  makeTask({ id: 't1', title: 'Backlog item', status: 'backlog', position: 1 }),
  makeTask({ id: 't2', title: 'Todo item', status: 'todo', position: 1 }),
  makeTask({ id: 't3', title: 'Doing item', status: 'in_progress', position: 1 }),
  makeTask({ id: 't4', title: 'Done item', status: 'done', position: 1 }),
];

describe('resolveDropStatus (pure, extracted onDragEnd logic)', () => {
  it('dropping t1 onto the done column resolves to "done"', () => {
    expect(resolveDropStatus(TASKS, 't1', 'done')).toBe('done');
  });

  it('dropping onto a card resolves to that card’s column', () => {
    expect(resolveDropStatus(TASKS, 't1', 't4')).toBe('done');
  });

  it('returns null when dropped back on its own column (no-op)', () => {
    expect(resolveDropStatus(TASKS, 't1', 'backlog')).toBeNull();
  });

  it('returns null for an unknown active task or a null over target', () => {
    expect(resolveDropStatus(TASKS, 'nope', 'done')).toBeNull();
    expect(resolveDropStatus(TASKS, 't1', null)).toBeNull();
  });
});

describe('bucketTasks', () => {
  it('buckets tasks by status under every lifecycle key, sorted by position', () => {
    const buckets = bucketTasks(TASKS);
    expect(Object.keys(buckets)).toEqual([...STATUS_LIFECYCLE]);
    expect(buckets.backlog.map((t) => t.id)).toEqual(['t1']);
    expect(buckets.todo.map((t) => t.id)).toEqual(['t2']);
    expect(buckets.done.map((t) => t.id)).toEqual(['t4']);
    expect(buckets.blocked).toEqual([]);
  });
});

function renderBoard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BoardView />
    </QueryClientProvider>,
  );
}

describe('BoardView', () => {
  beforeEach(() => {
    listTasks.mockReset().mockResolvedValue(TASKS);
    setTaskStatus.mockClear();
  });

  it('renders one column per status in lifecycle order with correct counts', async () => {
    renderBoard();

    await screen.findByText('Backlog item');
    const columns = screen.getAllByTestId(/^board-column-/);
    expect(columns.map((c) => c.getAttribute('data-testid'))).toEqual(
      STATUS_LIFECYCLE.map((s) => `board-column-${s}`),
    );

    const doneColumn = screen.getByTestId('board-column-done');
    expect(doneColumn).toHaveTextContent('Done item');

    const cancelledColumn = screen.getByTestId('board-column-cancelled');
    expect(cancelledColumn).toHaveTextContent('0');
  });

  it('exposes stable data-testids for e2e targeting', async () => {
    renderBoard();
    expect(await screen.findByTestId('task-card-t1')).toBeInTheDocument();
    expect(screen.getByTestId('board-column-backlog')).toBeInTheDocument();
  });
});
