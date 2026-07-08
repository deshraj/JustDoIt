import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommandPalette } from './command-palette';
import { useCommandPalette } from '@/hooks/use-command-palette';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const setTheme = vi.fn();
vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'dark', setTheme }),
}));

const listTasks = vi.fn();
const listProjects = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    listTasks: (...a: unknown[]) => listTasks(...a),
    listProjects: (...a: unknown[]) => listProjects(...a),
  },
}));

function Harness() {
  const { open, setOpen } = useCommandPalette();
  return <CommandPalette open={open} onOpenChange={setOpen} />;
}

function renderHarness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

describe('CommandPalette', () => {
  beforeEach(() => {
    push.mockClear();
    setTheme.mockClear();
    listTasks.mockReset().mockResolvedValue([{ id: 't1', title: 'Ship the launch email' }]);
    listProjects.mockReset().mockResolvedValue([]);
  });

  it('⌘K opens the palette', async () => {
    const user = userEvent.setup();
    renderHarness();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.keyboard('{Meta>}k{/Meta}');

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('typing a task title filters to it, and Enter navigates to it', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.keyboard('{Meta>}k{/Meta}');
    const input = await screen.findByPlaceholderText('Search tasks, jump to a view…');

    await user.type(input, 'Ship the launch');
    await screen.findByText('Ship the launch email');
    await user.keyboard('{Enter}');

    expect(push).toHaveBeenCalledWith('/tasks/t1');
  });

  it('the "Board" navigate item pushes /board', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.keyboard('{Meta>}k{/Meta}');
    const boardItem = await screen.findByText('Board');
    await user.click(boardItem);

    expect(push).toHaveBeenCalledWith('/board');
  });

  it('the "Toggle theme" action calls setTheme', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.keyboard('{Meta>}k{/Meta}');
    const toggle = await screen.findByText('Toggle theme');
    await user.click(toggle);

    expect(setTheme).toHaveBeenCalledWith('light');
  });
});
