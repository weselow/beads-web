/**
 * Parser for beads data via HTTP API
 *
 * Fetches and provides typed access to beads with helper functions for
 * common operations.
 */

import type { Bead, Epic, StatusInfo } from "@/types";

import * as api from './api';

/** Statuses older bd versions wrote, and the current status each means. */
const STATUS_SYNONYMS = new Map<string, string>([
  ['done', 'closed'],
  ['resolved', 'closed'],
  ['pending', 'open'],
]);

/**
 * Brings a bead's status up to date: synonyms of old bd versions become the
 * current status, a tombstone (deleted bead) gives `null`. Every other status
 * is kept as bd wrote it.
 */
function normalizeBeadStatus(bead: Bead): Bead | null {
  if (bead.status === 'tombstone') return null;
  const current = STATUS_SYNONYMS.get(bead.status);
  return current ? { ...bead, status: current } : bead;
}

/**
 * Beads whose status is not in the project's status list.
 * Used for the warning indicator in the filter bar.
 */
export function getUnknownStatusBeads(beads: Bead[], statuses: readonly StatusInfo[]): Bead[] {
  const known = new Set(statuses.map((s) => s.name));
  return beads.filter((bead) => !known.has(bead.status));
}

/**
 * Sorted, deduplicated names of the statuses missing from the project's list.
 */
export function getUnknownStatusNames(beads: Bead[], statuses: readonly StatusInfo[]): string[] {
  const names = new Set(getUnknownStatusBeads(beads, statuses).map((b) => b.status));
  return Array.from(names).sort();
}

/**
 * Loads beads from a project directory via API
 *
 * Keeps each bead's real bd status, turning only the synonyms of old bd
 * versions into current statuses, and drops tombstone beads.
 *
 * @param projectPath - The root path of the project
 * @returns Promise resolving to array of Bead objects
 *
 * @example
 * ```typescript
 * const beads = await loadProjectBeads('/path/to/project');
 * ```
 */
/**
 * The board is showing an old copy: bd was called and failed, so the server
 * answered from issues.jsonl instead.
 */
export interface StaleSource {
  /** bd's error text; may span several lines. */
  reason: string;
  /** When issues.jsonl was last written, if the server knows. */
  modifiedAt?: string;
}

export interface LoadProjectBeadsResult {
  beads: Bead[];
  source?: string;
  /** `null` unless the server marked the answer as an old copy. */
  stale: StaleSource | null;
  /**
   * Total number of comments in the project, reported by the server on every
   * response — also on incremental ones, where `beads` holds only the changed
   * records. `undefined` means the server did not report it.
   */
  commentTotal?: number;
  /**
   * `true` when `beads` is the whole list even on an incremental request, so a
   * bead missing from it was deleted. `undefined` for the other sources.
   */
  complete?: boolean;
}

export async function loadProjectBeads(projectPath: string, options?: { updatedAfter?: string }): Promise<Bead[]>;
export async function loadProjectBeads(projectPath: string, options: { withSource: true; updatedAfter?: string }): Promise<LoadProjectBeadsResult>;
export async function loadProjectBeads(projectPath: string, options?: { withSource?: true; updatedAfter?: string }): Promise<Bead[] | LoadProjectBeadsResult> {
  const result = await api.beads.read(projectPath, options?.updatedAfter);
  // Normalize statuses, filter tombstones, ensure comments array
  const mapped: Bead[] = [];
  for (const bead of result.beads) {
    const normalized = normalizeBeadStatus({ ...bead, comments: bead.comments ?? [] });
    if (normalized !== null) {
      mapped.push(normalized);
    }
  }
  if (options?.withSource) {
    return {
      beads: mapped,
      source: result.source,
      commentTotal: result.comment_total,
      complete: result.complete,
      stale: result.stale_reason === undefined
        ? null
        : { reason: result.stale_reason, modifiedAt: result.jsonl_modified_at },
    };
  }
  return mapped;
}

/**
 * Alias for loadProjectBeads for backward compatibility
 */
export async function parseBeadsFromPath(projectPath: string): Promise<Bead[]> {
  try {
    return await loadProjectBeads(projectPath);
  } catch (error) {
    console.error(`Failed to load beads from ${projectPath}:`, error);
    return [];
  }
}

