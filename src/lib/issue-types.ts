/**
 * Single source of truth for bead issue types.
 *
 * bd v1.0 supports these issue types: task, bug, feature, epic, story, spike,
 * milestone. This module centralizes their display metadata (label, Lucide
 * icon, theme color token) so the create dialog, cards, and filters stay in
 * sync. Add a new type here and every consumer picks it up.
 *
 * Color classes use the shared theme tokens defined in `themes.css`
 * (text-danger, text-info, text-epic, …) so icons adapt across all themes.
 */

import { BookOpen, Bug, CircleDot, FlaskConical, Layers, Milestone, Sparkles } from "lucide-react";

import type { LucideIcon } from "lucide-react";

/** Canonical bd issue_type values that have first-class display metadata. */
export type IssueTypeValue =
  | "task"
  | "bug"
  | "feature"
  | "epic"
  | "story"
  | "spike"
  | "milestone";

/** Type filter selection: every issue type plus an "all" pass-through. */
export type IssueTypeFilter = "all" | IssueTypeValue;

/** Display metadata for a single issue type. */
export interface IssueTypeMeta {
  /** Canonical bd issue_type value. */
  value: IssueTypeValue;
  /** Human-readable label (e.g. "Milestone"). */
  label: string;
  /** Lucide icon component representing the type. */
  icon: LucideIcon;
  /** Tailwind text color class using a shared theme token. */
  colorClass: string;
}

/**
 * Ordered list of issue types. Order drives the create-bead Select and the
 * type filter menu, so keep the most common types first.
 */
export const ISSUE_TYPES: readonly IssueTypeMeta[] = [
  { value: "task", label: "Task", icon: CircleDot, colorClass: "text-t-tertiary" },
  { value: "bug", label: "Bug", icon: Bug, colorClass: "text-danger" },
  { value: "feature", label: "Feature", icon: Sparkles, colorClass: "text-info" },
  { value: "epic", label: "Epic", icon: Layers, colorClass: "text-epic" },
  { value: "story", label: "Story", icon: BookOpen, colorClass: "text-success" },
  { value: "spike", label: "Spike", icon: FlaskConical, colorClass: "text-warning" },
  { value: "milestone", label: "Milestone", icon: Milestone, colorClass: "text-status-review" },
];

const ISSUE_TYPE_MAP: Record<string, IssueTypeMeta> = Object.fromEntries(
  ISSUE_TYPES.map((meta) => [meta.value, meta]),
);

/** Fallback metadata for unknown or missing issue types. */
const FALLBACK_ISSUE_TYPE: IssueTypeMeta = ISSUE_TYPE_MAP.task;

/**
 * Resolve display metadata for an issue type.
 *
 * Returns the `task` metadata for unknown, empty, or missing values so callers
 * always receive a usable icon, label, and color.
 */
export function getIssueTypeMeta(value?: string | null): IssueTypeMeta {
  if (!value) return FALLBACK_ISSUE_TYPE;
  return ISSUE_TYPE_MAP[value] ?? FALLBACK_ISSUE_TYPE;
}
