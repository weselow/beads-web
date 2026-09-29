import { describe, expect, it } from 'vitest';

import { compareBeads } from '@/lib/bead-sort';
import type { Bead } from '@/types';

function bead(id: string, created_at: string): Bead {
  return {
    id, title: id, status: 'open', priority: 2, issue_type: 'task', owner: '',
    created_at, updated_at: created_at, comments: [],
  };
}

const a = bead('a', '2026-01-02T00:00:00Z');
const b = bead('b', '2026-01-01T00:00:00Z');
const c = bead('c', '2026-01-03T00:00:00Z');
const ids = (beads: Bead[]) => beads.map((x) => x.id);

describe('compareBeads', () => {
  it('sorts by creation time, newest first when descending', () => {
    expect(ids([a, b, c].toSorted(compareBeads('created_at', 'desc', new Map())))).toEqual(['c', 'a', 'b']);
    expect(ids([a, b, c].toSorted(compareBeads('created_at', 'asc', new Map())))).toEqual(['b', 'a', 'c']);
  });

  it('sorts by ticket number, a bead without one counting as 0', () => {
    const numbers = new Map([['a', 5], ['c', 2]]);
    expect(ids([a, b, c].toSorted(compareBeads('ticket_number', 'asc', numbers)))).toEqual(['b', 'c', 'a']);
    expect(ids([a, b, c].toSorted(compareBeads('ticket_number', 'desc', numbers)))).toEqual(['a', 'c', 'b']);
  });
});
