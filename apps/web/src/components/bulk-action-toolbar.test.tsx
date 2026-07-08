import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BulkActionToolbar } from './bulk-action-toolbar';

const bulkUpdateTasks = vi.fn();
const bulkDeleteTasks = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    bulkUpdateTasks: (...a: unknown[]) => bulkUpdateTasks(...a),
    bulkDeleteTasks: (...a: unknown[]) => bulkDeleteTasks(...a),
  },
}));

const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { error: (...a: unknown[]) => toastError(...a) },
}));

beforeEach(() => {
  bulkUpdateTasks.mockReset().mockResolvedValue([]);
  bulkDeleteTasks.mockReset().mockResolvedValue({ deleted: 2 });
  toastError.mockClear();
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('BulkActionToolbar', () => {
  it('shows the selection count and sends a bulk delete', async () => {
    wrap(<BulkActionToolbar selectedIds={['a', 'b']} onDone={() => {}} />);
    expect(screen.getByText(/2 selected/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => expect(bulkDeleteTasks).toHaveBeenCalledWith(['a', 'b']));
  });

  it('sends a status change', async () => {
    wrap(<BulkActionToolbar selectedIds={['a']} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /mark done/i }));
    await waitFor(() => expect(bulkUpdateTasks).toHaveBeenCalledWith(['a'], { status: 'done' }));
  });

  it('renders nothing when there is no selection', () => {
    const { container } = wrap(<BulkActionToolbar selectedIds={[]} onDone={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an error toast when the bulk delete request fails', async () => {
    bulkDeleteTasks.mockReset().mockRejectedValue(new Error('network down'));
    wrap(<BulkActionToolbar selectedIds={['a', 'b']} onDone={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});
