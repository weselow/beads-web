"use client";

import { CornerLeftUp } from "lucide-react";

import { formatBeadId } from "@/lib/bead-utils";
import { cn } from "@/lib/utils";
import type { Bead } from "@/types";

export interface ParentLinkProps {
  parent: Bead;
  /** The parent's ticket number; its short id is shown when there is none */
  ticketNumber?: number;
  onOpen: (parent: Bead) => void;
  className?: string;
}

/**
 * "part of #N" mark on a card whose parent is not an epic. It sits inside the
 * card, which opens on click and on Enter/Space itself, so the mark keeps
 * both from reaching the card and opens the parent instead.
 */
export function ParentLink({ parent, ticketNumber, onOpen, className }: ParentLinkProps) {
  const label = ticketNumber !== undefined ? `#${ticketNumber}` : formatBeadId(parent.id);
  return (
    <button
      type="button"
      aria-label={`Open parent: ${parent.title}`}
      title={parent.title}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(parent);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") e.stopPropagation();
      }}
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-medium text-t-muted shrink-0",
        "hover:text-foreground hover:underline",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
        className
      )}
    >
      <CornerLeftUp className="size-3" aria-hidden="true" />
      part of {label}
    </button>
  );
}
