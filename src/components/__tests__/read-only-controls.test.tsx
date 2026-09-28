import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { READ_ONLY_HINT } from '@/lib/read-only';
import type { Bead, Epic } from '@/types';

import { BeadDetail } from '../bead-detail';
import { CommentList } from '../comment-list';
import { EpicCard } from '../epic-card';
import { MemoryPanel } from '../memory-panel';
import { QuickFilterBar } from '../quick-filter-bar';

// While the board shows an old copy from issues.jsonl, every write control is
// disabled and says why. Nothing here may reach the backend.
vi.mock('@/lib/api', () => ({
  beads: { update: vi.fn() },
  git: { prStatus: vi.fn().mockResolvedValue({ pr: null }) },
}));

vi.mock('@/lib/cli', () => ({
  addComment: vi.fn(),
  closeBead: vi.fn(),
  updateTitle: vi.fn(),
  updateDescription: vi.fn(),
  updateStatus: vi.fn(),
}));

vi.mock('@/hooks/use-theme', async () => {
  const { getTheme } = await import('@/lib/themes');
  return {
    useTheme: () => {
      const theme = getTheme('default');
      return { theme, layout: theme.layout, themeId: 'default' };
    },
  };
});

vi.mock('@/hooks/use-memory', () => ({
  useMemory: () => ({
    entries: [{ key: 'k1', content: 'Remembered' }],
    filteredEntries: [{ key: 'k1', content: 'Remembered' }],
    isLoading: false,
    error: null,
    search: '',
    setSearch: vi.fn(),
    createEntry: vi.fn(),
    editEntry: vi.fn(),
    deleteEntry: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const makeBead = (id: string, overrides: Partial<Bead> = {}): Bead => ({
  id,
  title: `Bead ${id}`,
  description: 'Some text',
  status: 'open',
  priority: 2,
  issue_type: 'task',
  owner: 'tester',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  comments: [],
  ...overrides,
});

function expectDisabledWithHint(element: HTMLElement) {
  expect(element).toBeDisabled();
  expect(element).toHaveAttribute('title', READ_ONLY_HINT);
}

describe('write controls on an old copy', () => {
  it('disables the New bead button', () => {
    render(
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
        onNewBead={vi.fn()}
        readOnly
      />,
    );

    const button = screen.getByRole('button', { name: /new/i });
    expectDisabledWithHint(button);
    // The shared Button switches pointer events off when disabled, which
    // would hide the tooltip.
    expect(button.className).not.toMatch(/disabled:pointer-events-none/);
  });

  it('disables adding a comment', () => {
    render(<CommentList comments={[]} beadId="b1" projectPath="M:/demo" readOnly />);

    expectDisabledWithHint(screen.getByRole('textbox', { name: 'Add a comment' }));
    expectDisabledWithHint(screen.getByRole('button', { name: 'Add' }));
  });

  it('disables closing an epic', () => {
    const child = makeBead('c1', { status: 'closed', parent_id: 'e1' });
    const epic = makeBead('e1', { issue_type: 'epic', status: 'inreview', children: ['c1'] }) as Epic;

    render(
      <EpicCard
        epic={epic}
        allBeads={[epic, child]}
        onSelect={vi.fn()}
        onChildClick={vi.fn()}
        projectPath="M:/demo"
        readOnly
      />,
    );

    expectDisabledWithHint(screen.getByRole('button', { name: /close epic/i }));
  });

  it('disables editing fields in the bead detail panel', () => {
    const child = makeBead('c1', { parent_id: 'e1' });
    const epic = makeBead('e1', { issue_type: 'epic', children: ['c1'] });

    render(
      <BeadDetail
        bead={epic}
        open
        onOpenChange={vi.fn()}
        projectPath="M:/demo"
        allBeads={[epic, child]}
        onChildClick={vi.fn()}
        readOnly
      />,
    );

    // Title and description render as plain text, without the pen button.
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.getByText('Bead e1').closest('[title]')).toHaveAttribute('title', READ_ONLY_HINT);
    expectDisabledWithHint(screen.getByRole('combobox', { name: 'Status' }));
    expectDisabledWithHint(screen.getByRole('combobox', { name: 'Issue type' }));
    expectDisabledWithHint(screen.getByRole('combobox', { name: 'Priority' }));
    expectDisabledWithHint(screen.getByRole('button', { name: /add subtask/i }));
  });

  it('disables memory writes and deletes', () => {
    render(<MemoryPanel open onOpenChange={vi.fn()} projectPath="M:/demo" readOnly />);

    expectDisabledWithHint(screen.getByRole('button', { name: /add memory/i }));
    expectDisabledWithHint(screen.getByRole('button', { name: 'Entry actions' }));
  });
});

describe('write controls on current data', () => {
  it('leaves them enabled', () => {
    render(<CommentList comments={[]} beadId="b1" projectPath="M:/demo" />);

    const input = screen.getByRole('textbox', { name: 'Add a comment' });
    expect(input).toBeEnabled();
    expect(input).not.toHaveAttribute('title');
  });
});
