'use client';

import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Button } from '@/components/ui/button';

function GitHubIcon(): React.ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.05-.02-2.06-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.39 1.24-3.23-.13-.31-.54-1.53.11-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.65 1.65.24 2.87.12 3.18.77.84 1.23 1.91 1.23 3.23 0 4.63-2.81 5.65-5.49 5.95.43.37.81 1.1.81 2.22 0 1.6-.02 2.9-.02 3.29 0 .32.22.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5Z" />
    </svg>
  );
}

function SignInContent(): React.ReactNode {
  const error = useSearchParams().get('error');
  const rejected = error === 'AccessDenied';

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 flex flex-col items-center gap-4 text-center">
        <div className="grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-6"
            aria-hidden="true"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">justdoit</h1>
          <p className="text-sm text-muted-foreground">
            The keyboard-first task manager — your tasks, your time, your data.
          </p>
        </div>
      </div>

      {rejected && (
        <div
          role="alert"
          className="mb-4 rounded-lg bg-destructive/10 px-4 py-3 text-center text-sm text-destructive"
        >
          That GitHub account isn’t on the allowlist. Ask the owner to add your email or username.
        </div>
      )}

      <Button
        autoFocus
        size="lg"
        className="h-11 w-full text-sm"
        onClick={() => void signIn('github', { callbackUrl: '/' })}
      >
        <GitHubIcon />
        Continue with GitHub
      </Button>

      <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
        Invite-only access. Sign in with GitHub to reach your workspace.
      </p>
    </div>
  );
}

export default function SignInPage(): React.ReactNode {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-6">
      {/* Soft indigo backdrop glow — subtle, on-brand, works in light and dark. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/3 size-[32rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-[120px]" />
      </div>
      <Suspense>
        <SignInContent />
      </Suspense>
    </div>
  );
}
