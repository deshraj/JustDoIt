import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Onboarding } from './onboarding';
import { EmptyState } from './empty-state';

describe('Onboarding & EmptyState', () => {
  it('renders the first-run welcome and fires the quick-add CTA', () => {
    const onQuickAdd = vi.fn();
    render(<Onboarding onQuickAdd={onQuickAdd} onCreateSample={() => {}} />);
    expect(screen.getByRole('heading', { name: /welcome to justdoit/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add your first task/i }));
    expect(onQuickAdd).toHaveBeenCalled();
  });

  it('fires the create-sample-project CTA', () => {
    const onCreateSample = vi.fn();
    render(<Onboarding onQuickAdd={() => {}} onCreateSample={onCreateSample} />);
    fireEvent.click(screen.getByRole('button', { name: /create a sample project/i }));
    expect(onCreateSample).toHaveBeenCalled();
  });

  it('EmptyState shows title, description, and an optional action', () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        title="No tasks"
        description="You're all caught up."
        action={{ label: 'New task', onClick }}
      />,
    );
    expect(screen.getByText(/no tasks/i)).toBeInTheDocument();
    expect(screen.getByText(/you're all caught up/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /new task/i }));
    expect(onClick).toHaveBeenCalled();
  });

  it('EmptyState renders without an action button when none is given', () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.getByText(/nothing here/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
