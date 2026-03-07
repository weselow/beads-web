"use client";

import { FolderOpen, GitPullRequest, Link2, MessageSquare, Check, X, Clock } from "lucide-react";

import { CopyableText } from "@/components/copyable-text";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "@/hooks/use-theme";
import { formatBeadId, formatWorktreePath, isBlocked, truncate } from "@/lib/bead-utils";
import { cn } from "@/lib/utils";
import type { Bead, WorktreeStatus, PRStatus, StatusBadgeInfo } from "@/types";

export interface BeadCardProps {
  bead: Bead;
  ticketNumber?: number;
  /** Worktree status for the bead */
  worktreeStatus?: WorktreeStatus;
  /** Mini PR status for card display */
  prStatus?: PRStatus;
  isSelected?: boolean;
  onSelect: (bead: Bead) => void;
}

/**
 * Get worktree status color for the status box
 * Green: PR merged or checks passed
 * Yellow/amber: checks pending
 * Red: checks failed or needs rebase
 * Gray: no PR or default state, or bead is closed
 */
function getWorktreeStatusColor(worktreeStatus?: WorktreeStatus, prStatus?: PRStatus, beadStatus?: string): string {
  // Closed beads should not show colored status badges
  if (beadStatus === 'closed') {
    return "bg-surface-overlay/50 border-b-default/50";
  }

  if (!worktreeStatus?.exists) {
    return "bg-surface-overlay/50 border-b-default/50";
  }

  // Check PR status first
  if (prStatus?.pr) {
    const { state, checks } = prStatus.pr;

    if (state === "merged") {
      return "bg-success/10 border-success/30";
    }

    if (checks.status === "success") {
      return "bg-success/10 border-success/30";
    }

    if (checks.status === "pending") {
      return "bg-warning/10 border-warning/30";
    }

    if (checks.status === "failure") {
      return "bg-danger/10 border-danger/30";
    }
  }

  // Check worktree ahead/behind
  const { ahead, behind } = worktreeStatus;

  if (ahead > 0 && behind > 0) {
    // Needs rebase - red
    return "bg-danger/10 border-danger/30";
  }

  if (ahead > 0 && behind === 0) {
    // Ready to push/PR - green
    return "bg-success/10 border-success/30";
  }

  return "bg-surface-overlay/50 border-b-default/50";
}

/**
 * Get the PR checks display icon and text
 */
function getPRChecksDisplay(prStatus: PRStatus): { icon: React.ReactNode; text: string; className: string } {
  const { pr } = prStatus;

  if (!pr) {
    return { icon: null, text: "", className: "" };
  }

  if (pr.state === "merged") {
    return {
      icon: <Check className="size-3" aria-hidden="true" />,
      text: "Merged",
      className: "text-success"
    };
  }

  const { checks } = pr;
  const checksText = `${checks.passed}/${checks.total}`;

  if (checks.status === "success") {
    return {
      icon: <Check className="size-3" aria-hidden="true" />,
      text: checksText,
      className: "text-success"
    };
  }

  if (checks.status === "pending") {
    return {
      icon: <Clock className="size-3" aria-hidden="true" />,
      text: checksText,
      className: "text-warning"
    };
  }

  if (checks.status === "failure") {
    return {
      icon: <X className="size-3" aria-hidden="true" />,
      text: checksText,
      className: "text-danger"
    };
  }

  return { icon: null, text: checksText, className: "text-t-tertiary" };
}

/**
 * Get the display label for the bead type
 */
function getTypeLabel(bead: Bead): string {
  return bead.issue_type === "epic" ? "Epic" : "Task";
}

/**
 * Get badge variant class for status badges based on severity.
 * warning = orange (blocked, unknown), muted = gray (deferred), info = blue (hooked/waiting)
 */
function getStatusBadgeClasses(variant: StatusBadgeInfo['variant']): string {
  switch (variant) {
    case 'warning':
      return 'bg-blocked-accent/15 text-blocked-accent border-blocked-accent/30';
    case 'muted':
      return 'bg-t-muted/15 text-t-tertiary border-t-muted/30';
    case 'info':
      return 'bg-info/15 text-info border-info/30';
  }
}

