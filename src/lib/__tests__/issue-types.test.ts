import { CircleDot } from 'lucide-react';
import { describe, it, expect } from 'vitest';

import { ISSUE_TYPES, getIssueTypeMeta } from '@/lib/issue-types';

describe('getIssueTypeMeta', () => {
  it('returns matching metadata for every known type', () => {
    for (const meta of ISSUE_TYPES) {
      const result = getIssueTypeMeta(meta.value);
      expect(result.value).toBe(meta.value);
      expect(result.label).toBe(meta.label);
      expect(result.icon).toBe(meta.icon);
      expect(result.colorClass).toBe(meta.colorClass);
    }
  });

  it('resolves the newer issue types added in bd v1.0', () => {
    expect(getIssueTypeMeta('story').label).toBe('Story');
    expect(getIssueTypeMeta('spike').label).toBe('Spike');
    expect(getIssueTypeMeta('milestone').label).toBe('Milestone');
    expect(getIssueTypeMeta('epic').label).toBe('Epic');
  });

  it('falls back to task for an unknown value', () => {
    const result = getIssueTypeMeta('nonsense-type');
    expect(result.value).toBe('task');
    expect(result.label).toBe('Task');
    expect(result.icon).toBe(CircleDot);
  });

  it('falls back to task for missing or empty values', () => {
    expect(getIssueTypeMeta(undefined).value).toBe('task');
    expect(getIssueTypeMeta(null).value).toBe('task');
    expect(getIssueTypeMeta('').value).toBe('task');
  });
});
