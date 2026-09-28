import { describe, expect, it } from 'vitest';

import { countBeadsForHome } from '@/lib/home-counts';
import type { Bead } from '@/types';

function bead(status: string): Bead {
  return {
    id: status, title: status, status, priority: 2, issue_type: 'task', owner: '',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', comments: [],
  };
}

describe('countBeadsForHome', () => {
  it('counts the four statuses the home page shows', () => {
    const beads = ['open', 'in_progress', 'inreview', 'closed', 'closed'].map(bead);
    expect(countBeadsForHome(beads)).toEqual({ open: 1, in_progress: 1, inreview: 1, closed: 2 });
  });

  it('counts every other status as open, as the board shows it', () => {
    const beads = ['blocked', 'deferred', 'hooked', 'pinned', 'constructor'].map(bead);
    expect(countBeadsForHome(beads)).toEqual({ open: 5, in_progress: 0, inreview: 0, closed: 0 });
  });
});
