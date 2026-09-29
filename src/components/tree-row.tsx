"use client";

import { memo } from "react";

import { ChevronDown, ChevronRight } from "lucide-react";

import { getColumnColors } from "@/components/kanban-column";
import { PriorityBadge } from "@/components/priority-badge";
import { Progress } from "@/components/ui/progress";
import { formatBeadId } from "@/lib/bead-utils";
import { columnTitle } from "@/lib/board-columns";
import { getIssueTypeMeta } from "@/lib/issue-types";
import { getProgressIndicatorClass, percentDone } from "@/lib/progress";
import { getStatusCategory, isDoneStatus } from "@/lib/statuses";
import type { TreeNode, TreeProgress } from "@/lib/tree";
import { cn } from "@/lib/utils";
import type { Bead, StatusInfo } from "@/types";

export interface TreeRowProps {
  node: TreeNode;
  /** Its children are on screen; ignored for a row without children. */
  expanded: boolean;
  ticketNumber?: number;
  statuses: readonly StatusInfo[];
  onToggle: (id: string) => void;
  onOpenBead: (bead: Bead) => void;
}

/** Arrow that folds the row's children; an empty slot of the same width when it has none. */
function ExpandToggle({ node, expanded, onToggle }: Pick<TreeRowProps, "node" | "expanded" | "onToggle">) {
  if (node.children.length === 0) return <span className="size-5 shrink-0" aria-hidden="true" />;
  const Icon = expanded ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      onClick={() => onToggle(node.bead.id)}
      aria-expanded={expanded}
      aria-label={`${expanded ? "Collapse" : "Expand"} ${node.bead.title}`}
      className="flex size-5 shrink-0 items-center justify-center rounded text-t-tertiary hover:text-t-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-t-tertiary"
    >
      <Icon className="size-3.5" aria-hidden="true" />
    </button>
  );
}

function TypeIcon({ type }: { type: string }) {
  const { icon: Icon, label, colorClass } = getIssueTypeMeta(type);
  return <Icon role="img" aria-label={label} className={cn("size-3.5 shrink-0", colorClass)} />;
}

/** Status name in its group's colour, as the board's column headers. */
function StatusLabel({ status, statuses }: { status: string; statuses: readonly StatusInfo[] }) {
  const category = getStatusCategory(status, statuses);
  const color = category ? getColumnColors(category).text : "text-t-tertiary";
  return <span className={cn("w-24 truncate text-right text-[11px] font-medium", color)}>{columnTitle(status)}</span>;
}

/** Done direct children out of all, as a bar and as numbers. */
function RowProgress({ progress: { done, total } }: { progress: TreeProgress }) {
  const percentage = percentDone(done, total);
  return (
    <span className="flex items-center gap-1.5">
      <Progress
        value={percentage}
        aria-label={`${done} of ${total} children done`}
        className={cn("h-1.5 w-16 bg-surface-overlay", getProgressIndicatorClass(percentage))}
      />
      <span className="w-10 text-[11px] tabular-nums text-t-tertiary">{done}/{total}</span>
    </span>
  );
}

/** The title opens the bead; a done bead is struck through, as in the epic card's list. */
function RowTitle({ bead, done, onOpenBead }: { bead: Bead; done: boolean; onOpenBead: (bead: Bead) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpenBead(bead)}
      className={cn(
        "min-w-0 truncate rounded text-left hover:underline",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-t-tertiary",
        done ? "line-through text-t-muted" : "text-t-primary"
      )}
    >
      {bead.title}
    </button>
  );
}

/** Right side of the row: readiness of the children, priority, status. */
function RowMarks({ node, statuses }: { node: TreeNode; statuses: readonly StatusInfo[] }) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-2">
      {node.progress.total > 0 && <RowProgress progress={node.progress} />}
      <PriorityBadge priority={node.bead.priority} />
      <StatusLabel status={node.bead.status} statuses={statuses} />
    </span>
  );
}

/**
 * One flat row of the tree, indented by depth. The arrow and the title are
 * separate buttons, so folding a row never opens its bead.
 */
export const TreeRow = memo(function TreeRow({ node, expanded, ticketNumber, statuses, onToggle, onOpenBead }: TreeRowProps) {
  const { bead } = node;
  return (
    <li
      data-bead-id={bead.id}
      data-depth={node.depth}
      className={cn(
        "flex h-8 items-center gap-2 pr-3 text-sm hover:bg-surface-overlay/50",
        "[content-visibility:auto] [contain-intrinsic-size:auto_2rem]",
        !node.matched && "opacity-60"
      )}
      style={{ paddingLeft: `${0.5 + node.depth * 1.25}rem` }}
    >
      <ExpandToggle node={node} expanded={expanded} onToggle={onToggle} />
      <TypeIcon type={bead.issue_type} />
      <span className="shrink-0 font-mono text-xs tabular-nums text-t-muted">
        {ticketNumber !== undefined ? `#${ticketNumber}` : formatBeadId(bead.id)}
      </span>
      <RowTitle bead={bead} done={isDoneStatus(bead.status, statuses)} onOpenBead={onOpenBead} />
      {node.orphan && <span className="shrink-0 text-[11px] italic text-t-muted">parent not found</span>}
      <RowMarks node={node} statuses={statuses} />
    </li>
  );
});
