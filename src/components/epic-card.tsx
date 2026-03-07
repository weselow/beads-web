"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";

import { CheckCircle2, ChevronDown, ChevronRight, Layers, Loader2, MessageSquare } from "lucide-react";

import { CopyableText } from "@/components/copyable-text";
import { DependencyBadge } from "@/components/dependency-badge";
import { DesignDocPreview } from "@/components/design-doc-preview";
import { SubtaskList, ChildPRStatus } from "@/components/subtask-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useTheme } from "@/hooks/use-theme";
import * as api from "@/lib/api";
import { formatBeadId, truncate } from "@/lib/bead-utils";
import { closeBead } from "@/lib/cli";
import { computeEpicProgress } from "@/lib/epic-parser";
import { cn, isDoltProject } from "@/lib/utils";
import type { Bead, Epic, EpicProgress } from "@/types";

export interface EpicCardProps {
  /** Epic bead with children */
  epic: Epic;
  /** All beads to resolve children */
  allBeads: Bead[];
  /** Ticket number for display */
  ticketNumber?: number;
  /** Whether this epic is selected */
  isSelected?: boolean;
  /** Callback when selecting this epic */
  onSelect: (epic: Epic) => void;
  /** Callback when clicking a child task */
  onChildClick: (child: Bead) => void;
  /** Callback when navigating to a dependency */
  onNavigateToDependency?: (beadId: string) => void;
  /** Project root path for fetching design docs */
  projectPath?: string;
  /** Callback after epic is closed (to refresh board) */
  onUpdate?: () => void;
}

/**
 * Compute epic progress from children
 * Uses epic-parser utility for proper dependency resolution
 */
function computeProgress(epic: Epic, allBeads: Bead[]): EpicProgress {
  return computeEpicProgress(epic, allBeads);
}

/**
 * Get progress bar indicator color based on completion percentage
 */
function getProgressIndicatorClass(percentage: number): string {
  if (percentage === 100) return "[&>*]:bg-progress-100";
  if (percentage >= 75) return "[&>*]:bg-progress-75";
  if (percentage >= 50) return "[&>*]:bg-progress-50";
  if (percentage >= 25) return "[&>*]:bg-progress-25";
  return "[&>*]:bg-progress-0";
}

/** Auto-refresh interval for PR statuses (30 seconds) */
const PR_STATUS_REFRESH_INTERVAL = 30_000;

/**
 * Larger epic card with distinctive styling
 */

