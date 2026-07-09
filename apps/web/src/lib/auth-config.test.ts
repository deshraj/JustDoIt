import { describe, it, expect } from 'vitest';
import {
  isAuthEnabled,
  parseAllowlist,
  isAllowed,
  shouldRedirect,
  resolveApiBase,
} from './auth-config';

describe('auth-config', () => {
  it('isAuthEnabled: hosted mode or GitHub id enables auth', () => {
    expect(isAuthEnabled({})).toBe(false);
    expect(isAuthEnabled({ JUSTDOIT_MODE: 'hosted' })).toBe(true);
    expect(isAuthEnabled({ AUTH_GITHUB_ID: 'abc' })).toBe(true);
  });

  it('parseAllowlist: trims, lowercases, drops empties', () => {
    expect(parseAllowlist(' A@x.dev , octocat ,')).toEqual(['a@x.dev', 'octocat']);
    expect(parseAllowlist(undefined)).toEqual([]);
  });

  it('isAllowed: matches email or login, fails closed when empty', () => {
    const list = ['a@x.dev', 'octocat'];
    expect(isAllowed(list, { email: 'A@x.dev' })).toBe(true);
    expect(isAllowed(list, { login: 'Octocat' })).toBe(true);
    expect(isAllowed(list, { email: 'b@x.dev' })).toBe(false);
    expect(isAllowed([], { email: 'a@x.dev' })).toBe(false);
  });

  it('shouldRedirect: only when auth on, no session, non-public path', () => {
    expect(shouldRedirect('/tasks', false, true)).toBe(true);
    expect(shouldRedirect('/tasks', true, true)).toBe(false);
    expect(shouldRedirect('/signin', false, true)).toBe(false);
    expect(shouldRedirect('/api/auth/callback', false, true)).toBe(false);
    expect(shouldRedirect('/tasks', false, false)).toBe(false);
  });

  it('resolveApiBase: env or localhost, trailing slash stripped', () => {
    expect(resolveApiBase({})).toBe('http://localhost:8787');
    expect(resolveApiBase({ NEXT_PUBLIC_API_URL: '/api/backend/' })).toBe('/api/backend');
  });
});
