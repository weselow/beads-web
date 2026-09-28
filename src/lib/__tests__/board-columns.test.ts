import { describe, expect, it } from 'vitest';

import { buildBoardColumns, columnTitle, orderBoardStatuses } from '@/lib/board-columns';
import { BUILTIN_STATUSES } from '@/lib/statuses';
import type { Bead, StatusInfo } from '@/types';

function bead(id: string, status: string): Bead {
  return {
    id, title: id, status, priority: 2, issue_type: 'task', owner: '',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', comments: [],
  };
}

// Custom statuses listed before the built-in ones on purpose: the order
// inside a group must not depend on where bd put them in the list.
const withCustom: StatusInfo[] = [
  { name: 'qa', category: 'wip', builtin: false },
  { name: 'shipped', category: 'done', builtin: false },
  { name: 'triage', category: 'active', builtin: false },
  { name: 'icebox', category: 'frozen', builtin: false },
  ...BUILTIN_STATUSES,
];

const names = (list: { name: string }[]) => list.map((s) => s.name);
const ids = (beads: Bead[]) => beads.map((b) => b.id);
const column = (columns: ReturnType<typeof buildBoardColumns>, status: string) =>
  columns.find((c) => c.status === status)!;

describe('orderBoardStatuses', () => {
  it('orders built-in statuses by group active, wip, frozen, done and leaves pinned out', () => {
    expect(names(orderBoardStatuses(BUILTIN_STATUSES))).toEqual([
      'open', 'in_progress', 'blocked', 'hooked', 'deferred', 'closed',
    ]);
  });

  it('puts a project\'s own statuses after the built-in ones of the same group', () => {
    expect(names(orderBoardStatuses(withCustom))).toEqual([
      'open', 'triage', 'in_progress', 'blocked', 'hooked', 'qa', 'deferred', 'icebox', 'closed', 'shipped',
    ]);
  });

  it('keeps an open column even when the list lacks one', () => {
    expect(names(orderBoardStatuses([{ name: 'closed', category: 'done', builtin: true }]))).toEqual([
      'open', 'closed',
    ]);
  });
});

describe('columnTitle', () => {
  it('names built-in statuses and shows a project\'s own status as it is', () => {
    expect(['open', 'in_progress', 'blocked', 'deferred', 'closed', 'hooked'].map(columnTitle)).toEqual([
      'Open', 'In Progress', 'Blocked', 'Deferred', 'Closed', 'Hooked',
    ]);
    expect(columnTitle('inreview')).toBe('inreview');
  });
});

describe('buildBoardColumns', () => {
  it('gives every status its own column with its group', () => {
    const columns = buildBoardColumns([bead('b', 'blocked'), bead('q', 'qa')], withCustom);
    expect(ids(column(columns, 'blocked').beads)).toEqual(['b']);
    expect(ids(column(columns, 'qa').beads)).toEqual(['q']);
    expect(column(columns, 'qa').category).toBe('wip');
    expect(column(columns, 'icebox').category).toBe('frozen');
  });

  it('collapses every empty column except open, in_progress and closed', () => {
    const columns = buildBoardColumns([bead('q', 'qa')], withCustom);
    const collapsed = columns.filter((c) => c.collapsed).map((c) => c.status);
    expect(collapsed).toEqual(['triage', 'blocked', 'hooked', 'deferred', 'icebox', 'shipped']);
  });

  it('shows pinned beads at the top of open, marked as pinned', () => {
    const columns = buildBoardColumns([bead('o', 'open'), bead('p', 'pinned')], BUILTIN_STATUSES);
    const open = column(columns, 'open');
    expect(ids(open.beads)).toEqual(['p', 'o']);
    expect(open.beads[0]._statusBadge).toEqual({ label: 'Pinned', variant: 'muted' });
    expect(open.beads[0].status).toBe('pinned');
    expect(open.beads[1]._statusBadge).toBeUndefined();
  });

  it('puts a status missing from the list into open, with a warning badge', () => {
    const columns = buildBoardColumns([bead('x', 'mystery')], BUILTIN_STATUSES);
    const open = column(columns, 'open');
    expect(ids(open.beads)).toEqual(['x']);
    expect(open.beads[0]._statusBadge).toEqual({ label: 'mystery', variant: 'warning' });
    expect(columns.some((c) => c.status === 'mystery')).toBe(false);
  });

  it('keeps the order it was given, so the sort chosen in the filter bar survives', () => {
    const columns = buildBoardColumns([bead('1', 'open'), bead('2', 'mystery'), bead('3', 'open')], BUILTIN_STATUSES);
    expect(ids(column(columns, 'open').beads)).toEqual(['1', '2', '3']);
  });
});
