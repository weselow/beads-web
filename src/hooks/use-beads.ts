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
  /** Manually refresh beads from the file */
  refresh: () => Promise<void>;
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

  // Track if initial load has completed
  const hasLoadedRef = useRef(false);
  const isLoadingRef = useRef(false);
  // Track latest updated_at for incremental polling
  const lastUpdatedRef = useRef<string | null>(null);

  /**
   * Load beads from the project directory
   */
  const loadBeads = useCallback(async () => {
    if (!projectPath) {
      setBeads([]);
      setBeadsByStatus(EMPTY_GROUPED);
      setTicketNumbers(new Map());
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
      const updatedAfter = hasLoadedRef.current ? lastUpdatedRef.current ?? undefined : undefined;
      const fetchedBeads = await loadProjectBeads(projectPath, { updatedAfter });

      // Compute max updated_at from fetched results
      const maxUpdated = fetchedBeads.reduce((max, b) => {
        const t = b.updated_at || b.created_at || '';
        return t > max ? t : max;
      }, '');
      if (maxUpdated) lastUpdatedRef.current = maxUpdated;

      let loadedBeads: Bead[];
      if (hasLoadedRef.current && updatedAfter) {
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
  const refresh = useCallback(async () => {
    await loadBeads();
  }, [loadBeads]);

  // Initial load when project path changes
  useEffect(() => {
    hasLoadedRef.current = false;
    lastUpdatedRef.current = null;
    loadBeads();
  }, [loadBeads]);

  // Set up file watcher for real-time updates
  // Note: useFileWatcher expects the project root path, not the full issues.jsonl path,
  // because the backend watch API appends .beads/issues.jsonl to the provided path
  const { error: watchError } = useFileWatcher(
    projectPath,
    loadBeads,
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

  // Polling for dolt:// projects (no file watcher available)
  useEffect(() => {
    if (!projectPath || !isDoltProject(projectPath)) return;

    const intervalId = setInterval(() => {
      loadBeads();
    }, 3_000);

    return () => clearInterval(intervalId);
  }, [projectPath, loadBeads]);

  return {
    beads,
    beadsByStatus,
    ticketNumbers,
    isLoading,
    error,
    refresh,
  };
}
