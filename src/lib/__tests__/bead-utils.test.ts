import { describe, it, expect } from 'vitest';

import {
  formatBeadId,
  formatStatus,
  formatShortDate,
  formatWorktreePath,
  getStatusDotColor,
  truncate,
  isBlocked,
} from '@/lib/bead-utils';

describe('formatBeadId', () => {
  it('preserves and upper-cases the workspace prefix', () => {
    expect(formatBeadId('pa-pne9')).toBe('PA-pne9');
    expect(formatBeadId('dc-xyz')).toBe('DC-xyz');
    expect(formatBeadId('beads-web-2m8')).toBe('BEADS-WEB-2m8');
  });

  it('handles the default bd prefix', () => {
    expect(formatBeadId('bd-abc')).toBe('BD-abc');
    expect(formatBeadId('BD-ABC')).toBe('BD-ABC');
  });

  it('keeps the last segment as the short id for multi-dash ids', () => {
    expect(formatBeadId('beads-kanban-ui-abc123')).toBe('BEADS-KANBAN-UI-abc123');
  });

  it('truncates a long suffix to maxLen', () => {
    expect(formatBeadId('bd-abcdefghijklm', 6)).toBe('BD-abcdef');
    expect(formatBeadId('project-abcdefgh', 8)).toBe('PROJECT-abcdefgh');
    expect(formatBeadId('project-abcdefgh', 4)).toBe('PROJECT-abcd');
  });

  it('upper-cases ids without a dash', () => {
    expect(formatBeadId('nodash')).toBe('NODASH');
  });
});

describe('formatStatus', () => {
  it('formats known statuses', () => {
    expect(formatStatus('open')).toBe('Open');
    expect(formatStatus('in_progress')).toBe('In Progress');
    expect(formatStatus('inreview')).toBe('In Review');
    expect(formatStatus('closed')).toBe('Closed');
  });

  it('returns unknown status as-is', () => {
    // @ts-expect-error testing unknown status
    expect(formatStatus('unknown')).toBe('unknown');
  });
});

describe('getStatusDotColor', () => {
  it('returns correct color classes', () => {
    expect(getStatusDotColor('open')).toContain('status-open');
    expect(getStatusDotColor('in_progress')).toContain('status-progress');
    expect(getStatusDotColor('inreview')).toContain('status-review');
    expect(getStatusDotColor('closed')).toContain('status-closed');
  });
});

describe('formatShortDate', () => {
  it('formats valid dates', () => {
    const result = formatShortDate('2025-01-23T10:00:00Z');
    expect(result).toContain('Jan');
    expect(result).toContain('23');
    expect(result).toContain('2025');
  });

  it('returns original string for invalid dates', () => {
    expect(formatShortDate('not-a-date')).toBe('not-a-date');
  });
});

describe('formatWorktreePath', () => {
  it('extracts worktree folder name', () => {
    expect(formatWorktreePath('/repo/.worktrees/bd-abc123')).toBe('bd-abc123');
  });

  it('falls back to last path segment', () => {
    expect(formatWorktreePath('/some/path/folder')).toBe('folder');
  });

  it('returns original for simple paths', () => {
    expect(formatWorktreePath('simple')).toBe('simple');
  });
});

describe('truncate', () => {
  it('returns short text unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates long text with ellipsis', () => {
    const result = truncate('hello world this is long', 10);
    expect(result.length).toBeLessThanOrEqual(14); // 10 + trim + ellipsis
    expect(result).toContain('\u2026');
  });
});

describe('isBlocked', () => {
  it('returns false for closed tasks even with open deps', () => {
    const allBeads = [{ id: 'dep1', status: 'open' }];
    expect(isBlocked({ status: 'closed', deps: ['dep1'] }, allBeads)).toBe(false);
  });

  it('returns false for open tasks whose only dep is closed', () => {
    const allBeads = [{ id: 'dep1', status: 'closed' }];
    expect(isBlocked({ status: 'open', deps: ['dep1'] }, allBeads)).toBe(false);
  });

  it('returns true when at least one dep is not closed (one open, one closed)', () => {
    const allBeads = [
      { id: 'dep1', status: 'closed' },
      { id: 'dep2', status: 'open' },
    ];
    expect(isBlocked({ status: 'open', deps: ['dep1', 'dep2'] }, allBeads)).toBe(true);
  });

  it('returns true when dep is in_progress', () => {
    const allBeads = [{ id: 'dep1', status: 'in_progress' }];
    expect(isBlocked({ status: 'open', deps: ['dep1'] }, allBeads)).toBe(true);
  });

  it('returns false when dep references a missing bead', () => {
    const allBeads = [{ id: 'other', status: 'open' }];
    expect(isBlocked({ status: 'open', deps: ['ghost'] }, allBeads)).toBe(false);
  });

  it('returns false for open task with empty deps array', () => {
    expect(isBlocked({ status: 'open', deps: [] }, [])).toBe(false);
  });

  it('returns false for open task without deps property', () => {
    expect(isBlocked({ status: 'open' }, [])).toBe(false);
  });

  it('returns false when deps is null', () => {
    expect(isBlocked({ status: 'open', deps: null }, [])).toBe(false);
  });
});
