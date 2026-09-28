"use client";

import { useState, useEffect, useCallback, useRef } from "react";

import {
  AlertTriangle,
  Check,
  Clock,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { PRFilesList } from "@/components/pr-files-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePRStatus } from "@/hooks/use-pr-status";
import { toast } from "@/hooks/use-toast";
import * as api from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Bead, WorktreeStatus, PRChecks, PRFilesResponse } from "@/types";

/**
 * Get overall checks status display
 */
function getChecksStatusDisplay(checks: PRChecks): {
  icon: React.ReactNode;
  text: string;
  className: string;
} {
  const checksText = `${checks.passed}/${checks.total}`;

  if (checks.status === "success") {
    return {
      icon: <Check className="size-4" aria-hidden="true" />,
      text: checksText,
      className: "text-success",
    };
  }

  if (checks.status === "pending") {
    return {
      icon: <Clock className="size-4" aria-hidden="true" />,
      text: checksText,
      className: "text-warning",
    };
  }

  if (checks.status === "failure") {
    return {
      icon: <X className="size-4" aria-hidden="true" />,
      text: checksText,
      className: "text-danger",
    };
  }

  return { icon: null, text: checksText, className: "text-t-tertiary" };
}

export interface BeadPRSectionProps {
  bead: Bead;
  worktreeStatus?: WorktreeStatus;
  projectPath: string;
  open: boolean;
  onCleanup?: () => void;
}

/**
 * Worktree & PR management section for bead detail panel.
 * Handles: PR status display, create PR, merge PR, cleanup, rebase siblings.
 */
