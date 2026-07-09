'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  CalendarDays,
  KanbanSquare,
  ListTodo,
  Plus,
  Search,
  Settings,
} from 'lucide-react';
import { useProjects } from '@/hooks/use-projects';
import { NewProjectDialog } from '@/components/new-project-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const VIEW_LINKS = [
  { href: '/tasks', label: 'List', icon: ListTodo },
  { href: '/board', label: 'Board', icon: KanbanSquare },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const { data: projects, isLoading } = useProjects();
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  return (
    <nav aria-label="Primary" className="flex h-full w-60 flex-col gap-6 px-4 py-6">
      <Link href="/tasks" className="rounded-md px-2 text-lg font-semibold tracking-tight">
        justdoit
      </Link>

      <ul className="flex flex-col gap-1">
        {VIEW_LINKS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname?.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground',
                  active && 'bg-muted text-foreground',
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between pr-1">
          <p className="px-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Projects
          </p>
          <button
            type="button"
            onClick={() => setNewProjectOpen(true)}
            aria-label="New project"
            className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
        </div>
        {isLoading ? (
          <div className="flex flex-col gap-2 px-2.5">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-3/4" />
          </div>
        ) : projects && projects.length > 0 ? (
          <ul className="no-scrollbar flex flex-col gap-1 overflow-y-auto">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/tasks?project=${project.id}`}
                  className="flex items-center gap-2.5 truncate rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground"
                >
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: project.color ?? 'hsl(var(--muted-foreground))' }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{project.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <button
            type="button"
            onClick={() => setNewProjectOpen(true)}
            className="mx-1 rounded-md px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            No projects yet — create one
          </button>
        )}
      </div>

      <Link
        href="/settings"
        aria-current={pathname?.startsWith('/settings') ? 'page' : undefined}
        className={cn(
          'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground',
          pathname?.startsWith('/settings') && 'bg-muted text-foreground',
        )}
      >
        <Settings className="size-4" aria-hidden="true" />
        Settings
      </Link>

      <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} />
    </nav>
  );
}
