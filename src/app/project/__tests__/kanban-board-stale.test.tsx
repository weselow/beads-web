import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StaleSource } from '@/lib/beads-parser';
import { BUILTIN_STATUSES } from '@/lib/statuses';
import type { Bead, StatusInfo } from '@/types';

import KanbanBoard from '../kanban-board';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=p1'),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock('@/hooks/use-project', () => ({
  useProject: () => ({
    project: {
      id: 'p1',
      name: 'Demo Project',
      path: 'M:/demo',
      tags: [],
      lastOpened: '2026-01-01T00:00:00Z',
      createdAt: '2026-01-01T00:00:00Z',
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

const bead: Bead = {
  id: 'demo-1',
  title: 'Demo bead',
  status: 'open',
  priority: 2,
  issue_type: 'task',
  owner: 'user',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  comments: [],
};

// The value useBeads reports; each test sets it before rendering.
let currentStale: StaleSource | null = null;

vi.mock('@/hooks/use-beads', () => ({
  useBeads: () => ({
    beads: [bead],
    ticketNumbers: new Map<string, number>(),
    isLoading: false,
    error: null,
    stale: currentStale,
    refresh: vi.fn(),
  }),
}));

// The project's status list; each test may replace it before rendering.
let currentStatuses: readonly StatusInfo[] = BUILTIN_STATUSES;

vi.mock('@/hooks/use-statuses', () => ({
  useStatuses: () => ({ statuses: currentStatuses, isLoading: false }),
}));

// Keep the detail panel open on one bead, so its read-only flag can be seen.
vi.mock('@/hooks/use-bead-detail', () => ({
  useBeadDetail: () => ({
    detailBead: bead,
    isDetailOpen: true,
    canGoBack: false,
    openBead: vi.fn(),
    pushBead: vi.fn(),
    goBack: vi.fn(),
    handleDetailOpenChange: vi.fn(),
    navigateToBead: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-github-status', () => ({
  useGitHubStatus: () => ({
    hasRemote: true,
    isAuthenticated: true,
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-theme', async () => {
  const { getTheme } = await import('@/lib/themes');
  return {
    useTheme: () => {
      const theme = getTheme('default');
      return { theme, layout: theme.layout, themeId: 'default' };
    },
  };
});

vi.mock('@/hooks/use-worktree-statuses', () => ({
  useWorktreeStatuses: () => ({ statuses: {}, isLoading: false, error: null, refresh: vi.fn() }),
}));

// Stubs that show the read-only flag each write area received.
function flagStub(testId: string) {
  function FlagStub({ readOnly, status, collapsed, children }: {
    readOnly?: boolean; status?: string; collapsed?: boolean; children?: React.ReactNode;
  }) {
    return (
      <div data-testid={testId} data-read-only={String(readOnly === true)} data-status={status} data-collapsed={collapsed}>
        {children}
      </div>
    );
  }
  return FlagStub;
}

vi.mock('@/components/kanban-column', () => ({ KanbanColumn: flagStub('column') }));
vi.mock('@/components/bead-detail', () => ({ BeadDetail: flagStub('bead-detail') }));
vi.mock('@/components/comment-list', () => ({ CommentList: flagStub('comment-list') }));
vi.mock('@/components/memory-panel', () => ({ MemoryPanel: flagStub('memory-panel') }));
vi.mock('@/components/activity-timeline', () => ({ ActivityTimeline: () => null }));
vi.mock('@/components/agents-panel', () => ({ AgentsPanel: () => null }));
vi.mock('@/components/project-settings-dialog', () => ({ ProjectSettingsDialog: () => null }));
vi.mock('@/components/create-bead-dialog', () => ({ CreateBeadDialog: () => null }));

function readOnlyFlags(): string[] {
  const ids = ['column', 'bead-detail', 'comment-list', 'memory-panel'];
  return ids.flatMap((id) =>
    screen.getAllByTestId(id).map((el) => el.getAttribute('data-read-only') ?? 'missing'),
  );
}

beforeEach(() => {
  currentStale = null;
  currentStatuses = BUILTIN_STATUSES;
});

describe('Kanban board on an old copy from issues.jsonl', () => {
  it('shows the banner and disables every write area', () => {
    currentStale = { reason: 'bd exited with exit code: 1', modifiedAt: '2026-07-15T12:00:00Z' };

    render(<KanbanBoard />);

    expect(screen.getByText(/Showing an old copy from Jul 15, 2026/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new/i })).toBeDisabled();
    expect(readOnlyFlags().every((flag) => flag === 'true')).toBe(true);
  });

  it('shows no banner and keeps writes enabled on current data', () => {
    render(<KanbanBoard />);

    expect(screen.queryByText(/Showing an old copy/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new/i })).toBeEnabled();
    expect(readOnlyFlags().every((flag) => flag === 'false')).toBe(true);
  });
});

describe('Kanban board columns', () => {
  const columns = () => screen.getAllByTestId('column');
  const statusesOf = (els: HTMLElement[]) => els.map((el) => el.getAttribute('data-status'));

  it('draws a column per status, by group, with pinned left out', () => {
    render(<KanbanBoard />);

    expect(statusesOf(columns())).toEqual(['open', 'in_progress', 'blocked', 'hooked', 'deferred', 'closed']);
  });

  it('collapses the empty columns other than open, in_progress and closed', () => {
    render(<KanbanBoard />);

    const collapsed = columns().filter((el) => el.getAttribute('data-collapsed') === 'true');
    expect(statusesOf(collapsed)).toEqual(['blocked', 'hooked', 'deferred']);
  });

  it("draws the project's own status after the built-in ones of its group", () => {
    currentStatuses = [...BUILTIN_STATUSES, { name: 'inreview', category: 'wip', builtin: false }];

    render(<KanbanBoard />);

    expect(statusesOf(columns())).toEqual([
      'open', 'in_progress', 'blocked', 'hooked', 'inreview', 'deferred', 'closed',
    ]);
  });
});
