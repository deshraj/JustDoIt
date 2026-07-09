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
  const base = env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';
  return base.replace(/\/$/, '');
}
