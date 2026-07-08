import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShortcutCheatsheet } from './shortcut-cheatsheet';

describe('ShortcutCheatsheet', () => {
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
});
