/**
 * The tree view: beads nested under their parents at any depth (milestone →
 * epic → task → subtask → …), cut down to what the board filters let through.
 *
 * A bead that passed the filters comes with its whole chain of ancestors; the
 * ancestors that did not pass are kept but marked, so the view can dim them.
 * Built with maps by id, so a project of thousands of beads stays fast.
 */

import { getIssueTypeMeta } from "@/lib/issue-types";
import { isDoneStatus } from "@/lib/statuses";
import type { Bead, StatusInfo } from "@/types";

/** Done direct children out of all direct children. */
export interface TreeProgress {
  done: number;
  total: number;
}

/** One row of the tree with the rows under it. */
export interface TreeNode {
  bead: Bead;
  /** 0 for a root. */
  depth: number;
  children: TreeNode[];
  /** Counts every direct child in the data, also those the filters or Show closed hide. */
  progress: TreeProgress;
  /** Passed the board filters; false for an ancestor kept only to show the path. */
  matched: boolean;
  /** Its parent_id names a bead the project does not have (deleted, another project). */
  orphan: boolean;
}

export interface BuildTreeOptions {
  /** Beads that passed the board filters, the type filter and the story rule. */
  matchedIds: ReadonlySet<string>;
  /** Off: beads in the done group are hidden unless an open match sits under them. */
  showClosed: boolean;
  /** Order of siblings, the board's sort (see compareBeads). */
  compare: (a: Bead, b: Bead) => number;
}

interface BuildContext {
  byId: ReadonlyMap<string, Bead>;
  parentOf: ReadonlyMap<string, string>;
  childrenOf: ReadonlyMap<string, Bead[]>;
  statuses: readonly StatusInfo[];
  options: BuildTreeOptions;
  visited: Set<string>;
}

/**
 * Parent of each bead. parent_id wins; the parent's children list counts only
 * for a child whose parent_id is empty. A bead naming itself has no parent.
 */
function linkParents(beads: readonly Bead[], byId: ReadonlyMap<string, Bead>): Map<string, string> {
  const parentOf = new Map<string, string>();
  for (const bead of beads) {
    if (bead.parent_id && bead.parent_id !== bead.id) parentOf.set(bead.id, bead.parent_id);
  }
  for (const parent of beads) {
    for (const childId of parent.children ?? []) {
      const child = byId.get(childId);
      if (child && !child.parent_id && childId !== parent.id && !parentOf.has(childId)) {
        parentOf.set(childId, parent.id);
      }
    }
  }
  return parentOf;
}

/** Direct children of each bead that has any, already in sibling order. */
function groupChildren(beads: readonly Bead[], ctx: Omit<BuildContext, "childrenOf">): Map<string, Bead[]> {
  const childrenOf = new Map<string, Bead[]>();
  for (const bead of beads) {
    const parentId = ctx.parentOf.get(bead.id);
    if (parentId === undefined || !ctx.byId.has(parentId)) continue;
    const siblings = childrenOf.get(parentId);
    if (siblings) siblings.push(bead);
    else childrenOf.set(parentId, [bead]);
  }
  childrenOf.forEach((siblings) => siblings.sort(ctx.options.compare));
  return childrenOf;
}

/**
 * Node for a bead and its subtree, or null when nothing in it is shown. A bead
 * already visited is skipped, which is what breaks a ring in the data.
 */
function buildNode(bead: Bead, depth: number, orphan: boolean, ctx: BuildContext): TreeNode | null {
  ctx.visited.add(bead.id);
  const kids = ctx.childrenOf.get(bead.id) ?? [];
  const children: TreeNode[] = [];
  for (const kid of kids) {
    const node = ctx.visited.has(kid.id) ? null : buildNode(kid, depth + 1, false, ctx);
    if (node) children.push(node);
  }
  const isDone = (b: Bead) => isDoneStatus(b.status, ctx.statuses);
  const matched = ctx.options.matchedIds.has(bead.id);
  const shownItself = matched && (ctx.options.showClosed || !isDone(bead));
  if (!shownItself && children.length === 0) return null;
  const progress = { done: kids.filter(isDone).length, total: kids.length };
  return { bead, depth, children, progress, matched, orphan };
}

/**
 * A bead left unvisited after the roots sits on a ring or under one (every
 * ancestor has a parent). Walking up until a bead repeats lands on the ring.
 */
function ringEntry(start: Bead, ctx: BuildContext): Bead {
  const seen = new Set<string>();
  let current = start;
  while (!seen.has(current.id)) {
    seen.add(current.id);
    current = ctx.byId.get(ctx.parentOf.get(current.id)!)!;
  }
  return current;
}

const isMilestone = (bead: Bead) => getIssueTypeMeta(bead.issue_type).value === "milestone";

/** Roots: milestones first, then the sibling order. */
function rootOrder(compare: BuildTreeOptions["compare"]): (a: TreeNode, b: TreeNode) => number {
  return (a, b) => Number(isMilestone(b.bead)) - Number(isMilestone(a.bead)) || compare(a.bead, b.bead);
}

/**
 * The tree's roots. A bead whose parent is missing becomes a root marked
 * orphan; a ring of parents is cut at one of its beads, which becomes a root,
 * so every bead appears once.
 */
export function buildTree(beads: readonly Bead[], statuses: readonly StatusInfo[], options: BuildTreeOptions): TreeNode[] {
  const byId = new Map(beads.map((b) => [b.id, b]));
  const parentOf = linkParents(beads, byId);
  const base = { byId, parentOf, statuses, options, visited: new Set<string>() };
  const ctx: BuildContext = { ...base, childrenOf: groupChildren(beads, base) };
  const roots: TreeNode[] = [];
  const add = (node: TreeNode | null) => node && roots.push(node);
  for (const bead of beads) {
    const parentId = parentOf.get(bead.id);
    const isRoot = parentId === undefined || !byId.has(parentId);
    if (isRoot && !ctx.visited.has(bead.id)) add(buildNode(bead, 0, parentId !== undefined, ctx));
  }
  for (const bead of beads) {
    if (!ctx.visited.has(bead.id)) add(buildNode(ringEntry(bead, ctx), 0, false, ctx));
  }
  return roots.sort(rootOrder(options.compare));
}

/** The rows on screen, depth first: a collapsed node shows, its subtree does not. */
export function flattenVisible(roots: readonly TreeNode[], collapsed: ReadonlySet<string>): TreeNode[] {
  const rows: TreeNode[] = [];
  const stack = roots.toReversed();
  while (stack.length > 0) {
    const node = stack.pop()!;
    rows.push(node);
    if (!collapsed.has(node.bead.id)) stack.push(...node.children.toReversed());
  }
  return rows;
}
