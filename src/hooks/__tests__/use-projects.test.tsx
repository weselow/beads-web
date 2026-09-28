import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Project } from '@/types';

// --- Mocks ------------------------------------------------------------------
//
// `useProjects` composes two dependencies:
//   - `getProjectsWithTags` (src/lib/db) — returns the project list with
//     `cachedCounts` attached by the backend.
//   - `loadProjectBeads` (src/lib/beads-parser) — fetches fresh beads per
//     project and normally overwrites the cached seed.
//
// We mock both. `loadProjectBeads` is made to never resolve so the hook
// stays in the "cached seed only" state and we can assert the initial
// render uses the cached counts, not zeros.

const getProjectsWithTagsMock = vi.fn();
const loadProjectBeadsMock = vi.fn();

vi.mock('@/lib/db', () => ({
  getProjectsWithTags: (...args: unknown[]) => getProjectsWithTagsMock(...args),
  createProject: vi.fn(),
}));

vi.mock('@/lib/beads-parser', () => ({
  loadProjectBeads: (...args: unknown[]) => loadProjectBeadsMock(...args),
}));

vi.mock('@/lib/api', () => ({
  projects: {
    archive: vi.fn(),
    unarchive: vi.fn(),
    delete: vi.fn(),
  },
}));

// Import AFTER mocks so the hook picks them up.
// eslint-disable-next-line import/first, import/order
import { useProjects } from '../use-projects';

beforeEach(() => {
  getProjectsWithTagsMock.mockReset();
  loadProjectBeadsMock.mockReset();
  // Never resolve — lets us observe the cached-seed state in isolation.
  loadProjectBeadsMock.mockImplementation(() => new Promise(() => {}));
});

describe('useProjects — cached counts seeding', () => {
  it('seeds beadCounts from server cachedCounts on initial render', async () => {
    const project: Project = {
      id: 'p1',
      name: 'cached-project',
      path: '/tmp/cached-project',
      tags: [],
      lastOpened: '2026-04-22T00:00:00Z',
      createdAt: '2026-04-22T00:00:00Z',
      cachedCounts: {
        active: 3,
        wip: 1,
        frozen: 2,
        done: 5,
        dataSource: 'dolt-direct',
        updatedAt: '2026-04-22T00:00:00Z',
      },
    };

    getProjectsWithTagsMock.mockResolvedValueOnce([project]);

    const { result } = renderHook(() => useProjects());

    // Wait for the fetch to populate state. `isLoading` flips to false
    // right after the seed step, before beads fetching starts.
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.projects).toHaveLength(1);
    const seeded = result.current.projects[0];
    expect(seeded.beadCounts).toEqual({ active: 3, wip: 1, frozen: 2, done: 5 });
    expect(seeded.countsLoaded).toBe(true);
    expect(seeded.dataSource).toBe('dolt-direct');
  });

  it('leaves countsLoaded false when no cache exists, so donut renders as dashed', async () => {
    const project: Project = {
      id: 'p2',
      name: 'fresh-project',
      path: '/tmp/fresh-project',
      tags: [],
      lastOpened: '2026-04-22T00:00:00Z',
      createdAt: '2026-04-22T00:00:00Z',
      cachedCounts: null,
    };

    getProjectsWithTagsMock.mockResolvedValueOnce([project]);

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const seeded = result.current.projects[0];
    expect(seeded.countsLoaded).toBe(false);
    // Zero counts are a fallback — NOT a real "0 tasks" signal. The
    // dashed donut rendering in project-card distinguishes these.
    expect(seeded.beadCounts).toEqual({ active: 0, wip: 0, frozen: 0, done: 0 });
  });
});

describe('useProjects — fresh counts', () => {
  const project: Project = {
    id: 'p3',
    name: 'live-project',
    path: '/tmp/live-project',
    tags: [],
    lastOpened: '2026-09-29T00:00:00Z',
    createdAt: '2026-09-29T00:00:00Z',
    cachedCounts: null,
  };

  it('takes the counts the server sent, without counting the beads again', async () => {
    getProjectsWithTagsMock.mockResolvedValueOnce([project]);
    loadProjectBeadsMock.mockReset();
    loadProjectBeadsMock.mockResolvedValueOnce({
      // One open bead, yet the server says otherwise: its numbers win.
      beads: [{ id: 'a', status: 'open' }],
      source: 'cli',
      stale: null,
      counts: { active: 4, wip: 2, frozen: 1, done: 9 },
    });

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.projects[0]?.dataSource).toBe('cli');
    });
    const loaded = result.current.projects[0];
    expect(loaded.beadCounts).toEqual({ active: 4, wip: 2, frozen: 1, done: 9 });
    expect(loaded.countsLoaded).toBe(true);
    expect(loaded.beadError).toBeUndefined();
  });

  it('reports an error when the server sent no counts', async () => {
    getProjectsWithTagsMock.mockResolvedValueOnce([project]);
    loadProjectBeadsMock.mockReset();
    loadProjectBeadsMock.mockResolvedValueOnce({ beads: [], source: 'cli', stale: null });

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.projects[0]?.beadError).toBeDefined();
    });
    expect(result.current.projects[0].beadError).toMatch(/counts/i);
  });
});
