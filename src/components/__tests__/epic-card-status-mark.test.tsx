import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getStatusBadgeClasses } from '@/lib/statuses';
import type { CardLayout } from '@/lib/themes';
import type { Bead, Epic, StatusBadgeInfo } from '@/types';

import { EpicCard } from '../epic-card';

vi.mock('@/lib/api', () => ({
  git: { prStatus: vi.fn().mockResolvedValue({ pr: null }) },
}));

vi.mock('@/lib/cli', () => ({ closeBead: vi.fn() }));

// The card layout comes from the theme; each test picks one.
const current = vi.hoisted(() => ({ layout: 'standard' as CardLayout }));

vi.mock('@/hooks/use-theme', async () => {
  const { getTheme } = await import('@/lib/themes');
  return {
    useTheme: () => ({ theme: getTheme('default'), layout: current.layout, themeId: 'default' }),
  };
});

const makeEpic = (status: string, statusBadge?: StatusBadgeInfo): Epic => ({
  id: 'e1', title: 'Epic e1', status, priority: 2, issue_type: 'epic', owner: 'tester',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', comments: [],
  children: [], _statusBadge: statusBadge,
} as Bead as Epic);

function renderEpic(epic: Epic) {
  render(<EpicCard epic={epic} allBeads={[epic]} onSelect={vi.fn()} onChildClick={vi.fn()} />);
}

const LAYOUTS: CardLayout[] = ['standard', 'compact-row', 'property-tags'];

describe.each(LAYOUTS)('epic card status mark, %s layout', (layout) => {
  beforeEach(() => {
    current.layout = layout;
  });

  it('shows Pinned for a pinned epic lifted into Open', () => {
    renderEpic(makeEpic('pinned', { label: 'Pinned', variant: 'muted' }));
    const mark = screen.getByText('Pinned');
    expect(mark.className).toContain(getStatusBadgeClasses('muted'));
  });

  it('shows the status name as a warning for a status missing from the list', () => {
    renderEpic(makeEpic('mystery', { label: 'mystery', variant: 'warning' }));
    const mark = screen.getByText('mystery');
    expect(mark.className).toContain(getStatusBadgeClasses('warning'));
  });

  it('shows no mark when the board set none', () => {
    renderEpic(makeEpic('open'));
    expect(screen.queryByText('Pinned')).not.toBeInTheDocument();
    expect(screen.queryByText('open')).not.toBeInTheDocument();
  });
});
