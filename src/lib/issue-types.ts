/**
 * Single source of truth for bead issue types.
 *
 * bd 1.3 supports these issue types: task, bug, feature, epic, chore, story,
 * spike, decision, milestone. This module centralizes their display metadata
 * (label, Lucide icon, theme color token, description sections) so the create
 * dialog, cards, and filters stay in sync. Add a new type here and every
 * consumer picks it up.
 *
 * Color classes use the shared theme tokens defined in `themes.css`
 * (text-danger, text-info, text-epic, …) so icons adapt across all themes.
 */

import {
  BookOpen,
  Bug,
  CircleDashed,
  CircleDot,
  FlaskConical,
  Layers,
  Milestone,
  Scale,
  Sparkles,
  Wrench,
} from "lucide-react";

import type { LucideIcon } from "lucide-react";

/** Canonical bd issue_type values that have first-class display metadata. */
export type IssueTypeValue =
  | "task"
  | "bug"
  | "feature"
  | "epic"
  | "chore"
  | "story"
  | "spike"
  | "decision"
  | "milestone";

/** Type filter selection: every issue type plus an "all" pass-through. */
export type IssueTypeFilter = "all" | IssueTypeValue;

/** Display metadata for a single issue type, known to beads-web or not. */
export interface IssueTypeMeta {
  /** bd issue_type value, as bd stores it. */
  value: string;
  /** Human-readable label (e.g. "Milestone"). */
  label: string;
  /** Lucide icon component representing the type. */
  icon: LucideIcon;
  /** Tailwind text color class using a shared theme token. */
  colorClass: string;
  /** Description section headings bd lint expects for this type. */
  sections: readonly string[];
}

/** Metadata of a type beads-web knows. */
export interface KnownIssueTypeMeta extends IssueTypeMeta {
  value: IssueTypeValue;
}

const ACCEPTANCE = ["Acceptance Criteria"];

const TASK: KnownIssueTypeMeta = {
  value: "task", label: "Task", icon: CircleDot, colorClass: "text-t-tertiary", sections: ACCEPTANCE,
};

/**
 * Ordered list of issue types. Order drives the create-bead Select and the
 * type filter menu, so keep the most common types first.
 */
export const ISSUE_TYPES: readonly KnownIssueTypeMeta[] = [
  TASK,
  { value: "bug", label: "Bug", icon: Bug, colorClass: "text-danger", sections: [] },
  { value: "feature", label: "Feature", icon: Sparkles, colorClass: "text-info", sections: ACCEPTANCE },
  { value: "epic", label: "Epic", icon: Layers, colorClass: "text-epic", sections: ["Success Criteria"] },
  { value: "chore", label: "Chore", icon: Wrench, colorClass: "text-t-secondary", sections: [] },
  { value: "story", label: "Story", icon: BookOpen, colorClass: "text-success", sections: ACCEPTANCE },
  { value: "spike", label: "Spike", icon: FlaskConical, colorClass: "text-warning", sections: ["Goal", "Findings"] },
  {
    value: "decision", label: "Decision", icon: Scale, colorClass: "text-status-progress",
    sections: ["Decision", "Rationale", "Alternatives Considered"],
  },
  { value: "milestone", label: "Milestone", icon: Milestone, colorClass: "text-status-review", sections: [] },
];

const ISSUE_TYPE_MAP: ReadonlyMap<string, KnownIssueTypeMeta> = new Map(
  ISSUE_TYPES.map((meta) => [meta.value, meta]),
);

/** Neutral metadata for a type bd has but beads-web does not know (convoy, agent, …). */
function unknownIssueTypeMeta(value: string): IssueTypeMeta {
  const label = value.charAt(0).toUpperCase() + value.slice(1);
  return { value, label, icon: CircleDashed, colorClass: "text-t-muted", sections: [] };
}

/**
 * Resolve display metadata for an issue type.
 *
 * A missing or empty value is a task, as in bd. An unknown value keeps its
 * own name with a neutral icon, so it is never shown as another type.
 */
export function getIssueTypeMeta(value?: string | null): IssueTypeMeta {
  if (!value) return TASK;
  return ISSUE_TYPE_MAP.get(value) ?? unknownIssueTypeMeta(value);
}

/**
 * Types offered when changing a bead's type. An unknown current type is added,
 * so the choice shows the bead's real type, not another one.
 */
export function issueTypeChoices(current: string): readonly IssueTypeMeta[] {
  const meta = getIssueTypeMeta(current);
  return ISSUE_TYPE_MAP.has(meta.value) ? ISSUE_TYPES : [...ISSUE_TYPES, meta];
}

const PLAIN_PLACEHOLDER = "Optional details…";

/**
 * Placeholder for the description field: the section headings bd lint
 * expects for the type, or a plain hint when it expects none.
 */
export function descriptionPlaceholder(type: string): string {
  const { sections } = getIssueTypeMeta(type);
  if (sections.length === 0) return PLAIN_PLACEHOLDER;
  const headings = sections.map((section) => `## ${section}`).join("\n");
  return `${PLAIN_PLACEHOLDER} Suggested sections:\n\n${headings}`;
}
