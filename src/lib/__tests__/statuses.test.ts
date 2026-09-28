import { describe, expect, it } from 'vitest';

import { BUILTIN_STATUSES, getStatusCategory, isDoneStatus } from '@/lib/statuses';
import type { StatusInfo } from '@/types';

const statuses: StatusInfo[] = [
  ...BUILTIN_STATUSES,
  { name: 'inreview', category: 'wip', builtin: false },
  { name: 'shipped', category: 'done', builtin: false },
];

describe('BUILTIN_STATUSES', () => {
  it('lists the seven statuses bd 1.3.0 knows, in its order', () => {
    expect(BUILTIN_STATUSES.map((s) => s.name)).toEqual([
      'open', 'in_progress', 'blocked', 'deferred', 'closed', 'pinned', 'hooked',
    ]);
    expect(BUILTIN_STATUSES.every((s) => s.builtin)).toBe(true);
  });
});

describe('getStatusCategory', () => {
  it('returns the group of a built-in status', () => {
    expect(getStatusCategory('open', statuses)).toBe('active');
    expect(getStatusCategory('blocked', statuses)).toBe('wip');
    expect(getStatusCategory('deferred', statuses)).toBe('frozen');
    expect(getStatusCategory('closed', statuses)).toBe('done');
  });

  it('returns the group of a project status', () => {
    expect(getStatusCategory('inreview', statuses)).toBe('wip');
  });

  it('returns undefined for a status missing from the list', () => {
    expect(getStatusCategory('mystery', statuses)).toBeUndefined();
  });
});

describe('isDoneStatus', () => {
  it('is true for every status in the done group', () => {
    expect(isDoneStatus('closed', statuses)).toBe(true);
    expect(isDoneStatus('shipped', statuses)).toBe(true);
  });

  it('is false for other groups and for unknown statuses', () => {
    expect(isDoneStatus('open', statuses)).toBe(false);
    expect(isDoneStatus('inreview', statuses)).toBe(false);
    expect(isDoneStatus('mystery', statuses)).toBe(false);
  });
});
