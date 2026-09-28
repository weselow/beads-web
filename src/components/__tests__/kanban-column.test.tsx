import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Bead, StatusCategory } from '@/types';

import { KanbanColumn, getColumnColors } from '../kanban-column';

vi.mock('@/components/bead-card', () => ({
  BeadCard: ({ bead }: { bead: Bead }) => <div>{bead.title}</div>,
}));
vi.mock('@/components/epic-card', () => ({ EpicCard: () => null }));

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
