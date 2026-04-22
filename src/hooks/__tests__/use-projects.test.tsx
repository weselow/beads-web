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
  // Not called in these tests because loadProjectBeads never resolves, but
  // keep a stub so importers don't crash.
  groupBeadsByStatus: vi.fn(() => ({
    open: [],
    in_progress: [],
    inreview: [],
    closed: [],
  })),
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
        open: 3,
        in_progress: 1,
        inreview: 0,
        closed: 5,
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
    expect(seeded.beadCounts).toEqual({
      open: 3,
      in_progress: 1,
      inreview: 0,
      closed: 5,
    });
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
    expect(seeded.beadCounts).toEqual({
      open: 0,
      in_progress: 0,
      inreview: 0,
      closed: 0,
    });
  });
});
