import { CircleDashed, Scale, Wrench } from 'lucide-react';
import { describe, it, expect } from 'vitest';

import {
  ISSUE_TYPES,
  descriptionPlaceholder,
  getIssueTypeMeta,
  issueTypeChoices,
} from '@/lib/issue-types';

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

  it('knows chore and decision', () => {
    expect(getIssueTypeMeta('chore')).toMatchObject({ value: 'chore', label: 'Chore', icon: Wrench });
    expect(getIssueTypeMeta('decision')).toMatchObject({ value: 'decision', label: 'Decision', icon: Scale });
  });

  it('offers chore and decision in the shared type list', () => {
    const values = ISSUE_TYPES.map((meta) => meta.value);
    expect(values).toContain('chore');
    expect(values).toContain('decision');
  });

  it('shows an unknown type under its own name with a neutral icon, not as Task', () => {
    const result = getIssueTypeMeta('convoy');
    expect(result.value).toBe('convoy');
    expect(result.label).toBe('Convoy');
    expect(result.icon).toBe(CircleDashed);
    expect(result.colorClass).toBe('text-t-muted');
  });

  it('falls back to task for missing or empty values', () => {
    expect(getIssueTypeMeta(undefined).value).toBe('task');
    expect(getIssueTypeMeta(null).value).toBe('task');
    expect(getIssueTypeMeta('').value).toBe('task');
  });
});

describe('issueTypeChoices', () => {
  it('is the shared list when the current type is known', () => {
    expect(issueTypeChoices('task')).toEqual(ISSUE_TYPES);
  });

  it('adds an unknown current type, so a choice shows it and not another type', () => {
    const values = issueTypeChoices('convoy').map((meta) => meta.value);
    expect(values).toEqual([...ISSUE_TYPES.map((meta) => meta.value), 'convoy']);
  });
});

describe('descriptionPlaceholder', () => {
  const cases: Array<[string, string[]]> = [
    ['task', ['Acceptance Criteria']],
    ['feature', ['Acceptance Criteria']],
    ['story', ['Acceptance Criteria']],
    ['epic', ['Success Criteria']],
    ['spike', ['Goal', 'Findings']],
    ['decision', ['Decision', 'Rationale', 'Alternatives Considered']],
  ];

  it.each(cases)('lists the sections bd lint expects for %s', (type, sections) => {
    const text = descriptionPlaceholder(type);
    for (const section of sections) {
      expect(text).toContain(`## ${section}`);
    }
  });

  it.each(['bug', 'chore', 'milestone', 'convoy'])('suggests no sections for %s', (type) => {
    expect(descriptionPlaceholder(type)).toBe('Optional details…');
  });
});
