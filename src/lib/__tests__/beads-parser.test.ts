import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally before importing the module
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocking fetch — must come after vi.stubGlobal
import type { Bead, StatusInfo } from '@/types'; // eslint-disable-line import/first

import { // eslint-disable-line import/first
  getUnknownStatusBeads,
  getUnknownStatusNames,
  groupBeadsByStatus,
  loadProjectBeads,
} from '../beads-parser';
import { BUILTIN_STATUSES } from '../statuses'; // eslint-disable-line import/first

function mockResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    json: () => Promise.resolve(data),
  } as Response;
}

const rawBead = {
  id: 'test-1',
  title: 'Test',
  status: 'open',
  priority: 2,
  issue_type: 'task',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  mockFetch.mockReset();
});

describe('loadProjectBeads', () => {
  it('passes the complete flag of a journal-backed response through', async () => {
    mockFetch.mockResolvedValue(mockResponse({
      beads: [rawBead],
      source: 'cli-journal',
      comment_total: 0,
      complete: true,
    }));

    const result = await loadProjectBeads('/test/path', { withSource: true });

    expect(result.source).toBe('cli-journal');
    expect(result.complete).toBe(true);
    expect(result.beads).toHaveLength(1);
  });

  it('leaves complete undefined when the server does not report it', async () => {
    mockFetch.mockResolvedValue(mockResponse({ beads: [rawBead], source: 'cli', comment_total: 0 }));

    const result = await loadProjectBeads('/test/path', { withSource: true });

    expect(result.complete).toBeUndefined();
  });

  it('reports an old copy when bd failed and the answer came from issues.jsonl', async () => {
    mockFetch.mockResolvedValue(mockResponse({
      beads: [rawBead],
      comment_total: 0,
      source: 'jsonl',
      jsonl_modified_at: '2026-09-28T20:17:39Z',
      stale_reason: 'bd exited with exit code: 1: Error: no beads database found\nHint: run bd init',
    }));

    const result = await loadProjectBeads('/test/path', { withSource: true });

    expect(result.stale).toEqual({
      reason: 'bd exited with exit code: 1: Error: no beads database found\nHint: run bd init',
      modifiedAt: '2026-09-28T20:17:39Z',
    });
  });

  it('reports an old copy without a date when the file date is unknown', async () => {
    mockFetch.mockResolvedValue(mockResponse({
      beads: [rawBead],
      source: 'jsonl',
      stale_reason: 'bd timed out',
    }));

    const result = await loadProjectBeads('/test/path', { withSource: true });

    expect(result.stale).toEqual({ reason: 'bd timed out', modifiedAt: undefined });
  });

  it('reports no old copy for a normal response', async () => {
    mockFetch.mockResolvedValue(mockResponse({ beads: [rawBead], source: 'jsonl' }));

    const result = await loadProjectBeads('/test/path', { withSource: true });

    expect(result.stale).toBeNull();
  });
});

describe('loadProjectBeads statuses', () => {
  async function loadStatuses(...raw: string[]): Promise<string[]> {
    const beads = raw.map((status, i) => ({ ...rawBead, id: `b-${i}`, status }));
    mockFetch.mockResolvedValue(mockResponse({ beads }));
    const loaded = await loadProjectBeads('/test/path');
    return loaded.map((b) => b.status);
  }

  it('keeps the real bd status instead of folding it into four columns', async () => {
    expect(await loadStatuses('blocked', 'deferred', 'hooked', 'pinned', 'inreview'))
      .toEqual(['blocked', 'deferred', 'hooked', 'pinned', 'inreview']);
  });

  it('turns the synonyms of old bd versions into current statuses', async () => {
    expect(await loadStatuses('done', 'resolved', 'pending')).toEqual(['closed', 'closed', 'open']);
  });

  it('hides tombstone beads', async () => {
    expect(await loadStatuses('open', 'tombstone')).toEqual(['open']);
  });
});

function bead(id: string, status: string, updated_at = '2026-01-01T00:00:00Z'): Bead {
  return {
    id, title: id, status, priority: 2, issue_type: 'task', owner: '',
    created_at: '2026-01-01T00:00:00Z', updated_at, comments: [],
  };
}

const projectStatuses: StatusInfo[] = [
  ...BUILTIN_STATUSES,
  { name: 'inreview', category: 'wip', builtin: false },
];

describe('groupBeadsByStatus', () => {
  it('has a group for every status in the list, empty ones included', () => {
    const grouped = groupBeadsByStatus([], projectStatuses);
    expect(Object.keys(grouped)).toEqual(projectStatuses.map((s) => s.name));
    expect(grouped.hooked).toEqual([]);
  });

  it('puts each bead into the group of its own status', () => {
    const grouped = groupBeadsByStatus(
      [bead('a', 'blocked'), bead('b', 'inreview'), bead('c', 'open')],
      projectStatuses,
    );
    expect(grouped.blocked.map((b) => b.id)).toEqual(['a']);
    expect(grouped.inreview.map((b) => b.id)).toEqual(['b']);
    expect(grouped.open.map((b) => b.id)).toEqual(['c']);
  });

  it('sorts each group by last update, newest first', () => {
    const grouped = groupBeadsByStatus(
      [bead('old', 'open', '2026-01-01T00:00:00Z'), bead('new', 'open', '2026-03-01T00:00:00Z')],
      projectStatuses,
    );
    expect(grouped.open.map((b) => b.id)).toEqual(['new', 'old']);
  });

  it('puts a status missing from the list into open, with a warning badge', () => {
    const grouped = groupBeadsByStatus([bead('x', 'mystery')], BUILTIN_STATUSES);
    expect(grouped.open).toHaveLength(1);
    expect(grouped.open[0].status).toBe('mystery');
    expect(grouped.open[0]._statusBadge).toEqual({ label: 'mystery', variant: 'warning' });
    expect(grouped.mystery).toBeUndefined();
  });

  it('keeps an open group even when the list lacks one', () => {
    const grouped = groupBeadsByStatus([bead('x', 'open')], []);
    expect(grouped.open.map((b) => b.id)).toEqual(['x']);
  });
});

describe('unknown statuses', () => {
  const beads = [bead('a', 'inreview'), bead('b', 'mystery'), bead('c', 'weird'), bead('d', 'mystery')];

  it('are only the statuses missing from the project list', () => {
    expect(getUnknownStatusBeads(beads, projectStatuses).map((b) => b.id)).toEqual(['b', 'c', 'd']);
    expect(getUnknownStatusNames(beads, projectStatuses)).toEqual(['mystery', 'weird']);
  });

  it('include a project status when the list does not have it', () => {
    expect(getUnknownStatusNames(beads, BUILTIN_STATUSES)).toEqual(['inreview', 'mystery', 'weird']);
  });
});
