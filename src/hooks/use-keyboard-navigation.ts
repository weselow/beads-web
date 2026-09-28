"use client";

import { useCallback, useEffect, useState, RefObject } from "react";

import type { Bead, BoardColumn } from "@/types";

/**
 * Letters kept for the three columns every project has, after 'g'
 */
const LETTER_SHORTCUTS = new Map<string, string>([
  ["o", "open"],
  ["p", "in_progress"],
  ["c", "closed"],
]);

/**
 * Column a key picks after 'g': a letter for open, in progress or closed, or
 * 1..9 for the columns in board order. `undefined` when the key picks none.
 */
export function columnForShortcut(key: string, columnOrder: readonly string[]): string | undefined {
  const letter = LETTER_SHORTCUTS.get(key.toLowerCase());
  if (letter !== undefined) return letter;
  return /^[1-9]$/.test(key) ? columnOrder[Number(key) - 1] : undefined;
}

/** Column that holds the bead, if any */
function columnHolding(columns: readonly BoardColumn[], beadId: string): BoardColumn | undefined {
  return columns.find((c) => c.beads.some((b) => b.id === beadId));
}

export interface KeyboardNavigationOptions {
  beads: Bead[];
  /** The board's columns, in the order they are drawn */
  columns: readonly BoardColumn[];
  selectedId: string | null;
  onSelect: (bead: Bead) => void;
  onOpen: (bead: Bead) => void;
  onClose: () => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  isDetailOpen: boolean;
}

export interface KeyboardNavigationResult {
  selectedId: string | null;
  selectedColumnStatus: string | null;
  setSelectedId: (id: string | null) => void;
  setSelectedColumnStatus: (status: string | null) => void;
  scrollToSelected: () => void;
}

/**
 * Hook for keyboard navigation in the Kanban board
 *
 * Shortcuts:
 * - j or ArrowDown: Move selection down
 * - k or ArrowUp: Move selection up
 * - Enter: Open selected bead detail
 * - Escape: Close detail sheet / clear selection
 * - /: Focus search input
 * - g then o: Go to Open column
 * - g then p: Go to In Progress column
 * - g then c: Go to Closed column
 * - g then 1..9: Go to that column, counting from the left
 */
