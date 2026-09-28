/**
 * TEMPORARY until beads-web-5fk.3, which draws a column per status.
 *
 * Beads now carry their real bd status, but the board still has fixed
 * columns. So that no bead drops off the board in between, every status
 * without a column is shown in open with a badge naming it.
 */

import { formatStatus } from "@/lib/bead-utils";
import { getStatusCategory } from "@/lib/statuses";
import type { Bead, BoardColumnStatus, StatusBadgeInfo, StatusInfo } from "@/types";

const COLUMNS: { status: BoardColumnStatus; title: string }[] = [
  { status: "open", title: "Open" },
  { status: "in_progress", title: "In Progress" },
  { status: "inreview", title: "In Review" },
  { status: "closed", title: "Closed" },
];

/** Columns to draw: In Review only in a project that has that status. */
export function boardColumns(statuses: readonly StatusInfo[]): typeof COLUMNS {
  const hasReview = statuses.some((s) => s.name === "inreview");
  return COLUMNS.filter((c) => c.status !== "inreview" || hasReview);
}

function foldedBadge(status: string, statuses: readonly StatusInfo[]): StatusBadgeInfo {
  const category = getStatusCategory(status, statuses);
  // A status bd does not know for this project stays as bd wrote it.
  if (category === undefined) return { label: status, variant: "warning" };
  if (status === "blocked") return { label: formatStatus(status), variant: "warning" };
  return { label: formatStatus(status), variant: category === "frozen" ? "muted" : "info" };
}

/**
 * Splits beads into the board's columns, keeping the order they came in, so
 * the sort chosen in the filter bar survives. The inreview key is always
 * present (empty when the project lacks the status), so keyboard navigation
 * can rely on all four.
 */
export function foldIntoBoardColumns(
  beads: readonly Bead[],
  statuses: readonly StatusInfo[]
): Record<BoardColumnStatus, Bead[]> {
  const board: Record<BoardColumnStatus, Bead[]> = { open: [], in_progress: [], inreview: [], closed: [] };
  const drawn = new Set<string>(boardColumns(statuses).map((c) => c.status));
  for (const bead of beads) {
    if (drawn.has(bead.status)) {
      board[bead.status as BoardColumnStatus].push(bead);
    } else {
      board.open.push({ ...bead, _statusBadge: foldedBadge(bead.status, statuses) });
    }
  }
  return board;
}
