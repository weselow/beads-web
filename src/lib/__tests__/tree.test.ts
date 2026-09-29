import { describe, expect, it } from 'vitest';

import { BUILTIN_STATUSES } from '@/lib/statuses';
import {
  buildTree, flattenVisible, keepSelection, matchTreeTypes, parentIds, treeStep,
  type BuildTreeOptions, type TreeNode, type TreeStep,
} from '@/lib/tree';
import type { Bead, StatusInfo } from '@/types';

const statuses: StatusInfo[] = [...BUILTIN_STATUSES, { name: 'shipped', category: 'done', builtin: false }];

function bead(id: string, extra: Partial<Bead> = {}): Bead {
  return {
    id, title: id, status: 'open', priority: 2, issue_type: 'task', owner: '',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', comments: [], ...extra,
  };
}

const byId = (x: Bead, y: Bead) => x.id.localeCompare(y.id);

/** Build with every bead matched and closed ones shown, unless told otherwise. */
function build(beads: Bead[], options: Partial<BuildTreeOptions> = {}): TreeNode[] {
  const matchedIds = new Set(beads.map((b) => b.id));
  return buildTree(beads, statuses, { matchedIds, showClosed: true, compare: byId, ...options });
}

/** `id@depth` for every node, depth first, whatever is collapsed. */
const rows = (roots: TreeNode[]) => flattenVisible(roots, new Set()).map((n) => `${n.bead.id}@${n.depth}`);

const find = (roots: TreeNode[], id: string) => flattenVisible(roots, new Set()).find((n) => n.bead.id === id)!;

describe('buildTree', () => {
  it('nests beads by parent_id at any depth', () => {
    const beads = [bead('m'), bead('e', { parent_id: 'm' }), bead('t', { parent_id: 'e' }), bead('s', { parent_id: 't' })];
    expect(rows(build(beads))).toEqual(['m@0', 'e@1', 't@2', 's@3']);
  });

  it('uses the parent children list when parent_id is empty, and trusts parent_id when they disagree', () => {
    const beads = [
      bead('p', { children: ['a', 'b'] }),
      bead('q'),
      bead('a'),
      bead('b', { parent_id: 'q' }),
    ];
    expect(rows(build(beads))).toEqual(['p@0', 'a@1', 'q@0', 'b@1']);
  });

  it('counts progress over every direct child in the data, done by the done group', () => {
    const beads = [
      bead('e'),
      bead('a', { parent_id: 'e', status: 'closed' }),
      bead('b', { parent_id: 'e', status: 'shipped' }),
      bead('c', { parent_id: 'e' }),
    ];
    const roots = build(beads, { matchedIds: new Set(['e', 'c']), showClosed: false });
    expect(roots[0].children.map((n) => n.bead.id)).toEqual(['c']);
    expect(roots[0].progress).toEqual({ done: 2, total: 3 });
    expect(roots[0].children[0].progress).toEqual({ done: 0, total: 0 });
  });

  it('makes a bead whose parent is missing a root marked orphan', () => {
    const roots = build([bead('a', { parent_id: 'gone' }), bead('b')]);
    expect(roots.map((n) => [n.bead.id, n.orphan])).toEqual([['a', true], ['b', false]]);
  });

  it('shows each bead of a two-bead ring once', () => {
    const beads = [bead('a', { parent_id: 'b' }), bead('b', { parent_id: 'a' })];
    expect(rows(build(beads))).toEqual(['a@0', 'b@1']);
  });

  it('shows each bead of a three-bead ring once, with its other children', () => {
    const beads = [
      bead('a', { parent_id: 'c' }),
      bead('b', { parent_id: 'a' }),
      bead('c', { parent_id: 'b' }),
      bead('x', { parent_id: 'b' }),
    ];
    const ids = rows(build(beads)).map((r) => r.split('@')[0]);
    expect(ids.toSorted()).toEqual(['a', 'b', 'c', 'x']);
    expect(build(beads)).toHaveLength(1);
  });

  it('treats a bead that is its own parent as a root', () => {
    expect(rows(build([bead('a', { parent_id: 'a' })]))).toEqual(['a@0']);
  });

  it('keeps matched beads with their ancestors and dims the ancestors that did not match', () => {
    const beads = [bead('e'), bead('t', { parent_id: 'e' }), bead('s', { parent_id: 't' }), bead('other'), bead('u', { parent_id: 'e' })];
    const roots = build(beads, { matchedIds: new Set(['t']) });
    expect(rows(roots)).toEqual(['e@0', 't@1']);
    expect(find(roots, 'e').matched).toBe(false);
    expect(find(roots, 't').matched).toBe(true);
  });

  it('hides closed beads unless asked, but keeps a closed ancestor of an open match', () => {
    const beads = [
      bead('e', { status: 'closed' }),
      bead('t', { parent_id: 'e' }),
      bead('done', { status: 'shipped' }),
      bead('old', { status: 'closed', parent_id: 'e' }),
    ];
    expect(rows(build(beads, { showClosed: false }))).toEqual(['e@0', 't@1']);
    expect(rows(build(beads, { showClosed: true }))).toEqual(['done@0', 'e@0', 'old@1', 't@1']);
  });

  it('orders siblings with the given comparison and puts milestones first on the root only', () => {
    const beads = [
      bead('a'),
      bead('z', { issue_type: 'milestone' }),
      bead('c', { parent_id: 'a' }),
      bead('b', { parent_id: 'a', issue_type: 'milestone' }),
    ];
    const reverse = (x: Bead, y: Bead) => y.id.localeCompare(x.id);
    expect(rows(build(beads))).toEqual(['z@0', 'a@0', 'b@1', 'c@1']);
    expect(rows(build(beads, { compare: reverse }))).toEqual(['z@0', 'a@0', 'c@1', 'b@1']);
  });
});