/**
 * Groups beads by status, with a group for every status in the project's
 * list (empty ones included). A bead whose status is not in the list goes
 * into open, on a copy carrying a warning badge with its status.
 * Each group is sorted by updated_at, most recent first.
 *
 * @example
 * ```typescript
 * const grouped = groupBeadsByStatus(beads, statuses);
 * console.log(grouped.blocked.length); // Number of blocked beads
 * ```
 */
export function groupBeadsByStatus(
  beads: Bead[],
  statuses: readonly StatusInfo[]
): Record<string, Bead[]> {
  // A status is any string bd accepts; a Map keeps names such as
  // "constructor" from matching what every plain object inherits.
  const groups = new Map<string, Bead[]>(statuses.map((s) => [s.name, []]));
  if (!groups.has('open')) groups.set('open', []);
  const open = groups.get('open')!;

  for (const bead of beads) {
    const group = groups.get(bead.status);
    if (group) {
      group.push(bead);
    } else {
      open.push({ ...bead, _statusBadge: { label: bead.status, variant: 'warning' } });
    }
  }

  groups.forEach((group) => {
    group.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  });
  return Object.fromEntries(groups);
}

/**
 * Finds a bead by its ID
 *
 * @param beads - Array of Bead objects to search
 * @param id - The bead ID to find
 * @returns The matching Bead or undefined if not found
 *
 * @example
 * ```typescript
 * const bead = getBeadById(beads, 'beads-kanban-ui-323');
 * if (bead) {
 *   console.log(bead.title);
 * }
 * ```
 */
export function getBeadById(beads: Bead[], id: string): Bead | undefined {
  return beads.find((bead) => bead.id === id);
}

/**
 * Constructs the path to issues.jsonl from a project path
 *
 * @param projectPath - The root path of the project
 * @returns Path to the issues.jsonl file
 */
export function getBeadsFilePath(projectPath: string): string {
  // Normalize path separators and ensure no trailing slash
  const normalizedPath = projectPath.replace(/\\/g, "/").replace(/\/$/, "");
  return `${normalizedPath}/.beads/issues.jsonl`;
}

/**
 * Assigns sequential ticket numbers to beads based on creation order
 *
 * @param beads - Array of Bead objects to assign numbers to
 * @returns Map of bead ID to ticket number (1-indexed, oldest bead = #1)
 *
 * @example
 * ```typescript
 * const ticketNumbers = assignTicketNumbers(beads);
 * const ticketNum = ticketNumbers.get('beads-kanban-ui-323'); // e.g., 5
 * console.log(`#${ticketNum}`); // "#5"
 * ```
 */
export function assignTicketNumbers(beads: Bead[]): Map<string, number> {
  // Sort all beads by created_at ascending (oldest first)
  const sortedBeads = [...beads].sort((a, b) => {
    const dateA = new Date(a.created_at).getTime();
    const dateB = new Date(b.created_at).getTime();
    return dateA - dateB;
  });

  // Assign 1-indexed ticket numbers
  const ticketNumbers = new Map<string, number>();
  sortedBeads.forEach((bead, index) => {
    ticketNumbers.set(bead.id, index + 1);
  });

  return ticketNumbers;
}

/**
 * Groups beads by epic status for epic-specific views
 *
 * @param beads - Array of Bead objects to group
 * @returns Record with epic status keys (with_children, standalone) and arrays of beads
 *
 * @example
 * ```typescript
 * const grouped = groupByEpicStatus(beads);
 * console.log(grouped.epics.length); // Number of epic beads
 * console.log(grouped.standalone.length); // Number of standalone task beads
 * ```
 */
export function groupByEpicStatus(beads: Bead[]): {
  epics: Epic[];
  standalone: Bead[];
  children: Bead[];
} {
  const epics: Epic[] = [];
  const standalone: Bead[] = [];
  const children: Bead[] = [];

  for (const bead of beads) {
    // Epic: has issue_type 'epic' or has children
    if (bead.issue_type === 'epic' || (bead.children && bead.children.length > 0)) {
      epics.push({
        ...bead,
        issue_type: 'epic',
        children: bead.children ?? [],
      } as Epic);
    }
    // Child: has parent_id
    else if (bead.parent_id) {
      children.push(bead);
    }
    // Standalone: no parent, not an epic
    else {
      standalone.push(bead);
    }
  }

  return { epics, standalone, children };
}
