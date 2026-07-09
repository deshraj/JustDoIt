'use client';

import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';

export default function SignInPage(): React.ReactNode {
  const error = useSearchParams().get('error');
  const rejected = error === 'AccessDenied';
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">justdoit</h1>
      {rejected && (
        <p role="alert" className="max-w-sm text-center text-sm text-destructive">
          That GitHub account isn’t on the allowlist. Ask the owner to add your email or login.
        </p>
      )}
      <Button onClick={() => void signIn('github', { callbackUrl: '/' })}>
        Continue with GitHub
      </Button>
    </main>
  );
}
