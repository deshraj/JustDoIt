import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShortcutCheatsheet, VIEW_SHORTCUT_ROUTES } from './shortcut-cheatsheet';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

describe('ShortcutCheatsheet', () => {
  beforeEach(() => {
    push.mockClear();
  });

  it('opens on "?" and shows shortcut rows, then closes on Escape', () => {
    render(<ShortcutCheatsheet />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(window, { key: '?', shiftKey: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/command palette/i)).toBeInTheDocument();
    // Radix's Dialog attaches its Escape handler on `document` (so it fires
    // regardless of which element inside the dialog has focus) — dispatch on
    // `document.body` so the event actually bubbles up to that listener,
    // rather than on `window` (a sibling target the event never reaches).
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ignores "?" typed into an input', () => {
    render(
      <>
        <input aria-label="field" />
        <ShortcutCheatsheet />
      </>,
    );
    const input = screen.getByLabelText('field');
    input.focus();
    fireEvent.keyDown(input, { key: '?', shiftKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('maps the advertised 1 / 2 / 3 shortcuts to List / Board / Calendar', () => {
    expect(VIEW_SHORTCUT_ROUTES).toEqual({ '1': '/tasks', '2': '/board', '3': '/calendar' });
  });

  it('pressing 1, 2, or 3 navigates to List, Board, and Calendar respectively', () => {
    render(<ShortcutCheatsheet />);

    fireEvent.keyDown(window, { key: '1' });
    expect(push).toHaveBeenCalledWith('/tasks');

    fireEvent.keyDown(window, { key: '2' });
    expect(push).toHaveBeenCalledWith('/board');

    fireEvent.keyDown(window, { key: '3' });
    expect(push).toHaveBeenCalledWith('/calendar');

    expect(push).toHaveBeenCalledTimes(3);
  });

  it('ignores the 1/2/3 shortcuts typed into an input', () => {
    render(
      <>
        <input aria-label="field" />
        <ShortcutCheatsheet />
      </>,
    );
    const input = screen.getByLabelText('field');
    input.focus();
    fireEvent.keyDown(input, { key: '1' });
    fireEvent.keyDown(input, { key: '2' });
    fireEvent.keyDown(input, { key: '3' });
    expect(push).not.toHaveBeenCalled();
  });
});
