import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export default function NotAllowedPage(): React.ReactNode {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-6">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/3 size-[32rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-destructive/15 blur-[120px]" />
      </div>
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-6 grid size-12 place-items-center rounded-xl bg-destructive/15 text-destructive">
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
            <circle cx="12" cy="12" r="9" />
            <path d="m15 9-6 6M9 9l6 6" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Access not allowed</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your GitHub account isn’t on the allowlist for this instance. Ask the owner to add your
          email or username.
        </p>
        <Link href="/signin" className={buttonVariants({ variant: 'outline', className: 'mt-6' })}>
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
