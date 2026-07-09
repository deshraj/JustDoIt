import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ApiKeysSettings } from './api-keys-settings';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('ApiKeysSettings', () => {
  beforeEach(() => {
    vi.spyOn(api, 'listApiKeys').mockResolvedValue([
      { id: 'k1', name: 'laptop', createdAt: new Date(), lastUsedAt: null },
    ]);
    vi.spyOn(api, 'createApiKey').mockResolvedValue({
      raw: 'jdi_live_ABC123SECRET',
      key: { id: 'k2', name: 'ci', createdAt: new Date(), lastUsedAt: null },
    });
    vi.spyOn(api, 'revokeApiKey').mockResolvedValue(undefined);
  });

  it('lists existing keys', async () => {
    wrap(<ApiKeysSettings />);
    expect(await screen.findByText('laptop')).toBeInTheDocument();
  });

  it('creates a key and shows the raw token exactly once', async () => {
    wrap(<ApiKeysSettings />);
    await userEvent.type(await screen.findByLabelText(/key name/i), 'ci');
    await userEvent.click(screen.getByRole('button', { name: /create key/i }));
    expect(await screen.findByText('jdi_live_ABC123SECRET')).toBeInTheDocument();
    expect(api.createApiKey).toHaveBeenCalledWith('ci');
  });

  it('revokes a key', async () => {
    wrap(<ApiKeysSettings />);
    await screen.findByText('laptop');
    await userEvent.click(screen.getByRole('button', { name: /revoke/i }));
    await waitFor(() => expect(api.revokeApiKey).toHaveBeenCalledWith('k1'));
  });
});
