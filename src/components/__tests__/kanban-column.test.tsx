import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Bead, StatusCategory } from '@/types';

import { KanbanColumn, getColumnColors } from '../kanban-column';

interface CardStubProps {
  parent?: Bead;
  parentTicketNumber?: number;
  onOpenParent?: (parent: Bead) => void;
}

// Shows what the column handed the card about its parent.
function ParentStub({ parent, parentTicketNumber, onOpenParent }: CardStubProps) {
  if (!parent) return null;
  return (
    <button onClick={() => onOpenParent?.(parent)}>
      parent {parent.id} #{parentTicketNumber}
    </button>
  );
}

vi.mock('@/components/bead-card', () => ({
  BeadCard: ({ bead, ...rest }: CardStubProps & { bead: Bead }) => (
    <div>{bead.title}<ParentStub {...rest} /></div>
  ),
}));
vi.mock('@/components/epic-card', () => ({
  EpicCard: ({ epic, ...rest }: CardStubProps & { epic: Bead }) => (
    <div>{epic.title}<ParentStub {...rest} /></div>
  ),
}));

function renderColumn(category: StatusCategory, collapsed: boolean, beads: Bead[] = []) {
  return render(
    <KanbanColumn
      status="qa"
      title="qa"
      category={category}
      collapsed={collapsed}
      beads={beads}
      allBeads={beads}
      onSelectBead={vi.fn()}
    />
  );
}

describe('getColumnColors', () => {
  it('colours each group like its built-in status and leaves frozen muted', () => {
    expect(getColumnColors('active').text).toBe('text-status-open');
    expect(getColumnColors('wip').text).toBe('text-status-progress');
    expect(getColumnColors('done').text).toBe('text-status-closed');
    expect(getColumnColors('frozen').text).toBe('text-t-tertiary');
    expect(getColumnColors('wip').accent).toBe('hsl(var(--status-progress))');
  });
});

describe('KanbanColumn', () => {
  it('draws a collapsed column as a narrow strip with its name and no bead list', () => {
    renderColumn('wip', true);

    const strip = screen.getByRole('region', { name: 'qa, no beads' });
    expect(strip).toHaveAttribute('data-collapsed', 'true');
    expect(strip).toHaveTextContent('qa');
    expect(screen.queryByText('No beads')).not.toBeInTheDocument();
  });

  it('draws an expanded column with a header in its group colour and its beads', () => {
    const bead: Bead = {
      id: 'q1', title: 'Check it', status: 'qa', priority: 2, issue_type: 'task', owner: '',
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', comments: [],
    };
    renderColumn('wip', false, [bead]);

    expect(screen.getByRole('heading', { name: 'qa' })).toHaveClass('text-status-progress');
    expect(screen.getByText('Check it')).toBeInTheDocument();
  });
});

describe('KanbanColumn, cards with a parent', () => {
  const make = (id: string, issue_type: string, parent_id?: string): Bead => ({
    id, title: `Bead ${id}`, status: 'open', priority: 2, issue_type, owner: '', parent_id,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', comments: [],
  });
  const milestone = make('m', 'milestone');

  function renderWithParent(card: Bead, onSelectBead = vi.fn()) {
    render(
      <KanbanColumn
        status="open"
        title="Open"
        category="active"
        beads={[card]}
        allBeads={[milestone, card]}
        ticketNumbers={new Map([['m', 7]])}
        onSelectBead={onSelectBead}
      />
    );
    return onSelectBead;
  }

  it('hands a card its parent and the parent\'s number, and opens the parent like any bead', () => {
    const onSelectBead = renderWithParent(make('t', 'task', 'm'));
    fireEvent.click(screen.getByRole('button', { name: 'parent m #7' }));
    expect(onSelectBead).toHaveBeenCalledWith(milestone);
  });

  it('hands an epic card its parent too', () => {
    renderWithParent(make('e', 'epic', 'm'));
    expect(screen.getByRole('button', { name: 'parent m #7' })).toBeInTheDocument();
  });

  it('hands no parent when it is not among the beads', () => {
    renderWithParent(make('t', 'task', 'gone'));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
