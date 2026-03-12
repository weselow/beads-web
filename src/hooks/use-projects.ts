"use client";

import { useState, useEffect, useCallback, useRef } from "react";

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
  refetch: () => Promise<void>;
  addProject: (input: CreateProjectInput) => Promise<Project>;
  updateProjectTags: (projectId: string, tags: Tag[]) => void;
}

export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const loadingRef = useRef(0);
  const beadsAbortRef = useRef<AbortController | null>(null);

  const fetchProjects = useCallback(async () => {
    const loadId = ++loadingRef.current;

    // Abort any previous beads loading cycle FIRST to free browser connections
    if (beadsAbortRef.current) {
      beadsAbortRef.current.abort();
      beadsAbortRef.current = null;
    }

    try {
      setError(null);

      const data = await getProjectsWithTags();
      if (loadId !== loadingRef.current) return;

      // Show projects immediately, preserving existing bead counts from previous load
      const zeroCounts: BeadCounts = { open: 0, in_progress: 0, inreview: 0, closed: 0 };
      setProjects((prev) => {
        const prevMap = new Map(prev.map((p) => [p.id, p]));
        return data.map((p) => ({
          ...p,
          beadCounts: prevMap.get(p.id)?.beadCounts ?? zeroCounts,
          dataSource: prevMap.get(p.id)?.dataSource,
        }));
      });
      setIsLoading(false);

      beadsAbortRef.current = new AbortController();
      const beadsSignal = beadsAbortRef.current.signal;

      // Then load beads per-project, updating each as it completes
      let loaded = 0;
      const total = data.length;

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
      let queue = [...data];

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
                      ? { ...p, beadCounts: result.beadCounts, dataSource: result.dataSource, beadError: result.beadError }
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

  // Fetch projects on mount
  useEffect(() => {
    fetchProjects();
    return () => {
      beadsAbortRef.current?.abort();
    };
  }, [fetchProjects]);

  return {
    projects,
    isLoading,
    loadingStatus,
    error,
    refetch: fetchProjects,
    addProject,
    updateProjectTags,
  };
}
