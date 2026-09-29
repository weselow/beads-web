"use client";

import { useMemo, useRef, useState, useCallback, useEffect } from "react";

import { useSearchParams, useRouter } from "next/navigation";

import { ArrowLeft, EllipsisVertical } from "lucide-react";

import { ActivityTimeline } from "@/components/activity-timeline";
import { AgentsPanel } from "@/components/agents-panel";
import { BeadDetail } from "@/components/bead-detail";
import { CommentList } from "@/components/comment-list";
import { CreateBeadDialog } from "@/components/create-bead-dialog";
import { ErrorBoundary } from "@/components/error-boundary";
import { IdeasPanel } from "@/components/ideas-panel";
import { JournalSwitch } from "@/components/journal-switch";
import { KanbanColumn } from "@/components/kanban-column";
import { MemoryPanel } from "@/components/memory-panel";
import { ProjectSettingsDialog } from "@/components/project-settings-dialog";
import { QuickFilterBar } from "@/components/quick-filter-bar";
import { StaleDataBanner } from "@/components/stale-data-banner";
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
import { useStatuses } from "@/hooks/use-statuses";
import { useTheme } from "@/hooks/use-theme";
import { useWorktreeStatuses } from "@/hooks/use-worktree-statuses";
import { isBlocked } from "@/lib/bead-utils";
import { getUnknownStatusBeads, getUnknownStatusNames } from "@/lib/beads-parser";
import { buildBoardColumns } from "@/lib/board-columns";
import { filterBoardTypes, splitIdeas } from "@/lib/ideas";
import type { IssueTypeFilter } from "@/lib/issue-types";
import { isDoneStatus } from "@/lib/statuses";
import { isDoltProject } from "@/lib/utils";
import type { Bead } from "@/types";

