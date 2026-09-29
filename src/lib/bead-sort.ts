/**
 * The order the filter bar picks for beads: by ticket number or by creation
 * time, either way. Shared by the board and the tree, so both sort the same.
 */

import type { Bead } from "@/types";

/** Sort field options */
export type SortField = "ticket_number" | "created_at";

/** Sort direction options */
export type SortDirection = "asc" | "desc";

/**
 * Comparison for `sort`/`toSorted`. A bead without a ticket number counts as 0.
 */
export function compareBeads(
  field: SortField,
  direction: SortDirection,
  ticketNumbers: ReadonlyMap<string, number>
): (a: Bead, b: Bead) => number {
  const key =
    field === "ticket_number"
      ? (bead: Bead) => ticketNumbers.get(bead.id) ?? 0
      : (bead: Bead) => new Date(bead.created_at).getTime();
  return direction === "asc" ? (a, b) => key(a) - key(b) : (a, b) => key(b) - key(a);
}
