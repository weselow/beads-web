import { describe, expect, it } from 'vitest';

import { boardColumns, foldIntoBoardColumns } from '@/lib/board-fold';
import { BUILTIN_STATUSES } from '@/lib/statuses';
import type { Bead, StatusInfo } from '@/types';

function bead(id: string, status: string): Bead {
  return {
    id, title: id, status, priority: 2, issue_type: 'task', owner: '',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', comments: [],
  };
}

const withReview: StatusInfo[] = [
  ...BUILTIN_STATUSES,
  { name: 'inreview', category: 'wip', builtin: false },
  { name: 'qa', category: 'wip', builtin: false },
];

const ids = (beads: Bead[]) => beads.map((b) => b.id);

describe('boardColumns', () => {
  it('shows In Review only when the project has that status', () => {
    expect(boardColumns(BUILTIN_STATUSES).map((c) => c.status)).toEqual(['open', 'in_progress', 'closed']);
    expect(boardColumns(withReview).map((c) => c.status)).toEqual(['open', 'in_progress', 'inreview', 'closed']);
  });
});

describe('foldIntoBoardColumns', () => {
  it('keeps open, in_progress and closed beads in their own columns', () => {
    const board = foldIntoBoardColumns([bead('a', 'open'), bead('b', 'in_progress'), bead('c', 'closed')], BUILTIN_STATUSES);
    expect(ids(board.open)).toEqual(['a']);
    expect(ids(board.in_progress)).toEqual(['b']);
    expect(ids(board.closed)).toEqual(['c']);
    expect(board.open[0]._statusBadge).toBeUndefined();
  });

  it('gives inreview its own column when the project has it', () => {
    const board = foldIntoBoardColumns([bead('r', 'inreview')], withReview);
    expect(ids(board.inreview)).toEqual(['r']);
    expect(board.open).toEqual([]);
  });

  it('puts inreview into open with a warning when the project lacks it', () => {
    const board = foldIntoBoardColumns([bead('r', 'inreview')], BUILTIN_STATUSES);
    expect(board.inreview).toEqual([]);
    expect(ids(board.open)).toEqual(['r']);
    expect(board.open[0]._statusBadge).toEqual({ label: 'inreview', variant: 'warning' });
  });

  it('folds the other statuses into open, each with a badge of its own status', () => {
    const beads = ['blocked', 'deferred', 'hooked', 'pinned', 'qa'].map((s) => bead(s, s));
    const board = foldIntoBoardColumns(beads, withReview);
    expect(ids(board.open)).toEqual(['blocked', 'deferred', 'hooked', 'pinned', 'qa']);
    expect(board.open.map((b) => b._statusBadge)).toEqual([
      { label: 'Blocked', variant: 'warning' },
      { label: 'Deferred', variant: 'muted' },
      { label: 'Hooked', variant: 'info' },
      { label: 'Pinned', variant: 'muted' },
      { label: 'Qa', variant: 'info' },
    ]);
    // The bead keeps its real status; only the column is borrowed.
    expect(board.open[0].status).toBe('blocked');
  });

  it('keeps the order it was given, so the sort chosen in the filter bar survives', () => {
    const board = foldIntoBoardColumns([bead('1', 'blocked'), bead('2', 'open'), bead('3', 'deferred')], BUILTIN_STATUSES);
    expect(ids(board.open)).toEqual(['1', '2', '3']);
  });
});
