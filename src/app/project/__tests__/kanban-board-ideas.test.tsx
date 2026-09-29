import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Bead } from '@/types';

import KanbanBoard from '../kanban-board';

// Opening an idea from the Ideas panel must show its card, the same one a
// board card opens. The board, the panel and the card are real here; only
// the backend is replaced.

const { STORY } = vi.hoisted(() => {
  const story: Bead = {
    id: 'idl-1',
    title: 'Dark mode for print',
    description: 'Users print boards',
    status: 'open',
    priority: 2,
    issue_type: 'story',
    owner: 'tester',
    created_at: '2026-09-28T00:00:00Z',
    updated_at: '2026-09-28T00:00:00Z',
    comments: [],
  };
  return { STORY: story };
});

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=p1'),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock('@/hooks/use-project', () => ({
  useProject: () => ({
    project: { id: 'p1', name: 'Demo', path: 'M:/demo', tags: [], lastOpened: '', createdAt: '' },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-beads', () => {
  const beads = [STORY];
  const ticketNumbers = new Map<string, number>();
  const refresh = vi.fn();
  return {
    useBeads: () => ({ beads, ticketNumbers, isLoading: false, error: null, stale: null, refresh }),
  };
});

vi.mock('@/hooks/use-statuses', async () => {
  const { BUILTIN_STATUSES } = await import('@/lib/statuses');
  return { useStatuses: () => ({ statuses: BUILTIN_STATUSES, isLoading: false }) };
});

vi.mock('@/hooks/use-github-status', () => ({
  useGitHubStatus: () => ({ hasRemote: true, isAuthenticated: true, isLoading: false, error: null, refresh: vi.fn() }),
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

vi.mock('@/lib/api', () => ({
  beads: { create: vi.fn(), update: vi.fn() },
  git: { prStatus: vi.fn().mockResolvedValue({ pr: null }) },
  journal: { get: vi.fn().mockResolvedValue({ enabled: false, forced_by_env: false }), set: vi.fn() },
}));

vi.mock('@/lib/cli', () => ({
  addComment: vi.fn(),
  closeBead: vi.fn(),
  updateTitle: vi.fn(),
  updateDescription: vi.fn(),
  updateStatus: vi.fn(),
}));

vi.mock('@/components/memory-panel', () => ({ MemoryPanel: () => null }));
vi.mock('@/components/agents-panel', () => ({ AgentsPanel: () => null }));
vi.mock('@/components/project-settings-dialog', () => ({ ProjectSettingsDialog: () => null }));
vi.mock('@/components/create-bead-dialog', () => ({ CreateBeadDialog: () => null }));

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

/**
 * The card's slide-in panel; it counts as open when slid on screen. Looked up
 * in the DOM directly: while the modal Ideas panel is open, Radix marks the
 * rest of the page aria-hidden, which role queries skip.
 */
function cardPanel() {
  return document.querySelector('button[aria-label="Close panel"]')?.closest('div.fixed');
}

describe('opening an idea from the Ideas panel', () => {
  it('closes the panel so the card is on top and usable', async () => {
    render(<KanbanBoard />);
    fireEvent.click(screen.getByRole('button', { name: /Ideas/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Dark mode for print' }));

    // Let effects and deferred handlers of both panels run.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(cardPanel()).toHaveClass('translate-x-0');
    // Both panels sit on the same layer and the Ideas one is added to the page
    // last, so while it stays open it covers the card and, being modal,
    // blocks clicks on it. Opening a card must close the Ideas panel.
    expect(screen.queryByRole('dialog', { name: 'Ideas' })).not.toBeInTheDocument();
  });
});
