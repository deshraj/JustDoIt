type Env = Record<string, string | undefined>;

export function isAuthEnabled(env: Env = process.env): boolean {
  return env.JUSTDOIT_MODE === 'hosted' || Boolean(env.AUTH_GITHUB_ID);
}

export function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowed(
  allowlist: string[],
  identity: { email?: string | null; login?: string | null },
): boolean {
  if (allowlist.length === 0) return false; // fail closed
  const email = identity.email?.toLowerCase();
  const login = identity.login?.toLowerCase();
  return (!!email && allowlist.includes(email)) || (!!login && allowlist.includes(login));
}

const PUBLIC_PREFIXES = ['/signin', '/not-allowed', '/api/auth'];

export function shouldRedirect(
  pathname: string,
  hasSession: boolean,
  authEnabled: boolean,
): boolean {
  if (!authEnabled || hasSession) return false;
  return !PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export function resolveApiBase(env: Env = process.env): string {
  // Explicit override (inlined at build time via NEXT_PUBLIC_API_URL) wins.
  if (env.NEXT_PUBLIC_API_URL) return env.NEXT_PUBLIC_API_URL.replace(/\/$/, '');
  // In the browser on a hosted (non-localhost) origin, always use the
  // same-origin proxy so we never hit CORS regardless of build-time env.
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') return '/api/backend';
  }
  return 'http://localhost:8787';
}
