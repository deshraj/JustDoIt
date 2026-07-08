import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Sidebar } from './sidebar';

vi.mock('next/navigation', () => ({
  usePathname: () => '/tasks',
}));

vi.mock('@/lib/api', () => ({
  api: {
    listProjects: vi.fn().mockResolvedValue([
      { id: 'inbox', name: 'Inbox' },
      { id: 'p1', name: 'Work' },
    ]),
  },
}));

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('Sidebar', () => {
  it('renders the five view links and the fetched projects, each linking correctly', async () => {
    renderWithClient(<Sidebar />);

    for (const label of ['List', 'Board', 'Calendar', 'Search', 'Analytics']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }

    expect(await screen.findByRole('link', { name: 'Inbox' })).toHaveAttribute(
      'href',
      '/tasks?project=inbox',
    );
    expect(screen.getByRole('link', { name: 'Work' })).toHaveAttribute('href', '/tasks?project=p1');
  });
});