export function BeadCard({ bead, ticketNumber, worktreeStatus, prStatus, isSelected = false, onSelect }: BeadCardProps) {
  const { layout } = useTheme();
  const blocked = isBlocked(bead);
  const commentCount = (bead.comments ?? []).length;
  const relatedCount = (bead.relates_to ?? []).length;

  const hasWorktree = worktreeStatus?.exists ?? false;
  const hasPR = prStatus?.pr !== null && prStatus?.pr !== undefined;

  // Get PR checks display info
  const prChecksDisplay = prStatus ? getPRChecksDisplay(prStatus) : null;

  // Shared interaction props
  const interactionProps = {
    "data-bead-id": bead.id,
    role: "button" as const,
    tabIndex: 0,
    "aria-label": `Select bead: ${bead.title}`,
    onClick: () => onSelect(bead),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(bead);
      }
    },
  };

  // Shared worktree/PR section
  const worktreeSection = hasWorktree && worktreeStatus?.worktree_path && (
    <div
      className={cn(
        "rounded-md border p-2 space-y-1.5",
        getWorktreeStatusColor(worktreeStatus, prStatus, bead.status)
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <FolderOpen className="size-3 shrink-0" aria-hidden="true" />
        <span className="font-mono truncate">
          {formatWorktreePath(worktreeStatus.worktree_path)}
        </span>
      </div>
      {hasPR && prStatus?.pr && prChecksDisplay && (
        <div className="flex items-center justify-between text-[10px]">
          <div className="flex items-center gap-1.5 text-foreground">
            <GitPullRequest className="size-3 shrink-0" aria-hidden="true" />
            <span>PR #{prStatus.pr.number}</span>
          </div>
          <div className={cn("flex items-center gap-1", prChecksDisplay.className)}>
            {prChecksDisplay.icon}
            <span className="tabular-nums">{prChecksDisplay.text}</span>
          </div>
        </div>
      )}
    </div>
  );

  // Inline PR badge for compact layouts
  const inlinePRBadge = hasPR && prStatus?.pr && prChecksDisplay && (
    <span className={cn("flex items-center gap-1 text-[10px] font-medium", prChecksDisplay.className)}>
      <GitPullRequest className="size-3" aria-hidden="true" />
      PR #{prStatus.pr.number} {prChecksDisplay.text}
    </span>
  );

  const isClosed = bead.status === 'closed';

  // ─── Layout: compact-row (Linear Minimal) ───
  if (layout === 'compact-row') {
    return (
      <div
        {...interactionProps}
        className={cn(
          "theme-card cursor-pointer p-2 flex items-start gap-2.5",
          "bg-card border border-transparent",
          "hover:bg-surface-overlay/50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isClosed && "opacity-40",
          isSelected && "bg-info/5 outline outline-1 outline-info/20"
        )}
      >
        {/* Priority bar */}
        <div className={cn(
          "w-1 h-4 rounded-sm shrink-0 mt-0.5",
          bead.priority === 0 ? "bg-danger" :
          bead.priority === 1 ? "bg-blocked-accent" :
          bead.priority === 2 ? "bg-t-faint" : "bg-surface-inset"
        )} />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-t-muted font-mono shrink-0 tabular-nums">
              {formatBeadId(bead.id)}
            </span>
            <span className="text-[13px] font-medium text-t-primary truncate">
              {bead.title}
            </span>
          </div>
          {(bead.description || inlinePRBadge) && (
            <div className="flex items-center gap-2 mt-0.5">
              {blocked && (
                <Badge variant="destructive" appearance="light" size="xs">BLOCKED</Badge>
              )}
              {bead.description && (
                <span className="text-xs text-t-muted truncate">
                  {truncate(bead.description, 60)}
                </span>
              )}
              {inlinePRBadge}
            </div>
          )}
        </div>

        {/* Right badges */}
        <div className="flex items-center gap-1.5 shrink-0">
          {commentCount > 0 && (
            <span className="flex items-center gap-0.5 text-[11px] text-t-faint">
              <MessageSquare className="size-3" aria-hidden="true" />
              {commentCount}
            </span>
          )}
        </div>
      </div>
    );
  }

  // ─── Layout: property-tags (Notion Warm / GitHub Clean) ───
  if (layout === 'property-tags') {
    return (
      <div
        {...interactionProps}
        className={cn(
          "theme-card cursor-pointer p-3 bg-card border border-b-default/60",
          "hover:bg-surface-inset/30",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          blocked && "border-l-3 border-l-danger",
          isClosed && "opacity-45",
          isSelected && "ring-2 ring-ring ring-offset-2 ring-offset-surface-base"
        )}
      >
        {/* Title first */}
        <div className={cn(
          "text-sm font-medium leading-snug text-t-primary mb-1.5",
          isClosed && "line-through decoration-t-faint"
        )}>
          {truncate(bead.title, 70)}
        </div>

        {/* Description */}
        {bead.description && (
          <p className="text-xs text-t-muted leading-relaxed mb-2">
            {truncate(bead.description, 80)}
          </p>
        )}

        {/* Property tags row */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="theme-badge text-[11px] font-mono px-1.5 py-0.5 bg-surface-overlay text-t-muted">
            {ticketNumber !== undefined && `#${ticketNumber} `}{formatBeadId(bead.id)}
          </span>
          {blocked && (
            <span className="theme-badge text-[10px] font-semibold px-1.5 py-0.5 bg-danger/15 text-danger">
              Blocked
            </span>
          )}
          <span className="theme-badge text-[10px] font-medium px-1.5 py-0.5 bg-surface-overlay text-t-tertiary">
            {getTypeLabel(bead)}
          </span>
          {bead.priority !== undefined && bead.priority <= 2 && (
            <span className={cn(
              "theme-badge text-[10px] font-medium px-1.5 py-0.5",
              bead.priority === 0 ? "bg-danger/15 text-danger" :
              bead.priority === 1 ? "bg-blocked-accent/15 text-blocked-accent" :
              "bg-surface-overlay text-t-muted"
            )}>
              P{bead.priority}
            </span>
          )}
          {inlinePRBadge}
          {commentCount > 0 && (
            <span className="text-[10px] text-t-faint px-1">
              {commentCount} {commentCount === 1 ? "comment" : "comments"}
            </span>
          )}
        </div>
      </div>
    );
  }

  // ─── Layout: standard (Default / Glassmorphism / Neo-Brutalist / Soft Light) ───
  return (
    <div
      {...interactionProps}
      className={cn(
        "theme-card cursor-pointer bg-card border border-border/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        blocked ? "border-l-4 border-l-danger" : "border-l-2 border-l-muted-foreground/30",
        isSelected && "ring-2 ring-ring ring-offset-2 ring-offset-background"
      )}
    >
      <div className="p-3 space-y-1.5">
        {/* Row 1: ID (left) + Type Badge (right) */}
        <div className="flex items-center justify-between">
          <div className="text-xs font-mono text-muted-foreground">
            {ticketNumber !== undefined && (
              <CopyableText copyText={`#${ticketNumber}`} className="font-semibold text-foreground">
                #{ticketNumber}
              </CopyableText>
            )}
            {ticketNumber !== undefined && " "}
            <CopyableText copyText={bead.id}>
              {formatBeadId(bead.id)}
            </CopyableText>
          </div>
          <div className="flex items-center gap-1.5">
            {blocked && (
              <Badge variant="destructive" appearance="light" size="xs">BLOCKED</Badge>
            )}
            {bead._statusBadge && !(blocked && bead._originalStatus === 'blocked') && (
              <Badge
                variant="outline"
                size="xs"
                className={getStatusBadgeClasses(bead._statusBadge.variant)}
              >
                {bead._statusBadge.label}
              </Badge>
            )}
            <Badge variant="outline" size="xs">{getTypeLabel(bead)}</Badge>
          </div>
        </div>

        {/* Row 2: Title */}
        <div className="font-semibold text-sm leading-tight">
          {truncate(bead.title, 60)}
        </div>

        {/* Description */}
        {bead.description && (
          <p className="text-xs text-muted-foreground leading-relaxed text-pretty">
            {truncate(bead.description, 80)}
          </p>
        )}
      </div>

      {/* Worktree and PR status box */}
      {worktreeSection && (
        <div className="px-3 pb-3">{worktreeSection}</div>
      )}

      {/* Footer: comment count + related count */}
      {(commentCount > 0 || relatedCount > 0) && (
        <div className="flex items-center p-3 pt-0 gap-2 text-muted-foreground">
          {commentCount > 0 && (
            <span className="flex items-center gap-1 text-[10px]">
              <MessageSquare className="size-3" aria-hidden="true" />
              {commentCount} {commentCount === 1 ? "comment" : "comments"}
            </span>
          )}
          {relatedCount > 0 && (
            <span className="flex items-center gap-1 text-[10px]">
              <Link2 className="size-3" aria-hidden="true" />
              {relatedCount} related
            </span>
          )}
        </div>
      )}
    </div>
  );
}
