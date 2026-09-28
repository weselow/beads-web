"use client";

/**
 * Hook for a project's status list: bd's built-in statuses plus the
 * project's own from `status.custom`, read from `GET /api/statuses`.
 */

import { useEffect, useState } from "react";

import * as api from "@/lib/api";
import { BUILTIN_STATUSES } from "@/lib/statuses";
import type { StatusInfo } from "@/types";

export interface UseStatusesResult {
  /** The project's statuses; bd's built-in ones until the list arrives or if it fails. */
  statuses: readonly StatusInfo[];
  /** True while the project's list is being read. */
  isLoading: boolean;
}

/**
 * Reads the project's status list once per project path. The server keeps
 * it in memory for a few minutes, so the call is cheap after the first one.
 * On failure the built-in list stands in — the server does the same when bd
 * is too old to report statuses.
 */
export function useStatuses(projectPath: string): UseStatusesResult {
  const [statuses, setStatuses] = useState<readonly StatusInfo[]>(BUILTIN_STATUSES);
  const [isLoading, setIsLoading] = useState(projectPath !== "");

  useEffect(() => {
    setStatuses(BUILTIN_STATUSES);
    if (!projectPath) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    api.statuses
      .get(projectPath)
      .then((result) => {
        if (!cancelled) setStatuses(result.statuses);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        console.warn("Could not read the project's statuses, using bd's built-in list:", {
          projectPath,
          error: message,
        });
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  return { statuses, isLoading };
}
