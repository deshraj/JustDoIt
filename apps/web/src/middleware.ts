import { NextResponse, type NextRequest } from 'next/server';
import { isAuthEnabled, shouldRedirect } from '@/lib/auth-config';

export default async function middleware(req: NextRequest): Promise<NextResponse> {
  if (!isAuthEnabled()) return NextResponse.next(); // local: zero-login

  // Import lazily so the local path never initializes Auth.js.
  const { auth } = await import('@/auth');
  const session = await auth();
  if (shouldRedirect(req.nextUrl.pathname, Boolean(session?.user?.id), true)) {
    const url = req.nextUrl.clone();
    url.pathname = '/signin';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Exclude static assets + the auth API from the matcher.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|ico)$).*)'],
};
