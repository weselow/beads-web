import { createRef } from 'react';

import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

const titles = () => screen.queryAllByRole('treeitem').map((row) => row.getAttribute('data-bead-id'));
const row = (id: string) => screen.getAllByRole('treeitem').find((r) => r.getAttribute('data-bead-id') === id)!;

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
    expect(screen.getAllByRole('treeitem').map((r) => r.getAttribute('data-depth'))).toEqual(['0', '1', '2', '0']);
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
    expect(screen.queryAllByRole('treeitem')).toHaveLength(0);
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

const press = (key: string, target: Element | Window = window) => act(() => { fireEvent.keyDown(target, { key }); });
const picked = () => screen.queryAllByRole('treeitem').filter((r) => r.getAttribute('aria-selected') === 'true')
  .map((r) => r.getAttribute('data-bead-id'));

describe('TreeView roles', () => {
  it('marks up a tree with levels, and expanded state only on rows with children', () => {
    renderTree();
    expect(screen.getByRole('tree', { name: 'Bead tree' })).toBeInTheDocument();
    expect(screen.getAllByRole('treeitem').map((r) => r.getAttribute('aria-level'))).toEqual(['1', '2', '3', '1']);
    expect(row('p-e1')).toHaveAttribute('aria-expanded', 'true');
    expect(row('p-r1')).not.toHaveAttribute('aria-expanded');
    expect(picked()).toEqual([]);
  });

  it('lets Tab reach the first row until a row is picked, then only the picked one', () => {
    renderTree();
    expect(screen.getAllByRole('treeitem').map((r) => r.tabIndex)).toEqual([0, -1, -1, -1]);
    press('ArrowUp');
    expect(screen.getAllByRole('treeitem').map((r) => r.tabIndex)).toEqual([-1, -1, -1, 0]);
  });

  it('keeps the buttons inside a row out of the Tab order, so the tree is one Tab stop', () => {
    renderTree();
    const tree = screen.getByRole('tree');
    within(tree).getAllByRole('button').forEach((button) => expect(button.tabIndex).toBe(-1));
    const stops = Array.from(tree.querySelectorAll<HTMLElement>('button, a, input, [tabindex]'))
      .filter((el) => el.tabIndex >= 0);
    expect(stops).toEqual([row('p-e1')]);
  });

  it('picks a row that gets focus, as on a click', () => {
    renderTree();
    act(() => row('p-t1').focus());
    expect(picked()).toEqual(['p-t1']);
  });
});

describe('TreeView keyboard', () => {
  beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });

  it('moves the pick with the arrows and j/k, focuses and scrolls to it, opens it with Enter', () => {
    const { onOpenBead } = renderTree();
    press('ArrowDown');
    expect(picked()).toEqual(['p-e1']);
    expect(row('p-e1')).toHaveFocus();
    expect(row('p-e1').scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    press('j');
    press('j');
    press('k');
    expect(picked()).toEqual(['p-t1']);
    press('Enter', row('p-t1'));
    expect(onOpenBead).toHaveBeenCalledWith(beads[1]);
  });

  it('jumps to the first and the last row with Home and End', () => {
    renderTree();
    press('End');
    expect(picked()).toEqual(['p-r1']);
    expect(row('p-r1')).toHaveFocus();
    press('Home');
    expect(picked()).toEqual(['p-e1']);
    expect(row('p-e1')).toHaveFocus();
  });

  it('keeps Home and End from scrolling the page in the tree, and leaves them to the search box', () => {
    const searchInputRef = createRef<HTMLInputElement>();
    render(<input ref={searchInputRef} aria-label="Search" />);
    renderTree({ searchInputRef });
    // fireEvent returns false when the default action (page scroll, caret move) was prevented.
    let notPrevented = true;
    act(() => { notPrevented = fireEvent.keyDown(window, { key: 'End' }); });
    expect(notPrevented).toBe(false);
    const search = screen.getByRole('textbox', { name: 'Search' });
    act(() => search.focus());
    act(() => { notPrevented = fireEvent.keyDown(search, { key: 'Home' }); });
    expect(notPrevented).toBe(true);
    expect(picked()).toEqual(['p-r1']);
  });

  it('folds and unfolds with left and right, and walks the levels', () => {
    renderTree();
    press('ArrowDown');
    press('ArrowLeft');
    expect(titles()).toEqual(['p-e1', 'p-r1']);
    press('ArrowRight');
    expect(titles()).toEqual(['p-e1', 'p-t1', 'p-s1', 'p-r1']);
    press('ArrowRight');
    expect(picked()).toEqual(['p-t1']);
    press('ArrowLeft');
    expect(titles()).toEqual(['p-e1', 'p-t1', 'p-r1']);
    press('ArrowLeft');
    expect(picked()).toEqual(['p-e1']);
  });

  it('hands the pick to the ancestor that got collapsed, and drops it with Escape', () => {
    renderTree();
    press('ArrowDown');
    press('ArrowDown');
    press('ArrowDown');
    expect(picked()).toEqual(['p-s1']);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Epic' }));
    expect(picked()).toEqual(['p-e1']);
    press('Escape');
    expect(picked()).toEqual([]);
  });

  it('leaves typing in the search box alone; / focuses it and Escape leaves it', () => {
    const searchInputRef = createRef<HTMLInputElement>();
    render(<input ref={searchInputRef} aria-label="Search" />);
    const { onOpenBead } = renderTree({ searchInputRef });
    press('/');
    const search = screen.getByRole('textbox', { name: 'Search' });
    expect(search).toHaveFocus();
    ['ArrowDown', 'j', 'ArrowRight', 'Enter'].forEach((key) => press(key, search));
    expect(picked()).toEqual([]);
    expect(onOpenBead).not.toHaveBeenCalled();
    press('Escape', search);
    expect(search).not.toHaveFocus();
  });

  it('ignores the keys while the card is open, so Escape only closes the card', () => {
    const { onOpenBead, rerender } = renderTree();
    press('ArrowDown');
    rerender(
      <TreeView projectId="proj" beads={beads} matchedIds={new Set(beads.map((b) => b.id))} statuses={BUILTIN_STATUSES}
        ticketNumbers={ticketNumbers} compare={compare} onOpenBead={onOpenBead} isDetailOpen />
    );
    ['ArrowDown', 'Enter', 'Escape'].forEach((key) => press(key));
    expect(picked()).toEqual(['p-e1']);
    expect(onOpenBead).not.toHaveBeenCalled();
  });

  it('leaves Alt+arrow to the browser and Enter on a button to the button', () => {
    const { onOpenBead } = renderTree();
    act(() => { fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true }); });
    expect(picked()).toEqual([]);
    press('ArrowDown');
    press('Enter', screen.getByRole('button', { name: 'Sub' }));
    expect(onOpenBead).not.toHaveBeenCalled();
  });
});