/**
 * Main Kanban board component with status columns, search, filter, and keyboard navigation
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
    stale,
    source: beadsSource,
    refresh: refreshBeads,
  } = useBeads(project?.path ?? "");

  // After the journal is switched, re-read everything so the new source shows.
  const refreshAfterJournalSwitch = useCallback(() => {
    void refreshBeads({ full: true });
  }, [refreshBeads]);

  // The project's statuses: bd's built-in ones plus its own
  const { statuses, isLoading: statusesLoading } = useStatuses(project?.path ?? "");

  // An old copy from issues.jsonl: bd failed, and every write goes through bd.
  const readOnly = stale !== null;

  // Use the bead filters hook with 300ms debounce
  const {
    filters,
    setFilters,
    filteredBeads,
    clearFilters,
    hasActiveFilters,
    availableOwners,
  } = useBeadFilters(beads, ticketNumbers, 300);

  // Issue type filter state ("all" or a specific issue type)
  const [typeFilter, setTypeFilter] = useState<IssueTypeFilter>("all");

  // Dolt project detection and filesystem path resolution
  const isDolt = isDoltProject(project?.path);
  const isDoltOnly = isDolt && !project?.localPath;
  const fsPath = isDolt ? (project?.localPath ?? "") : (project?.path ?? "");

  // GitHub status check
  const { hasRemote, isAuthenticated, isLoading: githubStatusLoading } = useGitHubStatus(
    fsPath || null
  );

  // Track whether the GitHub warning has been dismissed (session-only)
  const [githubWarningDismissed, setGithubWarningDismissed] = useState(false);

  // Theme
  const { theme } = useTheme();

  // Ideas panel state
  const [isIdeasOpen, setIsIdeasOpen] = useState(false);

  // Memory panel state
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);

  // Agents panel state
  const [isAgentsOpen, setIsAgentsOpen] = useState(false);

  // Create bead dialog state
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Project settings dialog state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Show GitHub warning if project loaded, status checked, and either no remote or not authenticated
  const showGitHubWarning = !projectLoading &&
    !githubStatusLoading &&
    project !== null &&
    !githubWarningDismissed &&
    (!hasRemote || !isAuthenticated);

  /**
   * Toggle a status in the filter
   */
  const toggleStatus = useCallback((status: string) => {
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

  // Filter out done beads to avoid unnecessary polling for finalized tasks
  const beadIds = useMemo(
    () => beads.filter(b => !isDoneStatus(b.status, statuses)).map(b => b.id),
    [beads, statuses]
  );

  // Worktree statuses for PR workflow (skip for dolt-only projects)
  const { statuses: worktreeStatuses } = useWorktreeStatuses(
    isDoltOnly ? "" : fsPath,
    isDoltOnly ? [] : beadIds
  );

  /**
   * Filter to only top-level beads (no parent_id), then apply the issue type
   * filter. Stories stay off the board unless Story is picked: they live in
   * the Ideas panel. Child tasks appear inside epic cards, not in columns.
   */
  const topLevelBeads = useMemo(
    () => filterBoardTypes(filteredBeads.filter(b => !b.parent_id), typeFilter),
    [filteredBeads, typeFilter]
  );

  // Open ideas for the counter on the Ideas button
  const ideasCount = useMemo(() => splitIdeas(beads, statuses, new Date()).active.length, [beads, statuses]);

  /**
   * Split top-level beads into a column per status of the project; pinned
   * beads sit at the top of open, empty minor columns collapse.
   */
  const columns = useMemo(() => buildBoardColumns(topLevelBeads, statuses), [topLevelBeads, statuses]);

  /**
   * Beads whose status is not in the project's list, for the warning indicator.
   */
  const unknownStatusBeads = useMemo(() => getUnknownStatusBeads(beads, statuses), [beads, statuses]);
  const unknownStatusNames = useMemo(() => getUnknownStatusNames(beads, statuses), [beads, statuses]);

  // Detail panel state
  const {
    detailBead,
    isDetailOpen,
    canGoBack,
    openBead,
    pushBead,
    goBack,
    handleDetailOpenChange,
    navigateToBead,
  } = useBeadDetail(beads);

  // Ref for search input (keyboard navigation)
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard navigation (use top-level beads for navigation)
  const { selectedId } = useKeyboardNavigation({
    beads: topLevelBeads,
    columns,
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
      {/* Header — terminal variant for neo-brutalist, standard otherwise */}
      {theme.headerVariant === 'terminal' ? (
        <div className="flex items-center justify-between gap-4 px-6 py-4 terminal-header">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="min-w-0 font-mono text-xl font-bold tracking-wide truncate">
              <a href="/" className="hover:opacity-80">&gt;</a>{' '}
              <span className="uppercase">{project.name}_</span>
            </h1>
            <JournalSwitch
              projectPath={project.path}
              source={beadsSource}
              onChanged={refreshAfterJournalSwitch}
              className="font-mono uppercase"
            />
          </div>
          <span className="shrink-0 font-mono text-xs text-t-muted uppercase tracking-widest">
            {beads.length} beads // {beads.filter(b => b.issue_type === 'epic').length} epics // {beads.filter(b => isBlocked(b, beads, statuses)).length} blocked
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-4 py-2">
          <Button variant="ghost" size="icon" className="shrink-0" asChild>
            <a href="/">
              <ArrowLeft className="h-4 w-4" />
              <span className="sr-only">Back to projects</span>
            </a>
          </Button>
          <h1 className="min-w-0 text-lg font-semibold truncate">{project.name}</h1>
          <JournalSwitch
            projectPath={project.path}
            source={beadsSource}
            onChanged={refreshAfterJournalSwitch}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Project settings"
            onClick={() => setIsSettingsOpen(true)}
          >
            <EllipsisVertical className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

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
          statusOptions={statuses}
          statuses={filters.statuses}
          onStatusToggle={toggleStatus}
          owners={filters.owners}
          onOwnerToggle={toggleOwner}
          availableOwners={availableOwners}
          onClearFilters={clearFilters}
          hasActiveFilters={hasActiveFilters}
          // Ideas
          isIdeasOpen={isIdeasOpen}
          onIdeasToggle={() => setIsIdeasOpen((prev) => !prev)}
          ideasCount={ideasCount}
          // Memory
          isMemoryOpen={isMemoryOpen}
          onMemoryToggle={() => setIsMemoryOpen((prev) => !prev)}
          // Agents
          isAgentsOpen={isAgentsOpen}
          onAgentsToggle={() => setIsAgentsOpen((prev) => !prev)}
          // Filesystem features require a real project path
          hasProjectPath={!isDoltOnly}
          // Unknown status warning
          unknownStatusCount={unknownStatusBeads.length}
          unknownStatusNames={unknownStatusNames}
          onNewBead={() => setIsCreateOpen(true)}
          readOnly={readOnly}
        />
      </div>

      {stale && (
        <div className="px-4 pb-3">
          <StaleDataBanner stale={stale} />
        </div>
      )}

      {/* Kanban Columns.
          The boundary sits inside <main> on purpose: a render error in the
          columns must not take down the header and the filter bar, which are
          the user's way back to the project list. */}
      <main className="flex-1 overflow-hidden p-4">
        <ErrorBoundary label="Kanban Board">
        {beadsLoading || statusesLoading ? (
          <div className="flex items-center justify-center h-full">
            <div role="status" className="text-t-muted">Loading beads…</div>
          </div>
        ) : beadsError ? (
          <div className="flex items-center justify-center h-full">
            <div role="alert" className="text-danger">Error loading beads: {beadsError.message}</div>
          </div>
        ) : (
          <div className="flex h-full overflow-x-auto" style={{ gap: 'var(--column-gap)' }}>
            {columns.map(({ status, title, category, collapsed, beads: columnBeads }) => (
              <KanbanColumn
                key={status}
                status={status}
                title={title}
                category={category}
                collapsed={collapsed}
                beads={columnBeads}
                allBeads={beads}
                selectedBeadId={selectedId}
                ticketNumbers={ticketNumbers}
                onSelectBead={openBead}
                onChildClick={openBead}
                onNavigateToDependency={navigateToBead}
                projectPath={project?.path}
                onUpdate={refreshBeads}
                readOnly={readOnly}
                statuses={statuses}
              />
            ))}
          </div>
        )}
        </ErrorBoundary>
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
          onChildClick={pushBead}
          onBack={goBack}
          canGoBack={canGoBack}
          onUpdate={refreshBeads}
          readOnly={readOnly}
          statuses={statuses}
        >
          <CommentList
            comments={detailBead.comments}
            beadId={detailBead.id}
            projectPath={project?.path ?? ""}
            onCommentAdded={() => refreshBeads({ full: true })}
            readOnly={readOnly}
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

      {/* Ideas Panel (works for dolt-only projects too, except Dismiss) */}
      <ErrorBoundary label="Ideas Panel">
        <IdeasPanel
          open={isIdeasOpen}
          onOpenChange={setIsIdeasOpen}
          beads={beads}
          statuses={statuses}
          projectPath={project.path}
          fsPath={fsPath}
          isDoltOnly={isDoltOnly}
          readOnly={readOnly}
          onOpenBead={openBead}
          onChanged={refreshBeads}
        />
      </ErrorBoundary>

      {/* Memory Panel (requires filesystem path) */}
      <ErrorBoundary label="Memory Panel">
      {fsPath && !isDoltOnly && (
        <MemoryPanel
          open={isMemoryOpen}
          onOpenChange={setIsMemoryOpen}
          projectPath={fsPath}
          readOnly={readOnly}
        />
      )}
      </ErrorBoundary>

      {/* Agents Panel (requires filesystem path) */}
      <ErrorBoundary label="Agents Panel">
      {fsPath && !isDoltOnly && (
        <AgentsPanel
          open={isAgentsOpen}
          onOpenChange={setIsAgentsOpen}
          projectPath={fsPath}
        />
      )}
      </ErrorBoundary>

      {/* Project Settings Dialog */}
      {project && (
        <ProjectSettingsDialog
          open={isSettingsOpen}
          onOpenChange={setIsSettingsOpen}
          projectId={project.id}
          projectName={project.name}
          projectPath={project.path}
          projectLocalPath={project.localPath}
          onUpdated={refetchProject}
        />
      )}

      {/* Create Bead Dialog */}
      {project?.path && (
        <CreateBeadDialog
          open={isCreateOpen}
          onOpenChange={setIsCreateOpen}
          projectPath={project.path}
          onCreated={refreshBeads}
        />
      )}

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
