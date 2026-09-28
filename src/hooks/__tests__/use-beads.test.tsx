import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Bead } from '@/types';

const loadProjectBeadsMock = vi.fn();
let watchedChange: (() => void) | undefined;

vi.mock('@/lib/beads-parser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/beads-parser')>();
  return {
    ...actual,
    loadProjectBeads: (...args: unknown[]) => loadProjectBeadsMock(...args),
  };
});

vi.mock('@/hooks/use-file-watcher', () => ({
  useFileWatcher: (
    _projectPath: string,
    onFileChange: () => void,
  ) => {
    watchedChange = onFileChange;
    return { isWatching: true, error: null };
  },
}));

// Import after mocks so useBeads receives the test implementations.
// eslint-disable-next-line import/first, import/order
import { useBeads } from '../use-beads';

const baseBead: Bead = {
  id: 'test-1',
  title: 'Test',
  status: 'open',
  priority: 2,
  issue_type: 'task',
  owner: 'user',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  comments: [],
};

/**
 * Intercepts the polling timer so a test can fire one poll by hand.
 * `interval` records the period of the latest polling timer that was set up.
 */
function capturePoll(): { current?: () => void; interval?: number } {
  const poll: { current?: () => void; interval?: number } = {};
  const realSetInterval = globalThis.setInterval;
  vi.spyOn(globalThis, 'setInterval').mockImplementation((handler, timeout, ...args) => {
    if (timeout === 15_000 || timeout === 5_000) {
      poll.current = handler as () => void;
      poll.interval = timeout;
    }
    return realSetInterval(handler, timeout, ...args);
  });
  return poll;
}

