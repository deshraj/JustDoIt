import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Task } from '@/lib/api';
import { ListView } from './list-view';

const routerReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/tasks',
  useRouter: () => ({ replace: routerReplace }),
}));

const listTasks = vi.fn();
const completeTask = vi.fn().mockResolvedValue({});
const setTaskStatus = vi.fn().mockResolvedValue({});

vi.mock('@/lib/api', () => ({
  api: {
    listTasks: (...args: unknown[]) => listTasks(...args),
    listProjects: vi.fn().mockResolvedValue([]),
    completeTask: (...args: unknown[]) => completeTask(...args),
    setTaskStatus: (...args: unknown[]) => setTaskStatus(...args),
    updateTask: vi.fn().mockResolvedValue({}),
    listSavedFilters: vi.fn().mockResolvedValue([]),
    createSavedFilter: vi.fn().mockResolvedValue({}),
    deleteSavedFilter: vi.fn().mockResolvedValue(undefined),
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
  makeTask({ id: 't1', title: 'Task One', status: 'todo', position: 1 }),
  makeTask({ id: 't2', title: 'Task Two', status: 'todo', position: 2 }),
  makeTask({ id: 't3', title: 'Task Three', status: 'done', position: 3 }),
];

function renderListView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ListView />
    </QueryClientProvider>,
  );
}

describe('ListView', () => {
  beforeEach(() => {
    listTasks.mockReset().mockResolvedValue(TASKS);
    completeTask.mockClear();
    setTaskStatus.mockClear();
    routerReplace.mockClear();
  });

  it('groups tasks by status and shows a header with a count per group', async () => {
    renderListView();

    expect(await screen.findByText('Task One')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Todo \(2\)/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Done \(1\)/ })).toBeInTheDocument();

    const todoSection =
      screen.getByRole('region', { name: 'Todo' }) ?? screen.getByLabelText('Todo');
    expect(within(todoSection).getByText('Task One')).toBeInTheDocument();
    expect(within(todoSection).getByText('Task Two')).toBeInTheDocument();
  });

  it('toggling a row checkbox calls completeTask with that task id', async () => {
    const user = userEvent.setup();
    renderListView();

    await screen.findByText('Task One');
    const checkbox = screen.getByRole('checkbox', { name: /Mark "Task One" as done/ });
    await user.click(checkbox);

    expect(completeTask).toHaveBeenCalledWith('t1');
  });

  it('changing the status filter updates the URL (which drives a refetch with the new param)', async () => {
    const user = userEvent.setup();
    renderListView();

    await screen.findByText('Task One');
    await user.click(screen.getByRole('combobox', { name: 'Filter by status' }));
    const option = await screen.findByRole('option', { name: 'Done' });
    await user.click(option);

    await waitFor(() => expect(routerReplace).toHaveBeenCalled());
    const [url] = routerReplace.mock.calls.at(-1) as [string];
    expect(new URL(url, 'http://x').searchParams.get('status')).toBe('done');
  });
});
