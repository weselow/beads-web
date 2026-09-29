"use client";

import { useMemo } from "react";

import { ChevronsDownUp, ChevronsUpDown, PackageOpen } from "lucide-react";

import { TreeRow } from "@/components/tree-row";
import { Button } from "@/components/ui/button";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { useTreeState } from "@/hooks/use-tree-state";
import { buildTree, flattenVisible, parentIds, type TreeNode } from "@/lib/tree";
import type { Bead, StatusInfo } from "@/types";

export interface TreeViewProps {
  /** Key for the remembered collapsed rows and Show closed */
  projectId: string;
  /** Every bead of the project, to find parents and count progress */
  beads: readonly Bead[];
  /** Beads that passed the board filters */
  matchedIds: ReadonlySet<string>;
  statuses: readonly StatusInfo[];
  ticketNumbers: ReadonlyMap<string, number>;
  /** Order of siblings, the board's sort */
  compare: (a: Bead, b: Bead) => number;
  onOpenBead: (bead: Bead) => void;
}

interface TreeToolbarProps {
  showClosed: boolean;
  onShowClosedChange: (on: boolean) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

function TreeToolbar({ showClosed, onShowClosedChange, onExpandAll, onCollapseAll }: TreeToolbarProps) {
  return (
    <div className="flex flex-shrink-0 items-center gap-2 border-b border-b-default/50 px-3 py-2">
      <Button variant="ghost" size="xs" onClick={onExpandAll}>
        <ChevronsUpDown aria-hidden="true" />
        Expand all
      </Button>
      <Button variant="ghost" size="xs" onClick={onCollapseAll}>
        <ChevronsDownUp aria-hidden="true" />
        Collapse all
      </Button>
      <label className="ml-auto flex items-center gap-1.5 text-xs text-t-muted">
        <ToggleSwitch checked={showClosed} onCheckedChange={onShowClosedChange} aria-label="Show closed" />
        <span aria-hidden="true">Show closed</span>
      </label>
    </div>
  );
}

function EmptyTree({ showClosed }: { showClosed: boolean }) {
  return (
    <div className="m-3 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-b-strong/50 py-8">
      <PackageOpen className="mb-2 size-8 text-t-muted" aria-hidden="true" />
      <span className="text-sm text-t-muted">No beads match the filters</span>
      {!showClosed && <span className="mt-1 text-xs text-t-faint">Closed beads are hidden; turn on Show closed to see them.</span>}
    </div>
  );
}

interface TreeRowsProps extends Pick<TreeViewProps, "ticketNumbers" | "statuses" | "onOpenBead"> {
  rows: readonly TreeNode[];
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
}

/** The visible rows; memoised rows redraw only when their own node or state changes. */
function TreeRows({ rows, collapsed, ticketNumbers, statuses, onToggle, onOpenBead }: TreeRowsProps) {
  return (
    <ul className="min-h-0 flex-1 overflow-y-auto py-1">
      {rows.map((node) => (
        <TreeRow
          key={node.bead.id}
          node={node}
          expanded={!collapsed.has(node.bead.id)}
          ticketNumber={ticketNumbers.get(node.bead.id)}
          statuses={statuses}
          onToggle={onToggle}
          onOpenBead={onOpenBead}
        />
      ))}
    </ul>
  );
}

/**
 * The project's beads as a tree: milestones, epics, tasks and subtasks at any
 * depth. Everything starts expanded; the rows the user folds are remembered.
 */
export function TreeView({ projectId, beads, matchedIds, statuses, ticketNumbers, compare, onOpenBead }: TreeViewProps) {
  const { collapsed, showClosed, toggleCollapsed, setCollapsed, setShowClosed } = useTreeState(projectId);
  const roots = useMemo(
    () => buildTree(beads, statuses, { matchedIds, showClosed, compare }),
    [beads, matchedIds, statuses, showClosed, compare]
  );
  const rows = useMemo(() => flattenVisible(roots, collapsed), [roots, collapsed]);

  return (
    <section aria-label="Bead tree" className="flex min-h-0 flex-1 flex-col">
      <TreeToolbar
        showClosed={showClosed}
        onShowClosedChange={setShowClosed}
        onExpandAll={() => setCollapsed([])}
        onCollapseAll={() => setCollapsed(parentIds(roots))}
      />
      {rows.length === 0 ? <EmptyTree showClosed={showClosed} /> : (
        <TreeRows rows={rows} collapsed={collapsed} ticketNumbers={ticketNumbers} statuses={statuses}
          onToggle={toggleCollapsed} onOpenBead={onOpenBead} />
      )}
    </section>
  );
}
