import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InlineTimer } from './inline-timer';

const listTimeEntries = vi.fn();
const startTimer = vi.fn().mockResolvedValue({});
const stopTimer = vi.fn().mockResolvedValue({});

vi.mock('@/lib/api', () => ({
  api: {
    listTimeEntries: (...args: unknown[]) => listTimeEntries(...args),
    startTimer: (...args: unknown[]) => startTimer(...args),
    stopTimer: (...args: unknown[]) => stopTimer(...args),
  },
}));

const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { error: (...a: unknown[]) => toastError(...a) },
}));

function renderTimer(taskId = 't1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <InlineTimer taskId={taskId} />
    </QueryClientProvider>,
  );
}

describe('InlineTimer', () => {
  beforeEach(() => {
    listTimeEntries.mockReset();
    startTimer.mockClear();
    stopTimer.mockClear();
    toastError.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('with no running entry, clicking Start calls startTimer(taskId); button is keyboard-operable', async () => {
    listTimeEntries.mockResolvedValue([]);
    const user = userEvent.setup();
    renderTimer('t1');

    const startButton = await screen.findByRole('button', { name: /start/i });
    startButton.focus();
    await user.keyboard('{Enter}');

    expect(startTimer).toHaveBeenCalledWith('t1');
  });

  it('with a running entry, renders elapsed time and Stop calls stopTimer(taskId)', async () => {
    // Real timers (fake timers deadlock RTL's findBy polling with React
    // Query's own internal timers); anchor startedAt relative to real
    // Date.now() so the elapsed-time assertion is deterministic regardless
    // of when the test actually runs.
    const startedAt = new Date(Date.now() - 65_000);
    listTimeEntries.mockResolvedValue([
      {
        id: 'e1',
        taskId: 't1',
        startedAt,
        endedAt: null,
        durationSeconds: null,
        note: null,
        source: 'timer',
        createdAt: startedAt,
        updatedAt: startedAt,
      },
    ]);

    const user = userEvent.setup();
    renderTimer('t1');

    expect(await screen.findByText('01:05')).toBeInTheDocument();

    const stopButton = screen.getByRole('button', { name: /stop/i });
    stopButton.focus();
    await user.keyboard('{Enter}');

    expect(stopTimer).toHaveBeenCalledWith('t1');
  });

  it('shows an error toast when starting the timer fails', async () => {
    listTimeEntries.mockResolvedValue([]);
    startTimer.mockRejectedValueOnce(new Error('server error'));
    const user = userEvent.setup();
    renderTimer('t1');

    const startButton = await screen.findByRole('button', { name: /start/i });
    await user.click(startButton);

    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});
