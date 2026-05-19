"use client";

/**
 * Hook for loading and managing memory entries (bd memories).
 *
 * Fetches from GET /api/memory and provides search, create, edit, and delete.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";

import * as api from "@/lib/api";
import type { MemoryEntry } from "@/types";

export interface UseMemoryResult {
  /** All memory entries from the project */
  entries: MemoryEntry[];
  /** Whether entries are currently being loaded */
  isLoading: boolean;
  /** Any error that occurred during loading */
  error: Error | null;
  /** Current search query */
  search: string;
  /** Set search query */
  setSearch: (value: string) => void;
  /** Entries filtered by search substring on key+content */
  filteredEntries: MemoryEntry[];
  /** Create a new entry; omit key to auto-generate */
  createEntry: (content: string, key?: string) => Promise<void>;
  /** Edit an entry's content */
  editEntry: (key: string, content: string) => Promise<void>;
  /** Permanently delete an entry */
  deleteEntry: (key: string) => Promise<void>;
  /** Manually refresh entries */
  refresh: () => Promise<void>;
}

/**
 * Hook to load and manage memory entries from a project's bd knowledge base.
 *
 * @param projectPath - The absolute path to the project root
 */
export function useMemory(projectPath: string): UseMemoryResult {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [search, setSearch] = useState("");

  const hasLoadedRef = useRef(false);

  const loadMemory = useCallback(async () => {
    if (!projectPath) {
      setEntries([]);
      setIsLoading(false);
      return;
    }

    if (!hasLoadedRef.current) {
      setIsLoading(true);
    }

    try {
      const data = await api.memory.list(projectPath);
      setEntries(data);
      setError(null);
      hasLoadedRef.current = true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      console.error("Failed to load memory:", error);
    } finally {
      setIsLoading(false);
    }
  }, [projectPath]);

  const refresh = useCallback(async () => {
    await loadMemory();
  }, [loadMemory]);

  useEffect(() => {
    hasLoadedRef.current = false;
    loadMemory();
  }, [loadMemory]);

  const filteredEntries = useMemo(() => {
    if (!search.trim()) return entries;
    const s = search.toLowerCase();
    return entries.filter(
      (e) =>
        e.key.toLowerCase().includes(s) || e.content.toLowerCase().includes(s)
    );
  }, [entries, search]);

  const createEntry = useCallback(
    async (content: string, key?: string) => {
      if (!projectPath) return;
      try {
        await api.memory.update(projectPath, key ?? "", content);
        await loadMemory();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error("Failed to create memory entry:", error);
        throw error;
      }
    },
    [projectPath, loadMemory]
  );

  const editEntry = useCallback(
    async (key: string, content: string) => {
      if (!projectPath) return;
      try {
        await api.memory.update(projectPath, key, content);
        await loadMemory();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error("Failed to edit memory entry:", error);
        throw error;
      }
    },
    [projectPath, loadMemory]
  );

  const deleteEntry = useCallback(
    async (key: string) => {
      if (!projectPath) return;
      try {
        await api.memory.remove(projectPath, key);
        await loadMemory();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error("Failed to delete memory entry:", error);
        throw error;
      }
    },
    [projectPath, loadMemory]
  );

  return {
    entries,
    isLoading,
    error,
    search,
    setSearch,
    filteredEntries,
    createEntry,
    editEntry,
    deleteEntry,
    refresh,
  };
}
