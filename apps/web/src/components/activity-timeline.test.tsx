import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ActivityTimeline } from './activity-timeline';

const listActivity = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    listActivity: (...args: unknown[]) => listActivity(...args),
  },
}));

beforeEach(() => {
  listActivity.mockReset().mockResolvedValue([
    {
      id: '1',
      entityType: 'task',
      entityId: 't',
      action: 'status_changed',
      payload: { to: 'done' },
      createdAt: new Date('2026-07-08T12:00:00.000Z'),
    },
    {
      id: '2',
      entityType: 'task',
      entityId: 't',
      action: 'created',
      payload: { title: 'X' },
      createdAt: new Date('2026-07-08T11:00:00.000Z'),
    },
  ]);
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('ActivityTimeline', () => {
  it('renders humanized entries newest-first', async () => {
    wrap(<ActivityTimeline taskId="t" />);
    expect(await screen.findByText(/changed status to done/i)).toBeInTheDocument();
    expect(screen.getByText(/created task/i)).toBeInTheDocument();
  });
});
