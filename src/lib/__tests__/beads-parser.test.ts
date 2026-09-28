import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally before importing the module
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocking fetch — must come after vi.stubGlobal
import { loadProjectBeads } from '../beads-parser'; // eslint-disable-line import/first

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
