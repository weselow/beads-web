import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { compareBeads } from '@/lib/bead-sort';
import { BUILTIN_STATUSES } from '@/lib/statuses';
import type { Bead } from '@/types';

import { TreeView, type TreeViewProps } from '../tree-view';

function bead(id: string, title: string, extra: Partial<Bead> = {}): Bead {
  return {
    id, title, status: 'open', priority: 2, issue_type: 'task', owner: '',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', comments: [], ...extra,
  };
}

// Epic with an open task (which has a subtask) and a closed task, plus a lone root task.
const beads: Bead[] = [
  bead('p-e1', 'Epic', { issue_type: 'epic', priority: 0 }),
  bead('p-t1', 'Task one', { parent_id: 'p-e1', status: 'in_progress' }),
  bead('p-t2', 'Closed task', { parent_id: 'p-e1', status: 'closed' }),
  bead('p-s1', 'Sub', { parent_id: 'p-t1' }),
  bead('p-r1', 'Root task'),
];
const ticketNumbers = new Map(beads.map((b, i) => [b.id, i + 1]));
const compare = compareBeads('ticket_number', 'asc', ticketNumbers);

function renderTree(props: Partial<TreeViewProps> = {}) {
  const onOpenBead = vi.fn();
  const view = render(
    <TreeView
      projectId="proj"
      beads={beads}
      matchedIds={new Set(beads.map((b) => b.id))}
      statuses={BUILTIN_STATUSES}
      ticketNumbers={ticketNumbers}
      compare={compare}
      onOpenBead={onOpenBead}
      {...props}
    />
  );
  return { ...view, onOpenBead };
}

const titles = () => screen.queryAllByRole('listitem').map((row) => row.getAttribute('data-bead-id'));
const row = (id: string) => screen.getAllByRole('listitem').find((r) => r.getAttribute('data-bead-id') === id)!;

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

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TreeView rows', () => {
  it('draws the nesting as flat rows indented by depth, closed beads hidden', () => {
    renderTree();
    expect(titles()).toEqual(['p-e1', 'p-t1', 'p-s1', 'p-r1']);
    expect(screen.getAllByRole('listitem').map((r) => r.getAttribute('data-depth'))).toEqual(['0', '1', '2', '0']);
  });

  it('shows number, status, priority and done/total of the children', () => {
    renderTree();
    const epic = within(row('p-e1'));
    expect(epic.getByText('#1')).toBeInTheDocument();
    expect(epic.getByText('P0')).toBeInTheDocument();
    expect(epic.getByText('Open')).toHaveClass('text-status-open');
    expect(epic.getByText('1/2')).toBeInTheDocument();
    expect(within(row('p-t1')).getByText('In Progress')).toHaveClass('text-status-progress');
    expect(within(row('p-r1')).queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('gives an arrow only to rows with children', () => {
    renderTree();
    expect(screen.getByRole('button', { name: 'Collapse Epic' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('button', { name: /Collapse Root task/ })).not.toBeInTheDocument();
  });

  it('opens the bead from its title', () => {
    const { onOpenBead } = renderTree();
    fireEvent.click(screen.getByRole('button', { name: 'Sub' }));
    expect(onOpenBead).toHaveBeenCalledWith(beads[3]);
  });

  it('marks an orphan and dims an ancestor that did not match the filters', () => {
    const orphan = bead('p-o1', 'Lost', { parent_id: 'p-gone' });
    renderTree({ beads: [...beads, orphan], matchedIds: new Set(['p-t1', 'p-o1']) });
    expect(within(row('p-o1')).getByText('parent not found')).toBeInTheDocument();
    expect(row('p-e1')).toHaveClass('opacity-60');
    expect(row('p-t1')).not.toHaveClass('opacity-60');
  });

  it('shows a placeholder when nothing passed the filters', () => {
    renderTree({ matchedIds: new Set() });
    expect(screen.getByText('No beads match the filters')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});

describe('TreeView expanding', () => {
  it('collapses and expands a row from its arrow without opening it', () => {
    const { onOpenBead } = renderTree();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Epic' }));
    expect(titles()).toEqual(['p-e1', 'p-r1']);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Epic' }));
    expect(titles()).toEqual(['p-e1', 'p-t1', 'p-s1', 'p-r1']);
    expect(onOpenBead).not.toHaveBeenCalled();
  });

  it('collapses and expands everything at once', () => {
    renderTree();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(titles()).toEqual(['p-e1', 'p-r1']);
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(titles()).toEqual(['p-e1', 'p-t1', 'p-s1', 'p-r1']);
  });

  it('shows closed beads, struck through, when Show closed is on', () => {
    renderTree();
    fireEvent.click(screen.getByRole('switch', { name: 'Show closed' }));
    expect(titles()).toEqual(['p-e1', 'p-t1', 'p-s1', 'p-t2', 'p-r1']);
    expect(screen.getByRole('button', { name: 'Closed task' })).toHaveClass('line-through');
  });
});

describe('TreeView memory', () => {
  it('remembers collapsed rows and Show closed per project', () => {
    const first = renderTree();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Epic' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Show closed' }));
    first.unmount();

    expect(JSON.parse(localStorage.getItem('beads-web:tree:proj:collapsed')!)).toEqual(['p-e1']);
    const second = renderTree();
    expect(titles()).toEqual(['p-e1', 'p-r1']);
    expect(screen.getByRole('switch', { name: 'Show closed' })).toHaveAttribute('aria-checked', 'true');
    second.unmount();

    renderTree({ projectId: 'other' });
    expect(titles()).toEqual(['p-e1', 'p-t1', 'p-s1', 'p-r1']);
  });

  it('switches to the other project state when projectId changes', () => {
    const view = renderTree();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Epic' }));
    view.rerender(
      <TreeView projectId="other" beads={beads} matchedIds={new Set(beads.map((b) => b.id))}
        statuses={BUILTIN_STATUSES} ticketNumbers={ticketNumbers} compare={compare} onOpenBead={vi.fn()} />
    );
    expect(titles()).toEqual(['p-e1', 'p-t1', 'p-s1', 'p-r1']);
    expect(JSON.parse(localStorage.getItem('beads-web:tree:proj:collapsed')!)).toEqual(['p-e1']);
  });

  it('works without storage', () => {
    const denied = () => { throw new Error('denied'); };
    vi.stubGlobal('localStorage', { ...memoryStorage(), getItem: denied, setItem: denied });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderTree();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Epic' }));
    expect(titles()).toEqual(['p-e1', 'p-r1']);
    expect(warn).toHaveBeenCalled();
  });
});
