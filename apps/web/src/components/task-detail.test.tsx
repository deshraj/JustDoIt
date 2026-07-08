import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Task } from '@/lib/api';
import { TaskDetail } from './task-detail';

const getTask = vi.fn();
const updateTask = vi.fn();
const listSubtasks = vi.fn();
const createSubtask = vi.fn();
const listTags = vi.fn();
const listTaskTags = vi.fn();
const listTimeEntries = vi.fn();
const completeTask = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    getTask: (...a: unknown[]) => getTask(...a),
    updateTask: (...a: unknown[]) => updateTask(...a),
    listSubtasks: (...a: unknown[]) => listSubtasks(...a),
    createSubtask: (...a: unknown[]) => createSubtask(...a),
    listTags: (...a: unknown[]) => listTags(...a),
    listTaskTags: (...a: unknown[]) => listTaskTags(...a),
    listTimeEntries: (...a: unknown[]) => listTimeEntries(...a),
    completeTask: (...a: unknown[]) => completeTask(...a),
  },
}));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Write the plan',
    description: '**bold** text',
    status: 'todo',
    priority: null,
    projectId: null,
    parentTaskId: null,
    position: 1,
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

function renderDetail(taskId = 't1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TaskDetail taskId={taskId} />
    </QueryClientProvider>,
  );
}

describe('TaskDetail', () => {
  beforeEach(() => {
    getTask.mockReset().mockResolvedValue(makeTask());
    updateTask.mockReset().mockResolvedValue(makeTask());
    listSubtasks.mockReset().mockResolvedValue([]);
    createSubtask.mockReset().mockResolvedValue(makeTask({ id: 's1', title: 'a subtask' }));
    listTags.mockReset().mockResolvedValue([]);
    listTaskTags.mockReset().mockResolvedValue([]);
    listTimeEntries.mockReset().mockResolvedValue([]);
    completeTask.mockReset().mockResolvedValue(makeTask({ status: 'done' }));
  });

  it('renders **bold** markdown as <strong> in the Preview tab', async () => {
    const user = userEvent.setup();
    renderDetail();

    await screen.findByLabelText('Task title');
    await user.click(screen.getByRole('tab', { name: 'Preview' }));

    const strong = await screen.findByText('bold');
    expect(strong.tagName).toBe('STRONG');
  });

  it('adding a subtask calls createSubtask with the parent id and title', async () => {
    const user = userEvent.setup();
    renderDetail();

    const input = await screen.findByLabelText('Add a subtask');
    await user.type(input, 'a subtask{Enter}');

    expect(createSubtask).toHaveBeenCalledWith('t1', { title: 'a subtask' });
  });

  it('selecting a priority calls updateTask with { priority }', async () => {
    const user = userEvent.setup();
    renderDetail();

    await screen.findByLabelText('Task title');
    await user.click(screen.getByRole('combobox', { name: 'Priority' }));
    const option = await screen.findByRole('option', { name: 'High' });
    await user.click(option);

    expect(updateTask).toHaveBeenCalledWith('t1', { priority: 'p1' });
  });
});
