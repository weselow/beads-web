"use client";

import { useMemo, useRef, useState, useCallback, useEffect, type ReactNode } from "react";

import { useSearchParams, useRouter } from "next/navigation";

import { ActivityTimeline } from "@/components/activity-timeline";
import { AgentsPanel } from "@/components/agents-panel";
import { BeadDetail } from "@/components/bead-detail";
import { BoardView } from "@/components/board-view";
import { CommentList } from "@/components/comment-list";
import { CreateBeadDialog } from "@/components/create-bead-dialog";
import { ErrorBoundary } from "@/components/error-boundary";
import { GitHubWarningDialog } from "@/components/github-warning-dialog";
import { IdeasPanel } from "@/components/ideas-panel";
import { MemoryPanel } from "@/components/memory-panel";
import { ProjectHeader } from "@/components/project-header";
import { ProjectSettingsDialog } from "@/components/project-settings-dialog";
import { QuickFilterBar } from "@/components/quick-filter-bar";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { TreeView } from "@/components/tree-view";
import { Button } from "@/components/ui/button";
import { useBeadDetail } from "@/hooks/use-bead-detail";
import { useBeadFilters } from "@/hooks/use-bead-filters";
import { useBeads } from "@/hooks/use-beads";
import { useGitHubStatus } from "@/hooks/use-github-status";
import { useProject } from "@/hooks/use-project";
import { useProjectView } from "@/hooks/use-project-view";
import { useStatuses } from "@/hooks/use-statuses";
import { useTheme } from "@/hooks/use-theme";
import { useWorktreeStatuses } from "@/hooks/use-worktree-statuses";
import { compareBeads } from "@/lib/bead-sort";
import { getUnknownStatusBeads, getUnknownStatusNames } from "@/lib/beads-parser";
import { filterBoardTypes, splitIdeas } from "@/lib/ideas";
import type { IssueTypeFilter } from "@/lib/issue-types";
import { isDoneStatus } from "@/lib/statuses";
import { isDoltProject } from "@/lib/utils";
import type { Bead } from "@/types";

interface PageMessageProps {
  children: ReactNode;
  /** "status" while loading, "alert" for an error */
  role?: "status" | "alert";
  /** Adds a way back to the project list */
  backLink?: boolean;
}

/** A whole-page message in place of the project: redirect, loading, error */
function PageMessage({ children, role, backLink = false }: PageMessageProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-dvh bg-surface-base gap-4">
      <div role={role} className={role === "alert" ? "text-danger" : "text-t-muted"}>{children}</div>
      {backLink && (
        <Button variant="outline" asChild>
          <a href="/">Back to projects</a>
        </Button>
      )}
    </div>
  );
}

/**
 * Project page: header, filter bar, then the beads as a Kanban board or as a
 * tree (?view=tree). The card, the side panels and the dialogs serve both.
 */
export default function KanbanBoard() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const projectId = searchParams.get('id');
  const [view, setView] = useProjectView();

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

  // Open ideas for the counter on the Ideas button
  const ideasCount = useMemo(() => splitIdeas(beads, statuses, new Date()).active.length, [beads, statuses]);

  // The tree marks the beads that pass the filter bar. Unlike the board it
  // keeps children of epics as rows of their own, so no selectBoardBeads here.
  // Both values stay stable between renders: the tree rebuilds when they change.
  const treeMatchedIds = useMemo(
    () => new Set(filterBoardTypes(filteredBeads, typeFilter).map((b) => b.id)),
    [filteredBeads, typeFilter]
  );
  const treeCompare = useMemo(
    () => compareBeads(filters.sortField, filters.sortDirection, ticketNumbers),
    [filters.sortField, filters.sortDirection, ticketNumbers]
  );

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

  const closeDetail = useCallback(() => handleDetailOpenChange(false), [handleDetailOpenChange]);

  // An idea opens in the same card as a board bead. The Ideas panel closes
  // first: it is modal and sits on the same layer, so it would cover the card
  // and block clicks on it.
  const openIdea = useCallback((bead: Bead) => {
    setIsIdeasOpen(false);
    openBead(bead);
  }, [openBead]);

  // Ref for search input (keyboard navigation)
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Redirect if no project ID
  useEffect(() => {
    if (!projectId) {
      router.replace("/");
    }
  }, [projectId, router]);


  if (!projectId) return <PageMessage>Redirecting…</PageMessage>;
  if (projectLoading) return <PageMessage role="status">Loading project…</PageMessage>;
  if (projectError) {
    return <PageMessage role="alert" backLink>Error: {projectError.message}</PageMessage>;
  }
  if (!project) return <PageMessage backLink>Project not found</PageMessage>;

  return (
    <div className="min-h-dvh bg-surface-base flex flex-col">
      <ProjectHeader
        variant={theme.headerVariant}
        projectName={project.name}
        projectPath={project.path}
        beadsSource={beadsSource}
        onJournalChanged={refreshAfterJournalSwitch}
        onOpenSettings={() => setIsSettingsOpen(true)}
        beads={beads}
        statuses={statuses}
      />

      {/* Quick Filter Bar */}
      <div className="flex justify-center px-4 pb-3">
        <QuickFilterBar
          // Board or tree
          view={view}
          onViewChange={setView}
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

      {/* Board or tree.
          The boundary sits inside <main> on purpose: a render error in the
          beads must not take down the header and the filter bar, which are
          the user's way back to the project list. It is keyed by the view,
          so switching views clears an error of the other one. */}
      <main className="flex-1 overflow-hidden p-4">
        <ErrorBoundary key={view} label={view === "tree" ? "Tree view" : "Kanban Board"}>
        {beadsLoading || statusesLoading ? (
          <div className="flex items-center justify-center h-full">
            <div role="status" className="text-t-muted">Loading beads…</div>
          </div>
        ) : beadsError ? (
          <div className="flex items-center justify-center h-full">
            <div role="alert" className="text-danger">Error loading beads: {beadsError.message}</div>
          </div>
        ) : view === "tree" ? (
          <div className="flex h-full flex-col overflow-hidden theme-column border border-b-default/50 bg-surface-raised/30">
            <TreeView
              projectId={project.id}
              beads={beads}
              matchedIds={treeMatchedIds}
              statuses={statuses}
              ticketNumbers={ticketNumbers}
              compare={treeCompare}
              onOpenBead={openBead}
            />
          </div>
        ) : (
          <BoardView
            beads={beads}
            filteredBeads={filteredBeads}
            typeFilter={typeFilter}
            statuses={statuses}
            ticketNumbers={ticketNumbers}
            projectPath={project.path}
            readOnly={readOnly}
            onUpdate={refreshBeads}
            onOpenBead={openBead}
            onNavigateToBead={navigateToBead}
            isDetailOpen={isDetailOpen}
            onCloseDetail={closeDetail}
            searchInputRef={searchInputRef}
          />
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

      {/* Ideas Panel (works for dolt-only projects too) */}
      <ErrorBoundary label="Ideas Panel">
        <IdeasPanel
          open={isIdeasOpen}
          onOpenChange={setIsIdeasOpen}
          beads={beads}
          statuses={statuses}
          projectPath={project.path}
          readOnly={readOnly}
          onOpenBead={openIdea}
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

      <GitHubWarningDialog
        open={showGitHubWarning}
        hasRemote={hasRemote}
        onDismiss={() => setGithubWarningDismissed(true)}
      />
    </div>
  );
}