describe('flattenVisible', () => {
  it('lists rows depth first and skips what is under a collapsed node', () => {
    const beads = [bead('a'), bead('b', { parent_id: 'a' }), bead('c', { parent_id: 'b' }), bead('d')];
    const roots = build(beads);
    const visible = (collapsed: string[]) => flattenVisible(roots, new Set(collapsed)).map((n) => n.bead.id);
    expect(visible([])).toEqual(['a', 'b', 'c', 'd']);
    expect(visible(['b'])).toEqual(['a', 'b', 'd']);
    expect(visible(['a'])).toEqual(['a', 'd']);
  });
});

describe('matchTreeTypes', () => {
  const branch = [
    bead('m', { issue_type: 'milestone' }),
    bead('e', { issue_type: 'epic', parent_id: 'm' }),
    bead('t', { parent_id: 'e' }),
    bead('s', { parent_id: 't', issue_type: 'bug' }),
    bead('other'),
    bead('lone-epic', { issue_type: 'epic' }),
  ];
  const ids = (set: ReadonlySet<string>) => Array.from(set).toSorted();

  it('keeps a bead of the picked type together with everything under it', () => {
    expect(ids(matchTreeTypes(branch, branch, 'milestone'))).toEqual(['e', 'm', 's', 't']);
  });

  it('shows the whole milestone branch as matched rows in the tree', () => {
    const roots = build(branch, { matchedIds: matchTreeTypes(branch, branch, 'milestone') });
    expect(rows(roots)).toEqual(['m@0', 'e@1', 't@2', 's@3']);
    expect(['m', 'e', 't', 's'].map((id) => find(roots, id).matched)).toEqual([true, true, true, true]);
  });

  it('works for epics too, each with its own branch', () => {
    expect(ids(matchTreeTypes(branch, branch, 'epic'))).toEqual(['e', 'lone-epic', 's', 't']);
  });

  it('still applies the other filters: a descendant they dropped stays out', () => {
    const filtered = branch.filter((b) => b.id !== 't');
    expect(ids(matchTreeTypes(filtered, branch, 'milestone'))).toEqual(['e', 'm', 's']);
  });

  it('follows the parent children list when parent_id is empty', () => {
    const beads = [bead('m', { issue_type: 'milestone', children: ['t'] }), bead('t')];
    expect(ids(matchTreeTypes(beads, beads, 'milestone'))).toEqual(['m', 't']);
  });

  it('keeps stories out unless Story is picked', () => {
    const beads = [bead('m', { issue_type: 'milestone' }), bead('idea', { issue_type: 'story', parent_id: 'm' })];
    expect(ids(matchTreeTypes(beads, beads, 'milestone'))).toEqual(['m']);
    expect(ids(matchTreeTypes(beads, beads, 'story'))).toEqual(['idea']);
  });

  it('stops on a ring of parents', () => {
    const ring = [bead('a', { parent_id: 'b' }), bead('b', { parent_id: 'a' }), bead('c', { parent_id: 'a' })];
    expect(ids(matchTreeTypes(ring, ring, 'milestone'))).toEqual([]);
    const typedRing = [...ring, bead('m', { issue_type: 'milestone', parent_id: 'c' })];
    expect(ids(matchTreeTypes(typedRing, typedRing, 'milestone'))).toEqual(['m']);
  });

  it('with all types keeps every filtered bead except stories, as before', () => {
    const beads = [...branch, bead('idea', { issue_type: 'story' })];
    const filtered = beads.filter((b) => b.id !== 'other');
    expect(ids(matchTreeTypes(filtered, beads, 'all'))).toEqual(['e', 'lone-epic', 'm', 's', 't']);
  });
});

