import type { ComponentProps } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { QuickFilterBar } from '../quick-filter-bar';

function renderBar(props: Partial<ComponentProps<typeof QuickFilterBar>> = {}) {
  return render(
    <QuickFilterBar
      typeFilter="all"
      onTypeFilterChange={vi.fn()}
      todayOnly={false}
      onTodayOnlyChange={vi.fn()}
      sortField="ticket_number"
      sortDirection="desc"
      onSortChange={vi.fn()}
      search=""
      onSearchChange={vi.fn()}
      statusOptions={[]}
      statuses={[]}
      onStatusToggle={vi.fn()}
      owners={[]}
      onOwnerToggle={vi.fn()}
      availableOwners={[]}
      onClearFilters={vi.fn()}
      hasActiveFilters={false}
      {...props}
    />,
  );
}

describe('Board / Tree switch in the filter bar', () => {
  it('marks the current view as pressed', () => {
    renderBar({ view: 'tree', onViewChange: vi.fn() });

    expect(screen.getByRole('button', { name: 'Tree view' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Board view' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports the picked view', () => {
    const onViewChange = vi.fn();
    renderBar({ view: 'board', onViewChange });

    fireEvent.click(screen.getByRole('button', { name: 'Tree view' }));
    expect(onViewChange).toHaveBeenCalledWith('tree');

    fireEvent.click(screen.getByRole('button', { name: 'Board view' }));
    expect(onViewChange).toHaveBeenCalledWith('board');
  });

  it('sits before the search field', () => {
    renderBar({ view: 'board', onViewChange: vi.fn() });

    const toggle = screen.getByRole('button', { name: 'Board view' });
    const search = screen.getByRole('textbox', { name: 'Search beads' });
    expect(toggle.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is left out when nobody listens for it', () => {
    renderBar();

    expect(screen.queryByRole('button', { name: 'Board view' })).not.toBeInTheDocument();
  });
});
