import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BUILTIN_STATUSES } from '@/lib/statuses';
import type { Bead, StatusInfo } from '@/types';

import { BeadDetail } from '../bead-detail';

const updateStatusMock = vi.fn();

vi.mock('@/lib/api', () => ({
  beads: { update: vi.fn() },
  git: { prStatus: vi.fn().mockResolvedValue({ pr: null }) },
}));

vi.mock('@/lib/cli', () => ({
  updateTitle: vi.fn(),
  updateDescription: vi.fn(),
  updateStatus: (...args: unknown[]) => updateStatusMock(...args),
}));

const statuses: StatusInfo[] = [
  ...BUILTIN_STATUSES,
  { name: 'inreview', category: 'wip', builtin: false },
];

function makeBead(status: string): Bead {
  return {
    id: 'b1', title: 'Bead b1', status, priority: 2, issue_type: 'task', owner: 'tester',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', comments: [],
  };
}

function renderDetail(status: string) {
  render(
    <BeadDetail bead={makeBead(status)} open onOpenChange={vi.fn()} projectPath="M:/demo" statuses={statuses} />,
  );
  return screen.getByRole('combobox', { name: 'Status' }) as HTMLSelectElement;
}

const optionValues = (select: HTMLSelectElement) => Array.from(select.options).map((o) => o.value);

beforeEach(() => {
  updateStatusMock.mockReset();
  updateStatusMock.mockResolvedValue(undefined);
});

describe('status choice in the bead detail panel', () => {
  it('offers every status of the project', () => {
    const select = renderDetail('open');
    expect(optionValues(select)).toEqual(statuses.map((s) => s.name));
  });

  it('shows the real status of the bead, not the column it sits in', () => {
    expect(renderDetail('blocked').value).toBe('blocked');
  });

  it('keeps a status missing from the list selectable, so it is not shown as another', () => {
    const select = renderDetail('mystery');
    expect(select.value).toBe('mystery');
    expect(optionValues(select)).toContain('mystery');
  });

  it('sends the chosen status to bd', async () => {
    const select = renderDetail('open');
    fireEvent.change(select, { target: { value: 'deferred' } });
    await waitFor(() => expect(updateStatusMock).toHaveBeenCalledWith('b1', 'deferred', 'M:/demo'));
  });
});
