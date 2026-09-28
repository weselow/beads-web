"use client";

import { Check, Circle, Clock, FileCheck, GitPullRequest, GitMerge, Link2 } from "lucide-react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { truncate } from "@/lib/bead-utils";
import { cn } from "@/lib/utils";
import type { Bead } from "@/types";

/**
 * PR status for a child task (used for icon display)
 */
export interface ChildPRStatus {
  state: "open" | "merged" | "closed";
  checks: { status: "success" | "failure" | "pending" };
}

export interface SubtaskListProps {
  /** Child tasks to display */
  childTasks: Bead[];
  /** Callback when clicking a child task */
  onChildClick: (child: Bead) => void;
  /** Maximum number of children to show when collapsed */
  maxCollapsed?: number;
  /** Whether the list is expanded */
  isExpanded?: boolean;
  /** PR status for each child task, keyed by bead ID */
  childPRStatuses?: Map<string, ChildPRStatus>;
}

/**
 * Get status icon based on bead status
 */
function getStatusIcon(status: string) {
  switch (status) {
    case 'closed':
      return <Check className="h-3.5 w-3.5 text-status-closed" aria-hidden="true" />;
    case 'in_progress':
      return <Clock className="h-3.5 w-3.5 text-status-progress" aria-hidden="true" />;
    case 'inreview':
      return <FileCheck className="h-3.5 w-3.5 text-status-review" aria-hidden="true" />;
    case 'open':
    default:
      return <Circle className="h-3.5 w-3.5 text-t-muted" aria-hidden="true" />;
  }
}

/**
 * Get status text color
 */
function getStatusColor(status: string): string {
  switch (status) {
    case 'closed':
      return "text-status-closed";
    case 'in_progress':
      return "text-status-progress";
    case 'inreview':
      return "text-status-review";
    case 'open':
    default:
      return "text-t-muted";
  }
}

/**
 * Get PR status info including icon and tooltip message
 * Returns null if no PR status (no icon shown)
 */
function getPRStatusInfo(prStatus: ChildPRStatus | undefined): { icon: React.ReactNode; tooltip: string } | null {
  if (!prStatus) {
    // No PR - no icon
    return null;
  }

  if (prStatus.state === "merged") {
    // Merged PR - purple GitMerge icon
    return {
      icon: (
        <GitMerge
          className="h-3.5 w-3.5 text-epic"
          aria-hidden="true"
        />
      ),
      tooltip: "PR merged",
    };
  }

  if (prStatus.state === "open") {
    // Open PR - color based on checks status
    if (prStatus.checks.status === "success") {
      return {
        icon: (
          <GitPullRequest
            className="h-3.5 w-3.5 text-success"
            aria-hidden="true"
          />
        ),
        tooltip: "PR open, checks passing",
      };
    }
    if (prStatus.checks.status === "failure") {
      return {
        icon: (
          <GitPullRequest
            className="h-3.5 w-3.5 text-danger"
            aria-hidden="true"
          />
        ),
        tooltip: "PR open, checks failing",
      };
    }
    // Pending checks
    return {
      icon: (
        <GitPullRequest
          className="h-3.5 w-3.5 text-warning"
          aria-hidden="true"
        />
      ),
      tooltip: "PR open, checks pending",
    };
  }

  // Closed PR (not merged) - no icon
  return null;
}

/**
 * Render PR status icon with tooltip
 */
function PRStatusIcon({ prStatus }: { prStatus: ChildPRStatus | undefined }) {
  const info = getPRStatusInfo(prStatus);
  if (!info) return null;

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help" tabIndex={0} aria-label={info.tooltip}>{info.icon}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {info.tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Compact list of child tasks within epic card
 */
export function SubtaskList({
  childTasks,
  onChildClick,
  maxCollapsed = 3,
  isExpanded = false,
  childPRStatuses,
}: SubtaskListProps) {
  if (childTasks.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic">
        No child tasks
      </div>
    );
  }

  const displayChildren = isExpanded ? childTasks : childTasks.slice(0, maxCollapsed);
  const hasMore = childTasks.length > maxCollapsed && !isExpanded;

  return (
    <div className="space-y-1">
      {displayChildren.map((child) => (
        <button
          key={child.id}
          onClick={(e) => {
            e.stopPropagation();
            onChildClick(child);
          }}
          aria-label={`Open task: ${child.title}`}
          className={cn(
            "w-full flex items-start gap-2 px-2 py-1.5 rounded-md",
            "hover:bg-surface-overlay transition-colors text-left",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-t-tertiary",
            "group"
          )}
        >
          <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
            {getStatusIcon(child.status)}
            <PRStatusIcon prStatus={childPRStatuses?.get(child.id)} />
          </div>
          <div className="flex-1 min-w-0">
            <p className={cn(
              "text-xs font-medium group-hover:underline",
              child.status === 'closed' && "line-through text-t-muted",
              child.status !== 'closed' && "text-t-secondary"
            )}>
              {truncate(child.title, 50)}
            </p>
            {child.description && (
              <p className="text-[10px] text-t-muted mt-0.5">
                {truncate(child.description, 60)}
              </p>
            )}
          </div>
          {(child.relates_to ?? []).length > 0 && (
            <span className="flex items-center gap-0.5 flex-shrink-0 text-muted-foreground">
              <Link2 className="size-3" aria-hidden="true" />
              <span className="text-[9px] tabular-nums">{child.relates_to!.length}</span>
            </span>
          )}
          <div className={cn(
            "flex-shrink-0 text-[9px] font-medium uppercase tracking-wide",
            getStatusColor(child.status)
          )}>
            {child.status.replace('_', ' ')}
          </div>
        </button>
      ))}
      {hasMore && (
        <p className="text-[10px] text-muted-foreground text-center py-1">
          +{childTasks.length - maxCollapsed} more
        </p>
      )}
    </div>
  );
}
