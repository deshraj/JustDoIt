import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuickAddBar } from './quick-add-bar';

const quickAdd = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { quickAdd: (...a: unknown[]) => quickAdd(...a) },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

function renderBar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <QuickAddBar />
    </QueryClientProvider>,
  );
}

describe('QuickAddBar', () => {
  beforeEach(() => {
    quickAdd.mockReset().mockResolvedValue({
      id: 't9',
      title: 'pay rent',
      dueAt: new Date('2026-07-10T09:00:00Z'),
      priority: 'p1',
    });
    toastSuccess.mockClear();
    toastError.mockClear();
  });

  it('Enter submits the exact text, clears the input, and shows a success toast', async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByLabelText('Quick add a task');
    await user.type(input, 'pay rent friday #home p1{Enter}');

    expect(quickAdd).toHaveBeenCalledWith('pay rent friday #home p1');
    expect(input).toHaveValue('');
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('an empty submit is a no-op', async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByLabelText('Quick add a task');
    input.focus();
    await user.keyboard('{Enter}');

    expect(quickAdd).not.toHaveBeenCalled();
  });

  it('Escape clears the input without submitting', async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByLabelText('Quick add a task');
    await user.type(input, 'draft text');
    await user.keyboard('{Escape}');

    expect(input).toHaveValue('');
    expect(quickAdd).not.toHaveBeenCalled();
  });
});
