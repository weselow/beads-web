import { createRef } from 'react';

import { act, fireEvent, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { columnForShortcut, useKeyboardNavigation } from '@/hooks/use-keyboard-navigation';
import type { Bead, BoardColumn } from '@/types';

const order = ['open', 'in_progress', 'blocked', 'hooked', 'deferred', 'closed'];

describe('columnForShortcut', () => {
  it('keeps g+o, g+p and g+c for open, in_progress and closed', () => {
    expect(columnForShortcut('o', order)).toBe('open');
    expect(columnForShortcut('p', order)).toBe('in_progress');
    expect(columnForShortcut('c', order)).toBe('closed');
  });

  it('maps g+1..9 to the columns in board order', () => {
    expect(columnForShortcut('1', order)).toBe('open');
    expect(columnForShortcut('3', order)).toBe('blocked');
    expect(columnForShortcut('6', order)).toBe('closed');
  });

  it('ignores a number past the last column, 0 and letters without a column', () => {
    expect(columnForShortcut('7', order)).toBeUndefined();
    expect(columnForShortcut('0', order)).toBeUndefined();
    expect(columnForShortcut('r', order)).toBeUndefined();
  });
});

function bead(id: string, status: string): Bead {
  return {
    id, title: id, status, priority: 2, issue_type: 'task', owner: '',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', comments: [],
  };
}

function col(status: string, beads: Bead[]): BoardColumn {
  return { status, title: status, category: 'wip', collapsed: beads.length === 0, beads };
}

describe('useKeyboardNavigation', () => {
  it('jumps to the first bead of the column picked by g and its number', () => {
    const blocked = bead('b1', 'blocked');
    const columns = [col('open', [bead('o1', 'open')]), col('in_progress', []), col('blocked', [blocked])];
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useKeyboardNavigation({
        beads: [columns[0].beads[0], blocked],
        columns,
        selectedId: null,
        onSelect,
        onOpen: vi.fn(),
        onClose: vi.fn(),
        searchInputRef: createRef<HTMLInputElement>(),
        isDetailOpen: false,
      })
    );

    act(() => { fireEvent.keyDown(window, { key: 'g' }); });
    act(() => { fireEvent.keyDown(window, { key: '3' }); });

    expect(onSelect).toHaveBeenCalledWith(blocked);
    expect(result.current.selectedId).toBe('b1');
    expect(result.current.selectedColumnStatus).toBe('blocked');
  });
});
