/**
 * TEMPORARY until beads-web-5fk.5, which counts beads by status group.
 *
 * The home page still has four counters. Beads now carry their real bd
 * status, so every status without a counter of its own is counted as open —
 * the column the board shows it in until beads-web-5fk.3.
 */

import type { Bead, BeadCounts } from "@/types";

const COUNTED = new Set<string>(["open", "in_progress", "inreview", "closed"]);

export function countBeadsForHome(beads: readonly Bead[]): BeadCounts {
  const counts: BeadCounts = { open: 0, in_progress: 0, inreview: 0, closed: 0 };
  for (const bead of beads) {
    const key = COUNTED.has(bead.status) ? (bead.status as keyof BeadCounts) : "open";
    counts[key]++;
  }
  return counts;
}
