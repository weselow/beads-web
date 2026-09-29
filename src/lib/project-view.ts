/**
 * How the project page shows its beads: the Kanban board or the tree. The
 * choice lives in the address as ?view=tree; no parameter means the board.
 */

export type ProjectView = "board" | "tree";

/** The view named by the ?view parameter; anything but "tree" is the board. */
export function parseProjectView(value: string | null): ProjectView {
  return value === "tree" ? "tree" : "board";
}

/**
 * The query string for the view, keeping every other parameter. The board is
 * the default, so it drops ?view instead of writing view=board.
 */
export function projectViewSearch(current: URLSearchParams, view: ProjectView): string {
  const params = new URLSearchParams(current);
  if (view === "tree") params.set("view", "tree");
  else params.delete("view");
  return `?${params.toString()}`;
}
