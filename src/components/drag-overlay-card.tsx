"use client";

import { formatBeadId, truncate } from "@/lib/bead-utils";
import { cn } from "@/lib/utils";
import type { Bead } from "@/types";

interface DragOverlayCardProps {
  bead: Bead;
}

export function DragOverlayCard({ bead }: DragOverlayCardProps) {
  return (
    <div className={cn(
      "theme-card bg-card border border-border/40 p-3 shadow-2xl rotate-2 opacity-90 w-64",
      "pointer-events-none"
    )}>
      <div className="text-xs font-mono text-muted-foreground mb-1">
        {formatBeadId(bead.id)}
      </div>
      <div className="font-semibold text-sm leading-tight">
        {truncate(bead.title, 50)}
      </div>
    </div>
  );
}