describe('parentIds', () => {
  it('lists every node that has children, at any depth', () => {
    const beads = [bead('a'), bead('b', { parent_id: 'a' }), bead('c', { parent_id: 'b' }), bead('d')];
    expect(parentIds(build(beads)).toSorted()).toEqual(['a', 'b']);
  });
});

// m ─┬─ e1 ── t1        (three levels)
//    └─ e2
// r
const navBeads = [
  bead('m'), bead('e1', { parent_id: 'm' }), bead('t1', { parent_id: 'e1' }), bead('e2', { parent_id: 'm' }), bead('r'),
];

/** The step from `selected` with the given rows collapsed. */
function step(selected: string | null, key: TreeStep, folded: string[] = []) {
  const collapsed = new Set(folded);
  return treeStep(flattenVisible(build(navBeads), collapsed), collapsed, selected, key);
}

describe('treeStep', () => {
  it('moves up and down over the visible rows only', () => {
    expect(step('m', 'down')).toEqual({ select: 'e1' });
    expect(step('t1', 'down')).toEqual({ select: 'e2' });
    expect(step('e1', 'down', ['e1'])).toEqual({ select: 'e2' });
    expect(step('r', 'up', ['m'])).toEqual({ select: 'm' });
    expect(step('e2', 'up')).toEqual({ select: 't1' });
  });

  it('stops at the first and the last row', () => {
    expect(step('m', 'up')).toBeNull();
    expect(step('r', 'down')).toBeNull();
  });

  it('starts at the first row going down and at the last going up', () => {
    expect(step(null, 'down')).toEqual({ select: 'm' });
    expect(step(null, 'up')).toEqual({ select: 'r' });
    expect(step('gone', 'down')).toEqual({ select: 'm' });
  });

  it('right expands a collapsed row, then goes to its first child; a leaf stays', () => {
    expect(step('e1', 'right', ['e1'])).toEqual({ toggle: 'e1' });
    expect(step('m', 'right')).toEqual({ select: 'e1' });
    expect(step('t1', 'right')).toBeNull();
  });

  it('left collapses an expanded row, otherwise goes to the parent', () => {
    expect(step('e1', 'left')).toEqual({ toggle: 'e1' });
    expect(step('e1', 'left', ['e1'])).toEqual({ select: 'm' });
    expect(step('t1', 'left')).toEqual({ select: 'e1' });
    expect(step('e2', 'left')).toEqual({ select: 'm' });
  });

  it('left on a root without children and sideways without a selection do nothing', () => {
    expect(step('r', 'left')).toBeNull();
    expect(step(null, 'left')).toBeNull();
    expect(step(null, 'right')).toBeNull();
  });

  it('first and last go to the first and the last visible row', () => {
    expect(step('t1', 'first')).toEqual({ select: 'm' });
    expect(step('m', 'last')).toEqual({ select: 'r' });
    expect(step('r', 'first', ['m'])).toEqual({ select: 'm' });
    expect(step('m', 'last', ['r'])).toEqual({ select: 'r' });
  });

  it('first and last work without a selection', () => {
    expect(step(null, 'first')).toEqual({ select: 'm' });
    expect(step(null, 'last')).toEqual({ select: 'r' });
  });

  it('first and last do nothing in an empty tree', () => {
    expect(treeStep([], new Set(), null, 'first')).toBeNull();
    expect(treeStep([], new Set(), null, 'last')).toBeNull();
  });
});

describe('keepSelection', () => {
  const keep = (selected: string | null, folded: string[], beads = navBeads) => {
    const roots = build(beads);
    return keepSelection(roots, flattenVisible(roots, new Set(folded)), selected);
  };

  it('keeps a row that is still on screen', () => {
    expect(keep('t1', [])).toBe('t1');
    expect(keep(null, [])).toBeNull();
  });

  it('moves to the collapsed ancestor that hides the row', () => {
    expect(keep('t1', ['e1'])).toBe('e1');
    expect(keep('t1', ['m', 'e1'])).toBe('m');
  });

  it('drops a row that left the tree', () => {
    expect(keep('t1', [], navBeads.filter((b) => b.id !== 't1'))).toBeNull();
  });
});
