"use client";

/**
 * Hook for loading and managing beads with real-time file watching.
 *
 * Combines the beads parser with file watcher to provide automatic
 * updates when the issues.jsonl file changes.
 */

import { useState, useEffect, useCallback, useRef } from "react";

import { useFileWatcher } from "@/hooks/use-file-watcher";
import {
  loadProjectBeads,
  groupBeadsByStatus,
  assignTicketNumbers,
} from "@/lib/beads-parser";
import { isDoltProject } from "@/lib/utils";
import type { Bead, BeadStatus } from "@/types";

export interface RefreshBeadsOptions {
  /**
   * Ignore the incremental cursor, replace state with a complete response and
   * ask the server to re-read the project from scratch (`full=1`).
   */
  full?: boolean;
}

interface LoadBeadsOptions {
  /** Ignore the incremental cursor and replace state with a complete response. */
  full?: boolean;
  /**
   * Also make the server re-read the project from scratch. Expensive for
   * journal-backed projects, so only an explicit manual refresh asks for it.
   */
  reread?: boolean;
}

/** Poll period for projects whose server keeps up through the bd events journal. */
const JOURNAL_POLL_MS = 5_000;
/** Poll period for the other database-backed sources. */
const DEFAULT_POLL_MS = 15_000;

/**
 * Result type for the useBeads hook
 */
export interface UseBeadsResult {
  /** Array of all beads from the project */
  beads: Bead[];
  /** Beads grouped by status for kanban columns */
  beadsByStatus: Record<BeadStatus, Bead[]>;
  /** Map of bead ID to sequential ticket number (1-indexed by creation order) */
  ticketNumbers: Map<string, number>;
  /** Whether beads are currently being loaded */
  isLoading: boolean;
  /** Any error that occurred during loading */
  error: Error | null;
  /** Manually refresh beads, optionally bypassing incremental loading. */
  refresh: (options?: RefreshBeadsOptions) => Promise<void>;
}

/**
 * Empty grouped beads object for initial state
 */
const EMPTY_GROUPED: Record<BeadStatus, Bead[]> = {
  open: [],
  in_progress: [],
  inreview: [],
  closed: [],
};

/**
 * Hook to load and watch beads from a project directory.
 *
 * Automatically refreshes when the issues.jsonl file changes.
 *
 * @param projectPath - The absolute path to the project root
 * @returns Object containing beads, grouped beads, loading state, error, and refresh function
 *
 * @example
 * ```tsx
 * function KanbanBoard({ projectPath }: { projectPath: string }) {
 *   const { beadsByStatus, isLoading, error, refresh } = useBeads(projectPath);
 *
 *   if (isLoading) return <Loading />;
 *   if (error) return <Error message={error.message} />;
 *
 *   return (
 *     <div>
 *       <Column title="Open" beads={beadsByStatus.open} />
 *       <Column title="In Progress" beads={beadsByStatus.in_progress} />
 *       <Column title="In Review" beads={beadsByStatus.inreview} />
 *       <Column title="Closed" beads={beadsByStatus.closed} />
 *     </div>
 *   );
 * }
 * ```
 */
