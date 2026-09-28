/**
 * A project's statuses come from `GET /api/statuses`: bd's built-in ones plus
 * the project's own from `status.custom`, each in one of four groups.
 */

import type { StatusCategory, StatusInfo } from "@/types";

/**
 * bd's built-in statuses in the order bd 1.3.0 lists them. Mirrors the
 * server's own fallback; used until the project's list arrives or when it
 * cannot be read.
 */
export const BUILTIN_STATUSES: readonly StatusInfo[] = [
  { name: "open", category: "active", builtin: true },
  { name: "in_progress", category: "wip", builtin: true },
  { name: "blocked", category: "wip", builtin: true },
  { name: "deferred", category: "frozen", builtin: true },
  { name: "closed", category: "done", builtin: true },
  { name: "pinned", category: "frozen", builtin: true },
  { name: "hooked", category: "wip", builtin: true },
];

/** Group of a status; `undefined` when the list does not have it. */
export function getStatusCategory(
  name: string,
  statuses: readonly StatusInfo[]
): StatusCategory | undefined {
  return statuses.find((s) => s.name === name)?.category;
}

/** Whether the status is in the done group (`closed` and any own done status). */
export function isDoneStatus(name: string, statuses: readonly StatusInfo[]): boolean {
  return getStatusCategory(name, statuses) === "done";
}
