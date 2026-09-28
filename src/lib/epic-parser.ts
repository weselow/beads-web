/**
 * Epic parser utility for beads kanban
 *
 * Provides functions to separate epics from tasks, build epic trees,
 * compute progress metrics, and identify blocking relationships.
 */

import { getStatusCategory, isDoneStatus } from "@/lib/statuses";
import type { Bead, Epic, EpicProgress, StatusInfo } from "@/types";

/**
 * Separates epics from standalone tasks
 *
 * @param beads - Array of all beads
 * @returns Object with separate arrays for epics and standalone tasks
 *
 * @example
 * ```typescript
 * const { epics, tasks } = parseEpicsAndTasks(allBeads);
 * console.log(`Found ${epics.length} epics and ${tasks.length} standalone tasks`);
 * ```
 */
export function parseEpicsAndTasks(beads: Bead[]): {
  epics: Epic[];
  tasks: Bead[];
} {
  if (!beads || beads.length === 0) {
    return { epics: [], tasks: [] };
  }

  const epics: Epic[] = [];
  const tasks: Bead[] = [];

  for (const bead of beads) {
    // Bead is an epic if issue_type is 'epic' OR if it has children
    if (bead.issue_type === 'epic' || (bead.children && bead.children.length > 0)) {
      epics.push({
        ...bead,
        issue_type: 'epic',
        children: bead.children ?? [],
      } as Epic);
    } else if (!bead.parent_id) {
      // Only include tasks that are NOT children of epics (standalone tasks)
      tasks.push(bead);
    }
  }

  return { epics, tasks };
}

/**
 * Attaches child beads to their parent epics
 *
 * @param epics - Array of epic beads
 * @param allBeads - Array of all beads (including children)
 * @returns Array of epics with resolved children attached
 *
 * @example
 * ```typescript
 * const epicsWithChildren = buildEpicTree(epics, allBeads);
 * epicsWithChildren.forEach(epic => {
 *   console.log(`Epic ${epic.id} has ${epic.children.length} children`);
 * });
 * ```
 */
export function buildEpicTree(epics: Epic[], allBeads: Bead[]): Epic[] {
  if (!epics || epics.length === 0) {
    return [];
  }

  if (!allBeads || allBeads.length === 0) {
    return epics;
  }

  // Create a lookup map for fast child access
  const beadMap = new Map<string, Bead>();
  for (const bead of allBeads) {
    beadMap.set(bead.id, bead);
  }

  // Build epic tree with resolved children
  return epics.map((epic) => {
    const children = (epic.children ?? [])
      .map((childId) => beadMap.get(childId))
      .filter((child): child is Bead => child !== undefined);

    return {
      ...epic,
      children: children.map((c) => c.id),
    };
  });
}

/**
 * Whether any dependency of the bead is found and is not in the done group.
 * Dependencies missing from the map (deleted beads) do not block.
 */
function hasOpenDependency(
  bead: Bead,
  beadMap: ReadonlyMap<string, Bead>,
  statuses: readonly StatusInfo[]
): boolean {
  return (bead.deps ?? []).some((depId) => {
    const depBead = beadMap.get(depId);
    return depBead !== undefined && !isDoneStatus(depBead.status, statuses);
  });
}

/**
 * Computes progress metrics for an epic based on its children
 *
 * A child counts as completed when its status is in the done group, and as
 * in progress when its status is in the wip group (`in_progress`, `hooked`,
 * a project's own `inreview` and so on).
 *
 * @param epic - Epic bead with children
 * @param allBeads - Array of all beads to resolve children from
 * @param statuses - The project's statuses, to tell the groups apart
 * @returns EpicProgress object with computed metrics
 *
 * @example
 * ```typescript
 * const progress = computeEpicProgress(epic, allBeads, statuses);
 * console.log(`${progress.completed}/${progress.total} children completed`);
 * ```
 */
export function computeEpicProgress(
  epic: Epic,
  allBeads: Bead[],
  statuses: readonly StatusInfo[]
): EpicProgress {
  const childIds = epic.children ?? [];
  const beadMap = new Map((allBeads ?? []).map((b) => [b.id, b]));
  if (beadMap.size === 0) {
    return { total: childIds.length, completed: 0, inProgress: 0, blocked: 0 };
  }

  const children = childIds
    .map((childId) => beadMap.get(childId))
    .filter((child): child is Bead => child !== undefined);

  return {
    total: children.length,
    completed: children.filter((c) => isDoneStatus(c.status, statuses)).length,
    inProgress: children.filter((c) => getStatusCategory(c.status, statuses) === 'wip').length,
    blocked: children.filter((c) => hasOpenDependency(c, beadMap, statuses)).length,
  };
}

/**
 * Whether the epic can be closed: it has children, every one of them is in
 * the done group, and the epic itself is not done yet. The epic's own status
 * does not matter otherwise.
 */
export function canCloseEpic(
  epicStatus: string,
  progress: EpicProgress,
  statuses: readonly StatusInfo[]
): boolean {
  return (
    progress.total > 0 &&
    progress.completed === progress.total &&
    !isDoneStatus(epicStatus, statuses)
  );
}

/**
 * Identifies tasks that are blocked by unresolved dependencies — ones whose
 * dependency is found and is not in the done group.
 *
 * @param beads - Array of all beads to check
 * @param statuses - The project's statuses, to tell which ones are done
 * @returns Array of beads that have blocking dependencies
 *
 * @example
 * ```typescript
 * const blockedTasks = getBlockedTasks(allBeads, statuses);
 * console.log(`${blockedTasks.length} tasks are currently blocked`);
 * ```
 */
export function getBlockedTasks(beads: Bead[], statuses: readonly StatusInfo[]): Bead[] {
  if (!beads || beads.length === 0) {
    return [];
  }
  const beadMap = new Map(beads.map((b) => [b.id, b]));
  return beads.filter((bead) => hasOpenDependency(bead, beadMap, statuses));
}

/**
 * Computes which beads the given bead blocks (inverse of deps)
 *
 * @param bead - The bead to check
 * @param allBeads - Array of all beads to search for dependents
 * @returns Array of bead IDs that depend on this bead
 *
 * @example
 * ```typescript
 * const blockers = computeBlockers(someBead, allBeads);
 * if (blockers.length > 0) {
 *   console.log(`Completing this task will unblock: ${blockers.join(', ')}`);
 * }
 * ```
 */
export function computeBlockers(bead: Bead, allBeads: Bead[]): string[] {
  if (!bead || !bead.id) {
    return [];
  }

  if (!allBeads || allBeads.length === 0) {
    return [];
  }

  // Find all beads that list this bead in their deps array
  const blockers: string[] = [];

  for (const otherBead of allBeads) {
    if (!otherBead.deps || otherBead.deps.length === 0) {
      continue;
    }

    // If this bead is in the other bead's deps, then this bead blocks it
    if (otherBead.deps.includes(bead.id)) {
      blockers.push(otherBead.id);
    }
  }

  return blockers;
}
