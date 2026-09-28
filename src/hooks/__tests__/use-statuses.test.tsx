import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BUILTIN_STATUSES } from '@/lib/statuses';
import type { StatusInfo } from '@/types';

import { useStatuses } from '../use-statuses';

const getStatusesMock = vi.fn();

vi.mock('@/lib/api', () => ({
  statuses: { get: (...args: unknown[]) => getStatusesMock(...args) },
}));

const projectList: StatusInfo[] = [
  ...BUILTIN_STATUSES,
  { name: 'inreview', category: 'wip', builtin: false },
];

beforeEach(() => {
  getStatusesMock.mockReset();
});

describe('useStatuses', () => {
  it('loads the project list from the server', async () => {
    getStatusesMock.mockResolvedValue({ statuses: projectList, source: 'cli' });

    const { result } = renderHook(() => useStatuses('C:/project'));

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(getStatusesMock).toHaveBeenCalledWith('C:/project');
    expect(result.current.statuses).toEqual(projectList);
  });

  it('falls back to the built-in list when the server fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getStatusesMock.mockRejectedValue(new Error('API error: 500'));

    const { result } = renderHook(() => useStatuses('C:/project'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.statuses).toEqual(BUILTIN_STATUSES);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not ask the server without a project path', () => {
    const { result } = renderHook(() => useStatuses(''));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.statuses).toEqual(BUILTIN_STATUSES);
    expect(getStatusesMock).not.toHaveBeenCalled();
  });
});
