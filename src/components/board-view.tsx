"use client";

import { useMemo, type RefObject } from "react";

import { KanbanColumn } from "@/components/kanban-column";
import { useKeyboardNavigation } from "@/hooks/use-keyboard-navigation";
import { buildBoardColumns, selectBoardBeads } from "@/lib/board-columns";
import { filterBoardTypes } from "@/lib/ideas";
import type { IssueTypeFilter } from "@/lib/issue-types";
import type { Bead, StatusInfo } from "@/types";

export interface BoardViewProps {
  /** Every bead of the project */
  beads: Bead[];
  /** Beads that passed the filter bar, before the issue type filter */
  filteredBeads: Bead[];
  typeFilter: IssueTypeFilter;
  statuses: readonly StatusInfo[];
  ticketNumbers: Map<string, number>;
  projectPath: string;
  readOnly: boolean;
  onUpdate: () => void;
  onOpenBead: (bead: Bead) => void;
  onNavigateToBead: (beadId: string) => void;
  /** Keyboard: Escape closes the card while it is open */
  isDetailOpen: boolean;
  onCloseDetail: () => void;
  /** Keyboard: '/' focuses the search field */
  searchInputRef: RefObject<HTMLInputElement>;
}

/**
 * Beads with a card of their own, then the issue type filter. Children of an
 * epic appear inside the epic card; children of any other parent get their
 * own card. Stories stay off the board unless Story is picked: they live in
 * the Ideas panel.
 */
function useBoardColumns({ beads, filteredBeads, typeFilter, statuses }: BoardViewProps) {
  const topLevelBeads = useMemo(
    () => filterBoardTypes(selectBoardBeads(filteredBeads, beads), typeFilter),
    [filteredBeads, beads, typeFilter]
  );
  // A column per status of the project; pinned beads sit at the top of open,
  // empty minor columns collapse.
  const columns = useMemo(() => buildBoardColumns(topLevelBeads, statuses), [topLevelBeads, statuses]);
  return { topLevelBeads, columns };
}

/**
 * The Kanban board: a column per status, with the board's keyboard
 * navigation. The keys work only while the board is on screen.
 */
export function BoardView(props: BoardViewProps) {
  const { beads, statuses, ticketNumbers, projectPath, readOnly, onUpdate, onOpenBead, onNavigateToBead } = props;
  const { topLevelBeads, columns } = useBoardColumns(props);

  const { selectedId } = useKeyboardNavigation({
    beads: topLevelBeads,
    columns,
    selectedId: null,
    onSelect: () => {
      // Just highlight, don't open detail
    },
    onOpen: onOpenBead,
    onClose: props.onCloseDetail,
    searchInputRef: props.searchInputRef,
    isDetailOpen: props.isDetailOpen,
  });

  return (
    <div className="flex h-full overflow-x-auto" style={{ gap: "var(--column-gap)" }}>
      {columns.map(({ status, title, category, collapsed, beads: columnBeads }) => (
        <KanbanColumn
          key={status}
          status={status}
          title={title}
          category={category}
          collapsed={collapsed}
          beads={columnBeads}
          allBeads={beads}
          selectedBeadId={selectedId}
          ticketNumbers={ticketNumbers}
          onSelectBead={onOpenBead}
          onChildClick={onOpenBead}
          onNavigateToDependency={onNavigateToBead}
          projectPath={projectPath}
          onUpdate={onUpdate}
          readOnly={readOnly}
          statuses={statuses}
        />
      ))}
    </div>
  );
}