export function EpicCard({
  epic,
  allBeads,
  ticketNumber,
  isSelected = false,
  onSelect,
  onChildClick,
  onNavigateToDependency,
  projectPath,
  onUpdate
}: EpicCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDesignPreviewExpanded, setIsDesignPreviewExpanded] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  // PR status for child tasks
  const [childPRStatuses, setChildPRStatuses] = useState<Map<string, ChildPRStatus>>(new Map());
  const isMountedRef = useRef(true);

  // Resolve children from IDs (memoized to prevent unnecessary re-fetches)
  const children = useMemo(() =>
    (epic.children || [])
      .map(childId => allBeads.find(b => b.id === childId))
      .filter((b): b is Bead => b !== undefined),
    [epic.children, allBeads]
  );

  // Fetch PR status for all children
  const fetchChildPRStatuses = useCallback(async () => {
    if (!projectPath || isDoltProject(projectPath) || children.length === 0) return;

    const statusMap = new Map<string, ChildPRStatus>();

    // Fetch PR status for all children in parallel (skip closed - no PR needed)
    const results = await Promise.all(
      children.filter(c => c.status !== 'closed').map(async (child) => {
        try {
          const prStatus = await api.git.prStatus(projectPath, child.id);
          if (prStatus.pr) {
            return {
              id: child.id,
              status: {
                state: prStatus.pr.state,
                checks: { status: prStatus.pr.checks.status },
              } as ChildPRStatus,
            };
          }
        } catch {
          // Ignore errors for individual children
        }
        return null;
      })
    );

    // Build the map from results
    for (const result of results) {
      if (result) {
        statusMap.set(result.id, result.status);
      }
    }

    // Only update state if component is still mounted
    if (isMountedRef.current) {
      setChildPRStatuses(statusMap);
    }
  }, [projectPath, children]);

  // Fetch PR statuses on mount and set up auto-refresh interval
  useEffect(() => {
    isMountedRef.current = true;

    // Initial fetch
    fetchChildPRStatuses();

    // Set up auto-refresh interval
    const intervalId = setInterval(() => {
      fetchChildPRStatuses();
    }, PR_STATUS_REFRESH_INTERVAL);

    return () => {
      isMountedRef.current = false;
      clearInterval(intervalId);
    };
  }, [fetchChildPRStatuses]);

  const progress = computeProgress(epic, allBeads);
  const progressPercentage = progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;

  const commentCount = (epic.comments ?? []).length;
  const hasDesignDoc = !!epic.design_doc;

  // Show Close Epic button when all children are complete and epic is in review
  const canCloseEpic = progressPercentage === 100 && epic.status === 'inreview';

  /**
   * Handle closing the epic
   */
  const handleCloseEpic = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isClosing) return;

    setIsClosing(true);
    try {
      await closeBead(epic.id, projectPath);
      onUpdate?.();
    } catch (error) {
      console.error('Failed to close epic:', error);
    } finally {
      setIsClosing(false);
    }
  };

  const { layout } = useTheme();

  // Shared interaction props
  const interactionProps = {
    "data-bead-id": epic.id,
    role: "button" as const,
    tabIndex: 0,
    "aria-label": `Select epic: ${epic.title}`,
    onClick: () => onSelect(epic),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(epic);
      }
    },
  };

  // Shared progress bar section
  const progressSection = (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-t-tertiary">
          {progress.completed}/{progress.total}
        </span>
        <span className="font-semibold text-t-secondary">{progressPercentage}%</span>
      </div>
      <Progress
        value={progressPercentage}
        aria-label={`Epic progress: ${progress.completed} of ${progress.total} completed`}
        className={cn(
          "h-2 bg-surface-overlay",
          getProgressIndicatorClass(progressPercentage)
        )}
      />
    </div>
  );

  // Shared children section
  const childrenSection = (
    <div className="pt-2 border-t border-b-strong">
      <button
        onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} child tasks`}
        className="flex items-center gap-1 text-xs font-semibold text-epic hover:text-epic/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-epic rounded mb-2"
      >
        {isExpanded ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
        Child Tasks ({children.length})
      </button>
      <SubtaskList
        childTasks={children}
        onChildClick={onChildClick}
        maxCollapsed={3}
        isExpanded={isExpanded}
        childPRStatuses={childPRStatuses}
      />
    </div>
  );

  // Shared close button
  const closeButton = canCloseEpic && (
    <div className="pt-2">
      <Button
        variant="outline"
        size="xs"
        onClick={handleCloseEpic}
        disabled={isClosing}
        className="w-full border-success/30 text-success hover:bg-success/10 hover:text-success/80"
      >
        {isClosing ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-3" aria-hidden="true" />}
        {isClosing ? 'Closing…' : 'Close Epic'}
      </Button>
    </div>
  );

  // Shared design doc section
  const designSection = hasDesignDoc && projectPath && (
    <div className="pt-2 border-t border-b-strong">
      <button
        onClick={(e) => { e.stopPropagation(); setIsDesignPreviewExpanded(!isDesignPreviewExpanded); }}
        aria-expanded={isDesignPreviewExpanded}
        aria-label={`${isDesignPreviewExpanded ? 'Collapse' : 'Expand'} design preview`}
        className="flex items-center gap-1 text-xs font-semibold text-epic hover:text-epic/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-epic rounded mb-2"
      >
        {isDesignPreviewExpanded ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
        Design Preview
      </button>
      {isDesignPreviewExpanded && (
        <DesignDocPreview designDocPath={epic.design_doc!} epicId={epic.id} projectPath={projectPath} />
      )}
    </div>
  );

  // ─── Layout: compact-row (Linear Minimal) ───
  if (layout === 'compact-row') {
    return (
      <div
        {...interactionProps}
        className={cn(
          "theme-card cursor-pointer p-2.5 bg-card border border-epic/20",
          "hover:bg-surface-overlay/50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-epic",
          isSelected && "bg-epic/5 outline outline-1 outline-epic/20"
        )}
      >
        <div className="flex items-start gap-2.5">
          <Layers className="h-4 w-4 text-epic shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-t-muted font-mono shrink-0">{formatBeadId(epic.id)}</span>
              <span className="text-[13px] font-semibold text-t-primary truncate">{epic.title}</span>
              <span className="text-[10px] font-semibold text-epic shrink-0">EPIC</span>
            </div>
            {progressSection}
            {closeButton}
            {childrenSection}
          </div>
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
          "theme-card cursor-pointer p-3 bg-card border border-epic/30",
          "hover:bg-surface-inset/30",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-epic",
          isSelected && "ring-2 ring-epic ring-offset-2 ring-offset-surface-base"
        )}
      >
        <div className="space-y-2">
          {/* Title */}
          <h3 className="font-semibold text-sm leading-tight text-t-primary">
            {truncate(epic.title, 70)}
          </h3>

          {epic.description && (
            <p className="text-xs text-t-muted leading-relaxed">{truncate(epic.description, 80)}</p>
          )}

          {/* Property tags */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="theme-badge text-[11px] font-mono px-1.5 py-0.5 bg-surface-overlay text-t-muted">
              {ticketNumber !== undefined && `#${ticketNumber} `}{formatBeadId(epic.id)}
            </span>
            <span className="theme-badge text-[10px] font-semibold px-1.5 py-0.5 bg-epic/15 text-epic">
              Epic
            </span>
            <span className="theme-badge text-[10px] px-1.5 py-0.5 bg-surface-overlay text-t-tertiary">
              {progressPercentage}% · {children.length} tasks
            </span>
            {commentCount > 0 && (
              <span className="text-[10px] text-t-faint">{commentCount} comments</span>
            )}
          </div>

          {progressSection}
          {closeButton}
          {designSection}
          {childrenSection}
        </div>
      </div>
    );
  }

  // ─── Layout: standard (Default / Glassmorphism / Neo-Brutalist / Soft Light) ───
  return (
    <div
      {...interactionProps}
      className={cn(
        "theme-card cursor-pointer p-4",
        "bg-surface-raised/70",
        "border border-b-default/60 border-l-2 border-l-epic",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-epic focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base",
        isSelected && "ring-2 ring-epic ring-offset-2 ring-offset-surface-base"
      )}
    >
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-epic" aria-hidden="true" />
            <span className="text-xs font-mono text-t-tertiary">
              {ticketNumber !== undefined && (
                <CopyableText copyText={`#${ticketNumber}`} className="font-semibold text-t-primary">
                  #{ticketNumber}
                </CopyableText>
              )}
              {ticketNumber !== undefined && " "}
              <CopyableText copyText={epic.id}>{formatBeadId(epic.id)}</CopyableText>
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <DependencyBadge deps={epic.deps} blockers={epic.blockers} onNavigate={onNavigateToDependency} />
            <Badge variant="outline" className="text-[10px] px-2 py-0.5 border-epic/30 text-epic bg-epic/20 font-semibold">EPIC</Badge>
          </div>
        </div>

        <h3 className="font-bold text-base leading-tight text-t-primary">{truncate(epic.title, 60)}</h3>

        {epic.description && (
          <p className="text-xs text-t-tertiary leading-relaxed">{truncate(epic.description, 100)}</p>
        )}

        {/* Progress */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-t-tertiary">Progress: {progress.completed}/{progress.total} completed</span>
            <span className="font-semibold text-t-secondary">{progressPercentage}%</span>
          </div>
          <Progress
            value={progressPercentage}
            aria-label={`Epic progress: ${progress.completed} of ${progress.total} completed`}
            className={cn("h-2 bg-surface-overlay", getProgressIndicatorClass(progressPercentage))}
          />
          <div className="flex items-center gap-3 text-[10px] text-t-muted">
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-status-open" aria-hidden="true" />
              {progress.inProgress} in progress
            </span>
            {progress.blocked > 0 && (
              <span className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-danger" aria-hidden="true" />
                {progress.blocked} blocked
              </span>
            )}
          </div>
        </div>

        {closeButton}
        {designSection}
        {childrenSection}

        {commentCount > 0 && (
          <div className="flex items-center pt-2">
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <MessageSquare className="h-3 w-3" aria-hidden="true" />
              {commentCount} {commentCount === 1 ? "comment" : "comments"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
