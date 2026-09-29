import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Bead } from '@/types';

import KanbanBoard from '../kanban-board';

// The Board / Tree switch on the project page. The board, the tree and the
// card are real; the backend is replaced, and the address is a small store so
// router.replace redraws the page the way Next.js does.

const { BEAD, data, nav } = vi.hoisted(() => {
  const bead: Bead = {
    id: 'demo-1',
    title: 'Demo bead',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    owner: 'tester',
    created_at: '2026-09-28T00:00:00Z',
    updated_at: '2026-09-28T00:00:00Z',
    comments: [],
  };
  const listeners = new Set<() => void>();
  const store = {
    search: 'id=p1',
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    replace(url: string) {
      store.search = url.replace(/^\?/, '');
      listeners.forEach((listener) => listener());
    },
  };
  // The beads the page gets; a test swaps in its own list before render.
  const data = { beads: [bead], ticketNumbers: new Map<string, number>([['demo-1', 1]]) };
  return { BEAD: bead, data, nav: store };
});

const replace = vi.fn((url: string) => nav.replace(url));

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(nav.subscribe, () => nav.search)),
    useRouter: () => ({ replace, push: vi.fn() }),
  };
});

vi.mock('@/hooks/use-project', () => ({
  useProject: () => ({
    project: { id: 'p1', name: 'Demo', path: 'M:/demo', tags: [], lastOpened: '', createdAt: '' },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-beads', () => {
  const refresh = vi.fn();
  return {
    useBeads: () => ({ beads: data.beads, ticketNumbers: data.ticketNumbers, isLoading: false, error: null, stale: null, refresh }),
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

/** In-memory Storage: Node 25 puts its own empty localStorage over jsdom's. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => Array.from(data.keys())[index] ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, String(value)); },
  };
}

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  nav.search = 'id=p1';
  data.beads = [BEAD];
  data.ticketNumbers = new Map([['demo-1', 1]]);
  replace.mockClear();
  vi.stubGlobal('localStorage', memoryStorage());
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const tree = () => screen.queryByRole('region', { name: 'Bead tree' });
const openColumn = () => screen.queryByRole('region', { name: 'Open' });
const viewButton = (name: 'Board view' | 'Tree view') => screen.getByRole('button', { name });

/** The card's slide-in panel; it counts as open when slid on screen. */
function cardPanel() {
  return document.querySelector('button[aria-label="Close panel"]')?.closest('div.fixed');
}

describe('Board / Tree switch on the project page', () => {
  it('shows the board by default, with Board view pressed', () => {
    render(<KanbanBoard />);

    expect(tree()).not.toBeInTheDocument();
    expect(viewButton('Board view')).toHaveAttribute('aria-pressed', 'true');
    expect(viewButton('Tree view')).toHaveAttribute('aria-pressed', 'false');
    expect(openColumn()).toBeInTheDocument();
  });

  it('switching to the tree puts view=tree in the address and shows the tree', () => {
    nav.search = 'id=p1&x=1';
    render(<KanbanBoard />);

    fireEvent.click(viewButton('Tree view'));

    expect(replace).toHaveBeenCalledWith('?id=p1&x=1&view=tree');
    expect(tree()).toBeInTheDocument();
    expect(openColumn()).not.toBeInTheDocument();
    expect(viewButton('Tree view')).toHaveAttribute('aria-pressed', 'true');
    expect(viewButton('Board view')).toHaveAttribute('aria-pressed', 'false');
  });

  it('switching back to the board drops the parameter and keeps the rest', () => {
    nav.search = 'id=p1&view=tree&x=1';
    render(<KanbanBoard />);

    fireEvent.click(viewButton('Board view'));

    expect(replace).toHaveBeenCalledWith('?id=p1&x=1');
    expect(tree()).not.toBeInTheDocument();
    expect(openColumn()).toBeInTheDocument();
    expect(viewButton('Board view')).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens straight in the tree with ?view=tree', () => {
    nav.search = 'id=p1&view=tree';
    render(<KanbanBoard />);

    expect(tree()).toBeInTheDocument();
    expect(openColumn()).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('treats an unknown view as the board', () => {
    nav.search = 'id=p1&view=list';
    render(<KanbanBoard />);

    expect(tree()).not.toBeInTheDocument();
    expect(viewButton('Board view')).toHaveAttribute('aria-pressed', 'true');
  });

  it('a click on a tree row opens the bead card', async () => {
    nav.search = 'id=p1&view=tree';
    render(<KanbanBoard />);

    fireEvent.click(within(tree()!).getByRole('button', { name: 'Demo bead' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(cardPanel()).toHaveClass('translate-x-0');
  });

  it('keeps the board keys to the board', async () => {
    const pickAndOpen = async () => {
      fireEvent.keyDown(window, { key: 'j' });
      fireEvent.keyDown(window, { key: 'Enter' });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    };

    nav.search = 'id=p1&view=tree';
    const { unmount } = render(<KanbanBoard />);
    await pickAndOpen();
    // The tree gets keys of its own later; the column keys must not act on it.
    expect(cardPanel()).toBeFalsy();
    unmount();

    nav.search = 'id=p1';
    render(<KanbanBoard />);
    await pickAndOpen();
    expect(cardPanel()).toHaveClass('translate-x-0');
  });

  it('applies the filter bar search to the tree', async () => {
    nav.search = 'id=p1&view=tree';
    render(<KanbanBoard />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Search beads' }), { target: { value: 'no such bead' } });
    // The search is debounced by 300 ms.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(within(tree()!).queryByRole('button', { name: 'Demo bead' })).not.toBeInTheDocument();
    expect(within(tree()!).getByText('No beads match the filters')).toBeInTheDocument();
  });

  it('the Milestone type filter shows each milestone with its whole branch', () => {
    const child = (id: string, title: string, extra: Partial<Bead>) => ({ ...BEAD, id, title, ...extra });
    data.beads = [
      child('m-1', 'Release 1.0', { issue_type: 'milestone' }),
      child('e-1', 'Payments epic', { issue_type: 'epic', parent_id: 'm-1' }),
      child('t-1', 'Card form', { parent_id: 'e-1' }),
      BEAD,
    ];
    data.ticketNumbers = new Map(data.beads.map((b, i) => [b.id, i + 1]));
    nav.search = 'id=p1&view=tree';
    render(<KanbanBoard />);

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Filter by issue type' }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Milestone' }));

    const view = within(tree()!);
    for (const title of ['Release 1.0', 'Payments epic', 'Card form']) {
      expect(view.getByRole('button', { name: title })).toBeInTheDocument();
    }
    expect(view.queryByRole('button', { name: 'Demo bead' })).not.toBeInTheDocument();
  });
});
