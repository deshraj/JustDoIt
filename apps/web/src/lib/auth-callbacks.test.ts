import { describe, it, expect, vi } from 'vitest';
import { upsertUser } from './auth-callbacks';

describe('upsertUser', () => {
  it('POSTs to the internal endpoint with the shared secret and returns id', async () => {
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ id: 'user-123' }), { status: 200 }),
    );
    const id = await upsertUser(
      fetchFn as unknown as typeof fetch,
      {
        base: 'http://api.internal',
        secret: 's3cret',
      },
      { githubId: '42', email: 'a@x.dev', name: 'A', avatarUrl: null },
    );

    expect(id).toBe('user-123');
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('http://api.internal/internal/users');
    expect((init as RequestInit).method).toBe('POST');
    expect((init!.headers as Record<string, string>)['X-Internal-Key']).toBe('s3cret');
  });

  it('throws on a non-OK upstream response', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response('nope', { status: 500 }));
    await expect(
      upsertUser(
        fetchFn as unknown as typeof fetch,
        { base: 'http://api', secret: 's' },
        {
          githubId: '1',
          email: null,
          name: null,
          avatarUrl: null,
        },
      ),
    ).rejects.toThrow(/500/);
  });
});
