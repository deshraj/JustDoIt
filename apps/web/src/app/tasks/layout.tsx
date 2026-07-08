import type { ReactNode } from 'react';

/**
 * Hosts the `@modal` parallel-route slot for the task-detail drawer. When a
 * <Link href="/tasks/[id]"> is followed from within /tasks, Next's
 * intercepting route (`@modal/(.)[id]`) renders the drawer here as a soft-nav
 * overlay on top of `children` (the List view); a hard refresh or direct
 * visit to /tasks/[id] instead serves the full-page fallback route.
 */
export default function TasksLayout({
  children,
  modal,
}: {
  children: ReactNode;
  modal: ReactNode;
}) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
