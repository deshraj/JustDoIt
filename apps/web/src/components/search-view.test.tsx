import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Task } from '@/lib/api';
import { SearchView } from './search-view';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/search',
  useSearchParams: () => new URLSearchParams(),
}));

const search = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { search: (...a: unknown[]) => search(...a), listTaskTags: vi.fn().mockResolvedValue([]) },
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

function renderSearch() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SearchView />
    </QueryClientProvider>,
  );
}

describe('SearchView', () => {
  beforeEach(() => {
    search.mockReset();
    replace.mockClear();
  });

  it('shows a hint before any query is entered', () => {
    renderSearch();
    expect(screen.getByText('Start typing to search your tasks.')).toBeInTheDocument();
  });

  it('after debounce, calls search with the term and renders result titles', async () => {
    search.mockResolvedValue([makeTask({ id: 't1', title: 'buy milk' })]);
    const user = userEvent.setup();
    renderSearch();

    await user.type(screen.getByLabelText('Search tasks'), 'milk');

    await waitFor(() => expect(search).toHaveBeenCalledWith('milk'), { timeout: 2000 });
    // The matched substring is wrapped in <mark> (see TaskRow's
    // highlightQuery), so the full title is split across text nodes —
    // assert on the row's accessible link rather than an exact text match.
    const row = await screen.findByRole('link', { name: /buy.*milk/ });
    expect(row).toBeInTheDocument();
    expect(row.querySelector('mark')).toHaveTextContent('milk');
  });

  it('clearing the query shows the hint again', async () => {
    search.mockResolvedValue([makeTask({ id: 't1', title: 'buy milk' })]);
    const user = userEvent.setup();
    renderSearch();

    const input = screen.getByLabelText('Search tasks');
    await user.type(input, 'milk');
    await waitFor(() => expect(search).toHaveBeenCalledWith('milk'), { timeout: 2000 });

    await user.clear(input);
    await waitFor(() =>
      expect(screen.getByText('Start typing to search your tasks.')).toBeInTheDocument(),
    );
  });

  it('shows a calm empty state when a query has no results', async () => {
    search.mockResolvedValue([]);
    const user = userEvent.setup();
    renderSearch();

    await user.type(screen.getByLabelText('Search tasks'), 'zzz');
    await waitFor(() => expect(search).toHaveBeenCalledWith('zzz'), { timeout: 2000 });

    expect(await screen.findByText('No tasks match “zzz”.')).toBeInTheDocument();
  });
});