export function useBeads(projectPath: string): UseBeadsResult {
  const [beads, setBeads] = useState<Bead[]>([]);
  const [beadsByStatus, setBeadsByStatus] =
    useState<Record<BeadStatus, Bead[]>>(EMPTY_GROUPED);
  const [ticketNumbers, setTicketNumbers] = useState<Map<string, number>>(
    new Map()
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [dataSource, setDataSource] = useState<string | null>(null);

  // Track if initial load has completed
  const hasLoadedRef = useRef(false);
  const isLoadingRef = useRef(false);
  // Track latest updated_at for incremental polling
  const lastUpdatedRef = useRef<string | null>(null);
  // Total comment count reported by the server; null when it reports none.
  const commentTotalRef = useRef<number | null>(null);
  // Whether the last response was the whole list (journal-backed source).
  const completeRef = useRef(false);

  /**
   * Load beads from the project directory
   */
  const loadBeads = useCallback(async (options?: LoadBeadsOptions) => {
    if (!projectPath) {
      setBeads([]);
      setBeadsByStatus(EMPTY_GROUPED);
      setTicketNumbers(new Map());
      setDataSource(null);
      setIsLoading(false);
      return;
    }

    // Skip if a request is already in flight (prevents polling overlap)
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;

    // Only show loading on initial load, not on refreshes
    if (!hasLoadedRef.current) {
      setIsLoading(true);
    }

    try {
      // Incremental fetch: pass updatedAfter on subsequent loads
      const updatedAfter =
        !options?.full && hasLoadedRef.current
          ? lastUpdatedRef.current ?? undefined
          : undefined;
      const result = await loadProjectBeads(projectPath, {
        withSource: true,
        updatedAfter,
        full: options?.reread,
      });
      const fetchedBeads = result.beads;
      setDataSource(result.source ?? null);
      commentTotalRef.current =
        typeof result.commentTotal === "number" ? result.commentTotal : null;
      completeRef.current = result.complete === true;

      // Compute max updated_at from fetched results
      const maxUpdated = fetchedBeads.reduce((max, b) => {
        const t = b.updated_at || b.created_at || '';
        return t > max ? t : max;
      }, '');
      if (maxUpdated) lastUpdatedRef.current = maxUpdated;

      let loadedBeads: Bead[];
      // A complete response is the whole list even when updatedAfter was sent;
      // merging it would keep beads that were deleted.
      if (!options?.full && hasLoadedRef.current && updatedAfter && !result.complete) {
        // Incremental update — merge changed beads into existing state
        setBeads(prev => {
          const beadMap = new Map(prev.map(b => [b.id, b]));
          for (const updated of fetchedBeads) {
            beadMap.set(updated.id, updated);
          }
          loadedBeads = Array.from(beadMap.values());
          const grouped = groupBeadsByStatus(loadedBeads);
          const tickets = assignTicketNumbers(loadedBeads);
          setBeadsByStatus(grouped);
          setTicketNumbers(tickets);
          return loadedBeads;
        });
      } else {
        // Full load — replace everything
        loadedBeads = fetchedBeads;
        const grouped = groupBeadsByStatus(loadedBeads);
        const tickets = assignTicketNumbers(loadedBeads);
        setBeads(loadedBeads);
        setBeadsByStatus(grouped);
        setTicketNumbers(tickets);
      }

      setError(null);
      hasLoadedRef.current = true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (hasLoadedRef.current) {
        console.warn("Beads refresh failed (non-fatal):", error.message);
      } else {
        setError(error);
        console.error("Failed to load beads:", error);
      }
    } finally {
      isLoadingRef.current = false;
      setIsLoading(false);
    }
  }, [projectPath]);

  /**
   * Public refresh function for manual reload
   */
  const refresh = useCallback(async (options?: RefreshBeadsOptions) => {
    await loadBeads({ full: options?.full, reread: options?.full });
  }, [loadBeads]);

  // Initial load when project path changes
  useEffect(() => {
    hasLoadedRef.current = false;
    lastUpdatedRef.current = null;
    commentTotalRef.current = null;
    completeRef.current = false;
    setDataSource(null);
    void loadBeads({ full: true });
  }, [loadBeads]);

  const handleWatchedChange = useCallback(() => {
    // JSONL comment changes do not advance issue.updated_at, so watcher
    // notifications must bypass the incremental cursor.
    void loadBeads({ full: true });
  }, [loadBeads]);

  // Set up file watcher for real-time updates
  // Note: useFileWatcher expects the project root path, not the full issues.jsonl path,
  // because the backend watch API appends .beads/issues.jsonl to the provided path
  const { error: watchError } = useFileWatcher(
    projectPath,
    handleWatchedChange,
    100 // 100ms debounce as per spec
  );

  // Combine any watch error with load error
  useEffect(() => {
    if (watchError && !error) {
      // Only log watch errors, don't surface them as main error
      // since the app can still function without file watching
      console.warn("File watcher error:", watchError);
    }
  }, [watchError, error]);

  /**
   * One polling round: an incremental read first, and the expensive full read
   * only when it is really needed. A comment added to an untouched bead does
   * not advance issue.updated_at, so the incremental read would miss it — the
   * server's project-wide comment total gives that away. When the server does
   * not report a total at all, fall back to a full read so no comment is lost.
   * A complete response (journal-backed source) already holds every comment,
   * so it never needs the second read.
   */
  const pollBeads = useCallback(async () => {
    const previousTotal = commentTotalRef.current;
    await loadBeads();
    if (completeRef.current) return;
    const currentTotal = commentTotalRef.current;
    if (currentTotal === null || currentTotal !== previousTotal) {
      await loadBeads({ full: true });
    }
  }, [loadBeads]);

  // Poll database-backed sources. Filesystem projects using embedded Dolt may
  // have JSONL export disabled, so their file watcher has nothing to observe.
  useEffect(() => {
    const shouldPoll =
      isDoltProject(projectPath) ||
      (dataSource !== null && dataSource !== "jsonl");
    if (!projectPath || !shouldPoll) return;

    // The journal-backed server answers from memory after a short catch-up,
    // so it can be asked more often.
    const period = dataSource === "cli-journal" ? JOURNAL_POLL_MS : DEFAULT_POLL_MS;
    const intervalId = setInterval(() => {
      void pollBeads();
    }, period);

    return () => clearInterval(intervalId);
  }, [projectPath, dataSource, pollBeads]);

  return {
    beads,
    beadsByStatus,
    ticketNumbers,
    isLoading,
    error,
    refresh,
  };
}
