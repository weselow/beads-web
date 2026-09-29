/**
 * What the tree view remembers per project: the rows the user collapsed and
 * the Show closed switch. Kept in localStorage; when storage is off or broken
 * the tree still works, it just forgets on reload.
 */

import { useCallback, useEffect, useState } from "react";

const storageKey = (projectId: string, name: "collapsed" | "showClosed") =>
  `beads-web:tree:${projectId}:${name}`;

function readStored(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch (err) {
    console.warn("Tree view: cannot read saved state", { key, err });
    return undefined;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn("Tree view: cannot save state", { key, err });
  }
}

interface TreeState {
  projectId: string;
  /** Collapsed rows; everything else is expanded. Ids no longer in the data do no harm. */
  collapsed: ReadonlySet<string>;
  showClosed: boolean;
}

function loadState(projectId: string): TreeState {
  const ids = readStored(storageKey(projectId, "collapsed"));
  const strings = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  return { projectId, collapsed: new Set(strings), showClosed: readStored(storageKey(projectId, "showClosed")) === true };
}

export function useTreeState(projectId: string) {
  const [stored, setState] = useState(() => loadState(projectId));
  // Another project: read its own state during render, so no frame shows the old one
  const state = stored.projectId === projectId ? stored : loadState(projectId);
  if (state !== stored) setState(state);

  useEffect(() => {
    writeStored(storageKey(state.projectId, "collapsed"), Array.from(state.collapsed));
    writeStored(storageKey(state.projectId, "showClosed"), state.showClosed);
  }, [state]);

  const toggleCollapsed = useCallback((id: string) => setState((s) => {
    const collapsed = new Set(s.collapsed);
    if (!collapsed.delete(id)) collapsed.add(id);
    return { ...s, collapsed };
  }), []);
  const setCollapsed = useCallback((ids: Iterable<string>) => setState((s) => ({ ...s, collapsed: new Set(ids) })), []);
  const setShowClosed = useCallback((showClosed: boolean) => setState((s) => ({ ...s, showClosed })), []);

  return { collapsed: state.collapsed, showClosed: state.showClosed, toggleCollapsed, setCollapsed, setShowClosed };
}
