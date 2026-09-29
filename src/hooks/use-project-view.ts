"use client";

import { useCallback } from "react";

import { useRouter, useSearchParams } from "next/navigation";

import { parseProjectView, projectViewSearch, type ProjectView } from "@/lib/project-view";

/**
 * The project page's view, read from ?view and changed with router.replace,
 * so a switch does not add a history entry and the other parameters stay.
 */
export function useProjectView(): [ProjectView, (view: ProjectView) => void] {
  const searchParams = useSearchParams();
  const router = useRouter();
  const view = parseProjectView(searchParams.get("view"));

  const setView = useCallback(
    (next: ProjectView) => {
      router.replace(projectViewSearch(new URLSearchParams(searchParams.toString()), next));
    },
    [router, searchParams]
  );

  return [view, setView];
}
