import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

describe('middleware (local mode bypass)', () => {
  const prev = { ...process.env };
  beforeEach(() => {
    delete process.env.JUSTDOIT_MODE;
    delete process.env.AUTH_GITHUB_ID;
  });
  afterEach(() => {
    process.env = { ...prev };
    vi.resetModules();
  });

  it('does not redirect when auth is disabled', async () => {
    const { default: middleware } = await import('./middleware');
    const res = await middleware(new NextRequest('http://localhost:3000/tasks'));
    // NextResponse.next() ⇒ no redirect Location header
    expect(res.headers.get('location')).toBeNull();
    expect(res.status).toBe(200);
  });
});
