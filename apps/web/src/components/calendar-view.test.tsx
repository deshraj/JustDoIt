import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Task } from '@/lib/api';
import { CalendarView } from './calendar-view';

const listTasks = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    listTasks: (...a: unknown[]) => listTasks(...a),
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

// Local-time constructors throughout (not UTC ISO strings): CalendarView and
// date-fns both operate in local time, and the test environment's timezone
// isn't UTC, so `new Date('2026-08-01T00:00:00Z')` can land on a different
// local calendar day than intended.
const AUGUST_5 = new Date(2026, 7, 5, 9, 0);
const AUGUST_15 = new Date(2026, 7, 15, 9, 0);

const TASKS: Task[] = [
  makeTask({ id: 'a1', title: 'Aug5 one', dueAt: AUGUST_5 }),
  makeTask({ id: 'a2', title: 'Aug5 two', dueAt: AUGUST_5 }),
  makeTask({ id: 'a3', title: 'Aug5 three', dueAt: AUGUST_5 }),
  makeTask({ id: 'a4', title: 'Aug5 four', dueAt: AUGUST_5 }),
  makeTask({ id: 'b1', title: 'Aug15 solo', dueAt: AUGUST_15 }),
];

function renderCalendar(initialMonth = new Date(2026, 7, 1)) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CalendarView initialMonth={initialMonth} />
    </QueryClientProvider>,
  );
}

describe('CalendarView', () => {
  beforeEach(() => {
    listTasks.mockReset().mockResolvedValue(TASKS);
  });

  it('renders the pinned month and places tasks in their due-date cells', async () => {
    renderCalendar();

    expect(await screen.findByRole('heading', { name: 'August 2026' })).toBeInTheDocument();

    const day5 = await screen.findByTestId('calendar-day-2026-08-05');
    expect(within(day5).getByText('Aug5 one')).toBeInTheDocument();
    expect(within(day5).getByText('Aug5 two')).toBeInTheDocument();
    expect(within(day5).getByText('Aug5 three')).toBeInTheDocument();

    const day15 = screen.getByTestId('calendar-day-2026-08-15');
    expect(within(day15).getByText('Aug15 solo')).toBeInTheDocument();
  });

  it('shows "+N more" once a day exceeds the visible cap', async () => {
    renderCalendar();
    const day5 = await screen.findByTestId('calendar-day-2026-08-05');
    expect(within(day5).getByText('+1 more')).toBeInTheDocument();

    const day15 = screen.getByTestId('calendar-day-2026-08-15');
    expect(within(day15).queryByText(/more/)).not.toBeInTheDocument();
  });

  it('clicking next month refetches with a shifted due range', async () => {
    const user = userEvent.setup();
    renderCalendar();

    await screen.findByRole('heading', { name: 'August 2026' });
    const [initialFilters] = listTasks.mock.calls[0] as [{ dueFrom: Date; dueTo: Date }];

    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await screen.findByRole('heading', { name: 'September 2026' });

    const [shiftedFilters] = listTasks.mock.calls.at(-1) as [{ dueFrom: Date; dueTo: Date }];
    expect(shiftedFilters.dueFrom.getTime()).toBeGreaterThan(initialFilters.dueFrom.getTime());
    expect(shiftedFilters.dueTo.getTime()).toBeGreaterThan(initialFilters.dueTo.getTime());
  });

  it('clicking previous month refetches with a shifted due range', async () => {
    const user = userEvent.setup();
    renderCalendar();

    await screen.findByRole('heading', { name: 'August 2026' });
    const [initialFilters] = listTasks.mock.calls[0] as [{ dueFrom: Date; dueTo: Date }];

    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    await screen.findByRole('heading', { name: 'July 2026' });

    const [shiftedFilters] = listTasks.mock.calls.at(-1) as [{ dueFrom: Date; dueTo: Date }];
    expect(shiftedFilters.dueFrom.getTime()).toBeLessThan(initialFilters.dueFrom.getTime());
    expect(shiftedFilters.dueTo.getTime()).toBeLessThan(initialFilters.dueTo.getTime());
  });
});
