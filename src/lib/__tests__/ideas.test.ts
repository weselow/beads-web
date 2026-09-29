import { describe, expect, it } from 'vitest';

import {
  deferDate,
  filterBoardTypes,
  isStaleIdea,
  localDateString,
  splitIdeas,
} from '@/lib/ideas';
import { BUILTIN_STATUSES } from '@/lib/statuses';
import type { Bead } from '@/types';

// Local time, so the date arithmetic does not depend on the machine's zone.
const NOW = new Date(2026, 8, 29, 12, 0, 0);

function makeBead(id: string, overrides: Partial<Bead> = {}): Bead {
  return {
    id,
    title: `Bead ${id}`,
    status: 'open',
    priority: 2,
    issue_type: 'story',
    owner: 'tester',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    comments: [],
    ...overrides,
  };
}

const ids = (beads: Bead[]) => beads.map((b) => b.id);

describe('splitIdeas', () => {
  it('takes only stories', () => {
    const beads = [makeBead('s1'), makeBead('t1', { issue_type: 'task' }), makeBead('n1', { issue_type: '' })];
    expect(ids(splitIdeas(beads, BUILTIN_STATUSES, NOW).active)).toEqual(['s1']);
  });

  it('leaves out closed stories and a project\'s own done status', () => {
    const statuses = [...BUILTIN_STATUSES, { name: 'shipped', category: 'done' as const, builtin: false }];
    const beads = [
      makeBead('s1'),
      makeBead('s2', { status: 'closed' }),
      makeBead('s3', { status: 'shipped' }),
      makeBead('s4', { status: 'closed', defer_until: '2027-01-01T00:00:00Z' }),
    ];
    const { active, deferred } = splitIdeas(beads, statuses, NOW);
    expect(ids(active)).toEqual(['s1']);
    expect(deferred).toEqual([]);
  });

  it('puts newest stories first', () => {
    const beads = [
      makeBead('old', { created_at: '2026-01-01T00:00:00Z' }),
      makeBead('new', { created_at: '2026-09-20T00:00:00Z' }),
      makeBead('mid', { created_at: '2026-05-01T00:00:00Z' }),
    ];
    expect(ids(splitIdeas(beads, BUILTIN_STATUSES, NOW).active)).toEqual(['new', 'mid', 'old']);
  });

  it('moves deferred status and a future defer date to the deferred list', () => {
    const beads = [
      makeBead('s1'),
      makeBead('d1', { status: 'deferred' }),
      makeBead('d2', { defer_until: '2026-10-05T00:00:00Z' }),
    ];
    const { active, deferred } = splitIdeas(beads, BUILTIN_STATUSES, NOW);
    expect(ids(active)).toEqual(['s1']);
    expect(ids(deferred).sort()).toEqual(['d1', 'd2']);
  });

  it('keeps a story whose defer date has passed in the main list', () => {
    const beads = [makeBead('s1', { defer_until: '2026-09-01T00:00:00Z' })];
    const { active, deferred } = splitIdeas(beads, BUILTIN_STATUSES, NOW);
    expect(ids(active)).toEqual(['s1']);
    expect(deferred).toEqual([]);
  });

  it('orders deferred stories by return date, undated ones last', () => {
    const beads = [
      makeBead('none', { status: 'deferred' }),
      makeBead('late', { status: 'deferred', defer_until: '2026-12-01T00:00:00Z' }),
      makeBead('soon', { status: 'deferred', defer_until: '2026-10-01T00:00:00Z' }),
    ];
    expect(ids(splitIdeas(beads, BUILTIN_STATUSES, NOW).deferred)).toEqual(['soon', 'late', 'none']);
  });
});

describe('isStaleIdea', () => {
  it('marks a story older than 90 days', () => {
    expect(isStaleIdea(makeBead('s', { created_at: '2026-06-01T00:00:00Z' }), NOW)).toBe(true);
  });

  it('does not mark a story of 89 days', () => {
    const created = new Date(NOW.getTime() - 89 * 24 * 60 * 60 * 1000).toISOString();
    expect(isStaleIdea(makeBead('s', { created_at: created }), NOW)).toBe(false);
  });

  it('does not mark a story with an unreadable date', () => {
    expect(isStaleIdea(makeBead('s', { created_at: 'garbage' }), NOW)).toBe(false);
  });
});

describe('filterBoardTypes', () => {
  const beads = [
    makeBead('s1'),
    makeBead('t1', { issue_type: 'task' }),
    makeBead('n1', { issue_type: '' }),
    makeBead('e1', { issue_type: 'epic' }),
  ];

  it('hides stories when every type is shown', () => {
    expect(ids(filterBoardTypes(beads, 'all'))).toEqual(['t1', 'n1', 'e1']);
  });

  it('shows stories only when Story is picked', () => {
    expect(ids(filterBoardTypes(beads, 'story'))).toEqual(['s1']);
  });

  it('treats a missing type as task', () => {
    expect(ids(filterBoardTypes(beads, 'task'))).toEqual(['t1', 'n1']);
  });
});

describe('localDateString', () => {
  it('uses the local calendar day, not the UTC one', () => {
    // 00:30 local time is still the previous day in UTC east of Greenwich.
    expect(localDateString(new Date(2026, 0, 5, 0, 30))).toBe('2026-01-05');
    expect(localDateString(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});

describe('deferDate', () => {
  it('gives the day a week ahead', () => {
    expect(deferDate('week', NOW)).toBe('2026-10-06');
  });

  it('gives the same day next month', () => {
    expect(deferDate('month', NOW)).toBe('2026-10-29');
  });

  it('keeps the month end within the next month', () => {
    expect(deferDate('month', new Date(2026, 0, 31, 12))).toBe('2026-02-28');
  });

  it('stays on the local day late in the evening', () => {
    expect(deferDate('week', new Date(2026, 8, 29, 23, 45))).toBe('2026-10-06');
  });
});
