"use client";

import { useState, useEffect, useCallback, useRef } from "react";

import * as api from "@/lib/api";
import { loadProjectBeads, groupBeadsByStatus } from "@/lib/beads-parser";
import {
  getProjectsWithTags,
  createProject,
  type CreateProjectInput,
} from "@/lib/db";
import type { Project, Tag, BeadCounts } from "@/types";

interface UseProjectsResult {
  projects: Project[];
  isLoading: boolean;
  loadingStatus: string | null;
  error: Error | null;
  showArchived: boolean;
  refetch: () => Promise<void>;
  addProject: (input: CreateProjectInput) => Promise<Project>;
  updateProjectTags: (projectId: string, tags: Tag[]) => void;
  archiveProject: (id: string) => Promise<void>;
  unarchiveProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  toggleShowArchived: () => void;
}

export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const loadingRef = useRef(0);
  const beadsAbortRef = useRef<AbortController | null>(null);
  const showArchivedRef = useRef(false);

  // Keep ref in sync with state
  useEffect(() => { showArchivedRef.current = showArchived; }, [showArchived]);

  const fetchProjects = useCallback(async () => {
    const loadId = ++loadingRef.current;

    // Abort any previous beads loading cycle FIRST to free browser connections
    if (beadsAbortRef.current) {
      beadsAbortRef.current.abort();
      beadsAbortRef.current = null;
    }

    try {
      setError(null);

      const data = await getProjectsWithTags(showArchivedRef.current);
      if (loadId !== loadingRef.current) return;

      // Show projects immediately. Seed bead counts from (in priority order):
      //   1. The previous in-memory project (covers live refreshes).
      //   2. The server-provided `cachedCounts` from the SQLite cache
      //      (covers cold loads — instant donut paint).
      //   3. `zeroCounts` as a last-resort empty state. In that case
      //      `countsLoaded` stays false so the card can render a dashed
      //      placeholder donut instead of misleading "0/0/0/0" values.
      const zeroCounts: BeadCounts = { open: 0, in_progress: 0, inreview: 0, closed: 0 };
      setProjects((prev) => {
        const prevMap = new Map(prev.map((p) => [p.id, p]));
        return data.map((p) => {
          const prevProject = prevMap.get(p.id);
          const cached = p.cachedCounts ?? null;

          // Prefer previous in-memory counts (freshest), then server cache.
          const hasPrev = prevProject?.beadCounts !== undefined && prevProject.countsLoaded === true;
          const beadCounts: BeadCounts = hasPrev
            ? prevProject!.beadCounts!
            : cached
              ? {
                  open: cached.open,
                  in_progress: cached.in_progress,
                  inreview: cached.inreview,
                  closed: cached.closed,
                }
              : zeroCounts;

          const dataSource = hasPrev
            ? prevProject!.dataSource
            : cached?.dataSource ?? undefined;

          const countsLoaded = hasPrev || cached !== null;

          return {
            ...p,
            beadCounts,
            dataSource: dataSource ?? undefined,
            countsLoaded,
          };
        });
      });
      setIsLoading(false);

      beadsAbortRef.current = new AbortController();
      const beadsSignal = beadsAbortRef.current.signal;

      // Skip beads loading for archived projects
      const activeData = data.filter(p => !p.archivedAt);

      // Then load beads per-project, updating each as it completes
      let loaded = 0;
      const total = activeData.length;

      const loadBeads = async (project: Project) => {
        try {
          if (beadsSignal.aborted) return null;
          const result = await loadProjectBeads(project.path, { withSource: true });
          if (beadsSignal.aborted) return null;
          const grouped = groupBeadsByStatus(result.beads);
          const beadCounts: BeadCounts = {
            open: grouped.open.length,
            in_progress: grouped.in_progress.length,
            inreview: grouped.inreview.length,
            closed: grouped.closed.length,
          };
          return { id: project.id, beadCounts, dataSource: result.source, beadError: undefined };
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return null;
          const message = err instanceof Error ? err.message : 'Unknown error';
          return { id: project.id, beadCounts: zeroCounts, dataSource: undefined, beadError: message };
        }
      };

      // Limit concurrent beads requests to avoid overloading Dolt servers
      const MAX_CONCURRENT = 3;
      let running = 0;
      const queue = [...activeData];

      await new Promise<void>((resolve) => {
        const next = () => {
          while (running < MAX_CONCURRENT && queue.length > 0) {
            const project = queue.shift()!;
            running++;
            loadBeads(project).then((result) => {
              running--;
              if (result && loadId === loadingRef.current) {
                loaded++;
                setLoadingStatus(
                  loaded < total
                    ? `Loading beads: ${project.name} (${loaded}/${total})`
                    : null
                );
                setProjects((prev) =>
                  prev.map((p) =>
                    p.id === result.id
                      ? {
                          ...p,
                          beadCounts: result.beadCounts,
                          dataSource: result.dataSource,
                          beadError: result.beadError,
                          // Fresh data has landed — donut should switch from
                          // dashed (if it was dashed) to solid.
                          countsLoaded: true,
                        }
                      : p
                  )
                );
              }
              if (queue.length === 0 && running === 0) {
                resolve();
              } else {
                next();
              }
            });
          }
          // Handle edge case: empty queue from the start
          if (queue.length === 0 && running === 0) {
            resolve();
          }
        };
        next();
      });
    } catch (err) {
      if (loadId !== loadingRef.current) return;
      setError(err instanceof Error ? err : new Error("Failed to fetch projects"));
      setIsLoading(false);
      setLoadingStatus(null);
    }
  }, []);

  const addProject = useCallback(
    async (input: CreateProjectInput): Promise<Project> => {
      const newProject = await createProject(input);
      await fetchProjects();
      return newProject;
    },
    [fetchProjects]
  );

  const updateProjectTags = useCallback((projectId: string, tags: Tag[]) => {
    setProjects((prev) =>
      prev.map((project) =>
        project.id === projectId ? { ...project, tags } : project
      )
    );
  }, []);

  const archiveProject = useCallback(async (id: string) => {
    await api.projects.archive(id);
    await fetchProjects();
  }, [fetchProjects]);

  const unarchiveProject = useCallback(async (id: string) => {
    await api.projects.unarchive(id);
    await fetchProjects();
  }, [fetchProjects]);

  const deleteProject = useCallback(async (id: string) => {
    await api.projects.delete(id);
    await fetchProjects();
  }, [fetchProjects]);

  const toggleShowArchived = useCallback(() => {
    setShowArchived(prev => !prev);
  }, []);

  // Fetch projects on mount and when showArchived changes
  useEffect(() => {
    fetchProjects();
    return () => {
      beadsAbortRef.current?.abort();
    };
  }, [fetchProjects, showArchived]);

  return {
    projects,
    isLoading,
    loadingStatus,
    error,
    showArchived,
    refetch: fetchProjects,
    addProject,
    updateProjectTags,
    archiveProject,
    unarchiveProject,
    deleteProject,
    toggleShowArchived,
  };
}