export function useKeyboardNavigation({
  beads,
  columns,
  selectedId,
  onSelect,
  onOpen,
  onClose,
  searchInputRef,
  isDetailOpen,
}: KeyboardNavigationOptions): KeyboardNavigationResult {
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(selectedId);
  const [selectedColumnStatus, setSelectedColumnStatus] = useState<string | null>(null);
  const [awaitingColumnKey, setAwaitingColumnKey] = useState(false);

  // Sync internal state with external selectedId
  useEffect(() => {
    setInternalSelectedId(selectedId);
  }, [selectedId]);

  /**
   * Get the current column's beads for the selected bead
   */
  const getCurrentColumnBeads = useCallback((): Bead[] => {
    if (selectedColumnStatus) {
      return columns.find((c) => c.status === selectedColumnStatus)?.beads ?? [];
    }
    if (!internalSelectedId) {
      // Default to first non-empty column
      return columns.find((c) => c.beads.length > 0)?.beads ?? [];
    }
    return columnHolding(columns, internalSelectedId)?.beads ?? beads;
  }, [internalSelectedId, selectedColumnStatus, columns, beads]);

  /**
   * Get current index of selected bead in its column
   */
  const getCurrentIndex = useCallback((): number => {
    const columnBeads = getCurrentColumnBeads();
    if (!internalSelectedId) return -1;
    return columnBeads.findIndex((b) => b.id === internalSelectedId);
  }, [internalSelectedId, getCurrentColumnBeads]);

  /**
   * Move selection in a direction (up or down)
   */
  const moveSelection = useCallback(
    (direction: "up" | "down") => {
      const columnBeads = getCurrentColumnBeads();
      if (columnBeads.length === 0) return;

      const currentIndex = getCurrentIndex();
      let newIndex: number;

      if (currentIndex === -1) {
        // No selection, select first or last based on direction
        newIndex = direction === "down" ? 0 : columnBeads.length - 1;
      } else {
        newIndex =
          direction === "down"
            ? Math.min(currentIndex + 1, columnBeads.length - 1)
            : Math.max(currentIndex - 1, 0);
      }

      const newBead = columnBeads[newIndex];
      if (newBead) {
        setInternalSelectedId(newBead.id);
        onSelect(newBead);
        // Update column status based on selected bead
        const column = columnHolding(columns, newBead.id);
        if (column) setSelectedColumnStatus(column.status);
      }
    },
    [getCurrentColumnBeads, getCurrentIndex, onSelect, columns]
  );

  /**
   * Jump to a specific column
   */
  const jumpToColumn = useCallback(
    (status: string) => {
      const columnBeads = columns.find((c) => c.status === status)?.beads ?? [];
      setSelectedColumnStatus(status);
      if (columnBeads.length > 0) {
        const firstBead = columnBeads[0];
        setInternalSelectedId(firstBead.id);
        onSelect(firstBead);
      } else {
        setInternalSelectedId(null);
      }
    },
    [columns, onSelect]
  );

  /**
   * Scroll the selected bead into view
   */
  const scrollToSelected = useCallback(() => {
    if (!internalSelectedId) return;
    const element = document.querySelector(`[data-bead-id="${internalSelectedId}"]`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [internalSelectedId]);

  // Scroll into view when selection changes
  useEffect(() => {
    scrollToSelected();
  }, [internalSelectedId, scrollToSelected]);

  /**
   * Handle keyboard events
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't handle if focused on an input (except for Escape)
      const target = event.target as HTMLElement;
      const isInputFocused =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      // Always handle Escape
      if (event.key === "Escape") {
        event.preventDefault();
        if (isDetailOpen) {
          onClose();
        } else if (isInputFocused) {
          target.blur();
        } else if (internalSelectedId) {
          setInternalSelectedId(null);
          setSelectedColumnStatus(null);
        }
        setAwaitingColumnKey(false);
        return;
      }

      // Skip other shortcuts if in input
      if (isInputFocused) return;

      // Handle 'g' prefix for column navigation
      if (awaitingColumnKey) {
        setAwaitingColumnKey(false);
        const targetStatus = columnForShortcut(event.key, columns.map((c) => c.status));
        if (targetStatus) {
          event.preventDefault();
          jumpToColumn(targetStatus);
        }
        return;
      }

      switch (event.key) {
        case "j":
        case "ArrowDown":
          event.preventDefault();
          if (!isDetailOpen) {
            moveSelection("down");
          }
          break;

        case "k":
        case "ArrowUp":
          event.preventDefault();
          if (!isDetailOpen) {
            moveSelection("up");
          }
          break;

        case "Enter":
          event.preventDefault();
          if (internalSelectedId && !isDetailOpen) {
            const selectedBead = beads.find((b) => b.id === internalSelectedId);
            if (selectedBead) {
              onOpen(selectedBead);
            }
          }
          break;

        case "/":
          event.preventDefault();
          searchInputRef.current?.focus();
          break;

        case "g":
          event.preventDefault();
          setAwaitingColumnKey(true);
          // Reset after timeout if no follow-up key
          setTimeout(() => setAwaitingColumnKey(false), 1000);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    beads,
    columns,
    internalSelectedId,
    isDetailOpen,
    awaitingColumnKey,
    moveSelection,
    jumpToColumn,
    onOpen,
    onClose,
    searchInputRef,
  ]);

  return {
    selectedId: internalSelectedId,
    selectedColumnStatus,
    setSelectedId: setInternalSelectedId,
    setSelectedColumnStatus,
    scrollToSelected,
  };
}
