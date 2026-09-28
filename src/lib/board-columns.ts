/**
 * The board's columns: one per status of the project, ordered by group.
 *
 * pinned has no column — its beads sit at the top of open, marked as pinned.
 * A bead whose status the project does not know goes into open with a warning
 * badge naming its status, so it never drops off the board.
 */

import type { Bead, BoardColumn, StatusBadgeInfo, StatusCategory, StatusInfo } from "@/types";

const GROUP_ORDER: readonly StatusCategory[] = ["active", "wip", "frozen", "done"];

/** Columns drawn in full even when empty; every other empty column collapses. */
const ALWAYS_EXPANDED = new Set(["open", "in_progress", "closed"]);

// A Map, so a status named e.g. "constructor" finds nothing inherited.
const BUILTIN_TITLES = new Map<string, string>([
  ["open", "Open"],
  ["in_progress", "In Progress"],
  ["blocked", "Blocked"],
  ["deferred", "Deferred"],
  ["closed", "Closed"],
  ["hooked", "Hooked"],
]);

const PINNED_BADGE: StatusBadgeInfo = { label: "Pinned", variant: "muted" };

const OPEN: StatusInfo = { name: "open", category: "active", builtin: true };

/** Column title: a fixed name for bd's statuses, a project's own status as it is. */
export function columnTitle(status: string): string {
  return BUILTIN_TITLES.get(status) ?? status;
}

/**
 * Statuses that get a column, by group active, wip, frozen, done; inside a
 * group bd's built-in statuses in bd's order, then the project's own. open is
 * always there, as the home of beads with an unknown status.
 */
export function orderBoardStatuses(statuses: readonly StatusInfo[]): StatusInfo[] {
  const drawn = statuses.filter((s) => s.name !== "pinned");
  if (!drawn.some((s) => s.name === "open")) drawn.unshift(OPEN);
  return GROUP_ORDER.flatMap((group) => {
    const inGroup = drawn.filter((s) => s.category === group);
    return [...inGroup.filter((s) => s.builtin), ...inGroup.filter((s) => !s.builtin)];
  });
}

/**
 * Splits beads into the board's columns, keeping the order they came in so
 * the sort chosen in the filter bar survives; pinned beads go first in open.
 */
export function buildBoardColumns(beads: readonly Bead[], statuses: readonly StatusInfo[]): BoardColumn[] {
  const ordered = orderBoardStatuses(statuses);
  const byStatus = new Map<string, Bead[]>(ordered.map((s) => [s.name, []]));
  const open = byStatus.get("open")!;
  const pinned: Bead[] = [];
  for (const bead of beads) {
    if (bead.status === "pinned") {
      pinned.push({ ...bead, _statusBadge: PINNED_BADGE });
    } else {
      const column = byStatus.get(bead.status);
      if (column) column.push(bead);
      else open.push({ ...bead, _statusBadge: { label: bead.status, variant: "warning" } });
    }
  }
  open.unshift(...pinned);
  return ordered.map(({ name, category }) => {
    const columnBeads = byStatus.get(name)!;
    const collapsed = columnBeads.length === 0 && !ALWAYS_EXPANDED.has(name);
    return { status: name, title: columnTitle(name), category, collapsed, beads: columnBeads };
  });
}
