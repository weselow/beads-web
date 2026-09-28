import { describe, expect, it } from 'vitest';

import { canCloseEpic, computeEpicProgress, getBlockedTasks } from '@/lib/epic-parser';
import { BUILTIN_STATUSES } from '@/lib/statuses';
import type { Bead, Epic, StatusInfo } from '@/types';

const statuses: StatusInfo[] = [
  ...BUILTIN_STATUSES,
  { name: 'inreview', category: 'wip', builtin: false },
  { name: 'shipped', category: 'done', builtin: false },
];

function bead(id: string, status: string, deps?: string[]): Bead {
  return {
    id, title: id, status, priority: 2, issue_type: 'task', owner: 'tester',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', comments: [], deps,
  };
}

function epicWith(children: Bead[], status = 'open'): { epic: Epic; all: Bead[] } {
  const epic = { ...bead('e1', status), issue_type: 'epic', children: children.map((c) => c.id) } as Epic;
  return { epic, all: [epic, ...children] };
}

describe('computeEpicProgress', () => {
  it('counts every status of the done group as completed', () => {
    const { epic, all } = epicWith([bead('a', 'closed'), bead('b', 'shipped'), bead('c', 'open')]);
    expect(computeEpicProgress(epic, all, statuses).completed).toBe(2);
  });

  it('counts the whole wip group as in progress, not only in_progress', () => {
    const { epic, all } = epicWith([bead('a', 'in_progress'), bead('b', 'hooked'), bead('c', 'inreview'), bead('d', 'open')]);
    expect(computeEpicProgress(epic, all, statuses).inProgress).toBe(3);
  });

  it('does not count a child as blocked when its dependency is done under its own status', () => {
    const { epic, all } = epicWith([bead('a', 'shipped'), bead('b', 'open', ['a']), bead('c', 'open', ['d']), bead('d', 'open')]);
    expect(computeEpicProgress(epic, all, statuses).blocked).toBe(1);
  });
});

describe('getBlockedTasks', () => {
  it('treats a dependency in the done group as resolved', () => {
    const beads = [bead('a', 'shipped'), bead('b', 'open', ['a']), bead('c', 'open', ['b'])];
    expect(getBlockedTasks(beads, statuses).map((b) => b.id)).toEqual(['c']);
  });
});

describe('canCloseEpic', () => {
  const progress = (total: number, completed: number) => ({ total, completed, inProgress: 0, blocked: 0 });

  it('allows closing when every child is done, whatever the epic status', () => {
    for (const status of ['open', 'in_progress', 'blocked', 'inreview']) {
      expect(canCloseEpic(status, progress(2, 2), statuses)).toBe(true);
    }
  });

  it('refuses while a child is not done', () => {
    expect(canCloseEpic('open', progress(3, 2), statuses)).toBe(false);
  });

  it('refuses an epic without children', () => {
    expect(canCloseEpic('open', progress(0, 0), statuses)).toBe(false);
  });

  it('hides the action when the epic itself is already done', () => {
    expect(canCloseEpic('closed', progress(2, 2), statuses)).toBe(false);
    expect(canCloseEpic('shipped', progress(2, 2), statuses)).toBe(false);
  });
});
