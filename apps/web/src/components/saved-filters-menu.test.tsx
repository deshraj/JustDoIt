import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SavedFiltersMenu } from './saved-filters-menu';

const listSavedFilters = vi.fn();
const createSavedFilter = vi.fn();
const deleteSavedFilter = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    listSavedFilters: (...a: unknown[]) => listSavedFilters(...a),
    createSavedFilter: (...a: unknown[]) => createSavedFilter(...a),
    deleteSavedFilter: (...a: unknown[]) => deleteSavedFilter(...a),
  },
}));

beforeEach(() => {
  listSavedFilters
    .mockReset()
    .mockResolvedValue([
      { id: 's1', name: 'Today', query: { due: 'today' }, createdAt: '', updatedAt: '' },
    ]);
  createSavedFilter.mockReset().mockResolvedValue({});
  deleteSavedFilter.mockReset().mockResolvedValue(undefined);
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('SavedFiltersMenu', () => {
  it('lists saved views and applies one on click', async () => {
    const onApply = vi.fn();
    wrap(<SavedFiltersMenu current={{}} onApply={onApply} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Today' }));
    expect(onApply).toHaveBeenCalledWith({ due: 'today' });
  });

  it('saving the current view calls createSavedFilter with the name and query', async () => {
    wrap(<SavedFiltersMenu current={{ status: 'done' }} onApply={() => {}} />);
    const input = await screen.findByLabelText('Saved view name');
    fireEvent.change(input, { target: { value: 'My view' } });
    fireEvent.click(screen.getByRole('button', { name: /save view/i }));
    await waitFor(() =>
      expect(createSavedFilter).toHaveBeenCalledWith({
        name: 'My view',
        query: { status: 'done' },
      }),
    );
  });
});
