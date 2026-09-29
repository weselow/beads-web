import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { Bead } from '@/types';

import { BeadDetail } from '../bead-detail';
import { CreateBeadDialog } from '../create-bead-dialog';
import { QuickFilterBar } from '../quick-filter-bar';

// The issue types chore and decision appear wherever a type is chosen, and a
// type beads-web does not know (bd has more, e.g. convoy) is shown as itself.
vi.mock('@/lib/api', () => ({
  beads: { create: vi.fn().mockResolvedValue({ id: 'x' }), update: vi.fn() },
  git: { prStatus: vi.fn().mockResolvedValue({ pr: null }) },
}));

vi.mock('@/lib/cli', () => ({
  updateTitle: vi.fn(),
  updateDescription: vi.fn(),
  updateStatus: vi.fn(),
}));

// Radix menus call pointer and scroll methods jsdom does not have.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

function openMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
}

function renderDialog() {
  render(<CreateBeadDialog open onOpenChange={vi.fn()} projectPath="M:/demo" onCreated={vi.fn()} />);
  return screen.getByLabelText('Description') as HTMLTextAreaElement;
}

function chooseDialogType(label: string) {
  openMenu(screen.getByRole('combobox', { name: 'Type' }));
  fireEvent.click(screen.getByRole('option', { name: label }));
}

function makeBead(issueType: string): Bead {
  return {
    id: 'b1', title: 'Bead b1', status: 'open', priority: 2, issue_type: issueType, owner: 'tester',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', comments: [],
  };
}

function renderDetailTypeSelect(issueType: string) {
  render(<BeadDetail bead={makeBead(issueType)} open onOpenChange={vi.fn()} projectPath="M:/demo" />);
  return screen.getByRole('combobox', { name: 'Issue type' }) as HTMLSelectElement;
}

describe('type choice in the create dialog', () => {
  it('offers chore and decision', () => {
    renderDialog();
    openMenu(screen.getByRole('combobox', { name: 'Type' }));
    expect(screen.getByRole('option', { name: 'Chore' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Decision' })).toBeInTheDocument();
  });

  it('hints the description sections of the selected type', () => {
    const description = renderDialog();
    expect(description.placeholder).toContain('## Acceptance Criteria');

    chooseDialogType('Decision');
    expect(description.placeholder).toContain('## Rationale');
    expect(description.placeholder).toContain('## Alternatives Considered');

    chooseDialogType('Bug');
    expect(description.placeholder).toBe('Optional details…');
  });

  it('never touches what the user already typed', () => {
    const description = renderDialog();
    fireEvent.change(description, { target: { value: 'My own notes' } });

    chooseDialogType('Spike');
    expect(description.value).toBe('My own notes');
    expect(description.placeholder).toContain('## Findings');
  });
});

describe('type filter on the board', () => {
  it('offers chore and decision', () => {
    render(
      <QuickFilterBar
        typeFilter="all" onTypeFilterChange={vi.fn()}
        todayOnly={false} onTodayOnlyChange={vi.fn()}
        sortField="ticket_number" sortDirection="desc" onSortChange={vi.fn()}
        search="" onSearchChange={vi.fn()}
        statusOptions={[]} statuses={[]} onStatusToggle={vi.fn()}
        owners={[]} onOwnerToggle={vi.fn()} availableOwners={[]}
        onClearFilters={vi.fn()} hasActiveFilters={false}
      />,
    );
    openMenu(screen.getByRole('button', { name: 'Filter by issue type' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Chore' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Decision' })).toBeInTheDocument();
  });
});

describe('type choice in the bead detail panel', () => {
  it('offers chore and decision', () => {
    const values = Array.from(renderDetailTypeSelect('chore').options).map((o) => o.value);
    expect(values).toContain('chore');
    expect(values).toContain('decision');
  });

  it('shows an unknown type as itself instead of another type', () => {
    const select = renderDetailTypeSelect('convoy');
    expect(select.value).toBe('convoy');
    expect(select.selectedOptions[0].textContent).toBe('Convoy');
  });
});
