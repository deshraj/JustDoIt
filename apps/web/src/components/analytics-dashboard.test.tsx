import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Task, TimeReport, TimeReportParams } from '@/lib/api';
import { AnalyticsDashboard } from './analytics-dashboard';

const getTimeReport = vi.fn();
const listTasks = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    getTimeReport: (...a: unknown[]) => getTimeReport(...a),
    listTasks: (...a: unknown[]) => listTasks(...a),
  },
}));

function makeReport(overrides: Partial<TimeReport> = {}): TimeReport {
  return {
    groupBy: 'day',
    from: null,
    to: null,
    totalSeconds: 0,
    buckets: [],
    estimateVsActual: [],
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 't0',
    title: 'Untitled',
    description: null,
    status: 'done',
    priority: null,
    projectId: null,
    parentTaskId: null,
    position: 0,
    dueAt: null,
    startAt: null,
    estimateMinutes: null,
    recurrence: null,
    completedAt: new Date(),
    archived: false,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AnalyticsDashboard />
    </QueryClientProvider>,
  );
}

describe('AnalyticsDashboard', () => {
  beforeEach(() => {
    getTimeReport.mockReset().mockImplementation((params: TimeReportParams) => {
      if (params.groupBy === 'day') {
        return Promise.resolve(
          makeReport({
            groupBy: 'day',
            totalSeconds: 3600,
            buckets: [
              { key: '2026-07-01', label: '2026-07-01', totalSeconds: 3600, entryCount: 1 },
            ],
            estimateVsActual: [
              {
                taskId: 't1',
                title: 'Write plan',
                estimateMinutes: 60,
                actualSeconds: 3600,
                actualMinutes: 60,
                varianceMinutes: 0,
              },
            ],
          }),
        );
      }
      if (params.groupBy === 'project') {
        return Promise.resolve(
          makeReport({
            groupBy: 'project',
            buckets: [{ key: 'p1', label: 'Work', totalSeconds: 3600, entryCount: 1 }],
          }),
        );
      }
      return Promise.resolve(
        makeReport({
          groupBy: 'tag',
          buckets: [{ key: 'dev', label: 'dev', totalSeconds: 3600, entryCount: 1 }],
        }),
      );
    });
    listTasks.mockReset().mockResolvedValue([makeTask({ id: 't1', completedAt: new Date() })]);
  });

  it("renders every chart's accessible title and correct stat-tile aggregates", async () => {
    renderDashboard();

    // Headings render immediately; wait for the data-dependent stat tile
    // instead, so the assertions below see loaded data too.
    await waitFor(() =>
      expect(screen.getByText('Total tracked').nextSibling).toHaveTextContent('1h'),
    );
    expect(screen.getByText('Tasks completed').nextSibling).toHaveTextContent('1');

    expect(screen.getByRole('heading', { name: 'Time tracked per day' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Time per project' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Time per tag' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Estimate vs actual' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Throughput (completed per day)' }),
    ).toBeInTheDocument();

    // sr-only data-table fallback (per the plan: assert ARIA/table, not SVG).
    expect(screen.getAllByText('2026-07-01').length).toBeGreaterThan(0);
    expect(screen.getByText('Work')).toBeInTheDocument();
  });

  it('changing the date range refetches the reports with a new from/to', async () => {
    const user = userEvent.setup();
    renderDashboard();

    await screen.findByRole('heading', { name: 'Time tracked per day' });
    const dayCalls = () =>
      (getTimeReport.mock.calls as [TimeReportParams][]).filter(
        (call) => call[0].groupBy === 'day',
      );
    const firstCall = dayCalls()[0]![0];
    getTimeReport.mockClear();

    await user.click(screen.getByRole('button', { name: '90d' }));

    await waitFor(() => expect(getTimeReport).toHaveBeenCalled());
    const secondCall = dayCalls()[0]![0];

    expect(secondCall.from).not.toEqual(firstCall.from);
  });
});
