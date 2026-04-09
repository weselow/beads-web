"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

import {
  ArrowLeft,
  Calendar,
  Circle,
  Layers,
  Link2,
  Plus,
  Square,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

import { BeadPRSection } from "@/components/bead-pr-section";
import { CopyableText } from "@/components/copyable-text";
import { CreateBeadDialog } from "@/components/create-bead-dialog";
import { DesignDocViewer } from "@/components/design-doc-viewer";
import { SubtaskList } from "@/components/subtask-list";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogClose,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import * as api from "@/lib/api";
import {
  formatBeadId,
  formatShortDate,
  formatStatus,
  formatWorktreePath,
  getStatusDotColor,
} from "@/lib/bead-utils";
import { updateStatus as cliUpdateStatus, deleteBead } from "@/lib/cli";
import { cn, isDoltProject } from "@/lib/utils";
import type { Bead, WorktreeStatus } from "@/types";


export interface BeadDetailProps {
  bead: Bead;
  ticketNumber?: number;
  worktreeStatus?: WorktreeStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children?: React.ReactNode;
  projectPath?: string;
  allBeads?: Bead[];
  onChildClick?: (child: Bead) => void;
  onCleanup?: () => void;
  onUpdate?: () => void;
}

/**
 * Bead detail modal — centered full-screen overlay.
 * Displays full bead information with metadata, PR section, subtasks, and comments.
 */
export function BeadDetail({
  bead,
  ticketNumber,
  worktreeStatus,
  open,
  onOpenChange,
  children,
  projectPath,
  allBeads,
  onChildClick,
  onCleanup,
  onUpdate,
}: BeadDetailProps) {
  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  const isReadOnly = !projectPath;
  const isDolt = projectPath ? isDoltProject(projectPath) : false;

  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  const handleDelete = useCallback(async () => {
    if (!projectPath) return;
    try {
      await deleteBead(bead.id, projectPath);
      setIsDeleteConfirmOpen(false);
      onOpenChange(false);
      onUpdate?.();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to delete bead", description: err instanceof Error ? err.message : "Unknown error" });
    }
  }, [bead.id, projectPath, onOpenChange, onUpdate]);

  const handleStatusChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!projectPath) return;
    const newStatus = e.target.value as import("@/types").BeadStatus;
    try {
      if (isDolt) {
        await api.beads.update({ path: projectPath, id: bead.id, status: newStatus });
      } else {
        await cliUpdateStatus(bead.id, newStatus, projectPath);
      }
      onUpdate?.();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to update status", description: err instanceof Error ? err.message : "Unknown error" });
    }
  }, [bead.id, projectPath, isDolt, onUpdate]);

  const [isDesignDocFullScreen, setIsDesignDocFullScreen] = useState(false);
  const [isAddSubtaskOpen, setIsAddSubtaskOpen] = useState(false);
  const hasDesignDoc = !!bead.design_doc;
  const hasWorktree = worktreeStatus?.exists ?? false;
  const isEpic = bead.children && bead.children.length > 0;

  // Resolve children from IDs
  const childTasks = useMemo(() => {
    if (!isEpic || !allBeads) return [];
    return (bead.children || [])
      .map(childId => allBeads.find(b => b.id === childId))
      .filter((b): b is Bead => b !== undefined);
  }, [isEpic, bead.children, allBeads]);

  // Resolve related tasks from IDs
  const relatedTasks = useMemo(() => {
    if (!allBeads || !bead.relates_to || bead.relates_to.length === 0) return [];
    const beadMap = new Map(allBeads.map(b => [b.id, b]));
    return bead.relates_to
      .map(id => beadMap.get(id))
      .filter((b): b is Bead => b !== undefined);
  }, [bead.relates_to, allBeads]);

  // PR status for child tasks (epics only)
  const [childPRStatuses, setChildPRStatuses] = useState<Map<string, { state: "open" | "merged" | "closed"; checks: { status: "success" | "failure" | "pending" } }>>(new Map());

  const fetchChildPRStatuses = useCallback(async () => {
    if (!projectPath || isDoltProject(projectPath) || childTasks.length === 0) return;

    const results = await Promise.all(
      childTasks.filter(c => c.status !== 'closed').map(async (child) => {
        try {
          const prStatus = await api.git.prStatus(projectPath, child.id);
          if (prStatus.pr) {
            return { id: child.id, status: { state: prStatus.pr.state, checks: { status: prStatus.pr.checks.status } } };
          }
        } catch { /* ignore */ }
        return null;
      })
    );

    const statusMap = new Map<string, { state: "open" | "merged" | "closed"; checks: { status: "success" | "failure" | "pending" } }>();
    for (const result of results) {
      if (result) statusMap.set(result.id, result.status);
    }
    setChildPRStatuses(statusMap);
  }, [projectPath, childTasks]);

  useEffect(() => {
    if (!open || !isEpic || !projectPath || childTasks.length === 0) return;
    fetchChildPRStatuses();
    const intervalId = setInterval(fetchChildPRStatuses, 30_000);
    return () => clearInterval(intervalId);
  }, [open, isEpic, projectPath, childTasks, fetchChildPRStatuses]);

  const handleFullScreenChange = useCallback((isFullScreen: boolean) => {
    setIsDesignDocFullScreen(isFullScreen);
  }, []);

  // Clear any lingering inline body styles when design doc dialog closes.
  useEffect(() => {
    if (!isDesignDocFullScreen) {
      document.body.style.overflow = '';
      document.body.style.pointerEvents = '';
    }
  }, [isDesignDocFullScreen]);

  return (
    <>
      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/80"
          onClick={() => onOpenChange(false)}
        />
      )}
      {/* Full-screen centered modal */}
      <div
        className={cn(
          "fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8 pointer-events-none",
          open ? "pointer-events-auto" : "pointer-events-none",
          isDesignDocFullScreen && "invisible"
        )}
      >
        <div
          className={cn(
            "relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl bg-surface-base border border-b-default shadow-2xl p-6 md:p-8",
            "transition-all duration-200 ease-out",
            open ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
          )}
        >
          {/* Header with Back button and Delete button */}
          <div className="flex items-center justify-between mb-6">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="gap-1.5 -ml-2"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </Button>
            <div className="flex items-center gap-1">
              {!isReadOnly && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsDeleteConfirmOpen(true)}
                  className="text-destructive hover:text-destructive gap-1.5"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-4">
            {/* Ticket Number + Bead ID */}
            <p className="text-xs font-mono text-t-muted">
              {ticketNumber !== undefined && (
                <CopyableText copyText={`#${ticketNumber}`} className="font-semibold text-t-secondary">
                  #{ticketNumber}
                </CopyableText>
              )}
              {ticketNumber !== undefined && " "}
              <CopyableText copyText={bead.id} variant="pill">
                {formatBeadId(bead.id, 8)}
              </CopyableText>
            </p>

            {/* Title */}
            <h2 className="text-xl font-semibold leading-tight text-t-primary">
              {bead.title}
            </h2>

            {/* Worktree path */}
            {bead.issue_type !== "epic" && hasWorktree && worktreeStatus?.worktree_path && (
              <div className={cn(
                "font-mono text-xs text-t-muted",
                bead.status === "closed" && "opacity-40"
              )}>
                <span
                  className="cursor-pointer hover:text-t-secondary hover:underline"
                  title="Cmd+Click to open in VS Code, double-click to select"
                  onClick={(e) => {
                    if (e.metaKey && worktreeStatus.worktree_path) {
                      api.fs.openExternal(worktreeStatus.worktree_path, 'vscode');
                    }
                  }}
                  onDoubleClick={(e) => {
                    const target = e.currentTarget;
                    const selection = window.getSelection();
                    if (selection) {
                      const range = document.createRange();
                      range.selectNodeContents(target);
                      selection.removeAllRanges();
                      selection.addRange(range);
                    }
                  }}
                >
                  {formatWorktreePath(worktreeStatus.worktree_path)}
                </span>
              </div>
            )}
          </div>

          {/* Inline Metadata Row */}
          <div className="mt-6 flex justify-center items-center gap-3 text-sm text-t-tertiary">
            <span className="flex items-center gap-1.5">
              {bead.issue_type === "epic" ? (
                <Layers className="size-3.5" aria-hidden="true" />
              ) : (
                <Square className="size-3.5" aria-hidden="true" />
              )}
              <span className="capitalize">{bead.issue_type}</span>
            </span>
            <span className="text-t-faint" aria-hidden="true">•</span>
            <span className="flex items-center gap-1.5">
              <Circle className={cn("size-2 fill-current", getStatusDotColor(bead.status))} aria-hidden="true" />
              {isReadOnly ? (
                <span>{formatStatus(bead.status)}</span>
              ) : (
                <select
                  value={bead.status}
                  onChange={handleStatusChange}
                  className="bg-transparent border-none text-sm text-t-tertiary cursor-pointer hover:text-t-secondary focus:outline-none appearance-none"
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="inreview">In Review</option>
                  <option value="closed">Closed</option>
                </select>
              )}
            </span>
            <span className="text-t-faint" aria-hidden="true">•</span>
            <span className="flex items-center gap-1.5">
              <Calendar className="size-3.5" aria-hidden="true" />
              <span>{formatShortDate(bead.created_at)}</span>
            </span>
          </div>

          {/* Worktree & PR Section */}
          {hasWorktree && projectPath && (
            <BeadPRSection
              bead={bead}
              worktreeStatus={worktreeStatus}
              projectPath={projectPath}
              open={open}
              onCleanup={onCleanup}
            />
          )}

          {/* Description */}
          {bead.description && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold mb-2 text-t-secondary">Description</h3>
              <div className="h-px bg-b-default mb-3" />
              <div className="prose prose-sm prose-invert max-w-none text-sm text-t-tertiary leading-relaxed">
                <ReactMarkdown>
                  {bead.description}
                </ReactMarkdown>
              </div>
            </div>
          )}
          {!bead.description && !isReadOnly && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold mb-2 text-t-secondary">Description</h3>
              <div className="h-px bg-b-default mb-3" />
              <span className="text-t-faint italic text-sm">No description</span>
            </div>
          )}

          {/* Metadata Key-Value */}
          {(() => {
            const metaFields = [
              { key: 'Priority', value: bead.priority !== undefined ? bead.priority : null },
              { key: 'Owner', value: bead.owner || null },
              { key: 'Parent', value: bead.parent_id || null },
              { key: 'Dependencies', value: bead.deps && bead.deps.length > 0 ? bead.deps : null },
              { key: 'Related To', value: bead.relates_to && bead.relates_to.length > 0 ? bead.relates_to : null },
            ].filter(f => f.value !== null);

            if (metaFields.length === 0) return null;

            return (
              <div className="mt-6">
                <h3 className="text-sm font-semibold mb-2 text-t-secondary">Details</h3>
                <div className="h-px bg-b-default mb-3" />
                <div className="space-y-3">
                  {metaFields.map(({ key, value }) => (
                    <div key={key}>
                      <div className="text-xs font-semibold text-t-secondary mb-0.5">{key}</div>
                      {key === 'Priority' ? (
                        <span className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold",
                          value === 0 ? "bg-danger/15 text-danger" :
                          value === 1 ? "bg-blocked-accent/15 text-blocked-accent" :
                          value === 2 ? "bg-warning/15 text-warning" :
                          "bg-surface-overlay text-t-muted"
                        )}>
                          P{value as number}
                        </span>
                      ) : Array.isArray(value) ? (
                        <div className="flex flex-wrap gap-1">
                          {(value as string[]).map(id => (
                            <CopyableText key={id} copyText={id} variant="pill">{id}</CopyableText>
                          ))}
                        </div>
                      ) : (
                        <span className="text-sm text-t-primary font-mono select-all cursor-text">{value as string}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Related Tasks */}
          {relatedTasks.length > 0 && onChildClick && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold mb-2 text-t-secondary flex items-center gap-1.5">
                <Link2 className="size-3.5" aria-hidden="true" />
                Related Tasks ({relatedTasks.length})
              </h3>
              <div className="h-px bg-b-default mb-3" />
              <div className="rounded-lg border border-b-default bg-surface-raised/50 p-3">
                <div className="space-y-1">
                  {relatedTasks.map((related) => (
                    <button
                      key={related.id}
                      onClick={() => onChildClick(related)}
                      aria-label={`Open related task: ${related.title}`}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded-md",
                        "hover:bg-b-default transition-colors text-left",
                        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-t-tertiary",
                        "group"
                      )}
                    >
                      <Circle
                        className={cn("size-2 flex-shrink-0 fill-current", getStatusDotColor(related.status))}
                        aria-hidden="true"
                      />
                      <span className="text-[10px] font-mono text-t-muted flex-shrink-0">
                        {formatBeadId(related.id)}
                      </span>
                      <span className={cn(
                        "text-xs font-medium flex-1 min-w-0 truncate group-hover:underline",
                        related.status === "closed" ? "line-through text-t-muted" : "text-t-secondary"
                      )}>
                        {related.title}
                      </span>
                      <Badge variant="outline" size="xs" className="flex-shrink-0">
                        {formatStatus(related.status)}
                      </Badge>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Subtasks (for epics) */}
          {isEpic && onChildClick && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-t-secondary">
                  Subtasks ({childTasks.length})
                </h3>
                {projectPath && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsAddSubtaskOpen(true)}
                    className="h-7 px-2 gap-1 text-xs text-success hover:text-success"
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                    Add subtask
                  </Button>
                )}
              </div>
              <div className="h-px bg-b-default mb-3" />
              <div className="rounded-lg border border-b-default bg-surface-raised/50 p-3">
                <SubtaskList
                  childTasks={childTasks}
                  onChildClick={onChildClick}
                  isExpanded={true}
                  childPRStatuses={childPRStatuses}
                />
              </div>
            </div>
          )}

          {/* Design Document */}
          {hasDesignDoc && projectPath && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold mb-3 text-t-secondary">Design Document</h3>
              <DesignDocViewer
                designDocPath={bead.design_doc!}
                epicId={formatBeadId(bead.id)}
                projectPath={projectPath}
                onFullScreenChange={handleFullScreenChange}
              />
            </div>
          )}

          {/* Children slot for comments + timeline */}
          {children && <div className="mt-6">{children}</div>}

          {/* Close button */}
          <button
            onClick={() => onOpenChange(false)}
            className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
        </div>
      </div>

      {/* Add Subtask Dialog (for epics) */}
      {projectPath && isEpic && (
        <CreateBeadDialog
          open={isAddSubtaskOpen}
          onOpenChange={setIsAddSubtaskOpen}
          projectPath={projectPath}
          onCreated={() => onUpdate?.()}
          parentId={bead.id}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <AlertDialogContent className="bg-surface-raised border-b-default">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-t-primary">Delete bead?</AlertDialogTitle>
            <AlertDialogDescription className="text-t-muted">
              This will permanently delete this bead and all its comments. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