beforeEach(() => {
  loadProjectBeadsMock.mockReset();
  watchedChange = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useBeads full refreshes', () => {
  it('bypasses updatedAfter when a full refresh is requested', async () => {
    loadProjectBeadsMock
      .mockResolvedValueOnce({ beads: [baseBead], source: 'jsonl' })
      .mockResolvedValueOnce({ beads: [], source: 'jsonl' })
      .mockResolvedValueOnce({
        beads: [{
          ...baseBead,
          comments: [{
            id: 'comment-1',
            issue_id: baseBead.id,
            author: 'user',
            text: 'Visible',
            created_at: '2026-01-02T00:00:00Z',
          }],
        }],
        source: 'jsonl',
      });

    const { result } = renderHook(() => useBeads('/tmp/project'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.refresh();
    });
    expect(loadProjectBeadsMock.mock.calls[1][1]).toMatchObject({
      withSource: true,
      updatedAfter: baseBead.updated_at,
    });

    await act(async () => {
      await result.current.refresh({ full: true });
    });
    expect(loadProjectBeadsMock.mock.calls[2][1]).toEqual({
      withSource: true,
      updatedAfter: undefined,
    });
    expect(result.current.beads[0].comments[0].text).toBe('Visible');
  });

  it('never asks the server for a full re-read', async () => {
    const poll = capturePoll();
    // Every read reports a changed comment total, so the poll also makes its
    // second, full read.
    let total = 0;
    loadProjectBeadsMock.mockImplementation(async () => ({
      beads: [baseBead],
      source: 'cli',
      commentTotal: total++,
    }));

    const { result } = renderHook(() => useBeads('C:\project'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(poll.current).toBeTypeOf('function'));

    await act(async () => {
      await result.current.refresh({ full: true });
    });
    act(() => {
      watchedChange?.();
    });
    await waitFor(() => expect(loadProjectBeadsMock).toHaveBeenCalledTimes(3));
    await act(async () => {
      poll.current?.();
    });
    await waitFor(() => expect(loadProjectBeadsMock).toHaveBeenCalledTimes(5));

    for (const [, options] of loadProjectBeadsMock.mock.calls) {
      expect(options).not.toHaveProperty('full');
    }
  });

  it('uses a full refresh for JSONL watcher notifications', async () => {
    loadProjectBeadsMock
      .mockResolvedValueOnce({ beads: [baseBead], source: 'jsonl' })
      .mockResolvedValueOnce({
        beads: [{
          ...baseBead,
          comments: [{
            id: 'comment-1',
            issue_id: baseBead.id,
            author: 'user',
            text: 'External comment',
            created_at: '2026-01-02T00:00:00Z',
          }],
        }],
        source: 'jsonl',
      });

    const { result } = renderHook(() => useBeads('/tmp/project'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      watchedChange?.();
    });

    await waitFor(() => {
      expect(result.current.beads[0].comments[0]?.text).toBe('External comment');
    });
    expect(loadProjectBeadsMock.mock.calls[1][1]).toEqual({
      withSource: true,
      updatedAfter: undefined,
    });
  });

  it('polls incrementally while the comment total is unchanged', async () => {
    const poll = capturePoll();

    loadProjectBeadsMock
      .mockResolvedValueOnce({ beads: [baseBead], source: 'cli', commentTotal: 0 })
      .mockResolvedValueOnce({ beads: [], source: 'cli', commentTotal: 0 });

    const { result } = renderHook(() => useBeads('C:\project'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(poll.current).toBeTypeOf('function'));

    await act(async () => {
      poll.current?.();
    });

    await waitFor(() => expect(loadProjectBeadsMock).toHaveBeenCalledTimes(2));
    expect(loadProjectBeadsMock.mock.calls[1][1]).toEqual({
      withSource: true,
      updatedAfter: baseBead.updated_at,
    });
    // No extra full refresh — the incremental poll was enough.
    expect(loadProjectBeadsMock).toHaveBeenCalledTimes(2);
  });

  it('runs a full refresh when the comment total changed', async () => {
    const poll = capturePoll();

    loadProjectBeadsMock
      .mockResolvedValueOnce({ beads: [baseBead], source: 'cli', commentTotal: 0 })
      .mockResolvedValueOnce({ beads: [], source: 'cli', commentTotal: 1 })
      .mockResolvedValueOnce({
        beads: [{
          ...baseBead,
          comments: [{
            id: 'comment-1',
            issue_id: baseBead.id,
            author: 'user',
            text: 'Polled comment',
            created_at: '2026-01-02T00:00:00Z',
          }],
        }],
        source: 'cli',
        commentTotal: 1,
      });

    const { result } = renderHook(() => useBeads('C:\project'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(poll.current).toBeTypeOf('function'));

    await act(async () => {
      poll.current?.();
    });

    await waitFor(() => {
      expect(result.current.beads[0].comments[0]?.text).toBe('Polled comment');
    });
    expect(loadProjectBeadsMock.mock.calls[1][1]).toEqual({
      withSource: true,
      updatedAfter: baseBead.updated_at,
    });
    expect(loadProjectBeadsMock.mock.calls[2][1]).toEqual({
      withSource: true,
      updatedAfter: undefined,
    });
  });

  it('falls back to a full refresh when the server reports no comment total', async () => {
    const poll = capturePoll();

    loadProjectBeadsMock
      .mockResolvedValueOnce({ beads: [baseBead], source: 'cli' })
      .mockResolvedValueOnce({ beads: [], source: 'cli' })
      .mockResolvedValueOnce({
        beads: [{
          ...baseBead,
          comments: [{
            id: 'comment-1',
            issue_id: baseBead.id,
            author: 'user',
            text: 'Legacy server comment',
            created_at: '2026-01-02T00:00:00Z',
          }],
        }],
        source: 'cli',
      });

    const { result } = renderHook(() => useBeads('C:\project'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(poll.current).toBeTypeOf('function'));

    await act(async () => {
      poll.current?.();
    });

    await waitFor(() => {
      expect(result.current.beads[0].comments[0]?.text).toBe('Legacy server comment');
    });
    expect(loadProjectBeadsMock.mock.calls[2][1]).toEqual({
      withSource: true,
      updatedAfter: undefined,
    });
  });
});

describe('useBeads with the events journal', () => {
  const secondBead: Bead = {
    ...baseBead,
    id: 'test-2',
    title: 'Second',
    created_at: '2026-01-01T00:00:01Z',
    updated_at: '2026-01-01T00:00:01Z',
  };

  it('replaces the list with a complete poll response, so a deleted bead disappears', async () => {
    const poll = capturePoll();

    loadProjectBeadsMock
      .mockResolvedValueOnce({
        beads: [baseBead, secondBead],
        source: 'cli-journal',
        commentTotal: 0,
        complete: true,
      })
      // The second bead was deleted; the comment total moved as well, which
      // would trigger the extra full read for an incremental source.
      .mockResolvedValueOnce({
        beads: [baseBead],
        source: 'cli-journal',
        commentTotal: 1,
        complete: true,
      });

    const { result } = renderHook(() => useBeads('C:\project'));
    await waitFor(() => expect(result.current.beads).toHaveLength(2));
    await waitFor(() => expect(poll.current).toBeTypeOf('function'));

    await act(async () => {
      poll.current?.();
    });

    await waitFor(() => expect(result.current.beads).toHaveLength(1));
    expect(result.current.beads[0].id).toBe(baseBead.id);
    // A complete response already holds every comment — no second read.
    expect(loadProjectBeadsMock).toHaveBeenCalledTimes(2);
  });

  it('polls every 5 seconds for a journal-backed project', async () => {
    const poll = capturePoll();
    loadProjectBeadsMock.mockResolvedValueOnce({
      beads: [baseBead],
      source: 'cli-journal',
      commentTotal: 0,
      complete: true,
    });

    const { result } = renderHook(() => useBeads('C:\project'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await waitFor(() => expect(poll.interval).toBe(5_000));
  });

  it('keeps polling every 15 seconds for other database sources', async () => {
    const poll = capturePoll();
    loadProjectBeadsMock.mockResolvedValueOnce({
      beads: [baseBead],
      source: 'cli',
      commentTotal: 0,
    });

    const { result } = renderHook(() => useBeads('C:\project'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await waitFor(() => expect(poll.interval).toBe(15_000));
  });
});

describe('useBeads with an old copy from issues.jsonl', () => {
  const stale = {
    reason: 'bd exited with exit code: 1\nHint: run bd doctor',
    modifiedAt: '2026-09-28T20:17:39Z',
  };

  it('reports the old copy', async () => {
    loadProjectBeadsMock.mockResolvedValueOnce({ beads: [baseBead], source: 'jsonl', stale });

    const { result } = renderHook(() => useBeads('/tmp/project'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.stale).toEqual(stale);
  });

  it('reports no old copy for a normal response', async () => {
    loadProjectBeadsMock.mockResolvedValueOnce({ beads: [baseBead], source: 'jsonl', stale: null });

    const { result } = renderHook(() => useBeads('/tmp/project'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.stale).toBeNull();
  });

  it('does not poll a project that legitimately lives on issues.jsonl', async () => {
    const poll = capturePoll();
    loadProjectBeadsMock.mockResolvedValue({ beads: [baseBead], source: 'jsonl', stale: null });

    const { result } = renderHook(() => useBeads('/tmp/project'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(poll.current).toBeUndefined();
  });

  it('polls every 15 seconds with full reads while the copy is old', async () => {
    const poll = capturePoll();
    loadProjectBeadsMock.mockResolvedValue({ beads: [baseBead], source: 'jsonl', commentTotal: 0, stale });

    const { result } = renderHook(() => useBeads('/tmp/project'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(poll.interval).toBe(15_000));

    await act(async () => {
      poll.current?.();
    });

    await waitFor(() => expect(loadProjectBeadsMock).toHaveBeenCalledTimes(2));
    // An incremental read would merge the recovered database into the old copy
    // and keep beads deleted since; only a full read replaces it cleanly.
    expect(loadProjectBeadsMock.mock.calls[1][1]).toEqual({
      withSource: true,
      updatedAfter: undefined,
    });
  });

  it('clears the old copy once bd answers again', async () => {
    const poll = capturePoll();
    const recovered = { ...baseBead, id: 'test-2', title: 'Recovered' };
    loadProjectBeadsMock
      .mockResolvedValueOnce({ beads: [baseBead], source: 'jsonl', commentTotal: 0, stale })
      .mockResolvedValue({ beads: [recovered], source: 'cli', commentTotal: 0, stale: null });

    const { result } = renderHook(() => useBeads('/tmp/project'));
    await waitFor(() => expect(result.current.stale).toEqual(stale));
    await waitFor(() => expect(poll.current).toBeTypeOf('function'));

    await act(async () => {
      poll.current?.();
    });

    await waitFor(() => expect(result.current.stale).toBeNull());
    expect(result.current.beads.map((b) => b.id)).toEqual(['test-2']);
  });
});
