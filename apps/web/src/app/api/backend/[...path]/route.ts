import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';
import { isAuthEnabled } from '@/lib/auth-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STRIP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'cookie',
]);

async function handler(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const base = process.env.INTERNAL_API_URL;
  const secret = process.env.INTERNAL_API_SECRET;
  if (!base || !secret) {
    return NextResponse.json({ error: 'proxy not configured' }, { status: 500 });
  }

  let userId = 'local-user';
  if (isAuthEnabled()) {
    const session = await auth();
    const id = session?.user?.id;
    if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    userId = id;
  }

  const { path } = await ctx.params;
  const target = `${base}/${path.join('/')}${req.nextUrl.search}`;

  const headers = new Headers(req.headers);
  for (const h of STRIP) headers.delete(h);
  headers.set('X-User-Id', userId);
  headers.set('X-Internal-Key', secret);

  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method,
    headers,
    redirect: 'manual',
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req.body;
    init.duplex = 'half'; // required to stream a request body through Node's fetch
  }

  const upstream = await fetch(target, init);
  const respHeaders = new Headers(upstream.headers);
  for (const h of STRIP) respHeaders.delete(h);
  // Passing through `upstream.body` (a ReadableStream) streams JSON, file
  // downloads, and SSE (/events) without buffering.
  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
export const HEAD = handler;
