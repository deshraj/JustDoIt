import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Task } from '@/lib/api';
import {
  BoardView,
  STATUS_LIFECYCLE,
  bucketTasks,
  resolveDropStatus,
  resolveReorderPosition,
  runDragEnd,
} from './board-view';

const listTasks = vi.fn();
const setTaskStatus = vi.fn().mockResolvedValue({});
const updateTask = vi.fn().mockResolvedValue({});

vi.mock('@/lib/api', () => ({
  api: {
    listTasks: (...a: unknown[]) => listTasks(...a),
    listProjects: vi.fn().mockResolvedValue([]),
    setTaskStatus: (...a: unknown[]) => setTaskStatus(...a),
    updateTask: (...a: unknown[]) => updateTask(...a),
    listTaskTags: vi.fn().mockResolvedValue([]),
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

// A second "todo" task so there's something to reorder against —
// TASKS above has exactly one task per column, which is enough for
// resolveDropStatus but not for exercising same-column reordering.
const REORDER_TASKS: Task[] = [
  ...TASKS,
  makeTask({ id: 't5', title: 'Todo item 2', status: 'todo', position: 2 }),
];

describe('resolveReorderPosition (pure, extracted onDragEnd logic)', () => {
  it('dropping onto an earlier sibling in the same column slots in just before it', () => {
    // t5 (position 2) dropped onto t2 (position 1): only sibling is t2, so
    // the new position lands just before it.
    expect(resolveReorderPosition(REORDER_TASKS, 't5', 't2')).toBe(0);
  });

  it('dropping onto a later sibling in the same column slots in just before it too', () => {
    // t2 (position 1) dropped onto t5 (position 2): only sibling is t5.
    expect(resolveReorderPosition(REORDER_TASKS, 't2', 't5')).toBe(1);
  });

  it('dropping in the column’s own empty space appends to the end', () => {
    // t2 dropped on the "todo" column itself (not on a specific card):
    // append after its only remaining sibling, t5 (position 2).
    expect(resolveReorderPosition(REORDER_TASKS, 't2', 'todo')).toBe(3);
  });

  it('returns the midpoint when there are neighbors on both sides', () => {
    const tasks: Task[] = [
      makeTask({ id: 'a', status: 'todo', position: 0 }),
      makeTask({ id: 'b', status: 'todo', position: 10 }),
      makeTask({ id: 'c', status: 'todo', position: 20 }),
    ];
    // 'c' dropped onto 'b': siblings (excluding 'c') are [a(0), b(10)];
    // 'b' is at index 1, so the new slot is between a and b.
    expect(resolveReorderPosition(tasks, 'c', 'b')).toBe(5);
  });

  it('returns null for a cross-column drop (handled by resolveDropStatus instead)', () => {
    expect(resolveReorderPosition(TASKS, 't1', 'done')).toBeNull();
  });

  it('returns null for an unknown active task, dropping on itself, or a null target', () => {
    expect(resolveReorderPosition(TASKS, 'nope', 't2')).toBeNull();
    expect(resolveReorderPosition(TASKS, 't1', 't1')).toBeNull();
    expect(resolveReorderPosition(TASKS, 't1', null)).toBeNull();
  });

  it('returns null when dropped in its own column and there are no siblings to reorder against', () => {
    expect(resolveReorderPosition(TASKS, 't1', 'backlog')).toBeNull();
  });
});

describe('runDragEnd (drag-end handler, extracted for testability without a real DnD backend)', () => {
  function makeDeps() {
    return {
      setStatus: vi.fn(),
      updateTask: vi.fn(),
      announce: vi.fn(),
    };
  }

  it('on a cross-column drop, calls setStatus and not updateTask', () => {
    const deps = makeDeps();
    runDragEnd(TASKS, 't1', 'done', deps);
    expect(deps.setStatus).toHaveBeenCalledWith({ id: 't1', status: 'done' });
    expect(deps.updateTask).not.toHaveBeenCalled();
    expect(deps.announce).toHaveBeenCalledWith(expect.stringContaining('done'));
  });

  it('on an intra-column reorder, calls updateTask with the new position and not setStatus', () => {
    const deps = makeDeps();
    runDragEnd(REORDER_TASKS, 't5', 't2', deps);
    expect(deps.updateTask).toHaveBeenCalledWith({ id: 't5', patch: { position: 0 } });
    expect(deps.setStatus).not.toHaveBeenCalled();
  });

  it('on a genuine no-op drop, calls neither mutation', () => {
    const deps = makeDeps();
    runDragEnd(TASKS, 't1', 'backlog', deps);
    expect(deps.setStatus).not.toHaveBeenCalled();
    expect(deps.updateTask).not.toHaveBeenCalled();
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
    updateTask.mockClear();
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
