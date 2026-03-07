"use client";

import { useMemo, useRef, useState, useCallback, useEffect } from "react";

import { useSearchParams, useRouter } from "next/navigation";

import { ArrowLeft } from "lucide-react";

import { ActivityTimeline } from "@/components/activity-timeline";
import { AgentsPanel } from "@/components/agents-panel";
import { BeadDetail } from "@/components/bead-detail";
import { CommentList } from "@/components/comment-list";
import { EditableProjectName } from "@/components/editable-project-name";
import { ErrorBoundary } from "@/components/error-boundary";
import { KanbanColumn } from "@/components/kanban-column";
import { MemoryPanel } from "@/components/memory-panel";
import { QuickFilterBar } from "@/components/quick-filter-bar";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogClose,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useBeadDetail } from "@/hooks/use-bead-detail";
import { useBeadFilters } from "@/hooks/use-bead-filters";
import { useBeads } from "@/hooks/use-beads";
import { useGitHubStatus } from "@/hooks/use-github-status";
import { useKeyboardNavigation } from "@/hooks/use-keyboard-navigation";
import { useProject } from "@/hooks/use-project";
import { useWorktreeStatuses } from "@/hooks/use-worktree-statuses";
import { getUnknownStatusBeads, getUnknownStatusNames } from "@/lib/beads-parser";
import { isDoltProject } from "@/lib/utils";
import type { Bead, BeadStatus } from "@/types";

/**
 * Column configuration for the Kanban board
 * Note: Cancelled status is hidden per requirements
 */
const COLUMNS: { status: BeadStatus; title: string }[] = [
  { status: "open", title: "Open" },
  { status: "in_progress", title: "In Progress" },
  { status: "inreview", title: "In Review" },
  { status: "closed", title: "Closed" },
];

/**
 * Issue type filter options
 */
type IssueTypeFilter = "all" | "epics" | "tasks";

/**
 * Main Kanban board component with 4 columns, search, filter, and keyboard navigation
 */
