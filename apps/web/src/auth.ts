import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import { parseAllowlist, isAllowed } from '@/lib/auth-config';
import { upsertUser } from '@/lib/auth-callbacks';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub], // reads AUTH_GITHUB_ID / AUTH_GITHUB_SECRET automatically
  session: { strategy: 'jwt' },
  pages: { signIn: '/signin', error: '/signin' },
  callbacks: {
    signIn({ profile }) {
      const allowlist = parseAllowlist(process.env.AUTH_ALLOWLIST);
      return isAllowed(allowlist, {
        email: (profile?.email as string | null) ?? null,
        login: (profile?.login as string | null) ?? null,
      });
    },
    async jwt({ token, account, profile }) {
      // account+profile are present only on the initial sign-in event.
      if (account && profile) {
        const base = process.env.INTERNAL_API_URL;
        const secret = process.env.INTERNAL_API_SECRET;
        if (!base || !secret) throw new Error('INTERNAL_API_URL/INTERNAL_API_SECRET missing');
        token.userId = await upsertUser(
          fetch,
          { base, secret },
          {
            githubId: String(profile.id),
            email: (profile.email as string | null) ?? null,
            name: (profile.name as string | null) ?? null,
            avatarUrl: (profile.avatar_url as string | null) ?? null,
          },
        );
      }
      return token;
    },
    session({ session, token }) {
      if (token.userId && session.user) session.user.id = token.userId;
      return session;
    },
  },
});
