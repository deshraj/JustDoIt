export default function NotAllowedPage(): React.ReactNode {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-xl font-semibold">Access not allowed</h1>
      <p className="text-sm text-muted-foreground">
        Your account isn’t on the allowlist for this instance.
      </p>
    </main>
  );
}
