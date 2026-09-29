import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CardLayout } from '@/lib/themes';
import type { Bead, Epic } from '@/types';

import { BeadCard } from '../bead-card';
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

const base = {
  status: 'open', priority: 2, owner: '', comments: [],
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};
const milestone: Bead = { ...base, id: 'proj-m1', title: 'Milestone one', issue_type: 'milestone' };
const child: Bead = { ...base, id: 'proj-c1', title: 'Child task', issue_type: 'task', parent_id: 'proj-m1' };
const epic = {
  ...base, id: 'proj-e1', title: 'Child epic', issue_type: 'epic', parent_id: 'proj-m1', children: [],
} as Bead as Epic;

function renderCard(parentTicketNumber?: number) {
  const onSelect = vi.fn();
  const onOpenParent = vi.fn();
  render(
    <BeadCard
      bead={child}
      allBeads={[milestone, child]}
      onSelect={onSelect}
      parent={milestone}
      parentTicketNumber={parentTicketNumber}
      onOpenParent={onOpenParent}
    />
  );
  return { onSelect, onOpenParent };
}

const LAYOUTS: CardLayout[] = ['standard', 'compact-row', 'property-tags'];

describe.each(LAYOUTS)('parent mark on a bead card, %s layout', (layout) => {
  beforeEach(() => {
    current.layout = layout;
  });

  it('names the parent by its ticket number', () => {
    renderCard(7);
    expect(screen.getByRole('button', { name: 'Open parent: Milestone one' })).toHaveTextContent('part of #7');
  });

  it('names the parent by its id when it has no ticket number', () => {
    renderCard();
    expect(screen.getByRole('button', { name: 'Open parent: Milestone one' })).toHaveTextContent('part of PROJ-m1');
  });

  it('opens the parent, not the card, on click', () => {
    const { onSelect, onOpenParent } = renderCard(7);
    fireEvent.click(screen.getByRole('button', { name: 'Open parent: Milestone one' }));
    expect(onOpenParent).toHaveBeenCalledTimes(1);
    expect(onOpenParent).toHaveBeenCalledWith(milestone);
    expect(onSelect).not.toHaveBeenCalled();
  });

  // The mark opens the parent itself on the key and cancels the browser's
  // default action, which would otherwise click the button a second time.
  it.each(['Enter', ' '])('opens the parent once, not the card, on %j pressed on the mark', (key) => {
    const { onSelect, onOpenParent } = renderCard(7);
    const mark = screen.getByRole('button', { name: 'Open parent: Milestone one' });
    const notCancelled = fireEvent.keyDown(mark, { key });
    expect(notCancelled).toBe(false);
    expect(onOpenParent).toHaveBeenCalledTimes(1);
    expect(onOpenParent).toHaveBeenCalledWith(milestone);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('cancels the key up of Space too, so the browser does not click the mark on release', () => {
    const { onSelect, onOpenParent } = renderCard(7);
    const mark = screen.getByRole('button', { name: 'Open parent: Milestone one' });
    expect(fireEvent.keyUp(mark, { key: ' ' })).toBe(false);
    expect(onOpenParent).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('leaves other keys alone', () => {
    const { onOpenParent } = renderCard(7);
    const mark = screen.getByRole('button', { name: 'Open parent: Milestone one' });
    expect(fireEvent.keyDown(mark, { key: 'a' })).toBe(true);
    expect(onOpenParent).not.toHaveBeenCalled();
  });

  it('shows no mark on a bead without a parent', () => {
    render(<BeadCard bead={milestone} allBeads={[milestone]} onSelect={vi.fn()} onOpenParent={vi.fn()} />);
    expect(screen.queryByText(/part of/)).not.toBeInTheDocument();
  });
});

describe.each(LAYOUTS)('parent mark on an epic card, %s layout', (layout) => {
  beforeEach(() => {
    current.layout = layout;
  });

  it('opens the parent, not the epic, on click', () => {
    const onSelect = vi.fn();
    const onOpenParent = vi.fn();
    render(
      <EpicCard
        epic={epic}
        allBeads={[milestone, epic]}
        onSelect={onSelect}
        onChildClick={vi.fn()}
        parent={milestone}
        parentTicketNumber={3}
        onOpenParent={onOpenParent}
      />
    );
    const mark = screen.getByRole('button', { name: 'Open parent: Milestone one' });
    expect(mark).toHaveTextContent('part of #3');
    fireEvent.click(mark);
    expect(onOpenParent).toHaveBeenCalledWith(milestone);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