export function BeadPRSection({
  bead,
  worktreeStatus,
  projectPath,
  open,
  onCleanup,
}: BeadPRSectionProps) {
  const hasWorktree = worktreeStatus?.exists ?? false;

  // Action loading states
  const [isCreatingPR, setIsCreatingPR] = useState(false);
  const [isMergingPR, setIsMergingPR] = useState(false);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [isRebasingSiblings, setIsRebasingSiblings] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isRefreshingPR, setIsRefreshingPR] = useState(false);

  // PR files state
  const [prFiles, setPrFiles] = useState<PRFilesResponse | null>(null);
  const [isPrFilesLoading, setIsPrFilesLoading] = useState(false);

  // Merge button delay state
  const [mergeButtonReady, setMergeButtonReady] = useState(false);
  const [isCheckingCI, setIsCheckingCI] = useState(false);

  // Guard to prevent duplicate auto-cleanup calls
  const autoCleanupTriggered = useRef(false);

  const shouldFetchPRStatus = open && hasWorktree;

  const {
    status: prStatus,
    isLoading: isPRStatusLoading,
    refresh: refreshPRStatus,
  } = usePRStatus(projectPath, shouldFetchPRStatus ? bead.id : null);

  // Clear action error and merge button state when panel closes
  useEffect(() => {
    if (!open) {
      setActionError(null);
      setMergeButtonReady(false);
      setIsCheckingCI(false);
    }
  }, [open]);

  // Delay showing merge button by 2 seconds when PR loads
  const prState = prStatus?.pr?.state;
  const prNumber = prStatus?.pr?.number;
  useEffect(() => {
    if (isPRStatusLoading || !prState || prState !== "open") {
      setMergeButtonReady(false);
      setIsCheckingCI(false);
      return;
    }

    setIsCheckingCI(true);
    setMergeButtonReady(false);

    const timer = setTimeout(async () => {
      await refreshPRStatus();
      setIsCheckingCI(false);
      setMergeButtonReady(true);
    }, 2000);

    return () => clearTimeout(timer);
  }, [isPRStatusLoading, prState, prNumber, refreshPRStatus]);

  const handleCreatePR = useCallback(async () => {
    setIsCreatingPR(true);
    setActionError(null);
    try {
      const prBody = `Closes ${bead.id}\n\n${bead.description ?? ""}`;
      const result = await api.git.createPR(projectPath, bead.id, bead.title, prBody);
      if (!result.success && result.error) {
        setActionError(result.error);
      } else {
        await refreshPRStatus();
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to create PR");
    } finally {
      setIsCreatingPR(false);
    }
  }, [projectPath, bead.id, bead.title, bead.description, refreshPRStatus]);

  const handleMergePR = useCallback(async () => {
    setIsMergingPR(true);
    setActionError(null);
    try {
      const result = await api.git.mergePR(projectPath, bead.id, "squash");
      if (!result.success && result.error) {
        setActionError(result.error);
      } else {
        await refreshPRStatus();

        // Rebase sibling branches
        setIsRebasingSiblings(true);
        try {
          const rebaseResult = await api.git.rebaseSiblings(projectPath, bead.id);
          const successCount = rebaseResult.results.filter(r => r.success).length;
          const failedResults = rebaseResult.results.filter(r => !r.success);

          if (rebaseResult.results.length > 0) {
            if (failedResults.length === 0) {
              toast({
                title: "Branches rebased",
                description: `Successfully rebased ${successCount} sibling branch${successCount !== 1 ? "es" : ""} onto main.`,
              });
            } else {
              toast({
                variant: "destructive",
                title: "Some rebases failed",
                description: `${successCount} succeeded, ${failedResults.length} failed: ${failedResults.map(r => r.bead_id).join(", ")}`,
              });
            }
          }
        } catch (rebaseErr) {
          console.error("Failed to rebase siblings:", rebaseErr);
          toast({
            variant: "destructive",
            title: "Rebase failed",
            description: rebaseErr instanceof Error ? rebaseErr.message : "Failed to rebase sibling branches",
          });
        } finally {
          setIsRebasingSiblings(false);
        }
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to merge PR");
    } finally {
      setIsMergingPR(false);
    }
  }, [projectPath, bead.id, refreshPRStatus]);

  const handleCleanUp = useCallback(async (options?: { auto?: boolean }) => {
    setIsCleaningUp(true);
    setActionError(null);
    try {
      const result = await api.git.deleteWorktree(projectPath, bead.id);
      if (!result.success) {
        setActionError("Failed to delete worktree");
      } else {
        if (options?.auto) {
          toast({
            title: "PR merged",
            description: "Worktree cleaned up and bead closed automatically.",
          });
        }
        onCleanup?.();
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to clean up");
    } finally {
      setIsCleaningUp(false);
    }
  }, [projectPath, bead.id, onCleanup]);

  // Auto-cleanup when PR merge is detected
  useEffect(() => {
    if (
      prStatus?.pr?.state === "merged" &&
      worktreeStatus?.exists &&
      !autoCleanupTriggered.current &&
      !isCleaningUp
    ) {
      autoCleanupTriggered.current = true;
      handleCleanUp({ auto: true });
    }
  }, [prStatus, worktreeStatus, isCleaningUp, handleCleanUp]);

  // Reset auto-cleanup guard when bead changes
  useEffect(() => {
    autoCleanupTriggered.current = false;
  }, [bead.id]);

  // Fetch PR files when PR exists and is open
  useEffect(() => {
    if (!prStatus?.pr?.number || prStatus.pr.state !== "open") {
      setPrFiles(null);
      return;
    }

    let cancelled = false;
    setIsPrFilesLoading(true);

    api.git.prFiles(projectPath, bead.id)
      .then((data) => { if (!cancelled) setPrFiles(data); })
      .catch(() => { if (!cancelled) setPrFiles(null); })
      .finally(() => { if (!cancelled) setIsPrFilesLoading(false); });

    return () => { cancelled = true; };
  }, [projectPath, bead.id, prStatus?.pr?.state, prStatus?.pr?.number]);

  if (!hasWorktree) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-t-secondary">Worktree & PR</h3>
        <Button
          variant="ghost"
          size="sm"
          mode="icon"
          className="h-6 w-6 -mr-1"
          onClick={async () => {
            setIsRefreshingPR(true);
            try { await refreshPRStatus(); } finally { setIsRefreshingPR(false); }
          }}
          disabled={isPRStatusLoading || isRefreshingPR}
          aria-label="Refresh PR status"
        >
          <RefreshCw className={cn("size-3.5", (isPRStatusLoading || isRefreshingPR) && "animate-spin")} />
        </Button>
      </div>
      <div className="h-px bg-b-default mb-3" />

      {/* Loading */}
      {isPRStatusLoading && (
        <div className="rounded-lg border border-b-default bg-surface-raised/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Skeleton className="size-4 rounded" />
              <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton className="h-4 w-10" />
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
      )}

      {/* Error */}
      {actionError && (
        <div role="alert" className="mb-3 rounded-lg border border-danger/30 bg-danger/10 p-3">
          <p className="text-sm text-danger">{actionError}</p>
        </div>
      )}

      {/* No remote */}
      {!isPRStatusLoading && prStatus && !prStatus.has_remote && (
        <div className="rounded-lg border border-b-default bg-surface-raised/50 p-4">
          <p className="text-sm text-t-tertiary">No remote configured. Push to a remote to enable PR features.</p>
        </div>
      )}

      {/* Branch not pushed */}
      {!isPRStatusLoading && prStatus?.has_remote && !prStatus.branch_pushed && (
        <div className="rounded-lg border border-b-default bg-surface-raised/50 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-t-tertiary">Branch not pushed to remote</p>
            <Button variant="outline" size="sm" className="gap-1.5" disabled>
              <Upload className="size-3.5" aria-hidden="true" />
              Push Branch
            </Button>
          </div>
        </div>
      )}

      {/* No PR yet */}
      {!isPRStatusLoading && prStatus?.has_remote && prStatus.branch_pushed && !prStatus.pr && (
        <div className="rounded-lg border border-b-default bg-surface-raised/50 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-t-tertiary">No pull request created yet</p>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={handleCreatePR}
              disabled={isCreatingPR}
            >
              {isCreatingPR ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <GitPullRequest className="size-3.5" aria-hidden="true" />
              )}
              Create PR
            </Button>
          </div>
        </div>
      )}

      {/* PR exists */}
      {!isPRStatusLoading && prStatus?.pr && (
        <div className="rounded-lg border border-b-default bg-surface-raised/50 p-4 space-y-4">
          {/* PR Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitPullRequest className="size-4 text-t-tertiary" aria-hidden="true" />
              <span className="text-sm font-medium text-t-secondary">PR #{prStatus.pr.number}</span>
              {prStatus.pr.state === "merged" && (
                <Badge className="text-[10px] px-1.5 py-0 bg-epic/20 text-epic border border-epic/30">Merged</Badge>
              )}
            </div>
            <div className={cn("flex items-center gap-1", getChecksStatusDisplay(prStatus.pr.checks).className)}>
              {getChecksStatusDisplay(prStatus.pr.checks).icon}
              <span className="text-sm tabular-nums">{getChecksStatusDisplay(prStatus.pr.checks).text}</span>
            </div>
          </div>

          {/* CI Checks */}
          {prStatus.pr.checks.total > 0 && prStatus.pr.state !== "merged" && (
            <div className="space-y-2">
              <span className="text-xs text-t-muted">Checks</span>
              <div className="flex items-center gap-4 text-xs">
                {prStatus.pr.checks.passed > 0 && (
                  <span className="flex items-center gap-1 text-success">
                    <Check className="size-3" aria-hidden="true" />
                    {prStatus.pr.checks.passed} passed
                  </span>
                )}
                {prStatus.pr.checks.failed > 0 && (
                  <span className="flex items-center gap-1 text-danger">
                    <X className="size-3" aria-hidden="true" />
                    {prStatus.pr.checks.failed} failed
                  </span>
                )}
                {prStatus.pr.checks.pending > 0 && (
                  <span className="flex items-center gap-1 text-warning">
                    <Clock className="size-3" aria-hidden="true" />
                    {prStatus.pr.checks.pending} pending
                  </span>
                )}
              </div>
            </div>
          )}

          {/* PR Files */}
          {prStatus.pr.state === "open" && isPrFilesLoading && (
            <div className="space-y-2">
              <Skeleton className="h-3.5 w-28" />
              <div className="space-y-1">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-3/4" />
              </div>
            </div>
          )}
          {prStatus.pr.state === "open" && prFiles && prFiles.files.length > 0 && (
            <PRFilesList
              files={prFiles.files}
              totalAdditions={prFiles.total_additions}
              totalDeletions={prFiles.total_deletions}
              totalFiles={prFiles.total_files}
            />
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-2 pt-2">
            <Button variant="outline" size="sm" className="gap-1.5" asChild>
              <a href={prStatus.pr.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-3.5" aria-hidden="true" />
                View PR
              </a>
            </Button>

            {prStatus.pr.state === "open" && !prStatus.pr.mergeable && (
              <span className="flex items-center gap-1.5 text-xs text-danger">
                <AlertTriangle className="size-3" aria-hidden="true" />
                Merge conflicts
              </span>
            )}

            {prStatus.pr.state === "open" && isCheckingCI && (
              <span role="status" aria-live="polite" className="flex items-center gap-1.5 text-xs text-t-muted">
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                Checking CI status…
              </span>
            )}

            {prStatus.pr.state === "open" && mergeButtonReady && prStatus.pr.checks.status === "success" && prStatus.pr.mergeable && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-success/30 text-success hover:bg-success/10"
                onClick={handleMergePR}
                disabled={isMergingPR}
              >
                {isMergingPR ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <GitMerge className="size-3.5" aria-hidden="true" />
                )}
                Merge PR
              </Button>
            )}

            {prStatus.pr.state === "merged" && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-b-strong/30 text-t-tertiary hover:bg-surface-overlay/10"
                onClick={() => handleCleanUp()}
                disabled={isCleaningUp}
              >
                {isCleaningUp ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 className="size-3.5" aria-hidden="true" />
                )}
                Clean Up
              </Button>
            )}
          </div>

          {isRebasingSiblings && (
            <div role="status" aria-live="polite" className="flex items-center gap-2 pt-2 text-xs text-t-tertiary">
              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              <span>Rebasing other branches...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
