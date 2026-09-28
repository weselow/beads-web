import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Bead, PRStatus } from '@/types';

import { BeadPRSection } from '../bead-pr-section';

// A pushed branch without a PR: the section offers Create PR.
const pushedWithoutPR: PRStatus = {
  has_remote: true,
  branch_pushed: true,
  pr: null,
  rate_limit: { remaining: 5000, limit: 5000, reset_at: '' },
};

vi.mock('@/hooks/use-pr-status', () => ({
  usePRStatus: () => ({ status: pushedWithoutPR, isLoading: false, error: null, refresh: vi.fn() }),
}));

vi.mock('@/lib/api', () => ({ git: {} }));

function renderSection(status: string) {
  const bead: Bead = {
    id: 'b1', title: 'Bead b1', status, priority: 2, issue_type: 'task', owner: 'tester',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', comments: [],
  };
  render(
    <BeadPRSection
      bead={bead}
      worktreeStatus={{ exists: true, worktree_path: 'M:/demo/.worktrees/bd-b1', branch: 'bd-b1', ahead: 1, behind: 0, dirty: false, last_modified: null }}
      projectPath="M:/demo"
      open
    />,
  );
}

describe('Create PR', () => {
  it.each(['open', 'in_progress', 'hooked', 'inreview'])('is available for a pushed branch in status %s', (status) => {
    renderSection(status);
    expect(screen.getByRole('button', { name: /create pr/i })).toBeEnabled();
    expect(screen.queryByText(/must be in review/i)).not.toBeInTheDocument();
  });
});
