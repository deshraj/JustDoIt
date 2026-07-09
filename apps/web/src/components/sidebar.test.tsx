import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Sidebar } from './sidebar';

vi.mock('next/navigation', () => ({
  usePathname: () => '/tasks',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/lib/api', () => ({
  api: {
    listProjects: vi.fn().mockResolvedValue([
      { id: 'inbox', name: 'Inbox' },
      { id: 'p1', name: 'Work' },
    ]),
    createProject: vi.fn(),
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

  it('has a Settings link and a New project button', async () => {
    renderWithClient(<Sidebar />);
    await screen.findByRole('link', { name: 'Inbox' });
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('button', { name: 'New project' })).toBeInTheDocument();
  });
});
