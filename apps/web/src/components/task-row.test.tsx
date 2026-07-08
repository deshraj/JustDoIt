import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Task } from '@/lib/api';
import { TaskRow } from './task-row';

const completeTask = vi.fn().mockResolvedValue({});
const setTaskStatus = vi.fn().mockResolvedValue({});
const listTaskTags = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    completeTask: (...a: unknown[]) => completeTask(...a),
    setTaskStatus: (...a: unknown[]) => setTaskStatus(...a),
    listTaskTags: (...a: unknown[]) => listTaskTags(...a),
  },
}));

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 't1',
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

function renderRow(task: Task) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TaskRow task={task} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listTaskTags.mockReset().mockResolvedValue([]);
});

describe('TaskRow tag pills', () => {
  it('renders no pills when the task has no tags', async () => {
    renderRow(makeTask({ id: 't1', title: 'No tags here' }));
    await screen.findByText('No tags here');
    expect(screen.queryByText('urgent')).toBeNull();
  });

  it("renders the task's tag names as pills", async () => {
    listTaskTags.mockResolvedValue([
      { id: 'tag1', name: 'urgent', color: '#f97316', createdAt: '', updatedAt: '' },
      { id: 'tag2', name: 'home', color: null, createdAt: '', updatedAt: '' },
    ]);
    renderRow(makeTask({ id: 't1', title: 'Buy milk' }));

    expect(await screen.findByText('urgent')).toBeInTheDocument();
    expect(screen.getByText('home')).toBeInTheDocument();
    expect(listTaskTags).toHaveBeenCalledWith('t1');
  });
});
