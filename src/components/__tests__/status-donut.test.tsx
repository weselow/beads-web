import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { StatusDonut } from '@/components/status-donut';

const counts = { active: 4, wip: 3, frozen: 2, done: 1 };

function segmentFills(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('path')).map((p) => p.getAttribute('fill') ?? '');
}

describe('StatusDonut', () => {
  it('draws one part per status group', () => {
    const { container } = render(<StatusDonut beadCounts={counts} />);
    expect(segmentFills(container)).toEqual([
      'hsl(var(--status-open))',
      'hsl(var(--status-progress))',
      'hsl(var(--text-muted))',
      'hsl(var(--status-closed))',
    ]);
  });

  it('leaves out empty groups', () => {
    const { container } = render(<StatusDonut beadCounts={{ active: 2, wip: 0, frozen: 0, done: 3 }} />);
    expect(segmentFills(container)).toEqual(['hsl(var(--status-open))', 'hsl(var(--status-closed))']);
  });

  it('names every group with its number on hover', () => {
    const { container } = render(<StatusDonut beadCounts={counts} />);
    fireEvent.mouseEnter(container.firstChild as Element);
    expect(screen.getByText('10 tasks')).toBeTruthy();
    for (const [label, n] of [['Active', 4], ['In progress', 3], ['Frozen', 2], ['Done', 1]] as const) {
      const row = screen.getByText(label).parentElement!;
      expect(row.textContent).toContain(String(n));
    }
  });

  it('shows a dashed placeholder when there are no tasks', () => {
    render(<StatusDonut beadCounts={{ active: 0, wip: 0, frozen: 0, done: 0 }} />);
    expect(screen.getByLabelText('No tasks')).toBeTruthy();
  });
});
