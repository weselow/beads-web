import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import KanbanBoard from '../kanban-board';

// The board reads the project id from the URL and redirects when it is missing.
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=p1'),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

// Every hook that talks to the backend is replaced with a fixed answer,
// so the test only exercises rendering.
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

vi.mock('@/hooks/use-beads', () => ({
  useBeads: () => ({
    beads: [],
    beadsByStatus: { open: [], in_progress: [], inreview: [], closed: [] },
    ticketNumbers: new Map<string, number>(),
    isLoading: false,
    error: null,
    stale: null,
    refresh: vi.fn(),
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

// The theme hook reads localStorage, which jsdom does not provide here.
// Use the real default theme definition so the header renders as in the app.
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
  useWorktreeStatuses: () => ({
    statuses: {},
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

// The side panels have their own boundaries and their own data loading —
// stub them so only the board itself is under test, but keep them visible
// so the test can prove the board boundary did not swallow them.
vi.mock('@/components/memory-panel', () => ({
  MemoryPanel: () => <div data-testid="memory-panel" />,
}));

vi.mock('@/components/agents-panel', () => ({
  AgentsPanel: () => <div data-testid="agents-panel" />,
}));

vi.mock('@/components/project-settings-dialog', () => ({
  ProjectSettingsDialog: () => <div data-testid="settings-dialog" />,
}));

vi.mock('@/components/create-bead-dialog', () => ({
  CreateBeadDialog: () => <div data-testid="create-dialog" />,
}));

// A column that always fails to render. Without a boundary around the board
// this takes the whole page down to a blank screen.
vi.mock('@/components/kanban-column', () => ({
  KanbanColumn: () => {
    throw new Error('column blew up');
  },
}));

/**
 * React re-throws a caught render error as a global "error" event, which jsdom
 * then prints in full. Swallow it so the run output stays readable.
 */
function swallowUncaught(event: ErrorEvent) {
  event.preventDefault();
}

beforeEach(() => {
  window.addEventListener('error', swallowUncaught);
  // React logs the caught error itself; keep the test output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  window.removeEventListener('error', swallowUncaught);
  vi.restoreAllMocks();
});

describe('Kanban board error boundary', () => {
  it('shows the fallback instead of crashing when a column fails to render', () => {
    expect(() => render(<KanbanBoard />)).not.toThrow();

    expect(screen.getByText('Kanban Board encountered an error')).toBeInTheDocument();
    expect(screen.getByText('column blew up')).toBeInTheDocument();
  });

  it('keeps the header so the user can still leave the project', () => {
    render(<KanbanBoard />);

    expect(screen.getByText('Demo Project')).toBeInTheDocument();
    expect(screen.getByText('Back to projects')).toBeInTheDocument();
  });

  it('offers a way out of the broken state', () => {
    render(<KanbanBoard />);

    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
  });

  it('leaves the side panels mounted with their own boundaries', () => {
    render(<KanbanBoard />);

    expect(screen.getByTestId('memory-panel')).toBeInTheDocument();
    expect(screen.getByTestId('agents-panel')).toBeInTheDocument();
  });
});
