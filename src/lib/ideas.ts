/**
 * Ideas are beads of type story. They live in the Ideas panel next to the
 * board, not on the board itself. These rules decide which story goes where.
 */

import { addMonths, addWeeks, format } from "date-fns";

import { getIssueTypeMeta } from "@/lib/issue-types";
import type { IssueTypeFilter } from "@/lib/issue-types";
import { isDoneStatus } from "@/lib/statuses";
import type { Bead, StatusInfo } from "@/types";

/** A story older than this many days is marked, so the list does not rot. */
export const STALE_IDEA_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Main list and deferred list of the Ideas panel. */
export interface IdeaGroups {
  /** Open stories, newest first. Its length is the counter on the Ideas button. */
  active: Bead[];
  /** Deferred stories, the soonest to come back first, undated ones last. */
  deferred: Bead[];
}

/** How far ahead a quick defer goes. */
export type DeferPreset = "week" | "month";

function isStory(bead: Bead): boolean {
  return getIssueTypeMeta(bead.issue_type).value === "story";
}

/** Milliseconds of a date string; NaN when it cannot be read. */
function timeOf(value?: string | null): number {
  return value ? new Date(value).getTime() : NaN;
}

/** Deferred: bd's `deferred` status, or a defer date still ahead. */
function isDeferredIdea(bead: Bead, now: Date): boolean {
  return bead.status === "deferred" || timeOf(bead.defer_until) > now.getTime();
}

function byNewest(a: Bead, b: Bead): number {
  return (timeOf(b.created_at) || 0) - (timeOf(a.created_at) || 0);
}

function byReturnDate(a: Bead, b: Bead): number {
  const left = timeOf(a.defer_until);
  const right = timeOf(b.defer_until);
  if (isNaN(left)) return isNaN(right) ? 0 : 1;
  if (isNaN(right)) return -1;
  return left - right;
}

/** Split the project's stories into the panel's two lists; done ones go nowhere. */
export function splitIdeas(beads: readonly Bead[], statuses: readonly StatusInfo[], now: Date): IdeaGroups {
  const ideas = beads.filter((b) => isStory(b) && !isDoneStatus(b.status, statuses));
  return {
    active: ideas.filter((b) => !isDeferredIdea(b, now)).sort(byNewest),
    deferred: ideas.filter((b) => isDeferredIdea(b, now)).sort(byReturnDate),
  };
}

/** Whether a story has waited longer than {@link STALE_IDEA_DAYS}. */
export function isStaleIdea(bead: Bead, now: Date): boolean {
  const created = timeOf(bead.created_at);
  return !isNaN(created) && now.getTime() - created > STALE_IDEA_DAYS * DAY_MS;
}

/**
 * Apply the board's type filter. With every type shown, stories stay off the
 * board (they are in the Ideas panel); picking Story shows them. A missing
 * type counts as task, an unknown one matches only "all".
 */
export function filterBoardTypes(beads: readonly Bead[], typeFilter: IssueTypeFilter): Bead[] {
  if (typeFilter === "all") return beads.filter((b) => !isStory(b));
  return beads.filter((b) => getIssueTypeMeta(b.issue_type).value === typeFilter);
}

/** `YYYY-MM-DD` of the local calendar day (toISOString would give the UTC day). */
export function localDateString(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/** The local day a week or a month from now, as bd's `--defer` takes it. */
export function deferDate(preset: DeferPreset, now: Date): string {
  return localDateString(preset === "week" ? addWeeks(now, 1) : addMonths(now, 1));
}
