import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'user-A' } })) }));

describe('backend proxy', () => {
  const prev = { ...process.env };
  beforeEach(() => {
    process.env.JUSTDOIT_MODE = 'hosted';
    process.env.INTERNAL_API_URL = 'http://api.internal:8787';
    process.env.INTERNAL_API_SECRET = 's3cret';
  });
  afterEach(() => {
    process.env = { ...prev };
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('forwards to the internal API with X-User-Id and X-Internal-Key', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    const { GET } = await import('./route');

    const req = new NextRequest('http://localhost:3000/api/backend/tasks?status=todo');
    const res = await GET(req, { params: Promise.resolve({ path: ['tasks'] }) });

    expect(res.status).toBe(200);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://api.internal:8787/tasks?status=todo');
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('X-User-Id')).toBe('user-A');
    expect(headers.get('X-Internal-Key')).toBe('s3cret');
    expect(headers.get('cookie')).toBeNull();
  });

  it('returns 401 when hosted and there is no session', async () => {
    const authMod = await import('@/auth');
    (authMod.auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const { GET } = await import('./route');
    const res = await GET(new NextRequest('http://localhost:3000/api/backend/tasks'), {
      params: Promise.resolve({ path: ['tasks'] }),
    });
    expect(res.status).toBe(401);
  });
});