export default function KanbanBoard() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const projectId = searchParams.get('id');

  // Fetch project data from SQLite
  const {
    project,
    isLoading: projectLoading,
    error: projectError,
    refetch: refetchProject,
  } = useProject(projectId);

  // Fetch beads from project path
  const {
    beads,
    ticketNumbers,
    isLoading: beadsLoading,
    error: beadsError,
    refresh: refreshBeads,
  } = useBeads(project?.path ?? "");

  // Use the bead filters hook with 300ms debounce
  const {
    filters,
    setFilters,
    filteredBeads,
    clearFilters,
    hasActiveFilters,
    availableOwners,
  } = useBeadFilters(beads, ticketNumbers, 300);

  // Issue type filter state (epics vs tasks)
  const [typeFilter, setTypeFilter] = useState<IssueTypeFilter>("all");

  // GitHub status check
  const { hasRemote, isAuthenticated, isLoading: githubStatusLoading } = useGitHubStatus(
    project?.path ?? null
  );

  // Track whether the GitHub warning has been dismissed (session-only)
  const [githubWarningDismissed, setGithubWarningDismissed] = useState(false);

  // Memory panel state
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);

  // Agents panel state
  const [isAgentsOpen, setIsAgentsOpen] = useState(false);

  // Show GitHub warning if project loaded, status checked, and either no remote or not authenticated
  const showGitHubWarning = !projectLoading &&
    !githubStatusLoading &&
    project !== null &&
    !githubWarningDismissed &&
    (!hasRemote || !isAuthenticated);

  /**
   * Toggle a status in the filter
   */
  const toggleStatus = useCallback((status: BeadStatus) => {
    const newStatuses = filters.statuses.includes(status)
      ? filters.statuses.filter(s => s !== status)
      : [...filters.statuses, status];
    setFilters({ statuses: newStatuses });
  }, [filters.statuses, setFilters]);

  /**
   * Toggle an owner in the filter
   */
  const toggleOwner = useCallback((owner: string) => {
    const newOwners = filters.owners.includes(owner)
      ? filters.owners.filter(o => o !== owner)
      : [...filters.owners, owner];
    setFilters({ owners: newOwners });
  }, [filters.owners, setFilters]);

  // Filter out closed beads to avoid unnecessary polling for finalized tasks
  const beadIds = useMemo(() => beads.filter(b => b.status !== 'closed').map(b => b.id), [beads]);

  const isDoltOnly = isDoltProject(project?.path);

  // Worktree statuses for PR workflow (skip for dolt-only projects)
  const { statuses: worktreeStatuses } = useWorktreeStatuses(
    isDoltOnly ? "" : (project?.path ?? ""),
    isDoltOnly ? [] : beadIds
  );

  /**
   * Filter to only top-level beads (no parent_id)
   * Then apply issue type filter (epics vs tasks)
   * Child tasks should not appear in columns - they appear inside epic cards
   */
  const topLevelBeads = useMemo(() => {
    const topLevel = filteredBeads.filter(b => !b.parent_id);

    // Apply issue type filter
    if (typeFilter === "all") return topLevel;
    if (typeFilter === "epics") return topLevel.filter(b => b.issue_type === "epic");
    if (typeFilter === "tasks") return topLevel.filter(b => b.issue_type !== "epic");

    return topLevel;
  }, [filteredBeads, typeFilter]);

  /**
   * Group top-level beads by status for columns.
   * Defensive: falls back to 'open' for any status not in the 4 columns.
   */
  const filteredBeadsByStatus = useMemo(() => {
    const grouped: Record<BeadStatus, Bead[]> = {
      open: [],
      in_progress: [],
      inreview: [],
      closed: [],
    };
    for (const bead of topLevelBeads) {
      const column = grouped[bead.status] ? bead.status : 'open';
      grouped[column].push(bead);
    }
    return grouped;
  }, [topLevelBeads]);

  /**
   * Detect beads with truly unknown statuses for the warning indicator.
   */
  const unknownStatusBeads = useMemo(() => getUnknownStatusBeads(beads), [beads]);
  const unknownStatusNames = useMemo(() => getUnknownStatusNames(beads), [beads]);

  // Detail panel state
  const {
    detailBead,
    isDetailOpen,
    openBead,
    handleDetailOpenChange,
    navigateToBead,
  } = useBeadDetail(beads);

  // Ref for search input (keyboard navigation)
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard navigation (use top-level beads for navigation)
  const { selectedId } = useKeyboardNavigation({
    beads: topLevelBeads,
    beadsByStatus: filteredBeadsByStatus,
    selectedId: null,
    onSelect: () => {
      // Just highlight, don't open detail
    },
    onOpen: (bead) => {
      openBead(bead);
    },
    onClose: () => {
      handleDetailOpenChange(false);
    },
    searchInputRef,
    isDetailOpen,
  });

  // Redirect if no project ID
  useEffect(() => {
    if (!projectId) {
      router.replace("/");
    }
  }, [projectId, router]);

  /**
   * Handle navigation from Memory panel to a bead
   */
  const handleMemoryNavigateToBead = useCallback((beadId: string) => {
    setIsMemoryOpen(false);
    navigateToBead(beadId);
  }, [navigateToBead]);

  // Redirect state while no project ID
  if (!projectId) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-base">
        <p className="text-t-muted">Redirecting…</p>
      </div>
    );
  }

  // Show loading state
  if (projectLoading) {
    return (
      <div className="flex items-center justify-center min-h-dvh bg-surface-base">
        <div role="status" className="text-t-muted">Loading project…</div>
      </div>
    );
  }

  // Show project error state
  if (projectError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh bg-surface-base gap-4">
        <div role="alert" className="text-danger">Error: {projectError.message}</div>
        <Button variant="outline" asChild>
          <a href="/">Back to projects</a>
        </Button>
      </div>
    );
  }

  // Project not found
  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh bg-surface-base gap-4">
        <div className="text-t-muted">Project not found</div>
        <Button variant="outline" asChild>
          <a href="/">Back to projects</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-surface-base flex flex-col">
      {/* Breadcrumb line */}
      <div className="flex items-center gap-2 px-4 py-2">
        <Button variant="ghost" size="icon" asChild>
          <a href="/">
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Back to projects</span>
          </a>
        </Button>
        <EditableProjectName
          projectId={project.id}
          initialName={project.name}
          onNameUpdated={refetchProject}
        />
      </div>

      {/* Quick Filter Bar */}
      <div className="flex justify-center px-4 pb-3">
        <QuickFilterBar
          // Search
          search={filters.search}
          onSearchChange={(value) => setFilters({ search: value })}
          searchInputRef={searchInputRef}
          // Type filter
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          // Today
          todayOnly={filters.todayOnly}
          onTodayOnlyChange={(value) => setFilters({ todayOnly: value })}
          // Sort
          sortField={filters.sortField}
          sortDirection={filters.sortDirection}
          onSortChange={(field, direction) => setFilters({ sortField: field, sortDirection: direction })}
          // Status/Owner filters
          statuses={filters.statuses}
          onStatusToggle={toggleStatus}
          owners={filters.owners}
          onOwnerToggle={toggleOwner}
          availableOwners={availableOwners}
          onClearFilters={clearFilters}
          hasActiveFilters={hasActiveFilters}
          // Memory
          isMemoryOpen={isMemoryOpen}
          onMemoryToggle={() => setIsMemoryOpen((prev) => !prev)}
          // Agents
          isAgentsOpen={isAgentsOpen}
          onAgentsToggle={() => setIsAgentsOpen((prev) => !prev)}
          // Unknown status warning
          unknownStatusCount={unknownStatusBeads.length}
          unknownStatusNames={unknownStatusNames}
        />
      </div>

      {/* Kanban Columns */}
      <main className="flex-1 overflow-hidden p-4">
        {beadsLoading ? (
          <div className="flex items-center justify-center h-full">
            <div role="status" className="text-t-muted">Loading beads…</div>
          </div>
        ) : beadsError ? (
          <div className="flex items-center justify-center h-full">
            <div role="alert" className="text-danger">Error loading beads: {beadsError.message}</div>
          </div>
        ) : (
          <div className="grid grid-cols-4 h-full" style={{ gap: 'var(--column-gap)' }}>
            {COLUMNS.map(({ status, title }) => (
              <KanbanColumn
                key={status}
                status={status}
                title={title}
                beads={filteredBeadsByStatus[status] || []}
                allBeads={beads}
                selectedBeadId={selectedId}
                ticketNumbers={ticketNumbers}
                onSelectBead={openBead}
                onChildClick={openBead}
                onNavigateToDependency={navigateToBead}
                projectPath={project?.path}
                onUpdate={refreshBeads}
              />
            ))}
          </div>
        )}
      </main>

      {/* Bead Detail Sheet */}
      <ErrorBoundary label="Bead Detail">
      {detailBead && (
        <BeadDetail
          bead={detailBead}
          ticketNumber={ticketNumbers.get(detailBead.id)}
          worktreeStatus={isDoltOnly ? undefined : worktreeStatuses[detailBead.id]}
          open={isDetailOpen}
          onOpenChange={handleDetailOpenChange}
          projectPath={project?.path ?? ""}
          allBeads={beads}
          onChildClick={openBead}
          onUpdate={refreshBeads}
        >
          <CommentList
            comments={detailBead.comments}
            beadId={detailBead.id}
            projectPath={project?.path ?? ""}
            onCommentAdded={refreshBeads}
          />
          <ActivityTimeline
            bead={detailBead}
            comments={detailBead.comments}
            childBeads={(detailBead.children || [])
              .map(id => beads.find(b => b.id === id))
              .filter((b): b is Bead => !!b)}
          />
        </BeadDetail>
      )}
      </ErrorBoundary>

      {/* Memory Panel */}
      <ErrorBoundary label="Memory Panel">
      {project?.path && (
        <MemoryPanel
          open={isMemoryOpen}
          onOpenChange={setIsMemoryOpen}
          projectPath={project.path}
          onNavigateToBead={handleMemoryNavigateToBead}
        />
      )}
      </ErrorBoundary>

      {/* Agents Panel */}
      <ErrorBoundary label="Agents Panel">
      {project?.path && (
        <AgentsPanel
          open={isAgentsOpen}
          onOpenChange={setIsAgentsOpen}
          projectPath={project.path}
        />
      )}
      </ErrorBoundary>

      {/* GitHub Integration Warning Dialog */}
      <AlertDialog open={showGitHubWarning} onOpenChange={(open) => !open && setGithubWarningDismissed(true)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>GitHub Integration Unavailable</AlertDialogTitle>
            <AlertDialogDescription>
              {!hasRemote
                ? "This repository doesn't have a GitHub remote configured."
                : "GitHub CLI is not authenticated."}
              {" "}PR features (Create PR, Merge PR, status checks) will not be available.
              You can still work on tasks locally.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button>Continue Without GitHub</Button>} />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
