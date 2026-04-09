import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as apiModule from '../api';
import { addComment, updateStatus } from '../cli';

vi.mock('../api', () => ({
  bd: { command: vi.fn() }
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCommand = (apiModule.bd as any).command as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockCommand.mockReset();
  mockCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 });
});

describe('addComment', () => {
  it('sends bd comments add command', async () => {
    await addComment('BD-001', 'hello', '/proj');
    expect(mockCommand).toHaveBeenCalledWith(['comments', 'add', 'BD-001', 'hello'], '/proj');
  });

  it('throws on failure', async () => {
    mockCommand.mockResolvedValue({ stdout: '', stderr: 'oops', code: 1 });
    await expect(addComment('BD-001', 'hi')).rejects.toThrow('oops');
  });
});

describe('updateStatus', () => {
  it('sends standard bd update for non-inreview status', async () => {
    await updateStatus('BD-001', 'open', '/proj');
    expect(mockCommand).toHaveBeenCalledTimes(1);
    expect(mockCommand).toHaveBeenCalledWith(['update', 'BD-001', '--status', 'open'], '/proj');
  });

  it('configures custom status before sending inreview', async () => {
    await updateStatus('BD-001', 'inreview', '/proj');
    expect(mockCommand).toHaveBeenCalledTimes(2);
    expect(mockCommand).toHaveBeenNthCalledWith(1, ['config', 'set', 'status.custom', 'inreview'], '/proj');
    expect(mockCommand).toHaveBeenNthCalledWith(2, ['update', 'BD-001', '--status', 'inreview'], '/proj');
  });

  it('only configures custom status once per cwd', async () => {
    // /proj2 is fresh — not seen by previous tests
    await updateStatus('BD-001', 'inreview', '/proj2');
    await updateStatus('BD-002', 'inreview', '/proj2');
    const configCalls = mockCommand.mock.calls.filter((c: unknown[]) => (c[0] as string[])[0] === 'config');
    expect(configCalls).toHaveLength(1);
  });
});
