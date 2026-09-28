import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Bead } from '@/types';

import { useBeadFilters } from '../use-bead-filters';

function bead(id: string, status: string): Bead {
  return {
    id, title: id, status, priority: 2, issue_type: 'task', owner: '',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', comments: [],
  };
}

describe('useBeadFilters status filter', () => {
  it('filters by any status of the project, not only the four columns', () => {
    const beads = [bead('a', 'open'), bead('b', 'blocked'), bead('c', 'inreview')];
    const { result } = renderHook(() => useBeadFilters(beads, new Map(), 0));

    act(() => result.current.setFilters({ statuses: ['blocked', 'inreview'] }));

    expect(result.current.filteredBeads.map((b) => b.id).sort()).toEqual(['b', 'c']);
  });
});
