import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BUILTIN_STATUSES } from '@/lib/statuses';
import type { Bead, Epic, StatusInfo } from '@/types';

import { EpicCard } from '../epic-card';

vi.mock('@/lib/api', () => ({
  git: { prStatus: vi.fn().mockResolvedValue({ pr: null }) },
}));

vi.mock('@/lib/cli', () => ({ closeBead: vi.fn() }));

vi.mock('@/hooks/use-theme', async () => {
  const { getTheme } = await import('@/lib/themes');
  return {
    useTheme: () => {
      const theme = getTheme('default');
      return { theme, layout: theme.layout, themeId: 'default' };
    },
  };
});

// A project with its own done status next to bd's closed.
const statuses: StatusInfo[] = [...BUILTIN_STATUSES, { name: 'shipped', category: 'done', builtin: false }];

const makeBead = (id: string, overrides: Partial<Bead> = {}): Bead => ({
  id, title: `Bead ${id}`, status: 'open', priority: 2, issue_type: 'task', owner: 'tester',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', comments: [],
  ...overrides,
});

function renderEpic(epicStatus: string, childStatuses: string[]) {
  const children = childStatuses.map((status, i) => makeBead(`c${i}`, { status, parent_id: 'e1' }));
  const epic = makeBead('e1', { issue_type: 'epic', status: epicStatus, children: children.map((c) => c.id) }) as Epic;
  render(
    <EpicCard
      epic={epic}
      allBeads={[epic, ...children]}
      onSelect={vi.fn()}
      onChildClick={vi.fn()}
      projectPath="M:/demo"
      statuses={statuses}
    />,
  );
}

const closeButton = () => screen.queryByRole('button', { name: /close epic/i });

describe('Close Epic', () => {
  it('appears when every child is done, while the epic is still in progress', () => {
    renderEpic('in_progress', ['closed', 'shipped']);
    expect(closeButton()).toBeInTheDocument();
  });

  it('stays hidden while a child is not done', () => {
    renderEpic('open', ['closed', 'in_progress']);
    expect(closeButton()).not.toBeInTheDocument();
  });

  it('stays hidden once the epic itself is done', () => {
    renderEpic('closed', ['closed', 'shipped']);
    expect(closeButton()).not.toBeInTheDocument();
  });
});

describe('epic card counters', () => {
  it('counts the whole wip group as in progress', () => {
    renderEpic('open', ['in_progress', 'hooked', 'open']);
    expect(screen.getByText(/2 in progress/)).toBeInTheDocument();
  });

  it('strikes through a child that is done under the project status', () => {
    renderEpic('open', ['shipped', 'open']);
    expect(screen.getByText('Bead c0')).toHaveClass('line-through');
    expect(screen.getByText('Bead c1')).not.toHaveClass('line-through');
  });
});
