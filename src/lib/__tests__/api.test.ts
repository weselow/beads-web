import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally before importing the module
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocking fetch — must come after vi.stubGlobal
import * as api from '../api'; // eslint-disable-line import/first

// Helper to create a mock Response
function mockResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers(),
    json: () => Promise.resolve(data),
  } as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('api.beads', () => {
  describe('create', () => {
    it('calls POST /api/beads/create with correct body', async () => {
      const input: api.CreateBeadInput = {
        path: '/my/project',
        title: 'Test bead',
        description: 'A description',
        issue_type: 'task',
        priority: 2,
      };

      mockFetch.mockResolvedValue(mockResponse({ id: 'abc-123' }));

      const result = await api.beads.create(input);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/beads/create');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toEqual(input);
      expect(result).toEqual({ id: 'abc-123' });
    });

    it('includes parent_id when creating a subtask', async () => {
      const input: api.CreateBeadInput = {
        path: '/my/project',
        title: 'Subtask',
        parent_id: 'parent-456',
      };

      mockFetch.mockResolvedValue(mockResponse({ id: 'sub-789' }));

      await api.beads.create(input);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.parent_id).toBe('parent-456');
    });
  });

  describe('update', () => {
    it('calls PATCH /api/beads/update with correct body', async () => {
      const updateData = {
        path: '/my/project',
        id: 'bead-123',
        status: 'in_progress',
      };

      mockFetch.mockResolvedValue(mockResponse({ success: true }));

      const result = await api.beads.update(updateData);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/beads/update');
      expect(options.method).toBe('PATCH');
      expect(JSON.parse(options.body)).toEqual(updateData);
      expect(result).toEqual({ success: true });
    });

    it('sends a defer date, and an empty one to clear it', async () => {
      mockFetch.mockResolvedValue(mockResponse({ success: true }));

      await api.beads.update({ path: '/p', id: 'x-1', defer: '2026-10-10' });
      await api.beads.update({ path: '/p', id: 'x-1', issue_type: 'epic', status: 'open', defer: '' });

      expect(JSON.parse(mockFetch.mock.calls[0][1].body).defer).toBe('2026-10-10');
      expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({
        path: '/p', id: 'x-1', issue_type: 'epic', status: 'open', defer: '',
      });
    });
  });

  describe('read: defer date', () => {
    it('keeps defer_until from the server, and accepts null', async () => {
      const deferred = { id: 'a', title: 'A', status: 'deferred', defer_until: '2026-10-09T20:00:00Z' };
      const plain = { id: 'b', title: 'B', status: 'open', defer_until: null };
      mockFetch.mockResolvedValue(mockResponse({ beads: [deferred, plain] }));

      const data = await api.beads.read('/p');

      expect(data.beads[0].defer_until).toBe('2026-10-09T20:00:00Z');
    });

    it('refuses a defer_until that is not a string', async () => {
      mockFetch.mockResolvedValue(mockResponse({ beads: [{ id: 'a', title: 'A', status: 'deferred', defer_until: 5 }] }));
      await expect(api.beads.read('/p')).rejects.toThrow();
    });
  });

  describe('read', () => {
    it('calls GET /api/beads with path query param', async () => {
      mockFetch.mockResolvedValue(mockResponse({ beads: [] }));

      await api.beads.read('/test/path');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/beads?path=');
      expect(url).toContain(encodeURIComponent('/test/path'));
    });

    it('waits up to 60 s, since the first read of a large project takes 10-25 s', async () => {
      const timeout = vi.spyOn(AbortSignal, 'timeout');
      mockFetch.mockResolvedValue(mockResponse({ beads: [] }));

      await api.beads.read('/test/path');

      expect(timeout).toHaveBeenCalledWith(60000);
      expect(timeout).not.toHaveBeenCalledWith(10000);
      expect(mockFetch.mock.calls[0][1].signal).toBe(timeout.mock.results[0].value);
    });

    it('leaves other calls on the shared 10 s limit', async () => {
      const timeout = vi.spyOn(AbortSignal, 'timeout');
      mockFetch.mockResolvedValue(mockResponse({ success: true }));

      await api.beads.update({ path: '/p', id: 'b-1', status: 'open' });

      expect(timeout).toHaveBeenCalledWith(10000);
    });
  });
});

describe('api.version', () => {
  it('calls GET /api/version/check', async () => {
    const versionData: api.VersionCheckResponse = {
      current: '0.3.0',
      latest: '0.4.0',
      update_available: true,
      download_url: 'https://example.com',
      release_notes: 'New features',
      asset_url: null,
    };

    mockFetch.mockResolvedValue(mockResponse(versionData));

    const result = await api.version.check();

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/version/check');
    expect(result).toEqual(versionData);
  });
});

describe('fetchApi error handling', () => {
  it('throws on non-OK response with error body', async () => {
    mockFetch.mockResolvedValue(
      mockResponse({ error: 'Not found' }, 404)
    );

    await expect(api.beads.create({
      path: '/test',
      title: 'fail',
    })).rejects.toThrow('API error: 404 Not found');
  });

  it('throws with statusText when no JSON error body', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.reject(new Error('no json')),
    } as unknown as Response);

    await expect(api.beads.create({
      path: '/test',
      title: 'fail',
    })).rejects.toThrow('API error: 500 Internal Server Error');
  });
});

describe('api.statuses', () => {
  it('asks GET /api/statuses for the project and returns the list', async () => {
    const body = {
      statuses: [{ name: 'open', category: 'active', builtin: true }],
      source: 'cli',
    };
    mockFetch.mockResolvedValue(mockResponse(body));

    const result = await api.statuses.get('C:/my project');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/statuses?path=C%3A%2Fmy+project');
    expect(result).toEqual(body);
  });

  it('rejects a status with a group outside the four', async () => {
    mockFetch.mockResolvedValue(mockResponse({
      statuses: [{ name: 'open', category: 'later', builtin: true }],
      source: 'cli',
    }));

    await expect(api.statuses.get('/p')).rejects.toThrow();
  });
});
